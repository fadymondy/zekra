"use client"

// The graph's node inspector. Every node is a note: one click shows the FULL note (title,
// category, tags, meta, rendered body), with Open note (full page), Edit inline (the notes editor,
// autosave + version checks) and Expand (a wide sheet over the graph). Below: the node's links
// (edges; retype / remove / add) and its properties (entity metadata). Viewers (a 403 on write)
// see the same panel read-only. Keyboard: Enter opens the note page, Esc closes.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSWRConfig } from "swr"
import {
  ExternalLinkIcon, EyeIcon, FileTextIcon, Link2Icon, Loader2Icon, Maximize2Icon, PencilIcon, PinIcon, PlusIcon,
  Trash2Icon, XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { CategoryPicker } from "@/components/graph/category-picker"
import { NodeLinks } from "@/components/graph/node-links"
import { NoteEditor } from "@/components/notes/note-editor"
import { NoteMarkdown } from "@/components/notes/note-markdown"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import type { GraphNode } from "@/lib/api"
import { useMemory } from "@/lib/brains"
import {
  entityKey,
  graphApi,
  isInternalKey,
  isUuid,
  refreshGraph,
  useEntity,
  useReadOnly,
  writeErrorMessage,
  type EntityDetail,
} from "@/lib/graph-edit"
import { useTranslations } from "@/lib/i18n"
import { notesApi, useNote, type Note } from "@/lib/notes"
import { cn } from "@/lib/utils"

import { colorForGroup } from "./colors"

const WIDTH_KEY = "brain-inspector-width"
const MIN_W = 340
const MAX_W = 760

const noteKey = (id: string) => `/api/notes/${encodeURIComponent(id)}`

export function noteHref(locale: string, ns: string, noteId: string) {
  return `/${locale}/b/${encodeURIComponent(ns)}/notes?id=${encodeURIComponent(noteId)}`
}

/** Is focus in something that eats Enter/Escape itself? */
function typingTarget(el: EventTarget | null) {
  const h = el as HTMLElement | null
  if (!h) return false
  return !!h.closest("input, textarea, select, button, a, [contenteditable=true], [role=listbox], [role=menu], [role=dialog]")
}

/** Resolve a graph node to its entity id and note id (creating the note on demand). */
export function useNodeNote(node: GraphNode, namespace: string) {
  const readOnly = useReadOnly(namespace)
  const entityFromNode = isUuid(node.id) ? node.id : null
  const [createdNoteId, setCreatedNoteId] = useState<string | null>(null)
  const entity = useEntity(entityFromNode)
  const noteId = node.noteId || entity.data?.noteId || createdNoteId || null
  const note = useNote(noteId)
  const entityId = entityFromNode ?? note.data?.entityId ?? null
  // The entity for a derived memory node comes from its note.
  const entity2 = useEntity(entityFromNode ? null : entityId)
  const detail = entity.data ?? entity2.data

  // An entity with no note yet: make one (POST /entities/{id}/note is idempotent).
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current || readOnly || !entityFromNode || !entity.data || entity.data.noteId || node.noteId) return
    asked.current = true
    graphApi
      .entityNote(entityFromNode)
      .then((r) => setCreatedNoteId(r.note.id))
      .catch((err) => writeErrorMessage(namespace, err, ""))
  }, [entity.data, entityFromNode, node.noteId, readOnly, namespace])

  return { entityId, noteId, note, detail, entityLoading: entity.isLoading || entity2.isLoading }
}

export function NodeInspector({
  node,
  namespace,
  neighbors,
  palette = colorForGroup,
  onFocus,
  onClose,
}: {
  node: GraphNode
  namespace: string
  neighbors: GraphNode[]
  palette?: (group?: string | null) => string
  /** Focus another node; `hint` carries what we know when it isn't drawn in the graph. */
  onFocus: (id: string, hint?: GraphNode) => void
  onClose: () => void
}) {
  const { t, locale, isRtl } = useTranslations()
  const router = useRouter()
  const { mutate } = useSWRConfig()
  const readOnly = useReadOnly(namespace)
  const { entityId, noteId, note, detail, entityLoading } = useNodeNote(node, namespace)
  const structural = node.group === "root" || node.group === "type"
  const [mode, setMode] = useState<"view" | "edit">("view")
  const [expanded, setExpanded] = useState(false)

  // Resizable width, remembered.
  const [width, setWidth] = useState(420)
  useEffect(() => {
    const w = Number(window.localStorage.getItem(WIDTH_KEY))
    if (w >= MIN_W && w <= MAX_W) setWidth(w)
  }, [])
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = width
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) * (isRtl ? 1 : -1)
      setWidth(Math.min(MAX_W, Math.max(MIN_W, w0 + dx)))
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      setWidth((w) => {
        window.localStorage.setItem(WIDTH_KEY, String(w))
        return w
      })
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  // Keyboard: Enter opens the note page, Esc closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (expanded || typingTarget(e.target)) return
      if (e.key === "Escape") onClose()
      else if (e.key === "Enter" && noteId && !e.metaKey && !e.ctrlKey) router.push(noteHref(locale, namespace, noteId))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [expanded, noteId, locale, namespace, onClose, router])

  const n = note.data
  const name = n?.title || detail?.name || node.name
  const category = n?.category || detail?.type || node.type || node.group || "note"
  const color = palette(node.group)

  const fail = (err: unknown) => toast.error(writeErrorMessage(namespace, err, t("common.networkError")))

  /** Rename or recategorise: PATCH the entity (the server re-versions its note), else PUT the note. */
  const patchNode = useCallback(
    async (patch: { name?: string; category?: string; created?: boolean }) => {
      const prevNote = n
      const prevEntity = detail
      if (prevNote && noteId)
        void mutate(
          noteKey(noteId),
          { ...prevNote, ...(patch.name ? { title: patch.name } : {}), ...(patch.category ? { category: patch.category } : {}) },
          { revalidate: false },
        )
      if (prevEntity && entityId)
        void mutate(
          entityKey(entityId),
          { ...prevEntity, ...(patch.name ? { name: patch.name } : {}), ...(patch.category ? { type: patch.category } : {}) },
          { revalidate: false },
        )
      try {
        if (entityId) {
          const r = await graphApi.updateEntity(entityId, {
            ...(patch.name ? { name: patch.name } : {}),
            ...(patch.category ? { entity_type: patch.category, create_type: !!patch.created } : {}),
          })
          if (r.note && noteId) void mutate(noteKey(noteId), r.note, { revalidate: false })
        } else if (prevNote) {
          const saved = await notesApi.update(prevNote.id, prevNote.version, {
            ...(patch.name ? { title: patch.name } : {}),
            ...(patch.category ? { category: patch.category } : {}),
          })
          void mutate(noteKey(saved.id), saved, { revalidate: false })
        }
      } catch (err) {
        if (prevNote && noteId) void mutate(noteKey(noteId), prevNote, { revalidate: false })
        if (prevEntity && entityId) void mutate(entityKey(entityId), prevEntity, { revalidate: false })
        fail(err)
      } finally {
        refreshGraph(namespace, entityId)
        if (noteId) void mutate(noteKey(noteId))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n, detail, noteId, entityId, namespace, mutate],
  )

  const onSavedInline = useCallback(
    (saved: Note) => {
      void mutate(noteKey(saved.id), saved, { revalidate: false })
    },
    [mutate],
  )

  const openOther = (e: { id: string; name: string; type: string; noteId?: string }) =>
    onFocus(e.id, { id: e.id, name: e.name, group: e.type, type: e.type, noteId: e.noteId })

  return (
    <aside
      className="relative flex shrink-0 flex-col border-s border-line bg-grid-card"
      style={{ width }}
      aria-label={t("graph.inspector")}
    >
      {/* Resize handle on the inner edge */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("graph.resize")}
        onPointerDown={startResize}
        className="absolute inset-y-0 -start-1 z-10 w-2 cursor-col-resize hover:bg-grid-soft"
      />

      {/* Header */}
      <div className="space-y-2.5 border-b border-line p-4">
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 shrink-0" style={{ background: color }} />
          {structural || readOnly || (!entityId && !n) ? (
            <Badge variant="outline">{category}</Badge>
          ) : (
            <CategoryPicker
              namespace={namespace}
              value={category}
              onChange={(c, created) => c !== category && patchNode({ category: c, created })}
            />
          )}
          <div className="ms-auto flex items-center">
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("common.close")} title={t("graph.closeHint")}>
              <XIcon />
            </Button>
          </div>
        </div>

        <NameField
          key={name}
          value={name}
          readOnly={structural || readOnly || (!entityId && !n)}
          onCommit={(v) => patchNode({ name: v })}
        />

        {noteId ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" nativeButton={false} render={<Link href={noteHref(locale, namespace, noteId)} />} title={t("graph.openNoteHint")}>
              <ExternalLinkIcon className="rtl:-scale-x-100" />
              {t("graph.openNote")}
            </Button>
            {!readOnly && n ? (
              <Button size="sm" variant="outline" onClick={() => setMode(mode === "edit" ? "view" : "edit")} aria-pressed={mode === "edit"}>
                {mode === "edit" ? <EyeIcon /> : <PencilIcon />}
                {mode === "edit" ? t("graph.doneEditing") : t("graph.editInline")}
              </Button>
            ) : null}
            {n ? (
              <Button size="sm" variant="ghost" onClick={() => setExpanded(true)}>
                <Maximize2Icon />
                {t("graph.expand")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* The note */}
        {noteId ? (
          note.error ? (
            <p className="p-4 text-xs text-grid-muted">{note.error.message}</p>
          ) : !n ? (
            <p className="flex items-center gap-2 p-4 text-xs text-grid-muted">
              <Loader2Icon className="size-3.5 animate-spin" /> {t("graph.loadingNote")}
            </p>
          ) : mode === "edit" ? (
            <NoteEditor
              key={n.id}
              note={n}
              embedded
              initialMode="write"
              onSaved={onSavedInline}
              onDeleted={() => {
                setMode("view")
                onClose()
              }}
            />
          ) : (
            <NoteView note={n} />
          )
        ) : structural ? null : entityLoading ? (
          <p className="flex items-center gap-2 p-4 text-xs text-grid-muted">
            <Loader2Icon className="size-3.5 animate-spin" /> {t("graph.loadingNote")}
          </p>
        ) : detail ? (
          detail.summary ? (
            <div className="p-4">
              <NoteMarkdown text={detail.summary} />
            </div>
          ) : null
        ) : (
          <LegacyMemory node={node} namespace={namespace} />
        )}

        {/* Links + properties */}
        <div className="space-y-6 border-t border-line p-4">
          {entityId ? (
            <NodeLinks namespace={namespace} entityId={entityId} onOpenNode={openOther} compact />
          ) : (
            <NeighborList neighbors={neighbors} palette={palette} onFocus={(id) => onFocus(id)} />
          )}
          {entityId && detail ? <PropertiesEditor namespace={namespace} entity={detail} /> : null}
          {readOnly ? <p className="text-[11px] text-grid-muted">{t("graph.readOnly")}</p> : null}
        </div>
      </div>

      {/* Expand: the note in a wide sheet over the graph */}
      <Sheet open={expanded} onOpenChange={setExpanded}>
        <SheetContent
          side={isRtl ? "left" : "right"}
          className="w-full gap-0 overflow-y-auto p-0 data-[side=left]:sm:max-w-[720px] data-[side=right]:sm:max-w-[720px]"
        >
          <SheetTitle className="sr-only">{name}</SheetTitle>
          {n ? (
            readOnly ? (
              <div className="p-6">
                <h2 dir="auto" className="mb-3 text-xl font-medium text-grid-fg">
                  {n.title}
                </h2>
                <NoteView note={n} />
              </div>
            ) : (
              <NoteEditor
                key={`x-${n.id}`}
                note={n}
                onSaved={onSavedInline}
                onOpenNote={(id) => router.push(noteHref(locale, namespace, id))}
                onDeleted={() => {
                  setExpanded(false)
                  onClose()
                }}
              />
            )
          ) : null}
        </SheetContent>
      </Sheet>
    </aside>
  )
}

function NameField({ value, readOnly, onCommit }: { value: string; readOnly: boolean; onCommit: (v: string) => void }) {
  const { t } = useTranslations()
  const [v, setV] = useState(value)
  if (readOnly)
    return (
      <h2 dir="auto" className="break-words text-base font-medium leading-snug text-grid-fg">
        {value}
      </h2>
    )
  const commit = () => {
    const next = v.trim()
    if (next && next !== value) onCommit(next)
    else setV(value)
  }
  return (
    <input
      dir="auto"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          ;(e.target as HTMLInputElement).blur()
        } else if (e.key === "Escape") {
          e.stopPropagation()
          setV(value)
        }
      }}
      aria-label={t("graph.name")}
      className="w-full border-b border-transparent bg-transparent text-base font-medium leading-snug text-grid-fg outline-none hover:border-line focus:border-grid-fg"
    />
  )
}

/** The note, read: tags, meta, rendered body. */
export function NoteView({ note }: { note: Note }) {
  const { t, timeAgo } = useTranslations()
  return (
    <div className="space-y-3 p-4">
      {note.tags?.length ? (
        <div className="flex flex-wrap gap-1">
          {note.tags.map((tag) => (
            <span key={tag} className="grid-chip">
              <bdi>{tag}</bdi>
            </span>
          ))}
        </div>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-grid-muted">
        {note.pinned ? <PinIcon className="size-3 text-grid-action" aria-label={t("notes.pinned")} /> : null}
        <span>{t("notes.updated", { when: timeAgo(note.updatedAt) })}</span>
        <span aria-hidden>·</span>
        <span>{t("notes.version", { n: note.version })}</span>
        {note.source ? (
          <>
            <span aria-hidden>·</span>
            <bdi className="font-mono">{note.source}</bdi>
          </>
        ) : null}
      </p>
      {(note.body ?? "").trim() ? (
        <div className="max-w-[75ch]">
          <NoteMarkdown text={note.body!} />
        </div>
      ) : (
        <p className="text-sm text-grid-muted">{t("graph.emptyNote")}</p>
      )}
    </div>
  )
}

/** A pre-notes memory node (no note behind it): its content, read-only. */
function LegacyMemory({ node, namespace }: { node: GraphNode; namespace: string }) {
  const { t } = useTranslations()
  const uuid = node.id.startsWith("ent:") ? node.id.slice(4) : null
  const mem = useMemory(namespace, uuid)
  if (!uuid) return null
  if (mem.isLoading)
    return (
      <p className="flex items-center gap-2 p-4 text-xs text-grid-muted">
        <Loader2Icon className="size-3.5 animate-spin" /> {t("graph.loadingMemory")}
      </p>
    )
  return mem.data?.content ? (
    <div className="p-4">
      <NoteMarkdown text={mem.data.content} />
    </div>
  ) : null
}

function NeighborList({
  neighbors,
  palette,
  onFocus,
}: {
  neighbors: GraphNode[]
  palette: (g?: string | null) => string
  onFocus: (id: string) => void
}) {
  const { t, formatNumber } = useTranslations()
  return (
    <div>
      <div className="grid-micro mb-2 flex items-center gap-1.5">
        <Link2Icon className="size-3.5" /> {t("graph.connections")} <span>{formatNumber(neighbors.length)}</span>
      </div>
      {neighbors.length === 0 ? (
        <p className="text-xs text-grid-muted">{t("graph.noConnections")}</p>
      ) : (
        <ul className="max-h-96 divide-y divide-line overflow-y-auto border-y border-line">
          {neighbors.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => onFocus(n.id)} className="flex w-full items-center gap-2 px-2 py-1.5 text-start hover:bg-grid-soft">
                <span aria-hidden className="h-4 w-1 shrink-0" style={{ background: palette(n.group) }} />
                <span className="min-w-0 flex-1 truncate text-xs text-grid-fg" dir="auto">
                  {n.name}
                </span>
                <span className="shrink-0 text-[10px] text-grid-muted">{n.group}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const showValue = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v))
const parseValue = (s: string): unknown => {
  const x = s.trim()
  if (/^(-?\d+(\.\d+)?|true|false|\[.*\]|\{.*\})$/s.test(x)) {
    try {
      return JSON.parse(x)
    } catch {
      /* keep the string */
    }
  }
  return s
}

/** Key/value editor over the entity's metadata (server-owned keys hidden). The server merges the
 *  patch into the stored JSON, so a removed key is sent as null and null values are hidden. */
function PropertiesEditor({ namespace, entity }: { namespace: string; entity: EntityDetail }) {
  const { t, formatNumber } = useTranslations()
  const { mutate } = useSWRConfig()
  const readOnly = useReadOnly(namespace)
  const rows = useMemo(
    () =>
      Object.entries(entity.metadata ?? {})
        .filter(([k, v]) => !isInternalKey(k) && v !== null)
        .sort(([a], [b]) => a.localeCompare(b)),
    [entity.metadata],
  )
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState("")
  const [newVal, setNewVal] = useState("")

  async function save(patch: Record<string, unknown>) {
    const key = entityKey(entity.id)
    const prev = entity
    void mutate(key, { ...prev, metadata: { ...prev.metadata, ...patch } }, { revalidate: false })
    try {
      await graphApi.updateEntity(entity.id, { metadata: patch })
    } catch (err) {
      void mutate(key, prev, { revalidate: false })
      toast.error(writeErrorMessage(namespace, err, t("common.networkError")))
    } finally {
      void mutate(key)
    }
  }

  return (
    <div>
      <div className="grid-micro mb-2 flex items-center gap-1.5">
        {t("graph.properties")} <span>{formatNumber(rows.length)}</span>
        {!readOnly && !adding ? (
          <Button variant="ghost" size="xs" className="ms-auto" onClick={() => setAdding(true)}>
            <PlusIcon /> {t("graph.addProperty")}
          </Button>
        ) : null}
      </div>
      {rows.length === 0 && !adding ? <p className="text-xs text-grid-muted">{t("graph.noProperties")}</p> : null}
      {rows.length ? (
        <dl className="divide-y divide-line border-y border-line">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 py-1">
              <dt className="w-1/3 shrink-0 truncate font-mono text-[11px] text-grid-muted" dir="ltr" title={k}>
                {k}
              </dt>
              <dd className="min-w-0 flex-1">
                {readOnly ? (
                  <span dir="auto" className="block truncate text-xs text-grid-fg" title={showValue(v)}>
                    {showValue(v)}
                  </span>
                ) : (
                  <PropValue value={showValue(v)} onCommit={(s) => save({ [k]: parseValue(s) })} />
                )}
              </dd>
              {!readOnly ? (
                <Button variant="ghost" size="icon-xs" onClick={() => save({ [k]: null })} aria-label={t("graph.removeProperty", { key: k })}>
                  <Trash2Icon />
                </Button>
              ) : null}
            </div>
          ))}
        </dl>
      ) : null}
      {adding ? (
        <form
          className="mt-2 flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            const k = newKey.trim()
            if (!k || isInternalKey(k)) return
            void save({ [k]: parseValue(newVal) })
            setAdding(false)
            setNewKey("")
            setNewVal("")
          }}
        >
          <Input autoFocus dir="ltr" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder={t("graph.propertyKey")} aria-label={t("graph.propertyKey")} className="h-7 w-1/3 font-mono text-xs" />
          <Input dir="auto" value={newVal} onChange={(e) => setNewVal(e.target.value)} placeholder={t("graph.propertyValue")} aria-label={t("graph.propertyValue")} className="h-7 min-w-0 flex-1 text-xs" />
          <Button type="submit" size="icon-sm" variant="ghost" aria-label={t("common.save")}>
            <PlusIcon />
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => setAdding(false)} aria-label={t("common.cancel")}>
            <XIcon />
          </Button>
        </form>
      ) : null}
    </div>
  )
}

function PropValue({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input
      dir="auto"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur()
        else if (e.key === "Escape") {
          e.stopPropagation()
          setV(value)
        }
      }}
      className="w-full truncate border-b border-transparent bg-transparent py-0.5 text-xs text-grid-fg outline-none hover:border-line focus:border-grid-fg"
    />
  )
}

/** The hover preview card: title, category, the first lines of the note. */
export function NodeHoverCard({ node, x, y }: { node: GraphNode; x: number; y: number }) {
  const { t } = useTranslations()
  const note = useNote(node.noteId ?? null)
  const body = (note.data?.body ?? "").replace(/[#>*_`[\]]/g, "").trim()
  const lines = body.split(/\n+/).filter(Boolean).slice(0, 2).join(" ")
  const left = typeof window !== "undefined" ? Math.min(x + 14, window.innerWidth - 300) : x
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 w-72 border border-line bg-popover p-3 text-xs shadow-md"
      style={{ left, top: y + 14 }}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <FileTextIcon className="size-3.5 shrink-0 text-grid-muted" />
        <span dir="auto" className="min-w-0 flex-1 truncate font-medium text-grid-fg">
          {note.data?.title || node.name}
        </span>
      </div>
      <p className="mb-1 text-[10px] uppercase tracking-wider text-grid-muted">{note.data?.category || node.type || node.group}</p>
      {node.noteId ? (
        <p dir="auto" className="line-clamp-2 text-grid-body">
          {note.isLoading ? t("common.loading") : lines || t("graph.emptyNote")}
        </p>
      ) : null}
      <p className="mt-1.5 text-[10px] text-grid-muted">{t("graph.hoverHint")}</p>
    </div>
  )
}

/** Hover state with a short delay, so sweeping across the graph doesn't fetch every note. */
export function useHoverCard() {
  const [card, setCard] = useState<{ node: GraphNode; x: number; y: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const enter = useCallback((node: GraphNode, e: { clientX: number; clientY: number }) => {
    if (timer.current) clearTimeout(timer.current)
    const { clientX: x, clientY: y } = e
    timer.current = setTimeout(() => setCard({ node, x, y }), 350)
  }, [])
  const leave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setCard(null)
  }, [])
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  return { card, enter, leave }
}
