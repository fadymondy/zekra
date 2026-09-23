// Pure logic of the offline cache + sync engine — no Electron, no fs, no
// network — so it is unit-tested directly (test/sync-core.test.cjs):
//
//   mergeIncoming        apply a pulled page to the cache (at-least-once,
//                        dedupe by (id, version), tombstones, dirty notes)
//   coalesce             add an edit to the outbox, merging with what is
//                        already queued for the same note
//   applyPatch / localView   the optimistic note (server copy + queued edits)
//   resolveConflict      the 3-way merge after a 409
//   classifyStatus       what a push response means
//   backoffDelay         exponential backoff with jitter
//   resolveBaseVersion   follow this app's own pushes (v -> v') so an editor
//                        holding v does not 409 against itself
//   queryNotes           the list views (filter / sort / q / tag / paging)
//
// Server contract (plugins/brain/internal/brain/notes_handlers.go, notes.go):
//   GET /api/notes?namespace=&since=<RFC3339>&limit<=200&cursor=
//     since set => SYNC mode: oldest change first, tombstones included
//     (deleted:true, body omitted), archived included; nextCursor pages it;
//     serverTime (DB clock - 5s safety margin) is the next `since`. Delivery
//     is at-least-once, so clients dedupe by (id, version).
//   POST /api/notes {namespace,title,body,tags,category,pinned,source} -> 201 Note
//   PUT /api/notes/{id} {…patch, version} (or If-Match) -> 200 Note,
//     409 {error:{code:"conflict"}, current: Note}
//   DELETE /api/notes/{id} If-Match: "<v>" -> 200, 409 {current}
"use strict";

import type {
  OfflineEdit,
  OfflineFilter,
  OfflineNote,
  OfflineNotePatch,
  OfflinePatchField,
  OfflineQuery,
  OfflineSort,
} from "../../shared/services";

export const LOCAL_ID_PREFIX = "local:";
export const isLocalId = (id: string): boolean => id.startsWith(LOCAL_ID_PREFIX);

export const PATCH_FIELDS: OfflinePatchField[] = ["title", "description", "body", "tags", "category", "pinned", "archived", "icon", "color"];
/** Fields whose concurrent edits cannot be merged: both sides' text is kept. */
export const TEXT_FIELDS: OfflinePatchField[] = ["title", "description", "body"];

/* --------------------------------------------------------------- queue */

export type OpKind = OfflineEdit["kind"];

export interface QueueOp {
  opId: string;
  kind: OpKind;
  namespace: string;
  /** Real id, or `local:…` for a create (and edits of a not-yet-pushed note). */
  noteId: string;
  /** Version the edit was based on (0 for a create). */
  baseVersion: number;
  /** For create: the whole initial note. For update: the changed fields. */
  patch: OfflineNotePatch;
  /** Values of the patched fields at baseVersion (update only). */
  base: OfflineNotePatch;
  source: string;
  createdAt: string;
  attempts: number;
  /** Epoch ms before which the op is not retried. */
  nextAttemptAt: number;
  lastError?: string;
  /** Being pushed right now: never merged into. */
  inflight?: boolean;
}

export interface CoalesceResult {
  queue: QueueOp[];
  /** The op that now carries the edit (undefined when it cancelled out). */
  op?: QueueOp;
  /** Ops removed from the queue (a create + delete cancels both). */
  dropped: QueueOp[];
  /** The edit was a no-op (e.g. an update of a note already queued for deletion). */
  ignored?: boolean;
}

function samePatchValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  return (a ?? "") === (b ?? "");
}

/** Keep only known fields with a defined value. */
export function cleanPatch(p: OfflineNotePatch | undefined): OfflineNotePatch {
  const out: OfflineNotePatch = {};
  if (!p) return out;
  for (const k of PATCH_FIELDS) {
    const v = p[k];
    if (v === undefined) continue;
    if (k === "tags") {
      if (Array.isArray(v)) out.tags = (v as unknown[]).map(String);
    } else if (k === "pinned" || k === "archived") {
      out[k] = Boolean(v);
    } else {
      (out as Record<string, unknown>)[k] = String(v);
    }
  }
  return out;
}

/**
 * Add `op` to the queue. Edits of the same note merge, so a burst of
 * autosaves while offline becomes ONE push, and a note created and deleted
 * offline never reaches the server at all:
 *
 *   create + update  -> the create carries the merged fields
 *   create + delete  -> both dropped
 *   update + update  -> one update: patches merged (later wins), the base of
 *                       each field is its value before the FIRST edit
 *   update + delete  -> one delete at the first edit's base version
 *   delete + update  -> the update is ignored (the note is going away)
 *
 * In-flight ops are never merged into: the new op is appended and its base
 * version is resolved at push time (resolveBaseVersion).
 */
export function coalesce(queue: readonly QueueOp[], op: QueueOp): CoalesceResult {
  const idx = findLastIndex(queue, (q) => q.noteId === op.noteId && !q.inflight);
  const prev = idx >= 0 ? queue[idx] : undefined;
  const pendingDelete = queue.some((q) => q.noteId === op.noteId && q.kind === "delete");

  if (op.kind !== "delete" && pendingDelete) return { queue: queue.slice(), dropped: [], ignored: true };
  if (!prev) return { queue: [...queue, op], op, dropped: [] };

  const next = queue.slice();
  if (prev.kind === "create") {
    if (op.kind === "delete") {
      const dropped = queue.filter((q) => q.noteId === op.noteId);
      // An in-flight create cannot be recalled: then the delete must follow it.
      if (dropped.some((q) => q.inflight)) return { queue: [...queue, op], op, dropped: [] };
      return { queue: queue.filter((q) => q.noteId !== op.noteId), dropped };
    }
    const merged: QueueOp = { ...prev, patch: { ...prev.patch, ...op.patch } };
    next[idx] = merged;
    return { queue: next, op: merged, dropped: [] };
  }
  if (prev.kind === "update") {
    if (op.kind === "delete") {
      const merged: QueueOp = { ...op, opId: prev.opId, baseVersion: prev.baseVersion, patch: {}, base: {}, attempts: 0, nextAttemptAt: 0 };
      next[idx] = merged;
      return { queue: next, op: merged, dropped: [] };
    }
    const base: OfflineNotePatch = { ...op.base, ...prev.base };
    const merged: QueueOp = { ...prev, patch: { ...prev.patch, ...op.patch }, base };
    next[idx] = merged;
    return { queue: next, op: merged, dropped: [] };
  }
  // prev is a delete
  return { queue: queue.slice(), dropped: [], ignored: true };
}

function findLastIndex<T>(xs: readonly T[], pred: (x: T) => boolean): number {
  for (let i = xs.length - 1; i >= 0; i--) if (pred(xs[i])) return i;
  return -1;
}

/** Next op to push: oldest ready one, creates before edits of the same note. */
export function nextReady(queue: readonly QueueOp[], now: number): QueueOp | undefined {
  return queue.find((q) => !q.inflight && q.nextAttemptAt <= now);
}

/* ------------------------------------------------------------- backoff */

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** 0..1 — fraction of the delay randomised (full jitter at 1). */
  jitter?: number;
  /** Injected for tests; Math.random otherwise. */
  rand?: () => number;
}

/** attempt 1 -> base, 2 -> 2x base, … capped at max; +/- jitter. */
export function backoffDelay(attempt: number, o: BackoffOptions = {}): number {
  const base = o.baseMs ?? 2_000;
  const max = o.maxMs ?? 5 * 60_000;
  const jitter = Math.min(1, Math.max(0, o.jitter ?? 0.2));
  const rand = o.rand ?? Math.random;
  const n = Math.max(1, Math.floor(attempt));
  const raw = Math.min(max, base * 2 ** Math.min(n - 1, 30));
  const spread = raw * jitter;
  return Math.max(0, Math.round(raw - spread + rand() * 2 * spread));
}

export type PushOutcome = "ok" | "conflict" | "gone" | "auth" | "retry" | "reject";

/** What an HTTP status (0 = transport failure) means for a queued push. */
export function classifyStatus(status: number): PushOutcome {
  if (status >= 200 && status < 300) return "ok";
  if (status === 409 || status === 412) return "conflict";
  if (status === 404 || status === 410) return "gone";
  if (status === 401) return "auth";
  if (status === 0 || status === 408 || status === 425 || status === 429 || status >= 500) return "retry";
  return "reject"; // 400, 403, 413, 422 …: retrying will not help
}

/* --------------------------------------------------------------- merge */

export interface NsCache {
  notes: Record<string, OfflineNote>;
  /** The last SERVER copy of notes that have queued local edits (their
   *  `notes` entry is the optimistic local view). */
  shadows: Record<string, OfflineNote>;
}

export interface MergeResult {
  upserted: OfflineNote[];
  removed: string[];
}

/** Server JSON -> cache shape (drop unknown fields; tombstones keep no body). */
export function normaliseRemote(raw: unknown): OfflineNote | null {
  const n = raw as Record<string, unknown> | null;
  if (!n || typeof n.id !== "string" || typeof n.namespace !== "string") return null;
  const out: OfflineNote = {
    id: n.id,
    namespace: n.namespace,
    title: typeof n.title === "string" ? n.title : "",
    // Missing on servers without the column: absent, never an error.
    description: typeof n.description === "string" && n.description ? n.description : undefined,
    body: typeof n.body === "string" ? n.body : "",
    tags: Array.isArray(n.tags) ? n.tags.map(String) : [],
    category: typeof n.category === "string" ? n.category : undefined,
    icon: typeof n.icon === "string" && n.icon ? n.icon : undefined,
    color: typeof n.color === "string" && n.color ? n.color : undefined,
    pinned: Boolean(n.pinned),
    archived: Boolean(n.archived),
    indexed: Boolean(n.indexed),
    indexError: typeof n.indexError === "string" && n.indexError ? n.indexError : undefined,
    chunks: Number(n.chunks) || 0,
    version: Number(n.version) || 0,
    createdAt: typeof n.createdAt === "string" ? n.createdAt : undefined,
    updatedAt: typeof n.updatedAt === "string" ? n.updatedAt : new Date(0).toISOString(),
    source: typeof n.source === "string" ? n.source : undefined,
  };
  if (n.deleted === true) {
    out.deleted = true;
    out.body = "";
  }
  return out;
}

/**
 * Apply pulled notes to one brain's cache (mutates `cache`).
 *
 *  - older than what we hold -> ignored (at-least-once redelivery)
 *  - same version            -> ignored
 *  - a tombstone             -> removed
 *  - a note with queued local edits -> only its shadow (server copy) moves;
 *    the optimistic local view stays until the push resolves
 */
export function mergeIncoming(cache: NsCache, incoming: readonly OfflineNote[], dirty: ReadonlySet<string>): MergeResult {
  const upserted: OfflineNote[] = [];
  const removed: string[] = [];
  for (const n of incoming) {
    if (dirty.has(n.id)) {
      const shadow = cache.shadows[n.id];
      if (!shadow || n.version > shadow.version) cache.shadows[n.id] = n;
      continue;
    }
    const have = cache.notes[n.id];
    if (have && have.version >= n.version && !(n.deleted && !have.deleted)) continue;
    if (n.deleted) {
      if (have) {
        delete cache.notes[n.id];
        removed.push(n.id);
      }
      continue;
    }
    cache.notes[n.id] = n;
    upserted.push(n);
  }
  return { upserted, removed };
}

/* ------------------------------------------------------------ optimism */

export function applyPatch(note: OfflineNote, patch: OfflineNotePatch): OfflineNote {
  return { ...note, ...cleanPatch(patch) };
}

/** A fresh local note for an offline create. */
export function localNote(id: string, namespace: string, patch: OfflineNotePatch, nowIso: string): OfflineNote {
  return {
    id,
    namespace,
    title: patch.title ?? "",
    description: patch.description || undefined,
    body: patch.body ?? "",
    tags: patch.tags ?? [],
    category: patch.category ?? "note",
    icon: patch.icon || undefined,
    color: patch.color || undefined,
    pinned: patch.pinned ?? false,
    archived: patch.archived ?? false,
    indexed: false,
    chunks: 0,
    version: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    pending: true,
    localOnly: true,
  };
}

/** The note as the user should see it: server copy + every queued edit. */
export function localView(server: OfflineNote | undefined, ops: readonly QueueOp[], nowIso: string): OfflineNote | null {
  let note: OfflineNote | null = server ? { ...server } : null;
  for (const op of ops) {
    if (op.kind === "create") note = localNote(op.noteId, op.namespace, op.patch, op.createdAt);
    else if (op.kind === "delete") return null;
    else if (note) note = applyPatch(note, op.patch);
  }
  if (note && ops.length) {
    note.pending = true;
    note.updatedAt = nowIso;
  }
  return note;
}

/** The current values of the patched fields (the 3-way merge base). */
export function pickFields(note: OfflineNote | undefined, patch: OfflineNotePatch): OfflineNotePatch {
  const out: OfflineNotePatch = {};
  if (!note) return out;
  for (const k of Object.keys(patch) as OfflinePatchField[]) {
    (out as Record<string, unknown>)[k] = k === "tags" ? [...(note.tags ?? [])] : (note as unknown as Record<string, unknown>)[k] ?? (k === "pinned" || k === "archived" ? false : "");
  }
  return out;
}

/* ------------------------------------------------------------ conflicts */

export type ConflictResolution =
  /** No field was changed on both sides: re-send the patch on the new version. */
  | { kind: "rebase"; patch: OfflineNotePatch }
  /** title/body changed on both sides: the server keeps its text; `patch` is
   *  what can still be applied (non-conflicting + metadata, ours wins), and
   *  `copy` is our text to keep as a new "conflicted copy" note. */
  | { kind: "fork"; patch: OfflineNotePatch; copy: OfflineNotePatch; fields: OfflinePatchField[] };

/**
 * 3-way merge after a 409: `base` = the patched fields' values when the edit
 * was made, `patch` = our edit, `current` = the server's note now.
 *
 * Per field: server unchanged since base -> ours applies. Server changed it
 * too and to the same value -> nothing to do. Both changed it differently ->
 * text fields (title/body) cannot be merged, so both copies are KEPT
 * ("keep both"); metadata (tags, pin, archive, category, icon, colour) is a
 * single user intent, so the local, later edit wins.
 */
export function resolveConflict(base: OfflineNotePatch, patch: OfflineNotePatch, current: OfflineNote): ConflictResolution {
  const out: OfflineNotePatch = {};
  const conflicted: OfflinePatchField[] = [];
  const cur = current as unknown as Record<string, unknown>;
  for (const k of Object.keys(patch) as OfflinePatchField[]) {
    const mine = (patch as Record<string, unknown>)[k];
    const theirs = cur[k];
    const was = (base as Record<string, unknown>)[k];
    if (samePatchValue(mine, theirs)) continue; // already there
    const serverChanged = was !== undefined ? !samePatchValue(was, theirs) : TEXT_FIELDS.includes(k);
    if (serverChanged && TEXT_FIELDS.includes(k)) {
      conflicted.push(k);
      continue;
    }
    (out as Record<string, unknown>)[k] = mine;
  }
  if (!conflicted.length) return { kind: "rebase", patch: out };
  // The copy carries our full text so nothing typed is lost.
  const c: OfflineNotePatch = {};
  for (const k of TEXT_FIELDS) {
    const v = (patch as Record<string, unknown>)[k] ?? cur[k];
    (c as Record<string, unknown>)[k] = v;
  }
  c.tags = (patch.tags ?? current.tags ?? []).slice();
  if (patch.category ?? current.category) c.category = patch.category ?? current.category;
  return { kind: "fork", patch: out, copy: c, fields: conflicted };
}

/** "Meeting notes (conflicted copy 2026-09-23 14:05)". */
export function conflictCopyTitle(title: string, at: Date, label = "conflicted copy"): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const t = (title || "Untitled").trim();
  return `${t} (${label} ${stamp})`;
}

/* ------------------------------------------------------ self-write chain */

/** version -> version written by this app's queue, per note id. */
export type SelfWrites = Record<string, Record<string, number>>;

/** Remember that the queue moved `id` from `from` to `to`. Keeps the last 20. */
export function recordSelfWrite(chain: SelfWrites, id: string, from: number, to: number): void {
  const m = (chain[id] ??= {});
  m[String(from)] = to;
  const keys = Object.keys(m);
  if (keys.length > 20) for (const k of keys.slice(0, keys.length - 20)) delete m[k];
}

/**
 * An editor that loaded version `v` and saved offline still holds `v` after
 * the queue pushed its edit as v+1; its next online save would 409 against
 * itself. Follow the chain of our own writes to the version to send.
 */
export function resolveBaseVersion(chain: SelfWrites, id: string, v: number): number {
  const m = chain[id];
  if (!m) return v;
  let cur = v;
  for (let i = 0; i < 64; i++) {
    const next = m[String(cur)];
    if (next === undefined || next <= cur) break;
    cur = next;
  }
  return cur;
}

/* -------------------------------------------------------------- queries */

function matchesFilter(n: OfflineNote, filter: OfflineFilter): boolean {
  if (n.deleted) return false;
  if (filter === "archived") return n.archived;
  if (n.archived) return false;
  return filter === "pinned" ? n.pinned : true;
}

function compare(sort: OfflineSort): (a: OfflineNote, b: OfflineNote) => number {
  const byId = (a: OfflineNote, b: OfflineNote) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  if (sort === "title") {
    return (a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()) || -byId(a, b);
  }
  if (sort === "created") {
    return (a, b) => (b.createdAt ?? b.updatedAt).localeCompare(a.createdAt ?? a.updatedAt) || byId(a, b);
  }
  // updated: pinned first, like the server's browse order.
  return (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt) || byId(a, b);
}

export function queryNotes(all: Iterable<OfflineNote>, q: OfflineQuery = {}): { notes: OfflineNote[]; total: number; nextOffset?: number } {
  const filter = q.filter ?? "all";
  const needle = (q.q ?? "").trim().toLowerCase();
  const tag = (q.tag ?? "").trim();
  const rows: OfflineNote[] = [];
  for (const n of all) {
    if (!matchesFilter(n, filter)) continue;
    if (tag && !(n.tags ?? []).includes(tag)) continue;
    if (
      needle &&
      !n.title.toLowerCase().includes(needle) &&
      !(n.description ?? "").toLowerCase().includes(needle) &&
      !(n.body ?? "").toLowerCase().includes(needle)
    )
      continue;
    rows.push(n);
  }
  rows.sort(compare(q.sort ?? "updated"));
  const offset = Math.max(0, Math.floor(q.offset ?? 0));
  const limit = Math.min(1000, Math.max(1, Math.floor(q.limit ?? 100)));
  const notes = rows.slice(offset, offset + limit);
  const end = offset + notes.length;
  return { notes, total: rows.length, nextOffset: end < rows.length ? end : undefined };
}
