"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { LayoutGridIcon, ListIcon, LockIcon, PlusIcon, SearchIcon } from "lucide-react"

import { BrainCard, BrainRow, brainName } from "@/components/brains/brain-cells"
import { DeleteBrainDialog, NewBrainDialog } from "@/components/brains/brain-dialogs"
import { DetailStrip, SectionHeader } from "@/components/page"
import { EmptyState, ErrorState } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useStats } from "@/lib/brains"
import { useTranslations } from "@/lib/i18n"
import { isAdmin, useBrains, useMe } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"

type Sort = "recent" | "name" | "memories"
type ViewMode = "grid" | "list"
const SORTS: Sort[] = ["recent", "name", "memories"]

export default function BrainsPage() {
  const { t, locale, formatNumber } = useTranslations()
  useDocumentTitle(t("brains.title"))
  const router = useRouter()
  const me = useMe()
  const brainsQ = useBrains()
  const stats = useStats()
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<Sort>("recent")
  const [view, setView] = useState<ViewMode>("grid")
  const [creating, setCreating] = useState(false)
  const [deleteNs, setDeleteNs] = useState<string | null>(null)

  const brains = useMemo(() => {
    let rows = brainsQ.data ?? []
    const term = search.trim().toLowerCase()
    if (term)
      rows = rows.filter((b) =>
        [b.namespace, b.displayName ?? "", b.description ?? ""].some((s) => s.toLowerCase().includes(term)),
      )
    return [...rows].sort((a, b) => {
      if (sort === "name") return brainName(a).localeCompare(brainName(b), locale)
      if (sort === "memories") return b.memories - a.memories
      return new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime()
    })
  }, [brainsQ.data, search, sort, locale])

  const s = stats.data
  const loading = brainsQ.isLoading
  const v = (n?: number) => (loading || n === undefined ? "—" : formatNumber(n))
  const newButton = (
    <Button onClick={() => setCreating(true)}>
      <PlusIcon />
      {t("brains.new.button")}
    </Button>
  )

  return (
    <>
      <SectionHeader micro={t("brains.micro")} title={t("brains.title")} description={t("brains.description")} action={newButton} />

      <DetailStrip
        className="sm:grid-cols-3 lg:grid-cols-5"
        items={[
          { label: t("brains.stat.brains"), value: v(s?.brains ?? brainsQ.data?.length) },
          { label: t("brains.stat.memories"), value: v(s?.memories) },
          { label: t("brains.stat.nodes"), value: v(s?.entities) },
          { label: t("brains.stat.recalls24h"), value: <span className={s?.recalls24h ? "text-grid-ok" : undefined}>{v(s?.recalls24h)}</span> },
          { label: t("brains.stat.openGaps"), value: <span className={s?.openGaps ? "text-grid-warn" : undefined}>{v(s?.openGaps)}</span> },
        ]}
      />

      <div className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-grid-muted" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("brains.searchPlaceholder")}
            aria-label={t("brains.searchPlaceholder")}
            className="ps-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={sort} onValueChange={(val) => val && setSort(val as Sort)}>
            <SelectTrigger className="w-[180px]" aria-label={t("brains.sort.label")}>
              <SelectValue>{(val: Sort) => t(`brains.sort.${val}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((o) => (
                <SelectItem key={o} value={o}>
                  {t(`brains.sort.${o}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            className="hidden sm:flex"
            value={[view]}
            onValueChange={(val: string[]) => val[0] && setView(val[0] as ViewMode)}
          >
            <ToggleGroupItem value="grid" aria-label={t("brains.view.grid")}>
              <LayoutGridIcon />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label={t("brains.view.list")}>
              <ListIcon />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {brainsQ.error ? (
        <ErrorState error={brainsQ.error} />
      ) : loading ? (
        <div className="grid grid-cols-1 gap-px border-y border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="bg-grid-card p-4">
              <Skeleton className="h-44" />
            </div>
          ))}
        </div>
      ) : brains.length === 0 ? (
        <EmptyState
          title={search ? t("brains.emptySearch") : t("brains.empty")}
          body={search ? t("brains.emptySearchBody") : t("brains.emptyBody")}
          action={search ? undefined : newButton}
        />
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 gap-px border-y border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
          {brains.map((b) => (
            <BrainCard key={b.namespace} b={b} onDelete={() => setDeleteNs(b.namespace)} />
          ))}
        </div>
      ) : (
        <ol className="divide-y divide-line border-y border-line" aria-label={t("brains.title")}>
          {brains.map((b) => (
            <BrainRow key={b.namespace} b={b} onDelete={() => setDeleteNs(b.namespace)} />
          ))}
        </ol>
      )}

      {isAdmin(me.data) ? (
        <div className="-mt-px flex flex-wrap items-center gap-2 border-y border-line px-6 py-3 text-xs text-grid-muted">
          <LockIcon className="size-3.5" />
          {t("brains.adminPointer")}
          <Link href={`/${locale}/admin/users`} className="text-grid-fg underline underline-offset-4">
            {t("brains.adminLink")}
          </Link>
          <span className="ms-auto hidden items-center gap-4 text-[11px] sm:flex">
            <span>{t("brains.footer.nodes", { count: v(s?.entities) })}</span>
            <span>{t("brains.footer.sessions", { count: v(s?.sessions24h) })}</span>
          </span>
        </div>
      ) : null}

      <NewBrainDialog open={creating} onOpenChange={setCreating} onCreated={(ns) => router.push(`/${locale}/b/${encodeURIComponent(ns)}`)} />
      <DeleteBrainDialog namespace={deleteNs} onClose={() => setDeleteNs(null)} />
    </>
  )
}
