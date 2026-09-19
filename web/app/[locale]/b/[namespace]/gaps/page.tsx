"use client"

import { useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { CheckIcon, RotateCcwIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { useSWRConfig } from "swr"

import { ToneSquare } from "@/components/activity/activity-row"
import { RowList, SectionHeader, SectionTitle } from "@/components/page"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ApiError, brainApi, type Gap, type GapStatus } from "@/lib/api"
import { useGaps, type Tone } from "@/lib/brains"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

const ORDER: GapStatus[] = ["open", "indexed", "dismissed"]
const TONE: Record<string, Tone> = { open: "warn", indexed: "ok", dismissed: "muted" }

function GapRow({ g, busy, onResolve }: { g: Gap; busy: boolean; onResolve: (s: GapStatus) => void }) {
  const { t, formatNumber, formatDate } = useTranslations()
  return (
    <li className="flex flex-wrap items-center gap-3 px-6 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-grid-fg" title={g.query} dir="auto">
          {g.query}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-grid-muted">
          <span>{t(g.hits === 1 ? "gaps.miss" : "gaps.misses", { count: formatNumber(g.hits) })}</span>
          <span>{t("gaps.firstSeen", { date: formatDate(g.firstSeen) })}</span>
          <span>{t("gaps.lastSeen", { date: formatDate(g.lastSeen, { dateStyle: "medium", timeStyle: "short" }) })}</span>
          {g.resolution ? (
            <span className="italic" dir="auto">
              “{g.resolution}”
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5">
        {g.status !== "indexed" ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onResolve("indexed")}>
            <CheckIcon className="text-grid-ok" />
            {t("gaps.markIndexed")}
          </Button>
        ) : null}
        {g.status !== "dismissed" ? (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onResolve("dismissed")}>
            <XIcon />
            {t("gaps.dismiss")}
          </Button>
        ) : null}
        {g.status !== "open" ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onResolve("open")}>
            <RotateCcwIcon className="text-grid-warn" />
            {t("gaps.reopen")}
          </Button>
        ) : null}
      </div>
    </li>
  )
}

export default function BrainGapsPage() {
  const { t, formatNumber } = useTranslations()
  const ns = decodeURIComponent(useParams<{ namespace: string }>().namespace)
  useDocumentTitle(`${t("gaps.title")} · ${ns}`)
  const [status, setStatus] = useState<"" | GapStatus>("")
  const { data, error, isLoading, mutate } = useGaps(ns, status)
  const { mutate: globalMutate } = useSWRConfig()
  const [busyId, setBusyId] = useState<number | null>(null)

  const grouped = useMemo(() => {
    const m: Record<string, Gap[]> = { open: [], indexed: [], dismissed: [] }
    for (const g of data ?? []) (m[g.status] ??= []).push(g)
    return m
  }, [data])
  const total = data?.length ?? 0
  const visible = status ? [status] : ORDER

  async function resolve(id: number, next: GapStatus) {
    setBusyId(id)
    try {
      await brainApi.resolveGap({ id, status: next })
      toast.success(t(`gaps.resolved.${next}`))
      await mutate()
      void globalMutate((k) => Array.isArray(k) && k[0] === "/api/brain/brain")
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <SectionHeader micro={t("gaps.micro")} title={t("gaps.title")} description={t("gaps.description")} />
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-6 py-3">
        <ToggleGroup
          aria-label={t("gaps.filter")}
          variant="outline"
          size="sm"
          spacing={0}
          value={[status || "all"]}
          onValueChange={(v: string[]) => {
            const next = v[0]
            if (next) setStatus(next === "all" ? "" : (next as GapStatus))
          }}
        >
          <ToggleGroupItem value="all">{t("gaps.filter.all")}</ToggleGroupItem>
          {ORDER.map((s) => (
            <ToggleGroupItem key={s} value={s}>
              {t(`gaps.status.${s}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {total > 0 ? <span className="ms-auto text-[11px] text-grid-muted">{t("gaps.count", { count: formatNumber(total) })}</span> : null}
      </div>

      {error ? (
        <ErrorState error={error} />
      ) : isLoading ? (
        <LoadingRows rows={4} />
      ) : total === 0 ? (
        <EmptyState title={t("gaps.empty")} body={t("gaps.emptyBody")} />
      ) : (
        visible.map((s) => {
          const rows = grouped[s] ?? []
          if (rows.length === 0) return null
          return (
            <section key={s}>
              <SectionTitle action={<span className="grid-micro">{formatNumber(rows.length)}</span>}>
                <span className="inline-flex items-center gap-2">
                  <ToneSquare tone={TONE[s] ?? "muted"} className="size-2" />
                  {t(`gaps.status.${s}`)}
                </span>
              </SectionTitle>
              <RowList label={t(`gaps.status.${s}`)}>
                {rows.map((g) => (
                  <GapRow key={g.id} g={g} busy={busyId === g.id} onResolve={(next) => resolve(g.id, next)} />
                ))}
              </RowList>
            </section>
          )
        })
      )}
    </>
  )
}
