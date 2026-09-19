"use client"

// A brain's notes: list | editor on desktop (hairline between), one pane on mobile. Deep link:
// ?id=<noteId>. Contract: plugins/brain/internal/brain/notes_handlers.go.
import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { useSWRConfig } from "swr"
import { PinIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Ltr } from "@/components/copy-field"
import { NoteEditor } from "@/components/notes/note-editor"
import { SectionHeader } from "@/components/page"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { notesApi, useNote, useNotes, type Note } from "@/lib/notes"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"

const PAGE = 50

function setUrlId(id: string | null) {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set("id", id)
  else url.searchParams.delete("id")
  window.history.replaceState(null, "", url.pathname + url.search)
}

export default function NotesPage() {
  const { t, timeAgo } = useTranslations()
  const ns = decodeURIComponent(useParams<{ namespace: string }>().namespace)
  useDocumentTitle(`${t("nav.notes")} · ${ns}`)
  const { mutate } = useSWRConfig()

  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [tag, setTag] = useState("")
  const [archived, setArchived] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Deep link, read once from the URL (no Suspense boundary needed).
  useEffect(() => setSelected(new URL(window.location.href).searchParams.get("id")), [])

  useEffect(() => {
    const h = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(h)
  }, [search])
  useEffect(() => setLimit(PAGE), [q, tag, archived])

  const list = useNotes({ namespace: ns, q, tag, archived, limit })
  const current = useNote(selected)
  const notes = useMemo(() => list.data?.notes ?? [], [list.data])
  const tags = useMemo(() => {
    const all = new Set<string>()
    for (const n of notes) for (const x of n.tags ?? []) all.add(x)
    if (tag) all.add(tag)
    return Array.from(all).sort()
  }, [notes, tag])

  const refreshList = useCallback(
    () => mutate((key) => typeof key === "string" && key.startsWith("/api/notes?")),
    [mutate],
  )

  const select = (id: string | null) => {
    setSelected(id)
    setUrlId(id)
  }

  async function create() {
    setCreating(true)
    try {
      const n = await notesApi.create(ns, tag ? { tags: [tag] } : {})
      await mutate(`/api/notes/${encodeURIComponent(n.id)}`, n, { revalidate: false })
      select(n.id)
      void refreshList()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
    } finally {
      setCreating(false)
    }
  }

  const onSaved = useCallback(
    (n: Note) => {
      void mutate(`/api/notes/${encodeURIComponent(n.id)}`, n, { revalidate: false })
      void refreshList()
    },
    [mutate, refreshList],
  )

  const newButton = (
    <Button onClick={create} disabled={creating}>
      <PlusIcon />
      {creating ? t("common.working") : t("notes.new")}
    </Button>
  )
  const filtering = !!(q || tag)

  return (
    <>
      <SectionHeader micro={<Ltr>{ns}</Ltr>} title={t("nav.notes")} action={newButton} />

      <div className="grid border-t border-line lg:grid-cols-[22rem_1fr]">
        {/* List pane */}
        <aside className={cn("min-w-0 lg:border-e lg:border-line", selected && "hidden lg:block")}>
          <div className="space-y-3 border-b border-line px-6 py-3">
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
            {tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((x) => (
                  <button
                    key={x}
                    type="button"
                    aria-pressed={tag === x}
                    aria-label={tag === x ? t("notes.clearTag") : t("notes.filterTag", { tag: x })}
                    onClick={() => setTag(tag === x ? "" : x)}
                    className={cn(
                      "grid-chip inline-flex items-center gap-1 transition-colors hover:text-grid-fg",
                      tag === x && "bg-grid-soft text-grid-fg",
                    )}
                  >
                    <bdi>{x}</bdi>
                    {tag === x ? <XIcon className="size-3" /> : null}
                  </button>
                ))}
              </div>
            ) : null}
            <label className="flex cursor-pointer items-center gap-2 text-xs text-grid-muted">
              <Switch size="sm" checked={archived} onCheckedChange={(v) => setArchived(!!v)} />
              {t("notes.showArchived")}
            </label>
          </div>

          {list.error ? (
            <ErrorState error={list.error} />
          ) : list.isLoading && !list.data ? (
            <LoadingRows rows={4} />
          ) : notes.length === 0 ? (
            filtering ? (
              <p className="px-6 py-6 text-sm text-grid-muted">{t("notes.noMatches")}</p>
            ) : (
              <EmptyState title={t("notes.emptyTitle")} body={t("notes.emptyBody")} action={newButton} />
            )
          ) : (
            <ol className="divide-y divide-line border-b border-line" aria-label={t("nav.notes")}>
              {notes.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => select(n.id)}
                    aria-current={selected === n.id ? "true" : undefined}
                    className={cn(
                      "flex w-full flex-col gap-1 px-6 py-3 text-start transition-colors hover:bg-grid-soft",
                      selected === n.id && "bg-grid-soft",
                    )}
                  >
                    <span className="flex w-full items-center gap-2">
                      {n.pinned ? <PinIcon className="size-3.5 shrink-0 text-grid-action" aria-label={t("notes.pinned")} /> : null}
                      <span dir="auto" className="min-w-0 flex-1 truncate text-sm font-medium text-grid-fg">
                        {n.title || t("notes.untitled")}
                      </span>
                      {n.archived ? <span className="grid-micro">{t("notes.archived")}</span> : null}
                    </span>
                    {n.body ? (
                      <span dir="auto" className="line-clamp-2 text-xs text-grid-muted">
                        {n.body.slice(0, 200)}
                      </span>
                    ) : null}
                    <span className="text-xs text-grid-muted">{timeAgo(n.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {list.data?.nextCursor && limit < 200 ? (
            <div className="px-6 py-3">
              <Button variant="outline" size="sm" onClick={() => setLimit((l) => Math.min(200, l + PAGE))}>
                {t("notes.loadMore")}
              </Button>
            </div>
          ) : null}
        </aside>

        {/* Editor pane */}
        <section className={cn("min-w-0", !selected && "hidden lg:block")}>
          {!selected ? (
            <p className="px-6 py-12 text-center text-sm text-grid-muted">{t("notes.pickOne")}</p>
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
            <LoadingRows rows={2} />
          ) : (
            <NoteEditor
              key={current.data.id}
              note={current.data}
              onSaved={onSaved}
              onBack={() => select(null)}
              onDeleted={() => {
                select(null)
                void refreshList()
              }}
            />
          )}
        </section>
      </div>
    </>
  )
}
