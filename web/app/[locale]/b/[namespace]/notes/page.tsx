"use client"

// A brain's notes: list | editor on desktop (hairline between), one pane on mobile. The list is
// search + one compact filter row (category, tags, pinned, archived, sort) over cursor-paged
// rows that load more on scroll. Deep links: ?id=<noteId>, ?category=<name>.
// Contract: plugins/brain/internal/brain/notes_handlers.go (server filters: q, category, one tag,
// archived; everything else here is applied to the loaded pages).
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "next/navigation"
import useSWRInfinite from "swr/infinite"
import { useSWRConfig } from "swr"
import {
  AlertTriangleIcon, ArchiveIcon, ArrowDownUpIcon, CheckIcon, ChevronsUpDownIcon, Loader2Icon, NetworkIcon, PinIcon, PlusIcon, SearchIcon,
  TagIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Ltr } from "@/components/copy-field"
import { CategoryPicker } from "@/components/graph/category-picker"
import { categoryColor } from "@/components/graph/colors"
import { NoteEditor } from "@/components/notes/note-editor"
import { NoteRowActions, type NoteRowAction } from "@/components/notes/note-row-actions"
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
import { api, ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { refreshGraph } from "@/lib/graph-edit"
import { notesApi, useNote, useNotes, type Note, type NotePage } from "@/lib/notes"
import { closeTab, loadTabs, nextSelection, openTab, renameTab, type OpenTab } from "@/lib/notes/open-tabs"
import { noteIcon } from "@/lib/notes/note-icon"
import { forgetRecent, pushRecent } from "@/lib/notes/recent-notes"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"

const PAGE = 50
type Sort = "updated" | "created" | "title"

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
  const { t, timeAgo } = useTranslations()
  const ns = decodeURIComponent(useParams<{ namespace: string }>().namespace)
  useDocumentTitle(`${t("nav.notes")} · ${ns}`)
  const { mutate } = useSWRConfig()

  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [category, setCategory] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [archived, setArchived] = useState(false)
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
    if (sort === "created") all = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    else if (sort === "title") all = [...all].sort((a, b) => (a.title || "").localeCompare(b.title || ""))
    return all
  }, [pages, tags, pinnedOnly, sort])

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
  const filtering = !!(q || category || tags.length || pinnedOnly)
  const clearFilters = () => {
    setSearch("")
    setQ("")
    pickCategory("")
    setTags([])
    setPinnedOnly(false)
    setArchived(false)
    setSort("updated")
  }

  const sortLabel: Record<Sort, string> = {
    updated: t("notes.sortUpdated"),
    created: t("notes.sortCreated"),
    title: t("notes.sortTitle"),
  }

  const toggleBtn = (on: boolean) =>
    cn("h-7 gap-1 px-2 text-xs font-normal", on ? "border-grid-fg bg-grid-soft text-grid-fg" : "text-grid-muted")

  return (
    <>
      <SectionHeader micro={<Ltr>{ns}</Ltr>} title={t("nav.notes")} action={newButton} />

      <div className="grid border-t border-line lg:grid-cols-[24rem_1fr]">
        {/* List pane */}
        <aside
          className={cn(
            "flex min-w-0 flex-col lg:sticky lg:top-0 lg:h-[calc(100dvh-4rem)] lg:border-e lg:border-line",
            selected && "hidden lg:flex",
          )}
        >
          <div className="space-y-2 border-b border-line px-4 py-3">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-grid-muted" />
              <Input
                dir="auto"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("notes.search")}
                aria-label={t("notes.search")}
                className="ps-8"
              />
            </div>

            {/* One compact filter row */}
            <div className="flex flex-wrap items-center gap-1.5">
              <CategoryPicker namespace={ns} value={category} onChange={(c) => pickCategory(c)} allowAll className="min-w-28" />

              <TagCombobox
                namespace={ns}
                selected={tags}
                onToggle={(tag) => setTags((cur) => (cur.includes(tag) ? cur.filter((x) => x !== tag) : [...cur, tag]))}
                onClear={() => setTags([])}
                trigger={
                  <Button variant="outline" size="sm" className={cn("max-w-56 font-normal", tags.length ? "text-grid-fg" : "text-grid-muted")}>
                    <TagIcon />
                    {tags.length === 0 ? (
                      t("notes.tags")
                    ) : (
                      <span className="flex min-w-0 items-center gap-1">
                        {tags.slice(0, tags.length > 3 ? 2 : 3).map((x) => (
                          <bdi key={x} className="max-w-20 truncate">
                            {x}
                          </bdi>
                        ))}
                        {tags.length > 3 ? <span className="text-grid-muted">+{tags.length - 2}</span> : null}
                      </span>
                    )}
                    <ChevronsUpDownIcon className="text-grid-muted" />
                  </Button>
                }
              />

              <Button variant="outline" size="sm" aria-pressed={pinnedOnly} onClick={() => setPinnedOnly((v) => !v)} className={toggleBtn(pinnedOnly)}>
                <PinIcon /> {t("notes.pinnedFilter")}
              </Button>
              <Button variant="outline" size="sm" aria-pressed={archived} onClick={() => setArchived((v) => !v)} className={toggleBtn(archived)}>
                <ArchiveIcon /> {t("notes.archivedFilter")}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-normal text-grid-muted" />}>
                  <ArrowDownUpIcon /> {sortLabel[sort]}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-40">
                  {(["updated", "created", "title"] as Sort[]).map((s) => (
                    <DropdownMenuItem key={s} onClick={() => setSort(s)}>
                      <CheckIcon className={cn(sort === s ? "opacity-100" : "opacity-0")} />
                      {sortLabel[s]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* List vs tree (MH-217). The tree is rooted on the brain's
                  graph spine, so it answers "how is this brain organised"
                  where the list answers "what changed recently". */}
              <Button
                variant="outline"
                size="sm"
                aria-pressed={pane === "tree"}
                onClick={() => setPane((v) => (v === "tree" ? "list" : "tree"))}
                className={toggleBtn(pane === "tree")}
              >
                <NetworkIcon /> {t("tree.title")}
              </Button>

              {filtering || archived || sort !== "updated" ? (
                <button type="button" onClick={clearFilters} className="ms-auto text-xs text-grid-muted underline underline-offset-4 hover:text-grid-fg">
                  {t("notes.clearFilters")}
                </button>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
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
              <ol className="divide-y divide-line" aria-label={t("nav.notes")}>
                {notes.map((n) => (
                  <NoteRow
                    key={n.id}
                    n={n}
                    active={selected === n.id}
                    onSelect={() => select(n.id)}
                    timeAgo={timeAgo}
                    onAction={(a) => void rowAction(n, a)}
                    onAppearance={(patch) => void setAppearance(n, patch)}
                  />
                ))}
              </ol>
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

function NoteRow({
  n,
  active,
  onSelect,
  timeAgo,
  onAction,
  onAppearance,
}: {
  n: Note
  active: boolean
  onSelect: () => void
  timeAgo: (v: string) => string
  onAction: (action: NoteRowAction) => void
  onAppearance: (patch: { icon?: string; color?: string }) => void
}) {
  const { t } = useTranslations()
  const cat = n.category || "note"
  const { Icon: CategoryIcon, color: categoryTint } = noteIcon({ category: cat, icon: n.icon, color: n.color })
  const tags = n.tags ?? []
  const snippet = (n.body ?? "").replace(/[#>*_`]|\[\[|\]\]/g, "").replace(/\s+/g, " ").trim().slice(0, 220)
  return (
    <li>
      <NoteRowActions
        pinned={n.pinned}
        archived={n.archived}
        title={n.title}
        icon={n.icon}
        color={n.color}
        category={cat}
        onAction={onAction}
        onAppearance={onAppearance}
      >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className={cn(
          "relative flex w-full flex-col gap-1 px-4 py-3 text-start transition-colors hover:bg-grid-soft",
          active && "bg-grid-soft before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-grid-fg",
        )}
      >
        <span className="flex w-full items-center gap-1.5">
          {n.pinned ? <PinIcon className="size-3.5 shrink-0 text-grid-action" aria-label={t("notes.pinned")} /> : null}
          <span dir="auto" className="min-w-0 flex-1 truncate text-sm font-medium text-grid-fg">
            {n.title || t("notes.untitled")}
          </span>
          {!n.indexed ? (
            n.indexError ? (
              <AlertTriangleIcon className="size-3.5 shrink-0 text-grid-warn" aria-label={t("notes.notIndexed")} />
            ) : (
              <Loader2Icon className="size-3.5 shrink-0 animate-spin text-grid-muted" aria-label={t("notes.indexing")} />
            )
          ) : null}
          <span className="shrink-0 text-[12.5px] text-grid-muted">{timeAgo(n.updatedAt)}</span>
        </span>
        {snippet ? (
          <span dir="auto" className="line-clamp-2 text-xs text-grid-muted">
            {snippet}
          </span>
        ) : null}
        <span className="flex min-w-0 items-center gap-1.5">
          {/* Icon + colour derived from the category (MH-264), replacing the
              bare colour square. */}
          <span className="inline-flex shrink-0 items-center gap-1 text-[12.5px] text-grid-body">
            <CategoryIcon aria-hidden className="size-3 shrink-0" style={{ color: categoryTint }} />
            <bdi>{cat}</bdi>
          </span>
          {tags.slice(0, 2).map((x) => (
            <span key={x} className="grid-chip max-w-24 truncate !py-0 text-[12px]">
              <bdi>{x}</bdi>
            </span>
          ))}
          {tags.length > 2 ? <span className="text-[12px] text-grid-muted">+{tags.length - 2}</span> : null}
          {n.archived ? <span className="grid-micro ms-auto">{t("notes.archived")}</span> : null}
        </span>
      </button>
      </NoteRowActions>
    </li>
  )
}
