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
import { ArrowDownUpIcon, CheckIcon, Loader2Icon, NetworkIcon, PlusIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Ltr } from "@/components/copy-field"
import { CategoryPicker } from "@/components/graph/category-picker"
import { NoteEditor } from "@/components/notes/note-editor"
import { NoteListRow } from "@/components/notes/note-list-row"
import type { NoteRowAction } from "@/components/notes/note-row-actions"
import { NoteTabs } from "@/components/notes/note-tabs"
import { NoteTree } from "@/components/notes/note-tree"
import { TagCombobox } from "@/components/notes/tag-combobox"
import { SectionHeader } from "@/components/page"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { api, ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { refreshGraph } from "@/lib/graph-edit"
import { notesApi, useNote, useNotes, type Note, type NotePage } from "@/lib/notes"
import { closeTab, loadTabs, nextSelection, openTab, renameTab, type OpenTab } from "@/lib/notes/open-tabs"
import { groupNotes, type NoteGroup } from "@/lib/notes/note-groups"
import { forgetRecent, pushRecent } from "@/lib/notes/recent-notes"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"

const PAGE = 50
type Sort = "updated" | "created" | "title"
type View = "all" | "pinned" | "archived"

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

export default function NotesPage() {
  const { t, locale } = useTranslations()
  const ns = decodeURIComponent(useParams<{ namespace: string }>().namespace)
  useDocumentTitle(`${t("nav.notes")} · ${ns}`)
  const { mutate } = useSWRConfig()

  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [category, setCategory] = useState("")
  const [tags, setTags] = useState<string[]>([])
  // All · Pinned · Archived (the desktop's library lists). The server's archived=1 means
  // "include archived"; the Archived view keeps only those, client-side.
  const [view, setView] = useState<View>("all")
  const pinnedOnly = view === "pinned"
  const archived = view === "archived"
  // Which pane the list column shows: the note list, or the spine-rooted tree.
  const [pane, setPane] = useState<"list" | "tree">("list")
  const [sort, setSort] = useState<Sort>("updated")
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [justCreated, setJustCreated] = useState<string | null>(null)

  // Deep links, read once from the URL (no Suspense boundary needed).
  useEffect(() => {
    const sp = new URL(window.location.href).searchParams
    setSelected(sp.get("id"))
    setCategory(sp.get("category") ?? "")
  }, [])

  useEffect(() => {
    const h = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(h)
  }, [search])

  // The server filters by one tag; the rest (AND), pinned and the non-default sorts apply to
  // the loaded pages.
  const filters = { q, category, tag: tags[0] ?? "", archived }
  const list = useSWRInfinite<NotePage>(
    (i, prev: NotePage | null) => (i > 0 && !prev?.nextCursor ? null : listKey(ns, filters, i > 0 ? prev!.nextCursor : undefined)),
    (key: string) => api<NotePage>(key),
    { revalidateFirstPage: false, revalidateOnFocus: false, keepPreviousData: true },
  )
  // The realtime stream revalidates plain /api/notes? keys, not infinite ones: watch a one-row
  // head of the same query and refresh the pages when it changes.
  const head = useNotes({ namespace: ns, q, category, tag: filters.tag, archived, limit: 1 })
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
  const notes = useMemo(() => {
    let all = (pages ?? []).flatMap((p) => p.notes ?? [])
    if (tags.length > 1) all = all.filter((n) => tags.every((x) => n.tags?.includes(x)))
    if (pinnedOnly) all = all.filter((n) => n.pinned)
    if (archived) all = all.filter((n) => n.archived)
    if (sort === "created") all = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    else if (sort === "title") all = [...all].sort((a, b) => (a.title || "").localeCompare(b.title || ""))
    return all
  }, [pages, tags, pinnedOnly, archived, sort])
  const groups = useMemo(() => groupNotes(notes, { pinnedFirst: view === "all", sort }), [notes, view, sort])

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

  const pickCategory = (c: string) => {
    setCategory(c)
    setUrlParam("category", c || null)
  }

  async function create() {
    setCreating(true)
    try {
      const n = await notesApi.create(ns, { ...(tags.length ? { tags } : {}), ...(category ? { category } : {}) })
      await mutate(`/api/notes/${encodeURIComponent(n.id)}`, n, { revalidate: false })
      setJustCreated(n.id)
      select(n.id)
      refreshList()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
    } finally {
      setCreating(false)
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

  /*
  Row actions from the list (MH-220): pin, archive, delete. Pin and archive go
  through the same optimistic patch as an in-editor save; delete drops the row
  and clears the selection if it was the open note.
  */
  const rowAction = useCallback(
    async (n: Note, action: NoteRowAction) => {
      try {
        if (action === "delete") {
          await notesApi.remove(n.id)
          void list.mutate(
            (ps) => ps?.map((p) => ({ ...p, notes: p.notes.filter((x) => x.id !== n.id) })),
            { revalidate: false },
          )
          setSelected((cur) => (cur === n.id ? null : cur))
          forgetRecent(n.id)
          setTabs(closeTab(ns, n.id))
          refreshGraph(n.namespace)
          toast.success(t("notes.deletedToast"))
          return
        }
        const patch = action === "pin" ? { pinned: !n.pinned } : { archived: !n.archived }
        const updated = await notesApi.update(n.id, n.version, { ...n, body: n.body ?? "", ...patch })
        onSaved(updated)
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
      }
    },
    [list, onSaved, t],
  )

  /** Save an icon/colour override (MH-308). Empty strings clear it. */
  const setAppearance = useCallback(
    async (n: Note, patch: { icon?: string; color?: string }) => {
      try {
        const updated = await notesApi.update(n.id, n.version, { ...n, body: n.body ?? "", ...patch })
        onSaved(updated)
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
      }
    },
    [onSaved, t],
  )

  const newButton = (
    <Button onClick={create} disabled={creating}>
      <PlusIcon />
      {creating ? t("common.working") : t("notes.new")}
    </Button>
  )
  const filtering = !!(q || category || tags.length || view !== "all")
  const clearFilters = () => {
    setSearch("")
    setQ("")
    pickCategory("")
    setTags([])
    setView("all")
    setSort("updated")
  }
  const groupLabel = (g: NoteGroup<Note>) =>
    g.kind === "calendarMonth" && g.month !== undefined
      ? new Date(g.year ?? 2000, g.month, 1).toLocaleDateString(locale === "ar" ? "ar" : "en", { month: "long" })
      : g.kind === "year"
        ? g.year ? String(g.year) : t("notes.grp.earlier")
        : g.kind === "all"
          ? ""
          : t(`notes.grp.${g.kind}`)

  const sortLabel: Record<Sort, string> = {
    updated: t("notes.sortUpdated"),
    created: t("notes.sortCreated"),
    title: t("notes.sortTitle"),
  }

  const iconBtn = (on: boolean) =>
    cn("size-8 shrink-0 text-grid-muted hover:text-grid-fg", on && "bg-[color-mix(in_oklab,var(--grid-action)_18%,transparent)] text-grid-fg")

  return (
    <>
      <SectionHeader micro={<Ltr>{ns}</Ltr>} title={t("nav.notes")} action={newButton} />

      <div className="grid border-t border-line lg:grid-cols-[24rem_1fr]">
        {/* List pane — the desktop's notes column */}
        <aside
          className={cn(
            "flex min-w-0 flex-col lg:sticky lg:top-0 lg:h-[calc(100dvh-4rem)] lg:border-e lg:border-line",
            selected && "hidden lg:flex",
          )}
        >
          <div className="flex flex-col gap-2 px-3 pt-3 pb-2">
            <div className="flex items-center gap-1">
              <div className="relative min-w-0 flex-1">
                <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-grid-muted" />
                <Input
                  dir="auto"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setSearch("")
                  }}
                  placeholder={t("notes.search")}
                  aria-label={t("notes.search")}
                  className="h-8 rounded-md border-transparent bg-[color-mix(in_oklab,var(--grid-fg)_6%,transparent)] ps-8 text-[14px] shadow-none"
                />
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("notes.sort")} title={sortLabel[sort]} className={iconBtn(sort !== "updated")} />}>
                  <ArrowDownUpIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  {(["updated", "created", "title"] as Sort[]).map((s) => (
                    <DropdownMenuItem key={s} onClick={() => setSort(s)}>
                      <CheckIcon className={cn(sort === s ? "opacity-100" : "opacity-0")} />
                      {sortLabel[s]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Category and tags: a filter popover, so the column stays one quiet row. */}
              <Popover>
                <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("notes.filters")} title={t("notes.filters")} className={iconBtn(!!(category || tags.length))} />}>
                  <SlidersHorizontalIcon />
                </PopoverTrigger>
                <PopoverContent align="end" className="flex w-72 flex-col gap-2 p-3">
                  <CategoryPicker namespace={ns} value={category} onChange={(c) => pickCategory(c)} allowAll className="w-full" />
                  <TagCombobox
                    namespace={ns}
                    selected={tags}
                    onToggle={(tag) => setTags((cur) => (cur.includes(tag) ? cur.filter((x) => x !== tag) : [...cur, tag]))}
                    onClear={() => setTags([])}
                    trigger={
                      <Button variant="outline" size="sm" className="w-full justify-start font-normal text-grid-muted">
                        {tags.length ? tags.join(", ") : t("notes.tags")}
                      </Button>
                    }
                  />
                </PopoverContent>
              </Popover>

              {/* List vs tree (MH-217): the tree is rooted on the brain's graph spine. */}
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

            {/* All · Pinned · Archived */}
            <div role="radiogroup" aria-label={t("nav.notes")} className="flex rounded-lg bg-[color-mix(in_oklab,var(--grid-fg)_6%,transparent)] p-0.5">
              {(["all", "pinned", "archived"] as View[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    "h-7 flex-1 rounded-md text-[13px] font-medium transition-colors",
                    view === v ? "bg-grid-card text-grid-fg shadow-sm" : "text-grid-muted hover:text-grid-fg",
                  )}
                >
                  {t(`notes.view.${v}`)}
                </button>
              ))}
            </div>

            {category || tags.length ? (
              <div className="flex flex-wrap items-center gap-1">
                {category ? (
                  <button type="button" onClick={() => pickCategory("")} className="inline-flex h-6 items-center gap-1 rounded-md bg-[color-mix(in_oklab,var(--grid-fg)_7%,transparent)] px-1.5 text-[12.5px] text-grid-fg">
                    <bdi>{category}</bdi>
                    <XIcon className="size-3 text-grid-muted" />
                  </button>
                ) : null}
                {tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setTags((cur) => cur.filter((x) => x !== tag))}
                    className="inline-flex h-6 items-center gap-1 rounded-md bg-[color-mix(in_oklab,var(--grid-fg)_7%,transparent)] px-1.5 text-[12.5px] text-grid-fg"
                  >
                    #<bdi>{tag}</bdi>
                    <XIcon className="size-3 text-grid-muted" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {pane === "tree" ? (
              <NoteTree
                namespace={ns}
                onSelect={(entity) => {
                  // The tree speaks in entity names; the list speaks in note
                  // ids. Searching the name is the honest bridge — an entity
                  // need not BE a note, so there may be nothing to select.
                  setPane("list")
                  setSearch(entity)
                }}
              />
            ) : list.error ? (
              <ErrorState error={list.error} />
            ) : !pages ? (
              <LoadingRows rows={6} />
            ) : notes.length === 0 ? (
              filtering ? (
                <div className="px-6 py-8 text-center text-sm text-grid-muted">
                  <p>{t("notes.noMatches")}</p>
                  <button type="button" onClick={clearFilters} className="mt-2 underline underline-offset-4 hover:text-grid-fg">
                    {t("notes.clearFilters")}
                  </button>
                </div>
              ) : (
                <EmptyState title={t("notes.emptyTitle")} body={t("notes.emptyBody")} action={newButton} />
              )
            ) : (
              groups.map((g) => (
                <section key={g.key} aria-label={groupLabel(g) || undefined}>
                  {g.kind !== "all" ? (
                    <h3 className="sticky top-0 z-10 bg-grid-bg/95 px-2.5 pt-3 pb-1 text-[12.5px] font-semibold text-grid-muted backdrop-blur-sm">
                      {groupLabel(g)}
                    </h3>
                  ) : null}
                  <ol className="flex flex-col gap-px">
                    {g.notes.map((n) => (
                      <li key={n.id}>
                        <NoteListRow
                          note={n}
                          selected={selected === n.id}
                          onSelect={() => select(n.id)}
                          onAction={(a) => void rowAction(n, a)}
                          onAppearance={(patch) => void setAppearance(n, patch)}
                        />
                      </li>
                    ))}
                  </ol>
                </section>
              ))
            )}
            {hasMore ? (
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
              <p className="text-sm text-grid-muted">{t("notes.pickOne")}</p>
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

