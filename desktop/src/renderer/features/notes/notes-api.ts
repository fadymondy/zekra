import { ApiError, request, zekraApi, type Note, type NotePage, type NotePatch } from "../../lib/api";
import { isLocalNoteId, queueCreate, queueDelete, queueSave, rememberNote, resolveBase } from "../../services/offline";
import { listParams, queryString, type NoteView } from "./notes-model";

/*
The note calls the workspace makes on top of lib/api.ts (which is shared by
every feature team and kept small). Same endpoints the mobile app uses
(mobile/src/features/notes/api.ts, mobile/src/features/editor/api.ts).
*/

/** One entry of GET /api/notes/{id}/versions (newest first). */
export type NoteVersion = {
  version: number;
  title: string;
  body: string;
  tags: string[];
  category?: string;
  pinned: boolean;
  archived: boolean;
  deleted: boolean;
  source: string;
  authorUserId?: string;
  authorAgent?: string;
  createdAt: string;
};

export type NoteSaveResult =
  | { ok: true; note: Note }
  | { ok: false; conflict: boolean; error: string; status: number };

const enc = encodeURIComponent;

export const notesApi = {
  list: (token: string, ns: string, view: NoteView, cursor?: string) =>
    request<NotePage>(`/api/notes?${queryString(listParams(ns, view, cursor))}`, { token }),
  get: (token: string, id: string) => zekraApi.note(token, id),
  // Offline (transport failure): creates and deletes go to the desktop outbox
  // (services/offline.ts); a create then has a temporary `local:` id.
  create: (token: string, ns: string, patch: NotePatch) =>
    offlineFallback(zekraApi.createNote(token, ns, patch), async () => (await queueCreate(ns, patch))),
  update: (token: string, note: Note, patch: NotePatch) => zekraApi.updateNote(token, note, patch),
  remove: (token: string, note: Note) =>
    offlineFallback(zekraApi.deleteNote(token, note), async () => {
      const q = await queueDelete(note);
      return q.ok ? { ...q, note } : q;
    }),
  versions: (token: string, id: string) =>
    request<{ id: string; versions: NoteVersion[] }>(`/api/notes/${enc(id)}/versions`, { token }),
  /** Writes the old version back as a new one. */
  restore: (token: string, id: string, version: number) =>
    request<Note>(`/api/notes/${enc(id)}/restore`, { method: "POST", token, json: { version } }),
};

/** Run `online`; on a transport failure (status 0) fall back to the offline
 *  outbox. Anything else (4xx/5xx) is rethrown unchanged. */
async function offlineFallback<T>(online: Promise<T>, offline: () => Promise<{ ok: boolean; note?: Note | null }>): Promise<T> {
  try {
    const res = await online;
    if (res && typeof res === "object" && "version" in (res as object)) rememberNote(res as unknown as Note);
    return res;
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 0) throw e;
    const q = await offline().catch(() => null);
    if (q?.ok && q.note) return q.note as unknown as T;
    throw e;
  }
}

/**
 * PUT with the version the edit was based on; a 409 is reported, not thrown.
 *
 * Desktop offline support (services/offline.ts): the base is first rebased
 * over this app's own queued pushes; if edits for the note are still queued
 * (or it only exists locally) the save joins the outbox to keep their order;
 * a transport failure also lands in the outbox. Either way the result is
 * `ok` with the optimistic note (`pending: true` on it until pushed).
 */
export async function saveNote(token: string, base: Note, patch: NotePatch): Promise<NoteSaveResult> {
  const { note: b, pending } = await resolveBase(base);
  if (pending || isLocalNoteId(b.id)) {
    const q = await queueSave(b, patch);
    if (q.ok && q.note) return { ok: true, note: q.note };
  }
  try {
    const note = await zekraApi.updateNote(token, b, patch);
    rememberNote(note);
    return { ok: true, note };
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 0;
    if (status === 0) {
      const q = await queueSave(b, patch).catch(() => null);
      if (q?.ok && q.note) return { ok: true, note: q.note };
    }
    return { ok: false, conflict: status === 409, error: e instanceof Error ? e.message : String(e), status };
  }
}

/** Overwrite: re-read the server's current version and PUT ours over it. */
export async function overwriteNote(token: string, id: string, patch: NotePatch): Promise<Note> {
  const server = await zekraApi.note(token, id);
  return zekraApi.updateNote(token, server, patch);
}

/*
Tag suggestions: the brain's tags by how many notes carry them. There is no
tag endpoint, so — like the web's useNoteTagCounts — this pages through the
notes (bounded) and counts. Cached per brain for the session; `bump` keeps the
cache honest when the editor adds a tag.
*/
export type TagCount = { tag: string; count: number };
const tagCache = new Map<string, Promise<TagCount[]>>();

export function tagCounts(token: string, ns: string): Promise<TagCount[]> {
  const hit = tagCache.get(ns);
  if (hit) return hit;
  const job = (async () => {
    const counts = new Map<string, number>();
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res = await request<NotePage>(
        `/api/notes?${queryString({ namespace: ns, limit: "200", archived: "1", ...(cursor ? { cursor } : {}) })}`,
        { token },
      );
      for (const n of res.notes ?? []) for (const tag of n.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  })();
  job.catch(() => tagCache.delete(ns));
  tagCache.set(ns, job);
  return job;
}

export function forgetTagCounts(ns: string): void {
  tagCache.delete(ns);
}
