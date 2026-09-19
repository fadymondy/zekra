"use client"

// One note's editor: a clean header (editable title + category), a meta line, an overflow menu
// (pin, archive, versions, view in graph, delete), compact tags, and a Preview / Edit body. Existing
// notes open rendered; new ones open in Edit. Autosaves ~800ms after the last change with
// optimistic concurrency (`version` in the PUT body); a 409 shows the "changed elsewhere" banner
// with keep-mine / use-theirs. Typing `[[` in the body opens a node picker that inserts [[Title]].
// Also embedded in the graph inspector (`embedded`: no Links section, tighter padding).
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import Link from "next/link"
import {
  AlertTriangleIcon, ArchiveIcon, ArchiveRestoreIcon, ArrowLeftIcon, EllipsisIcon, HistoryIcon, NetworkIcon, PinIcon,
  PinOffIcon, PlusIcon, Trash2Icon, XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { CategoryPicker } from "@/components/graph/category-picker"
import { EntityResults } from "@/components/graph/entity-picker"
import { NoteLinksSection } from "@/components/notes/note-links"
import { NoteMarkdown } from "@/components/notes/note-markdown"
import { TagCombobox } from "@/components/notes/tag-combobox"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api"
import { refreshGraph, type Entity } from "@/lib/graph-edit"
import { useTranslations } from "@/lib/i18n"
import { NoteConflict, notesApi, useNoteVersions, type Note } from "@/lib/notes"
import { cn } from "@/lib/utils"

type Draft = { title: string; body: string; tags: string[]; category: string; pinned: boolean; archived: boolean }
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error"

const toDraft = (n: Note): Draft => ({
  title: n.title,
  body: n.body ?? "",
  tags: n.tags ?? [],
  category: n.category || "note",
  pinned: n.pinned,
  archived: n.archived,
})

const DEBOUNCE_MS = 800

/** A link that opens the brain overview focused on this note's graph node. */
export function graphHref(locale: string, note: Pick<Note, "namespace" | "id" | "entityId">) {
  const sp = new URLSearchParams()
  if (note.entityId) sp.set("focus", note.entityId)
  sp.set("note", note.id)
  return `/${locale}/b/${encodeURIComponent(note.namespace)}?${sp}`
}

export function NoteEditor({
  note,
  onSaved,
  onDeleted,
  onBack,
  onOpenNote,
  embedded,
  initialMode,
}: {
  note: Note
  onSaved: (n: Note) => void
  onDeleted: () => void
  onBack?: () => void
  onOpenNote?: (id: string) => void
  embedded?: boolean
  initialMode?: "write" | "preview"
}) {
  const { t, locale, isRtl, timeAgo, formatDate } = useTranslations()
  const [draft, setDraft] = useState<Draft>(() => toDraft(note))
  const [server, setServer] = useState<Note>(note)
  const [state, setState] = useState<SaveState>("idle")
  const [conflict, setConflict] = useState<Note | null>(null)
  const [tab, setTab] = useState<string>(
    () => initialMode ?? (!(note.body ?? "").trim() && !note.title.trim() ? "write" : "preview"),
  )
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const version = useRef(note.version)
  const serverRef = useRef(note)
  useEffect(() => {
    serverRef.current = server
  }, [server])
  const draftRef = useRef(draft)
  const dirty = useRef(false)
  const inFlight = useRef(false)
  const again = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onSavedRef = useRef(onSaved)
  useEffect(() => {
    onSavedRef.current = onSaved
  }, [onSaved])
  // The draft lives in state for rendering and in a ref for the async save path.
  const putDraft = (d: Draft) => {
    draftRef.current = d
    setDraft(d)
  }

  const save = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (!dirty.current) return
    if (inFlight.current) {
      again.current = true
      return
    }
    inFlight.current = true
    dirty.current = false
    setState("saving")
    try {
      const before = serverRef.current
      const n = await notesApi.update(note.id, version.current, draftRef.current)
      version.current = n.version
      setServer(n)
      setState(dirty.current ? "dirty" : "saved")
      onSavedRef.current(n)
      // A title/category/body change moves the note's graph node or its [[links]].
      if (n.title !== before.title || n.category !== before.category || n.body !== before.body) refreshGraph(n.namespace, n.entityId)
    } catch (err) {
      dirty.current = true
      if (err instanceof NoteConflict) {
        setConflict(err.current)
        setState("dirty")
      } else {
        setState("error")
        toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
      }
    } finally {
      inFlight.current = false
      if (again.current) {
        again.current = false
        void save()
      }
    }
  }, [note.id, t])

  // Every edit schedules a save; a conflict pauses autosave until the user picks a side.
  const edit = (patch: Partial<Draft>, immediate = false) => {
    putDraft({ ...draftRef.current, ...patch })
    dirty.current = true
    setState("dirty")
    if (conflict) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), immediate ? 0 : DEBOUNCE_MS)
  }

  // Flush a pending save when leaving the note.
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  }, [save])
  useEffect(
    () => () => {
      if (timer.current && dirty.current) void saveRef.current()
    },
    [],
  )

  // Someone else saved (the realtime stream refetched this note): adopt it if we have no edits.
  useEffect(() => {
    if (note.version > version.current && !dirty.current && !inFlight.current) {
      version.current = note.version
      setServer(note)
      putDraft(toDraft(note))
    }
  }, [note])

  function keepMine() {
    if (!conflict) return
    version.current = conflict.version
    setConflict(null)
    dirty.current = true
    void save()
  }

  function takeTheirs() {
    if (!conflict) return
    version.current = conflict.version
    dirty.current = false
    setServer(conflict)
    putDraft(toDraft(conflict))
    setConflict(null)
    setState("idle")
    onSavedRef.current(conflict)
  }

  async function remove() {
    try {
      await notesApi.remove(note.id)
      dirty.current = false
      toast.success(t("notes.deletedToast"))
      setDeleteOpen(false)
      refreshGraph(note.namespace)
      onDeleted()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
    }
  }

  async function restore(v: number) {
    try {
      const n = await notesApi.restore(note.id, v)
      version.current = n.version
      dirty.current = false
      setServer(n)
      putDraft(toDraft(n))
      setConflict(null)
      setState("saved")
      setVersionsOpen(false)
      toast.success(t("notes.restored", { n: v }))
      onSavedRef.current(n)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
    }
  }

  const status =
    state === "saving"
      ? t("notes.saving")
      : state === "dirty"
        ? t("notes.unsaved")
        : state === "error"
          ? t("notes.saveFailed")
          : t("notes.saved")

  const toggleTag = (tag: string) =>
    edit({ tags: draft.tags.includes(tag) ? draft.tags.filter((x) => x !== tag) : [...draft.tags, tag] }, true)

  const px = embedded ? "px-4" : "px-6"

  return (
    <div className="flex min-w-0 flex-col">
      {/* Header: back (mobile), title, category, overflow */}
      <div className={cn("flex flex-col gap-2 border-b border-line py-4", px)}>
        <div className="flex items-start gap-2">
          {onBack ? (
            <Button variant="ghost" size="icon-sm" className="mt-0.5 lg:hidden" onClick={onBack} aria-label={t("notes.back")}>
              <ArrowLeftIcon className="rtl:-scale-x-100" />
            </Button>
          ) : null}
          <input
            dir="auto"
            value={draft.title}
            onChange={(e) => edit({ title: e.target.value })}
            placeholder={t("notes.titlePlaceholder")}
            aria-label={t("notes.titlePlaceholder")}
            className={cn(
              "min-w-0 flex-1 bg-transparent font-medium text-grid-fg outline-none placeholder:text-grid-muted",
              embedded ? "text-lg" : "text-2xl",
            )}
          />
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("common.actions")} />}>
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuItem onClick={() => edit({ pinned: !draft.pinned }, true)}>
                {draft.pinned ? <PinOffIcon /> : <PinIcon />}
                {draft.pinned ? t("notes.unpin") : t("notes.pin")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => edit({ archived: !draft.archived }, true)}>
                {draft.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                {draft.archived ? t("notes.unarchive") : t("notes.archive")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setVersionsOpen(true)}>
                <HistoryIcon />
                {t("notes.versions")}
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href={graphHref(locale, server)} />}>
                <NetworkIcon />
                {t("notes.viewInGraph")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2Icon />
                {t("notes.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <CategoryPicker namespace={note.namespace} value={draft.category} onChange={(c) => edit({ category: c }, true)} />
          {/* Tags: inline chips + the combobox of existing tags */}
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {draft.tags.map((tag) => (
              <span key={tag} className="grid-chip inline-flex items-center gap-1">
                <bdi>{tag}</bdi>
                <button
                  type="button"
                  aria-label={t("notes.removeTag", { tag })}
                  onClick={() => toggleTag(tag)}
                  className="text-grid-muted hover:text-grid-fg"
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            ))}
            <TagCombobox
              namespace={note.namespace}
              selected={draft.tags}
              onToggle={toggleTag}
              allowCreate
              trigger={
                <Button variant="ghost" size="xs" className="text-grid-muted">
                  <PlusIcon /> {t("notes.addTag")}
                </Button>
              }
            />
          </div>
        </div>

        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-grid-muted">
          <span className={cn(state === "error" && "text-grid-danger-text")} aria-live="polite">
            {status}
          </span>
          <span aria-hidden>·</span>
          <span title={formatDate(server.updatedAt, { dateStyle: "medium", timeStyle: "short" })}>
            {t("notes.updated", { when: timeAgo(server.updatedAt) })}
          </span>
          <span aria-hidden>·</span>
          <span title={formatDate(server.createdAt, { dateStyle: "medium", timeStyle: "short" })}>
            {t("notes.created", { when: timeAgo(server.createdAt) })}
          </span>
          <span aria-hidden>·</span>
          <span>{t("notes.version", { n: server.version })}</span>
          {server.source ? (
            <>
              <span aria-hidden>·</span>
              <bdi className="font-mono">{server.source}</bdi>
            </>
          ) : null}
          {draft.pinned ? (
            <>
              <span aria-hidden>·</span>
              <PinIcon className="size-3 text-grid-action" aria-label={t("notes.pinned")} />
            </>
          ) : null}
          {draft.archived ? (
            <>
              <span aria-hidden>·</span>
              <span>{t("notes.archived")}</span>
            </>
          ) : null}
        </p>
      </div>

      {conflict ? (
        <div role="alert" className={cn("flex flex-wrap items-center gap-3 border-b border-line bg-amber-500/10 py-3 text-sm", px)}>
          <AlertTriangleIcon className="size-4 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-grid-fg">{t("notes.conflictTitle")}</p>
            <p className="text-grid-muted">{t("notes.conflictBody")}</p>
          </div>
          <Button size="sm" onClick={keepMine}>
            {t("notes.keepMine")}
          </Button>
          <Button size="sm" variant="outline" onClick={takeTheirs}>
            {t("notes.useTheirs")}
          </Button>
        </div>
      ) : null}

      {!server.indexed && server.indexError ? (
        <p className={cn("flex items-start gap-2 border-b border-line py-2 text-xs text-grid-warn", px)}>
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          {t("notes.indexFailed", { error: server.indexError })}
        </p>
      ) : null}

      <div className={cn("py-4", px)}>
        <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
          <TabsList variant="line">
            <TabsTrigger value="preview">{t("notes.preview")}</TabsTrigger>
            <TabsTrigger value="write">{t("notes.edit")}</TabsTrigger>
          </TabsList>
          <TabsContent value="write">
            <BodyEditor
              namespace={note.namespace}
              value={draft.body}
              onChange={(body) => edit({ body })}
              minHeight={embedded ? "min-h-[40vh]" : "min-h-[55vh]"}
            />
            <p className="mt-1.5 text-[11px] text-grid-muted">{t("notes.wikilinkHint")}</p>
          </TabsContent>
          <TabsContent value="preview" className={embedded ? "py-2" : "min-h-[40vh] py-3"}>
            {draft.body.trim() ? (
              <div className="max-w-[75ch]">
                <NoteMarkdown text={draft.body} />
              </div>
            ) : (
              <p className="text-sm text-grid-muted">
                {t("notes.nothingToPreview")}{" "}
                <button type="button" className="underline underline-offset-4" onClick={() => setTab("write")}>
                  {t("notes.startWriting")}
                </button>
              </p>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {!embedded ? <NoteLinksSection note={server} onOpenNote={(id) => onOpenNote?.(id)} /> : null}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("notes.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("notes.deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              {t("notes.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={versionsOpen} onOpenChange={setVersionsOpen}>
        <SheetContent side={isRtl ? "left" : "right"} className="gap-0 p-0">
          <SheetHeader className="border-b border-line px-6 py-4">
            <SheetTitle>{t("notes.versionsTitle")}</SheetTitle>
          </SheetHeader>
          <VersionList id={note.id} open={versionsOpen} current={server.version} onRestore={restore} formatDate={formatDate} />
        </SheetContent>
      </Sheet>
    </div>
  )
}

/** The markdown textarea with `[[` autocomplete over the brain's nodes. */
function BodyEditor({
  namespace,
  value,
  onChange,
  minHeight,
}: {
  namespace: string
  value: string
  onChange: (v: string) => void
  minHeight: string
}) {
  const { t } = useTranslations()
  const ref = useRef<HTMLTextAreaElement | null>(null)
  // The open `[[` query: where it starts (after the brackets) and what's typed so far.
  const [wiki, setWiki] = useState<{ start: number; query: string } | null>(null)
  const [active, setActive] = useState(0)
  const results = useRef<Entity[]>([])

  const detect = (text: string, caret: number) => {
    const before = text.slice(0, caret)
    const m = /\[\[([^[\]\n|]{0,60})$/.exec(before)
    if (m) {
      setWiki({ start: caret - m[1].length, query: m[1] })
      setActive(0)
    } else setWiki(null)
  }

  const insert = (e: Entity) => {
    const el = ref.current
    if (!el || !wiki) return
    const caret = el.selectionStart
    let after = value.slice(caret)
    if (after.startsWith("]]")) after = after.slice(2)
    const next = value.slice(0, wiki.start) + e.name + "]]" + after
    const pos = wiki.start + e.name.length + 2
    onChange(next)
    setWiki(null)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!wiki) return
    const n = results.current.length
    if (e.key === "ArrowDown" && n) {
      e.preventDefault()
      setActive((a) => (a + 1) % n)
    } else if (e.key === "ArrowUp" && n) {
      e.preventDefault()
      setActive((a) => (a - 1 + n) % n)
    } else if ((e.key === "Enter" || e.key === "Tab") && n) {
      e.preventDefault()
      insert(results.current[Math.min(active, n - 1)])
    } else if (e.key === "Escape") {
      e.preventDefault()
      setWiki(null)
    }
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        dir="auto"
        spellCheck={false}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          detect(e.target.value, e.target.selectionStart)
        }}
        onKeyDown={onKeyDown}
        onClick={(e) => detect(value, e.currentTarget.selectionStart)}
        onBlur={() => setTimeout(() => setWiki(null), 150)}
        placeholder={t("notes.bodyPlaceholder")}
        aria-label={t("notes.bodyPlaceholder")}
        aria-autocomplete="list"
        className={cn("resize-y rounded-none font-mono text-sm leading-relaxed", minHeight)}
      />
      {wiki ? (
        <div className="absolute inset-x-2 bottom-2 z-20 max-w-sm border border-line bg-popover p-1 shadow-md">
          <p className="grid-micro px-2 pb-1 pt-0.5">{t("notes.wikilinkPick")}</p>
          <EntityResults
            namespace={namespace}
            query={wiki.query}
            active={active}
            onPick={insert}
            onResults={(l) => {
              results.current = l
            }}
          />
        </div>
      ) : null}
    </div>
  )
}

function VersionList({
  id,
  open,
  current,
  onRestore,
  formatDate,
}: {
  id: string
  open: boolean
  current: number
  onRestore: (v: number) => Promise<void>
  formatDate: (v: string, o?: Intl.DateTimeFormatOptions) => string
}) {
  const { t } = useTranslations()
  const q = useNoteVersions(id, open)
  const [busy, setBusy] = useState<number | null>(null)
  const list = [...(q.data ?? [])].sort((a, b) => b.version - a.version)

  if (q.isLoading) return <p className="px-6 py-4 text-sm text-grid-muted">{t("common.loading")}</p>
  if (list.length <= 1) return <p className="px-6 py-4 text-sm text-grid-muted">{t("notes.versionsEmpty")}</p>
  return (
    <ol className="divide-y divide-line overflow-y-auto">
      {list.map((v) => (
        <li key={v.version} className="flex items-center gap-3 px-6 py-3">
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="flex items-center gap-2 text-sm">
              <span className="font-mono text-xs text-grid-muted">{t("notes.version", { n: v.version })}</span>
              <span dir="auto" className="truncate text-grid-fg">
                {v.title || t("notes.untitled")}
              </span>
            </p>
            <p className="text-xs text-grid-muted">
              {formatDate(v.createdAt, { dateStyle: "medium", timeStyle: "short" })} · <bdi>{v.authorAgent || v.source}</bdi>
              {v.deleted ? ` · ${t("notes.deleted")}` : ""}
            </p>
          </div>
          {v.version === current ? (
            <span className="grid-micro">{t("notes.current")}</span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={async () => {
                setBusy(v.version)
                try {
                  await onRestore(v.version)
                } finally {
                  setBusy(null)
                }
              }}
            >
              {busy === v.version ? t("common.working") : t("notes.restore")}
            </Button>
          )}
        </li>
      ))}
    </ol>
  )
}
