import { useEffect, useState } from "react";

import type {
  OfflineEdit,
  OfflineNote,
  OfflineNotePatch,
  OfflineQuery,
  SyncChangeEvent,
  SyncStatus,
} from "../../shared/ipc";
import type { Note, NotePage, NotePatch } from "../lib/api";
import { bridge } from "../lib/bridge";

/*
The renderer half of the offline cache + sync engine (src/main/services.ts,
src/main/offline/*). The main process keeps every brain's notes on disk and
syncs them in the background; this module is how screens read that cache
FIRST and let the network revalidate after.

Every function degrades to a no-op / null where there is no desktop bridge
(the browser preview) or the user turned the cache off, so callers never need
to branch on the platform.

  Reading
    cachedNotesPage(ns, view)      a NotePage from disk, instantly (or null)
    isOfflineCursor / nextCachedPage   paging through the cache
    cachedNote(ns, id)             one note (full body) from disk
    onSyncChange(fn)               notes changed by a pull, a push, a conflict
  Writing
    queueSave(base, patch)         save through the outbox (works offline)
    queueCreate(ns, patch)         create through the outbox (a `local:` id)
    queueDelete(note)
    resolveBase(note)              the version to PUT after this app's own
                                   queued pushes (avoids a self-409)
    rememberNote(note)             write-through of a note fetched online
  Status
    useSyncStatus()                online/offline/syncing, last synced, pending
    syncNow(), clearCache()

Wired today: features/notes/use-notes-list.ts (cache-first list + live sync
changes) and features/notes/notes-api.ts saveNote (offline fallback,
write-through, self-write rebase). See the README "Desktop services" section
for the rest the UI can adopt.
*/

const z = () => bridge();

export function offlineAvailable(): boolean {
  return typeof z().offlineNotes === "function";
}

export const OFFLINE_CURSOR = "offline:";
export const isOfflineCursor = (c: string | undefined): boolean => Boolean(c && c.startsWith(OFFLINE_CURSOR));
export const isLocalNoteId = (id: string): boolean => id.startsWith("local:");

type View = { filter: "all" | "pinned" | "archived"; sort: "updated" | "created" | "title"; q: string };

function query(view: View, offset = 0, limit = 50): OfflineQuery {
  return { filter: view.filter, sort: view.sort, q: view.q, offset, limit };
}

function toPage(r: { notes: OfflineNote[]; nextOffset?: number }): NotePage {
  return {
    notes: r.notes as unknown as Note[],
    nextCursor: r.nextOffset !== undefined ? `${OFFLINE_CURSOR}${r.nextOffset}` : undefined,
  };
}

/** The first page of a list view from the cache; null when there is no
 *  cache for this brain (never synced, cache off, browser preview). */
export async function cachedNotesPage(ns: string, view: View, limit = 50): Promise<NotePage | null> {
  if (!offlineAvailable()) return null;
  try {
    const r = await z().offlineNotes!(ns, query(view, 0, limit));
    if (!r.syncedAt && !r.notes.length) return null;
    return toPage(r);
  } catch {
    return null;
  }
}

/** The page after an `offline:<n>` cursor. */
export async function nextCachedPage(ns: string, view: View, cursor: string, limit = 50): Promise<NotePage> {
  const offset = Number(cursor.slice(OFFLINE_CURSOR.length)) || 0;
  const r = await z().offlineNotes!(ns, query(view, offset, limit));
  return toPage(r);
}

export async function cachedNote(ns: string, id: string): Promise<Note | null> {
  if (!offlineAvailable()) return null;
  return ((await z().offlineNote!(ns, id).catch(() => null)) as unknown as Note | null) ?? null;
}

/** Notes changed in the cache. Returns an unsubscribe. */
export function onSyncChange(fn: (e: SyncChangeEvent) => void): () => void {
  return z().onSyncChange?.(fn) ?? (() => undefined);
}

/** A note the renderer got from the API: keep the cache in step. */
export function rememberNote(note: Note): void {
  void z().offlinePut?.(note as unknown as OfflineNote)?.catch(() => undefined);
}

function patchOf(p: NotePatch): OfflineNotePatch {
  return p as OfflineNotePatch;
}

/** The values the patched fields had in `base` (the 3-way merge base). */
function baseOf(base: Note, patch: NotePatch): OfflineNotePatch {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) out[k] = (base as unknown as Record<string, unknown>)[k];
  return out as OfflineNotePatch;
}

/** `note` is the optimistic note (null after a delete). */
export type QueuedSave = { ok: true; note: Note | null; queued: true } | { ok: false; error: string };

async function enqueue(edit: OfflineEdit): Promise<QueuedSave> {
  if (!offlineAvailable()) return { ok: false, error: "unavailable" };
  const r = await z().offlineEnqueue!(edit);
  if (!r.ok) return { ok: false, error: r.error ?? "failed" };
  return { ok: true, queued: true, note: (r.note as unknown as Note | null) ?? null };
}

/** Save through the outbox; the engine pushes it when online (409s become
 *  a merge or a "conflicted copy" — see SyncStatus.conflicts). */
export function queueSave(base: Note, patch: NotePatch): Promise<QueuedSave> {
  return enqueue({
    kind: "update",
    namespace: base.namespace,
    id: base.id,
    baseVersion: base.version,
    patch: patchOf(patch),
    base: baseOf(base, patch),
    note: base as unknown as OfflineNote,
    source: "desktop",
  });
}

export function queueCreate(ns: string, patch: NotePatch): Promise<QueuedSave> {
  return enqueue({ kind: "create", namespace: ns, patch: patchOf(patch), source: "desktop" });
}

export function queueDelete(note: Note): Promise<QueuedSave> {
  return enqueue({ kind: "delete", namespace: note.namespace, id: note.id, baseVersion: note.version, source: "desktop" });
}

/**
 * The note to PUT against: follows `local:` ids to their server id and this
 * app's own queued pushes (v -> v+1) so an editor that saved offline does not
 * 409 against itself once back online. `pending` = edits for it are still
 * queued (save through the queue then, to keep their order).
 */
export async function resolveBase(note: Note): Promise<{ note: Note; pending: boolean }> {
  if (!offlineAvailable()) return { note, pending: false };
  try {
    const r = await z().offlineResolveBase!(note.id, note.version);
    return { note: r.id === note.id && r.version === note.version ? note : { ...note, id: r.id, version: r.version }, pending: r.pending };
  } catch {
    return { note, pending: false };
  }
}

/* --------------------------------------------------------------- status */

const IDLE: SyncStatus = { enabled: false, state: "disabled", online: true, lastSyncedAt: null, pending: 0, conflicts: [], namespaces: [] };

/** Live sync status (online/offline/syncing, last synced, pending edits). */
export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(IDLE);
  useEffect(() => {
    let alive = true;
    void z().offlineStatus?.().then((s) => alive && setStatus(s), () => undefined);
    const off = z().onSyncStatus?.((s) => setStatus(s));
    return () => {
      alive = false;
      off?.();
    };
  }, []);
  return status;
}

export function syncNow(): Promise<SyncStatus | undefined> {
  return z().offlineSyncNow?.() ?? Promise.resolve(undefined);
}

export function clearCache(includeQueue = false): Promise<SyncStatus | undefined> {
  return z().offlineClear?.(includeQueue) ?? Promise.resolve(undefined);
}

export function dismissConflict(id: string): Promise<SyncStatus | undefined> {
  return z().offlineDismissConflict?.(id) ?? Promise.resolve(undefined);
}
