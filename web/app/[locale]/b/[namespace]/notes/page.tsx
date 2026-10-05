"use client"

// A brain's notes, in the desktop app's shape (desktop/src/renderer/features/notes/
// notes-sidebar.tsx): list | editor on wide screens, one pane on narrow ones. The list is a
// search field with sort / filter / tree buttons, All · Pinned · Archived, then the notes in
// date sections (Pinned, Today, Yesterday, Previous 7 Days…) as dense tile rows; cursor-paged,
// loading more on scroll. Deep links: ?id=<noteId>, ?category=<name>.
// Contract: plugins/brain/internal/brain/notes_handlers.go (server filters: q, category, one tag,
// archived; everything else here is applied to the loaded pages).
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "next/navigation"
import useSWRInfinite from "swr/infinite"
import { useSWRConfig } from "swr"
import { Loader2Icon, NetworkIcon, PlusIcon } from "lucide-react"
import { Button, NOTE_COLORS, NotesView, toast, type Note as NqNote, type NotePatch, type Notebook } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { NoteEditor } from "@/components/notes/note-editor"
import { NoteTabs } from "@/components/notes/note-tabs"
import { NoteTree } from "@/components/notes/note-tree"
import { SectionHeader } from "@/components/page"
import { ErrorState, LoadingRows } from "@/components/states"
import { api, ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { refreshGraph } from "@/lib/graph-edit"
import { notesApi, useNote, useNotes, type Note, type NotePage } from "@/lib/notes"
import { closeTab, loadTabs, nextSelection, openTab, renameTab, type OpenTab } from "@/lib/notes/open-tabs"
import { forgetRecent, pushRecent } from "@/lib/notes/recent-notes"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"

const PAGE = 50

function setUrlParam(name: string, value: string | null) {
  const url = new URL(window.location.href)
  if (value) url.searchParams.set(name, value)
  else url.searchParams.delete(name)
  window.history.replaceState(null, "", url.pathname + url.search)
}

function listKey(ns: string, f: { q: string; category: string; tag: string; archived: boolean }, cursor?: string) {
  const sp = new URLSearchParams({ namespace: ns, limit: String(PAGE) })
  if (f.q) sp.set("q", f.q)
  if (f.category) sp.set("category", f.category)
  if (f.tag) sp.set("tag", f.tag)
  if (f.archived) sp.set("archived", "1")
  if (cursor) sp.set("cursor", cursor)
  return `/api/notes?${sp}`
}

const NQ_COLORS = new Set<string>(NOTE_COLORS)

/** A Zekra note as Nasaq's Note: the category is its notebook; a palette colour carries over. */
function toNq(n: Note): NqNote {
  return {
    id: n.id,
    title: n.title,
    body: n.description || n.body || "",
    format: "markdown",
    notebookId: n.category || null,
    tags: n.tags ?? [],
    color: n.color && NQ_COLORS.has(n.color) ? (n.color as NqNote["color"]) : null,
    pinned: n.pinned,
    archived: n.archived,
    createdAt: Date.parse(n.createdAt),
    updatedAt: Date.parse(n.updatedAt),
  }
}

export default function NotesPage() {
  const { t } = useTranslations()
  const ns = decodeURIComponent(useParams<{ namespace: string }>().namespace)
  useDocumentTitle(`${t("nav.notes")} · ${ns}`)
  const { mutate } = useSWRConfig()

  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  // NotesView's scope: all · pinned · archive · nb:<category> · tag:<tag>; it filters the loaded notes.
  const [scope, setScope] = useState("all")
  // Which pane the list column shows: the note list, or the spine-rooted tree.
  const [pane, setPane] = useState<"list" | "tree">("list")
  const [selected, setSelected] = useState<string | null>(null)
  const [justCreated, setJustCreated] = useState<string | null>(null)

  // Deep links, read once from the URL (no Suspense boundary needed).
  useEffect(() => {
    const sp = new URL(window.location.href).searchParams
    setSelected(sp.get("id"))
    const c = sp.get("category")
    if (c) setScope(`nb:${c}`)
  }, [])

  useEffect(() => {
    const h = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(h)
  }, [search])

  // The server searches; archived notes are included so NotesView's Archive scope has them.
  const filters = { q, category: "", tag: "", archived: true }
  const list = useSWRInfinite<NotePage>(
    (i, prev: NotePage | null) => (i > 0 && !prev?.nextCursor ? null : listKey(ns, filters, i > 0 ? prev!.nextCursor : undefined)),
    (key: string) => api<NotePage>(key),
    { revalidateFirstPage: false, revalidateOnFocus: false, keepPreviousData: true },
  )
  // The realtime stream revalidates plain /api/notes? keys, not infinite ones: watch a one-row
  // head of the same query and refresh the pages when it changes.
  const head = useNotes({ namespace: ns, q, archived: true, limit: 1 })
  const headSig = head.data ? `${head.data.notes[0]?.id}:${head.data.notes[0]?.version}:${head.data.serverTime}` : ""
  const lastHead = useRef("")
  useEffect(() => {
    if (!headSig) return
    if (lastHead.current && lastHead.current !== headSig) void list.mutate()
    lastHead.current = headSig
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headSig])

  const pages = list.data
  const hasMore = !!pages?.[pages.length - 1]?.nextCursor
  const notes = useMemo(() => (pages ?? []).flatMap((p) => p.notes ?? []), [pages])
  const nqNotes = useMemo(() => notes.map(toNq), [notes])
  const notebooks = useMemo<Notebook[]>(
    () => Array.from(new Set(notes.map((n) => n.category).filter(Boolean))).sort().map((c) => ({ id: c!, name: c! })),
    [notes],
  )

  // Load more when the sentinel scrolls into view.
  const sentinel = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasMore) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !list.isValidating) void list.setSize((s) => s + 1)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, list])

  const current = useNote(selected)

  const refreshList = useCallback(() => {
    void list.mutate()
    void mutate((key) => typeof key === "string" && key.startsWith("/api/notes?"))
  }, [list, mutate])

  // Open notes as tabs (MH-218), per brain.
  const [tabs, setTabs] = useState<OpenTab[]>([])
  useEffect(() => setTabs(loadTabs(ns)), [ns])

  const select = (id: string | null) => {
    setSelected(id)
    setUrlParam("id", id)
    if (id) {
      const n = notes.find((x) => x.id === id)
      if (n) {
        // Feeds the spotlight's RECENT section (MH-219). Recorded here rather
        // than in the editor so it reflects what the user opened, not what
        // happened to load — a deep link or a refetch is not a visit.
        pushRecent({ id: n.id, namespace: n.namespace, title: n.title, category: n.category })
        setTabs(openTab(ns, { id: n.id, title: n.title, category: n.category }))
      }
    }
  }

  const closeTabAt = (id: string) => {
    const next = closeTab(ns, id)
    setTabs(next)
    // Falls to the left neighbour, then the right — what every editor does.
    const after = nextSelection(tabs, id, selected)
    if (after !== selected) {
      setSelected(after)
      setUrlParam("id", after)
    }
  }

  const pickScope = (sc: string) => {
    setScope(sc)
    setUrlParam("category", sc.startsWith("nb:") ? sc.slice(3) : null)
  }

  async function create(): Promise<string | null> {
    try {
      const category = scope.startsWith("nb:") ? scope.slice(3) : ""
      const tag = scope.startsWith("tag:") ? scope.slice(4) : ""
      const n = await notesApi.create(ns, { ...(tag ? { tags: [tag] } : {}), ...(category ? { category } : {}) })
      await mutate(`/api/notes/${encodeURIComponent(n.id)}`, n, { revalidate: false })
      setJustCreated(n.id)
      select(n.id)
      refreshList()
      return n.id
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
      return null
    }
  }

  const onSaved = useCallback(
    (n: Note) => {
      void mutate(`/api/notes/${encodeURIComponent(n.id)}`, n, { revalidate: false })
      // Patch the row in place; a full refetch of every loaded page per keystroke-save is waste.
      void list.mutate(
        (ps) => ps?.map((p) => ({ ...p, notes: p.notes.map((x) => (x.id === n.id ? n : x)) })),
        { revalidate: false },
      )
      setTabs((cur) => renameTab(n.namespace, n.id, n.title, cur))
    },
    [mutate, list],
  )

  // NotesView's menu actions (pin, archive, colour, move to category, tags, rename) as note updates.
  const updateNote = useCallback(
    async (id: string, patch: NotePatch) => {
      const n = notes.find((x) => x.id === id)
      if (!n) return { error: t("notes.notFound") }
      const { notebookId, color, body: _b, format: _f, ...rest } = patch
      try {
        const updated = await notesApi.update(n.id, n.version, {
          ...n,
          body: n.body ?? "",
          ...rest,
          ...(notebookId !== undefined ? { category: notebookId ?? "" } : {}),
          ...(color !== undefined ? { color: color ?? "" } : {}),
        })
        onSaved(updated)
        if (notebookId !== undefined) refreshGraph(n.namespace)
      } catch (err) {
        return { error: err instanceof ApiError ? err.message : t("common.networkError") }
      }
    },
    [notes, onSaved, t],
  )

  const deleteNote = useCallback(
    async (id: string) => {
      const n = notes.find((x) => x.id === id)
      try {
        await notesApi.remove(id)
        void list.mutate((ps) => ps?.map((p) => ({ ...p, notes: p.notes.filter((x) => x.id !== id) })), { revalidate: false })
        setSelected((cur) => (cur === id ? null : cur))
        forgetRecent(id)
        setTabs(closeTab(ns, id))
        if (n) refreshGraph(n.namespace)
        toast.success(t("notes.deletedToast"))
      } catch (err) {
        return { error: err instanceof ApiError ? err.message : t("common.networkError") }
      }
    },
    [notes, list, ns, t],
  )

  const newButton = (
    <Button variant="primary" onClick={() => void create()}>
      <PlusIcon />
      {t("notes.new")}
    </Button>
  )

  const iconBtn = (on: boolean) =>
    cn("size-8 shrink-0 text-muted-foreground hover:text-foreground", on && "bg-[color-mix(in_oklab,var(--nq-action)_18%,transparent)] text-foreground")

  return (
    <>
      <SectionHeader micro={<Ltr>{ns}</Ltr>} title={t("nav.notes")} action={newButton} />

      <div className="grid border-t border-border lg:grid-cols-[24rem_1fr]">
        {/* List pane: Nasaq's NotesView (search, sort, list/board, scope chips for categories and tags,
            pinned/archive, the ⋯ and context menus). Categories are its notebooks. */}
        <aside
          className={cn(
            "flex min-w-0 flex-col lg:sticky lg:top-0 lg:h-[calc(100dvh-4rem)] lg:border-e lg:border-border",
            selected && "hidden lg:flex",
          )}
        >
          <div className="flex items-center justify-end gap-1 px-3 pt-2">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-pressed={pane === "tree"}
              aria-label={t("tree.title")}
              title={t("tree.title")}
              onClick={() => setPane((v) => (v === "tree" ? "list" : "tree"))}
              className={iconBtn(pane === "tree")}
            >
              <NetworkIcon />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {pane === "tree" ? (
              <NoteTree
                namespace={ns}
                onSelect={(entity) => {
                  // The tree speaks in entity names; the list speaks in note ids: search the name.
                  setPane("list")
                  setSearch(entity)
                }}
              />
            ) : (
              <NotesView
                notes={nqNotes}
                notebooks={notebooks}
                activeId={selected}
                onOpen={select}
                onCreate={async () => {
                  const id = await create()
                  return id ? { id } : undefined
                }}
                query={search}
                onQueryChange={setSearch}
                scope={scope}
                onScopeChange={pickScope}
                loading={!pages}
                error={list.error ? <ErrorState error={list.error} /> : undefined}
                onRetry={() => void list.mutate()}
                onUpdate={updateNote}
                onDelete={deleteNote}
                className="rounded-xl"
              />
            )}
            {pane === "list" && hasMore ? (
              <div ref={sentinel} className="flex justify-center px-6 py-3">
                <Button variant="ghost" size="sm" disabled={list.isValidating} onClick={() => void list.setSize((s) => s + 1)}>
                  {list.isValidating ? <Loader2Icon className="animate-spin" /> : null}
                  {t("notes.loadMore")}
                </Button>
              </div>
            ) : null}
          </div>
        </aside>

        {/* Editor pane */}
        <section className={cn("min-w-0", !selected && "hidden lg:block")}>
          {/* Tabs (MH-218) sit above the pane and stay put while the note
              below changes; the strip hides itself under two open notes. */}
          <NoteTabs
            tabs={tabs}
            activeId={selected}
            onSelect={select}
            onClose={closeTabAt}
            labels={{ openTabs: t("notes.openTabs"), untitled: t("notes.untitled"), close: t("common.close") }}
          />
          {!selected ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <p className="text-sm text-muted-foreground">{t("notes.pickOne")}</p>
              {newButton}
            </div>
          ) : current.error ? (
            <div>
              <ErrorState error={current.error instanceof ApiError && current.error.status === 404 ? new ApiError(404, t("notes.notFound")) : current.error} />
              <div className="px-6 py-3">
                <Button variant="ghost" size="sm" onClick={() => select(null)}>
                  {t("notes.back")}
                </Button>
              </div>
            </div>
          ) : !current.data ? (
            <LoadingRows rows={3} />
          ) : (
            <NoteEditor
              key={current.data.id}
              note={current.data}
              initialMode={justCreated === current.data.id ? "write" : undefined}
              onSaved={onSaved}
              onBack={() => select(null)}
              onOpenNote={(id) => select(id)}
              onDeleted={() => {
                select(null)
                refreshList()
              }}
            />
          )}
        </section>
      </div>
    </>
  )
}

