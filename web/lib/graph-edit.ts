"use client"

// Graph editing client: entities (every entity is a note's node), edges, the ontology, and
// the note ↔ graph reads (backlinks, related). Keys start with /api/brain/ or /api/notes so the
// shared realtime stream (lib/realtime.tsx, `graph` + `note` events) revalidates them.
// Contract: plugins/brain/internal/brain/graph_edit_handlers.go + graph_edit.go.
import { useSyncExternalStore } from "react"
import useSWR, { mutate as globalMutate } from "swr"

import { api, ApiError } from "@/lib/api"
import type { Note } from "@/lib/notes"
import { noRetryOn4xx } from "@/lib/queries"

export type Entity = {
  id: string
  namespace: string
  name: string
  type: string
  summary: string
  metadata: Record<string, unknown>
  naturalKey?: string
  noteId?: string
  deleted: boolean
  createdAt: string
}

export type EntityEdge = {
  id: string
  relation: string
  label: string
  direction: "out" | "in"
  fact?: string
  weight: number
  origin: string
  otherId: string
  otherName: string
  otherType: string
  otherNoteId?: string
  validFrom: string
}

export type EntityDetail = Entity & {
  edges: EntityEdge[] | null
  memories: { id: string; content: string; validAt: string }[] | null
}

export type OntologyType = { name: string; description: string; count: number; builtin: boolean; src?: string; dst?: string }
export type Ontology = { namespace: string; entityTypes: OntologyType[]; edgeTypes: OntologyType[] }

export type NoteLink = { id: string; title: string; category?: string; relation?: string }
export type RelatedEntity = {
  id: string
  type: string
  name: string
  noteId?: string
  relation: string
  edge: string
  backwards: boolean
  notes: NoteLink[]
  links: { relation: string; edge: string; backwards: boolean; id: string; name: string; type: string }[]
}

const enc = encodeURIComponent

/** Edges authored by a note ([[wikilinks]]) or by extraction: edit the note, not the edge. */
export const isLockedEdge = (e: Pick<EntityEdge, "origin">) => e.origin === "wikilink" || e.origin === "extract"

/** Metadata keys the server owns; the properties editor hides them. */
export const isInternalKey = (k: string) => k === "note_id" || k === "source" || k === "deleted" || k.startsWith("origin")

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (s: string) => UUID_RE.test(s)

export const entityKey = (id: string) => `/api/brain/entities/${enc(id)}`
export const ontologyKey = (ns: string) => `/api/brain/ontology?namespace=${enc(ns)}`

export const graphApi = {
  entity: (id: string) => api<EntityDetail>(entityKey(id)),
  updateEntity: (
    id: string,
    patch: { name?: string; entity_type?: string; summary?: string; metadata?: Record<string, unknown>; create_type?: boolean },
  ) => api<{ entity: Entity; note: Note | null }>(entityKey(id), { method: "PATCH", json: patch }),
  createEntity: (body: { namespace: string; name: string; entity_type?: string; summary?: string; create_type?: boolean }) =>
    api<Entity>("/api/brain/entities", { json: body }),
  entityNote: (id: string) => api<{ note: Note; created: boolean }>(`${entityKey(id)}/note`, { method: "POST", json: {} }),
  search: (namespace: string, q: string, type = "", limit = 12) =>
    api<{ entities: Entity[] }>(
      `/api/brain/entities/search?${new URLSearchParams({ namespace, q, type, limit: String(limit) })}`,
    ).then((r) => r.entities ?? []),
  createEdge: (body: {
    namespace: string
    src_id: string
    dst_id: string
    relation: string
    fact?: string
    weight?: number
    create_type?: boolean
  }) => api<unknown>("/api/brain/edges", { json: body }),
  updateEdge: (id: string, patch: { relation?: string; fact?: string; weight?: number; create_type?: boolean }) =>
    api<unknown>(`/api/brain/edges/${enc(id)}`, { method: "PATCH", json: patch }),
  deleteEdge: (id: string) => api<unknown>(`/api/brain/edges/${enc(id)}`, { method: "DELETE" }),
  ontology: (ns: string) => api<Ontology>(ontologyKey(ns)),
  createEntityType: (namespace: string, name: string, description = "") =>
    api<OntologyType>("/api/brain/ontology/entity-types", { json: { namespace, name, description } }),
  createEdgeType: (namespace: string, name: string, description = "") =>
    api<OntologyType>("/api/brain/ontology/edge-types", { json: { namespace, name, description } }),
  backlinks: (noteId: string) =>
    api<{ backlinks: NoteLink[] | null }>(`/api/notes/${enc(noteId)}/backlinks`).then((r) => r.backlinks ?? []),
  related: (noteId: string) =>
    api<{ related: RelatedEntity[] | null }>(`/api/notes/${enc(noteId)}/related`).then((r) => r.related ?? []),
}

export function useEntity(id: string | null) {
  return useSWR<EntityDetail>(id ? entityKey(id) : null, () => graphApi.entity(id!), noRetryOn4xx)
}

export function useOntology(ns: string | null) {
  return useSWR<Ontology>(ns ? ontologyKey(ns) : null, () => graphApi.ontology(ns!), {
    ...noRetryOn4xx,
    keepPreviousData: true,
  })
}

export function useEntitySearch(ns: string, q: string, enabled = true) {
  return useSWR<Entity[]>(
    enabled && ns ? ["/api/brain/entities/search", ns, q] : null,
    () => graphApi.search(ns, q),
    { ...noRetryOn4xx, keepPreviousData: true },
  )
}

export function useBacklinks(noteId: string | null) {
  return useSWR<NoteLink[]>(noteId ? `/api/notes/${enc(noteId)}/backlinks` : null, () => graphApi.backlinks(noteId!), noRetryOn4xx)
}

export function useRelated(noteId: string | null) {
  return useSWR<RelatedEntity[]>(noteId ? `/api/notes/${enc(noteId)}/related` : null, () => graphApi.related(noteId!), noRetryOn4xx)
}

/** Revalidate the (heavy) graph payload for a brain, plus an entity if given. */
export function refreshGraph(ns: string, entityId?: string | null) {
  void globalMutate((key) => Array.isArray(key) && key[0] === "/api/brain/graph" && key[1] === ns)
  void globalMutate(ontologyKey(ns))
  if (entityId) void globalMutate(entityKey(entityId))
}

// ── Read-only brains ─────────────────────────────────────────────────────
// The console has no up-front "can I write this brain?" answer, so the first 403 on a graph
// write flips the brain to read-only for the session and every editor renders as a viewer.
const readOnly = new Set<string>()
const listeners = new Set<() => void>()

export function markReadOnly(ns: string) {
  if (readOnly.has(ns)) return
  readOnly.add(ns)
  for (const l of listeners) l()
}

export function useReadOnly(ns: string) {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => readOnly.has(ns),
    () => false,
  )
}

/** A write error: flips the brain read-only on 403 and returns a message for the toast. */
export function writeErrorMessage(ns: string, err: unknown, fallback: string, lockedMsg?: string): string {
  if (err instanceof ApiError) {
    if (err.status === 403 && !/csrf/i.test(err.message)) markReadOnly(ns)
    if (err.status === 409 && lockedMsg) return lockedMsg
    return err.message
  }
  return fallback
}
