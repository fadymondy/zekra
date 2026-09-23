"use client"

// One note's editor, in the desktop app's shape (desktop/src/renderer/features/editor/
// note-editor.tsx): one scrolling page, as in Apple Notes — the note's icon tile (click for icon &
// colour), the title and a one-line description inline, category and tags, then the live WYSIWYG
// body. The markdown source (with the `[[` node picker) is a secondary view from the overflow menu,
// which also holds pin, archive, versions, graph, export and delete. Autosaves ~800ms after the
// last change with optimistic concurrency (`version` in the PUT body); a 409 shows the "changed
// elsewhere" banner with keep-mine / use-theirs. Also embedded in the graph inspector (`embedded`:
// no Links section, tighter padding).
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import Link from "next/link"
import {
  AlertTriangleIcon, ArchiveIcon, ArchiveRestoreIcon, ArrowLeftIcon, Code2Icon, EllipsisIcon, HashIcon, HistoryIcon, NetworkIcon,
  PinIcon, PinOffIcon, PlusIcon, Trash2Icon, XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { CategoryPicker } from "@/components/graph/category-picker"
import { EntityResults } from "@/components/graph/entity-picker"
import { NoteLinksSection } from "@/components/notes/note-links"
import { NoteAppearancePicker } from "@/components/notes/note-appearance-picker"
import { NoteTile } from "@/components/notes/note-list-row"
import { NoteExportItems } from "@/components/notes/note-export"
import { NoteEditorWysiwyg } from "@/components/notes/note-editor-wysiwyg"
import { TagCombobox } from "@/components/notes/tag-combobox"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api"
import { refreshGraph, type Entity } from "@/lib/graph-edit"
import { useTranslations } from "@/lib/i18n"
import { NoteConflict, notesApi, useNoteVersions, type Note } from "@/lib/notes"
import { cn } from "@/lib/utils"

type Draft = {
  title: string
  description: string
  body: string
  tags: string[]
  category: string
  icon: string
  color: string
  pinned: boolean
  archived: boolean
}
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error"

const toDraft = (n: Note): Draft => ({
  title: n.title,
  description: n.description ?? "",
  body: n.body ?? "",
  tags: n.tags ?? [],
  category: n.category || "note",
  icon: n.icon ?? "",
  color: n.color ?? "",
  pinned: n.pinned,
  archived: n.archived,
})

const DEBOUNCE_MS = 800
/** The server's cap on a note's description (notes_handlers.go). */
const DESCRIPTION_MAX = 280

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
  // The markdown source replaces the live body when asked for (overflow menu).
  const [source, setSource] = useState(false)
  const titleRef = useRef<HTMLTextAreaElement | null>(null)
  const descRef = useRef<HTMLTextAreaElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  // A new (empty) note starts in its title, as in Notes.
  useEffect(() => {
    if (initialMode === "write" || (!note.title.trim() && !(note.body ?? "").trim())) titleRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const focusBody = () => {
    const pm = bodyRef.current?.querySelector(".ProseMirror") as HTMLElement | null
    pm?.focus()
  }
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  // The rendered preview, captured by PNG export (MH-212).
  const previewRef = useRef<HTMLDivElement | null>(null)

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

  const px = embedded ? "px-4" : "px-6 xl:px-10"

  return (
    <div className="flex min-w-0 flex-col">
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

      {/* Header: icon tile · title + description · overflow; then category, tags, status. */}
      <div className={cn(embedded ? "pt-4 pb-2" : "pt-7 pb-3", px)}>
        <div className="flex items-start gap-3">
          {onBack ? (
            <Button variant="ghost" size="icon-sm" className="mt-1 lg:hidden" onClick={onBack} aria-label={t("notes.back")}>
              <ArrowLeftIcon className="rtl:-scale-x-100" />
            </Button>
          ) : null}
          <Popover>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label={t("notes.changeIcon")}
                  title={t("notes.changeIcon")}
                  className="mt-0.5 shrink-0 rounded-lg outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-grid-action/50"
                />
              }
            >
              <NoteTile
                note={{ category: draft.category, icon: draft.icon, color: draft.color }}
                className={cn("rounded-lg", embedded ? "size-8" : "size-9")}
                iconClassName="size-[18px]"
              />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-3">
              <NoteAppearancePicker
                icon={draft.icon}
                color={draft.color}
                category={draft.category}
                onChange={(patch) =>
                  edit({ ...(patch.icon !== undefined ? { icon: patch.icon } : {}), ...(patch.color !== undefined ? { color: patch.color } : {}) }, true)
                }
              />
            </PopoverContent>
          </Popover>

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <textarea
              ref={titleRef}
              rows={1}
              dir="auto"
              value={draft.title}
              onChange={(e) => edit({ title: e.target.value.replace(/\n/g, " ") })}
              onKeyDown={(e) => {
                const el = e.currentTarget
                if (e.key === "Enter" || (e.key === "ArrowDown" && el.selectionStart === el.value.length)) {
                  e.preventDefault()
                  descRef.current?.focus()
                }
              }}
              placeholder={t("notes.titlePlaceholder")}
              aria-label={t("notes.titlePlaceholder")}
              className={cn(
                "field-sizing-content w-full resize-none bg-transparent leading-tight font-bold tracking-[-0.01em] text-grid-fg outline-none placeholder:text-grid-muted/50 rtl:tracking-normal",
                embedded ? "text-xl" : "text-[26px]",
              )}
            />
            <textarea
              ref={descRef}
              rows={1}
              dir="auto"
              value={draft.description}
              maxLength={DESCRIPTION_MAX}
              onChange={(e) => edit({ description: e.target.value.replace(/\n/g, " ") })}
              onKeyDown={(e) => {
                const el = e.currentTarget
                if (e.key === "Enter") {
                  e.preventDefault()
                  focusBody()
                } else if ((e.key === "Backspace" && !el.value) || (e.key === "ArrowUp" && el.selectionStart === 0 && el.selectionEnd === 0)) {
                  e.preventDefault()
                  titleRef.current?.focus()
                }
              }}
              placeholder={t("notes.descriptionPlaceholder")}
              aria-label={t("notes.descriptionLabel")}
              className="field-sizing-content max-h-[3lh] w-full resize-none overflow-y-auto bg-transparent text-[15px] leading-snug text-grid-muted outline-none placeholder:text-grid-muted/50"
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="mt-1" aria-label={t("common.actions")} />}>
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem onClick={() => edit({ pinned: !draft.pinned }, true)}>
                {draft.pinned ? <PinOffIcon /> : <PinIcon />}
                {draft.pinned ? t("notes.unpin") : t("notes.pin")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => edit({ archived: !draft.archived }, true)}>
                {draft.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                {draft.archived ? t("notes.unarchive") : t("notes.archive")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSource((v) => !v)}>
                <Code2Icon />
                {source ? t("notes.sourceDone") : t("notes.sourceEdit")}
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
              {/* Export (MH-212). The submenu renders its own items; each one
                  runs client-side except PDF, which posts to the print route. */}
              <NoteExportItems
                input={{
                  title: draft.title,
                  markdown: draft.body,
                  theme: null,
                  surface: previewRef.current,
                }}
              />
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2Icon />
                {t("notes.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className={cn("mt-2.5 flex flex-wrap items-center gap-1.5", !embedded && "ps-12")}>
          <CategoryPicker
            namespace={note.namespace}
            value={draft.category}
            onChange={(c) => edit({ category: c }, true)}
            className="h-6 w-auto min-w-0 gap-1 rounded-md border-transparent bg-[color-mix(in_oklab,var(--grid-fg)_7%,transparent)] px-1.5 text-[13px] shadow-none"
          />
          {draft.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex h-6 items-center gap-0.5 rounded-md bg-[color-mix(in_oklab,var(--grid-fg)_7%,transparent)] ps-1.5 pe-1 text-[13px] text-grid-fg/80"
            >
              <HashIcon className="size-3 text-grid-muted" />
              <bdi>{tag}</bdi>
              <button
                type="button"
                aria-label={t("notes.removeTag", { tag })}
                onClick={() => toggleTag(tag)}
                className="rounded-sm p-px text-grid-muted hover:text-grid-fg"
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
              <Button variant="ghost" size="xs" className="h-6 text-[13px] text-grid-muted">
                <PlusIcon /> {draft.tags.length ? null : t("notes.addTag")}
              </Button>
            }
          />
          <span className="ms-auto flex items-center gap-1.5 text-[12.5px] text-grid-muted">
            {draft.pinned ? <PinIcon className="size-3" aria-label={t("notes.pinned")} /> : null}
            {draft.archived ? <ArchiveIcon className="size-3" aria-label={t("notes.archived")} /> : null}
            <span className={cn(state === "error" && "text-grid-danger-text")} aria-live="polite">
              {status}
            </span>
            <span aria-hidden>·</span>
            <span title={`${formatDate(server.updatedAt, { dateStyle: "medium", timeStyle: "short" })} · ${t("notes.created", { when: timeAgo(server.createdAt) })}`}>
              {t("notes.version", { n: server.version })}
            </span>
          </span>
        </div>
      </div>

      {source ? (
        // The markdown source: a secondary view in place of the live body.
        <div className="flex flex-col">
          <div className={cn("flex items-center gap-2 border-y border-line bg-[color-mix(in_oklab,var(--grid-fg)_4%,transparent)] py-1 text-xs text-grid-muted", px)}>
            <Code2Icon className="size-3.5" />
            <span className="flex-1">{t("notes.sourceTitle")}</span>
            <Button size="xs" variant="ghost" onClick={() => setSource(false)}>
              {t("notes.sourceDone")}
            </Button>
          </div>
          <div className={cn("py-4", px)}>
            <BodyEditor
              namespace={note.namespace}
              value={draft.body}
              onChange={(body) => edit({ body })}
              minHeight={embedded ? "min-h-[40vh]" : "min-h-[55vh]"}
            />
            <p className="mt-1.5 text-[12.5px] text-grid-muted">{t("notes.wikilinkHint")}</p>
          </div>
        </div>
      ) : (
        // One page: the live body right under the header, as in Notes.
        <div
          ref={(el) => {
            bodyRef.current = el
            previewRef.current = el
          }}
          className={cn("pt-1", embedded ? "pb-6" : "min-h-[55vh] pb-24", px)}
        >
          <NoteEditorWysiwyg bare namespace={note.namespace} value={draft.body} onChange={(body) => edit({ body })} />
        </div>
      )}

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
