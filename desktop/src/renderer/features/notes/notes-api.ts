import { ApiError, request, zekraApi, type Note, type NotePage, type NotePatch } from "../../lib/api";
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
  create: (token: string, ns: string, patch: NotePatch) => zekraApi.createNote(token, ns, patch),
  update: (token: string, note: Note, patch: NotePatch) => zekraApi.updateNote(token, note, patch),
  remove: (token: string, note: Note) => zekraApi.deleteNote(token, note),
  versions: (token: string, id: string) =>
    request<{ id: string; versions: NoteVersion[] }>(`/api/notes/${enc(id)}/versions`, { token }),
  /** Writes the old version back as a new one. */
  restore: (token: string, id: string, version: number) =>
    request<Note>(`/api/notes/${enc(id)}/restore`, { method: "POST", token, json: { version } }),
};

/** PUT with the version the edit was based on; a 409 is reported, not thrown. */
export async function saveNote(token: string, base: Note, patch: NotePatch): Promise<NoteSaveResult> {
  try {
    return { ok: true, note: await zekraApi.updateNote(token, base, patch) };
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 0;
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
