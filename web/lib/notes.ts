"use client"

// Notes client + SWR hooks. Every key starts with /api/notes so the shared realtime stream
// (lib/realtime.tsx) revalidates them on each `note` event. Contract:
// plugins/brain/internal/brain/notes_handlers.go + notes.go.
import useSWR from "swr"

import { api, ApiError } from "@/lib/api"
import { noRetryOn4xx } from "@/lib/queries"

export type Note = {
  id: string
  namespace: string
  ownerUserId?: string
  title: string
  body?: string
  tags: string[]
  /** The note's graph category (its entity type); "note" by default. */
  category?: string
  /** Appearance overrides (MH-308); "" or absent means derive from category. */
  icon?: string
  color?: string
  /** The note's node in the brain graph. */
  entityId?: string
  pinned: boolean
  archived: boolean
  source: string
  version: number
  chunks: number
  indexed: boolean
  indexError?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
  deleted: boolean
}

export type NoteVersion = {
  version: number
  title: string
  body: string
  tags: string[]
  pinned: boolean
  archived: boolean
  deleted: boolean
  source: string
  authorUserId?: string
  authorAgent?: string
  createdAt: string
}

export type NotePage = { notes: Note[]; nextCursor?: string; serverTime: string }

export type NoteListQuery = { namespace: string; q?: string; tag?: string; category?: string; archived?: boolean; limit?: number; cursor?: string }

export type NotePatch = Partial<Pick<Note, "title" | "body" | "tags" | "category" | "pinned" | "archived" | "icon" | "color">>

/** A 409 from PUT/DELETE: the note moved on; `current` is the server copy. */
export class NoteConflict extends Error {
  constructor(public current: Note) {
    super("conflict")
    this.name = "NoteConflict"
  }
}

function listPath(q: NoteListQuery) {
  const sp = new URLSearchParams({ namespace: q.namespace })
  if (q.q) sp.set("q", q.q)
  if (q.tag) sp.set("tag", q.tag)
  if (q.category) sp.set("category", q.category)
  if (q.archived) sp.set("archived", "1")
  if (q.limit) sp.set("limit", String(q.limit))
  if (q.cursor) sp.set("cursor", q.cursor)
  return `/api/notes?${sp}`
}

const enc = encodeURIComponent

export const notesApi = {
  list: (q: NoteListQuery) => api<NotePage>(listPath(q)),
  get: (id: string) => api<Note>(`/api/notes/${enc(id)}`),
  create: (namespace: string, n: NotePatch = {}) =>
    api<Note>("/api/notes", {
      json: { namespace, title: n.title ?? "", body: n.body ?? "", tags: n.tags ?? [], pinned: n.pinned ?? false, ...(n.category ? { category: n.category } : {}), source: "web" },
    }),
  /** Optimistic update: sends `version` in the body (the handler also accepts If-Match). */
  async update(id: string, version: number, patch: NotePatch): Promise<Note> {
    try {
      return await api<Note>(`/api/notes/${enc(id)}`, { method: "PUT", json: { ...patch, version, source: "web" } })
    } catch (err) {
      // api() keeps only the message; fetch the server copy for the conflict banner.
      if (err instanceof ApiError && err.status === 409) throw new NoteConflict(await notesApi.get(id))
      throw err
    }
  },
  remove: (id: string) => api<Note>(`/api/notes/${enc(id)}`, { method: "DELETE" }),
  versions: (id: string) => api<{ id: string; versions: NoteVersion[] }>(`/api/notes/${enc(id)}/versions`),
  restore: (id: string, version?: number) =>
    api<Note>(`/api/notes/${enc(id)}/restore`, { json: version ? { version } : {} }),
}

export function useNotes(q: NoteListQuery | null) {
  return useSWR<NotePage>(q ? listPath(q) : null, () => notesApi.list(q!), { ...noRetryOn4xx, keepPreviousData: true })
}

export function useNote(id: string | null) {
  return useSWR<Note>(id ? `/api/notes/${enc(id)}` : null, () => notesApi.get(id!), noRetryOn4xx)
}

export function useNoteVersions(id: string | null, enabled: boolean) {
  return useSWR(id && enabled ? `/api/notes/${enc(id)}/versions` : null, () => notesApi.versions(id!).then((r) => r.versions ?? []), noRetryOn4xx)
}

export type TagCount = { tag: string; count: number }

/** Tag → note count for a brain. There is no tags endpoint, so this pages the list (200 a page,
 *  capped) once and caches it under a key the realtime stream leaves alone; call `mutate` after
 *  a local tag edit. Only fetched when `enabled` (e.g. the tag picker is open). */
export function useNoteTagCounts(namespace: string, enabled: boolean) {
  return useSWR<TagCount[]>(
    enabled && namespace ? ["notes-tag-counts", namespace] : null,
    async () => {
      const counts = new Map<string, number>()
      let cursor: string | undefined
      for (let page = 0; page < 25; page++) {
        const res = await notesApi.list({ namespace, limit: 200, cursor })
        for (const n of res.notes ?? []) for (const tag of n.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
        if (!res.nextCursor) break
        cursor = res.nextCursor
      }
      return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    },
    { ...noRetryOn4xx, revalidateIfStale: false, dedupingInterval: 60_000 },
  )
}
