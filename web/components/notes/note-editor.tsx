"use client"

// One note's editor: title, markdown body (Write / Preview), tags, pin, archive. Autosaves
// ~800ms after the last change with optimistic concurrency (`version` in the PUT body); a 409
// shows the "changed elsewhere" banner with keep-mine / use-theirs.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import {
  AlertTriangleIcon, ArchiveIcon, ArchiveRestoreIcon, ArrowLeftIcon, HistoryIcon, PinIcon, PinOffIcon, XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { ConfirmButton } from "@/components/confirm-button"
import { NoteMarkdown } from "@/components/notes/note-markdown"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { NoteConflict, notesApi, useNoteVersions, type Note } from "@/lib/notes"
import { cn } from "@/lib/utils"

type Draft = { title: string; body: string; tags: string[]; pinned: boolean; archived: boolean }
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error"

const toDraft = (n: Note): Draft => ({
  title: n.title,
  body: n.body ?? "",
  tags: n.tags ?? [],
  pinned: n.pinned,
  archived: n.archived,
})

const DEBOUNCE_MS = 800

export function NoteEditor({
  note,
  onSaved,
  onDeleted,
  onBack,
}: {
  note: Note
  onSaved: (n: Note) => void
  onDeleted: () => void
  onBack: () => void
}) {
  const { t, isRtl, timeAgo, formatDate } = useTranslations()
  const [draft, setDraft] = useState<Draft>(() => toDraft(note))
  const [server, setServer] = useState<Note>(note)
  const [state, setState] = useState<SaveState>("idle")
  const [conflict, setConflict] = useState<Note | null>(null)
  const [tagInput, setTagInput] = useState("")
  const [tab, setTab] = useState<string>("write")
  const [versionsOpen, setVersionsOpen] = useState(false)

  const version = useRef(note.version)
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
      const n = await notesApi.update(note.id, version.current, draftRef.current)
      version.current = n.version
      setServer(n)
      setState(dirty.current ? "dirty" : "saved")
      onSavedRef.current(n)
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
  useEffect(
    () => () => {
      if (timer.current && dirty.current) void save()
    },
    [save],
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

  function addTag() {
    const next = tagInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    setTagInput("")
    if (next.length === 0) return
    edit({ tags: Array.from(new Set([...draft.tags, ...next])) })
  }

  function onTagKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      addTag()
    } else if (e.key === "Backspace" && tagInput === "" && draft.tags.length > 0) {
      edit({ tags: draft.tags.slice(0, -1) })
    }
  }

  async function remove() {
    try {
      await notesApi.remove(note.id)
      dirty.current = false
      toast.success(t("notes.deletedToast"))
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
          : t("notes.updated", { when: timeAgo(server.updatedAt) })

  return (
    <div className="flex min-w-0 flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-6 py-2">
        <Button variant="ghost" size="sm" className="lg:hidden" onClick={onBack}>
          <ArrowLeftIcon className="rtl:-scale-x-100" />
          {t("notes.back")}
        </Button>
        <span className={cn("text-xs text-grid-muted", state === "error" && "text-grid-danger-text")} aria-live="polite">
          {status} · {t("notes.version", { n: server.version })}
        </span>
        <div className="ms-auto flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={draft.pinned}
            onClick={() => edit({ pinned: !draft.pinned }, true)}
          >
            {draft.pinned ? <PinOffIcon /> : <PinIcon />}
            {draft.pinned ? t("notes.unpin") : t("notes.pin")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={draft.archived}
            onClick={() => edit({ archived: !draft.archived }, true)}
          >
            {draft.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
            {draft.archived ? t("notes.unarchive") : t("notes.archive")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setVersionsOpen(true)}>
            <HistoryIcon />
            {t("notes.versions")}
          </Button>
          <ConfirmButton
            label={t("notes.delete")}
            title={t("notes.deleteTitle")}
            description={t("notes.deleteBody")}
            confirmLabel={t("notes.delete")}
            onConfirm={remove}
          />
        </div>
      </div>

      {conflict ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-line bg-amber-500/10 px-6 py-3 text-sm">
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
        <p className="flex items-start gap-2 border-b border-line px-6 py-2 text-xs text-grid-warn">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          {t("notes.indexFailed", { error: server.indexError })}
        </p>
      ) : null}

      <div className="flex flex-col gap-4 px-6 py-5">
        <input
          dir="auto"
          value={draft.title}
          onChange={(e) => edit({ title: e.target.value })}
          placeholder={t("notes.titlePlaceholder")}
          aria-label={t("notes.titlePlaceholder")}
          className="w-full bg-transparent text-2xl font-medium text-grid-fg outline-none placeholder:text-grid-muted"
        />

        {/* Tags */}
        <div className="flex flex-wrap items-center gap-1.5">
          {draft.tags.map((tag) => (
            <span key={tag} className="grid-chip inline-flex items-center gap-1">
              <bdi>{tag}</bdi>
              <button
                type="button"
                aria-label={t("notes.removeTag", { tag })}
                onClick={() => edit({ tags: draft.tags.filter((x) => x !== tag) })}
                className="text-grid-muted hover:text-grid-fg"
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
          <Input
            dir="auto"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={onTagKey}
            onBlur={addTag}
            placeholder={t("notes.tagsPlaceholder")}
            aria-label={t("notes.tagsPlaceholder")}
            className="h-7 w-48 text-xs"
          />
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
          <TabsList variant="line">
            <TabsTrigger value="write">{t("notes.write")}</TabsTrigger>
            <TabsTrigger value="preview">{t("notes.preview")}</TabsTrigger>
          </TabsList>
          <TabsContent value="write">
            <Textarea
              dir="auto"
              value={draft.body}
              onChange={(e) => edit({ body: e.target.value })}
              placeholder={t("notes.bodyPlaceholder")}
              aria-label={t("notes.bodyPlaceholder")}
              className="min-h-[50vh] resize-y rounded-none font-mono text-sm leading-relaxed"
            />
          </TabsContent>
          <TabsContent value="preview" className="min-h-[50vh] border border-line px-4 py-3">
            {draft.body.trim() ? (
              <NoteMarkdown text={draft.body} />
            ) : (
              <p className="text-sm text-grid-muted">{t("notes.nothingToPreview")}</p>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Sheet open={versionsOpen} onOpenChange={setVersionsOpen}>
        <SheetContent side={isRtl ? "left" : "right"} className="gap-0 p-0">
          <SheetHeader className="border-b border-line px-6 py-4">
            <SheetTitle>{t("notes.versionsTitle")}</SheetTitle>
          </SheetHeader>
          <VersionList
            id={note.id}
            open={versionsOpen}
            current={server.version}
            onRestore={restore}
            formatDate={formatDate}
          />
        </SheetContent>
      </Sheet>
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
