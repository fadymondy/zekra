import { request, zekraApi, type Note, type NotePage, type NotePatch } from "@/lib/api";

import { listParams, queryString, type NoteView } from "./notes-core";

/*
React-query keys for the notes feature. Everything a brain's notes list owns
lives under ["notes", namespace]:

  ["notes", ns, "list", view]      one infinite list per view ({filter, sort, q})
  ["notes", ns, "versions", id]    a note's version history

So invalidating ["notes", ns] refreshes one brain, and ["notes"] — what the
note screen does after a save — refreshes every brain. The note screen itself
reads ["note", token, id]; this feature refreshes it by predicate (any key
headed "note" that carries the id), so it does not depend on that key's shape.
*/
export const noteKeys = {
  brain: (ns: string) => ["notes", ns] as const,
  lists: (ns: string) => ["notes", ns, "list"] as const,
  list: (ns: string, view: NoteView) => ["notes", ns, "list", view] as const,
  versions: (ns: string, id: string) => ["notes", ns, "versions", id] as const,
};

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

export const notesApi = {
  /** GET /api/notes — one cursor page of a brain's notes for a view. */
  list: (token: string, ns: string, view: NoteView, cursor?: string, signal?: AbortSignal) =>
    request<NotePage>(`/api/notes?${queryString(listParams(ns, view, cursor))}`, { token, signal }),
  /** PUT /api/notes/{id} with the patch and the version it was based on (409 on a stale version). */
  update: (token: string, note: Note, patch: NotePatch) => zekraApi.updateNote(token, note, patch),
  /** DELETE /api/notes/{id}, If-Match the version. */
  remove: (token: string, note: Note) => zekraApi.deleteNote(token, note),
  versions: (token: string, id: string, signal?: AbortSignal) =>
    request<{ id: string; versions: NoteVersion[] }>(`/api/notes/${encodeURIComponent(id)}/versions`, { token, signal }),
  /** POST /api/notes/{id}/restore — writes the old version back as a new one. */
  restore: (token: string, id: string, version: number) =>
    request<Note>(`/api/notes/${encodeURIComponent(id)}/restore`, { method: "POST", token, json: { version } }),
};
