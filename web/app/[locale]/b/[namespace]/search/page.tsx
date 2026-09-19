"use client"

import { useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { CheckIcon, MessagesSquareIcon, SearchIcon, SlidersHorizontalIcon, SparklesIcon, StarIcon, XIcon } from "lucide-react"

import { SectionHeader } from "@/components/page"
import { MemoryDialog } from "@/components/search/memory-dialog"
import { ErrorState } from "@/components/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { brainApi, type Recalled } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

type Mode = "recall" | "search"
const NETWORKS = ["fact", "experience", "belief"]
const LIMITS = [10, 20, 50]

/** The recall score as a grade bar beside the figure. */
function Grade({ score }: { score: number }) {
  const { t, formatNumber } = useTranslations()
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100)
  const fig = formatNumber(score, { minimumFractionDigits: 3, maximumFractionDigits: 3 })
  return (
    <span className="inline-flex items-center gap-2" title={t("search.scoreTitle", { n: fig })}>
      <span aria-hidden className="block h-1 w-12 bg-grid-soft">
        <span className="block h-full bg-grid-action" style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono">{fig}</span>
    </span>
  )
}

function Facet({ label, active, onClick, icon }: { label: ReactNode; active: boolean; onClick: () => void; icon?: ReactNode }) {
  return (
    <Button type="button" size="xs" variant={active ? "secondary" : "outline"} aria-pressed={active} onClick={onClick}>
      {active ? <CheckIcon /> : icon}
      {label}
    </Button>
  )
}

function toggleIn(set: Set<string>, v: string) {
  const next = new Set(set)
  if (next.has(v)) next.delete(v)
  else next.add(v)
  return next
}

export default function BrainSearchPage() {
  const { t, locale, formatNumber } = useTranslations()
  const params = useParams<{ namespace: string }>()
  const namespace = decodeURIComponent(params.namespace)
  useDocumentTitle(`${t("search.title")} · ${namespace}`)

  const [q, setQ] = useState("")
  const [mode, setMode] = useState<Mode>("recall")
  const [limit, setLimit] = useState(20)
  const [pending, setPending] = useState(false)
  const [state, setState] = useState<{ results?: Recalled[]; error?: unknown; q?: string }>({})
  const [open, setOpen] = useState<Recalled | null>(null)

  const [fNet, setFNet] = useState<Set<string>>(new Set())
  const [fType, setFType] = useState<Set<string>>(new Set())
  const [fSrc, setFSrc] = useState<Set<string>>(new Set())
  const [highImp, setHighImp] = useState(false)
  const clearTuners = () => {
    setFNet(new Set())
    setFType(new Set())
    setFSrc(new Set())
    setHighImp(false)
  }

  async function run() {
    const query = q.trim()
    if (!query || pending) return
    clearTuners()
    setPending(true)
    try {
      const r = mode === "recall" ? await brainApi.recall({ namespace, query, limit }) : await brainApi.search({ query, namespaces: [namespace], limit })
      setState({ results: r.results ?? [], q: query })
    } catch (error) {
      setState({ error, q: query })
    } finally {
      setPending(false)
    }
  }

  const raw = useMemo(() => state.results ?? [], [state.results])
  const netFacets = useMemo(() => NETWORKS.filter((n) => raw.some((r) => r.network === n)), [raw])
  const typeFacets = useMemo(() => Array.from(new Set(raw.map((r) => r.memoryType).filter(Boolean))).sort(), [raw])
  const srcFacets = useMemo(() => Array.from(new Set(raw.map((r) => r.sourceKind).filter(Boolean))).sort(), [raw])
  const results = useMemo(
    () =>
      raw.filter(
        (r) =>
          (fNet.size === 0 || fNet.has(r.network)) &&
          (fType.size === 0 || fType.has(r.memoryType)) &&
          (fSrc.size === 0 || fSrc.has(r.sourceKind)) &&
          (!highImp || (r.importance ?? 0) >= 0.7),
      ),
    [raw, fNet, fType, fSrc, highImp],
  )
  const hasFilters = fNet.size > 0 || fType.size > 0 || fSrc.size > 0 || highImp
  const ran = state.q !== undefined

  const patch = (id: string, content: string) =>
    setState((s) => ({ ...s, results: s.results?.map((x) => (x.id === id ? { ...x, content } : x)) }))

  return (
    <div>
      <SectionHeader
        micro={t("search.micro")}
        title={t(mode === "recall" ? "search.recallTitle" : "search.searchTitle")}
        description={
          <>
            {t(mode === "recall" ? "search.recallHint" : "search.searchHint")}{" "}
            <span dir="ltr" className="font-medium text-grid-fg">
              {namespace}
            </span>
          </>
        }
        action={
          <Button variant="outline" nativeButton={false} render={<Link href={`/${locale}/b/${encodeURIComponent(namespace)}/chat`} />}>
            <MessagesSquareIcon /> {t("search.openChat")}
          </Button>
        }
      />

      <section className="space-y-4 border-y border-line px-6 py-6">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("search.mode")}>
          <Button size="sm" variant={mode === "recall" ? "default" : "outline"} aria-pressed={mode === "recall"} onClick={() => setMode("recall")}>
            <SparklesIcon /> {t("search.modeRecall")}
          </Button>
          <Button size="sm" variant={mode === "search" ? "default" : "outline"} aria-pressed={mode === "search"} onClick={() => setMode("search")}>
            <SearchIcon /> {t("search.modeSearch")}
          </Button>
          <span aria-hidden className="mx-1 h-4 w-px bg-line" />
          <span className="grid-micro">{t("search.limit")}</span>
          {LIMITS.map((n) => (
            <Button key={n} size="xs" variant={limit === n ? "secondary" : "ghost"} aria-pressed={limit === n} onClick={() => setLimit(n)}>
              {formatNumber(n)}
            </Button>
          ))}
        </div>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault()
            void run()
          }}
        >
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-grid-muted" />
            <Input
              dir="auto"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("search.placeholder")}
              aria-label={t("search.placeholder")}
              autoFocus
              className="h-10 ps-9"
            />
          </div>
          <Button type="submit" size="lg" className="h-10 px-5" disabled={pending || !q.trim()}>
            <SearchIcon /> {pending ? t("search.searching") : t(mode === "recall" ? "search.modeRecall" : "search.modeSearch")}
          </Button>
        </form>
      </section>

      {state.error ? <ErrorState error={state.error} /> : null}

      {raw.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-6 py-3">
          <span className="grid-micro me-1 inline-flex items-center gap-1.5">
            <SlidersHorizontalIcon className="size-3.5" /> {t("search.tune")}
          </span>
          {netFacets.map((n) => (
            <Facet key={n} label={<span dir="ltr">{n}</span>} active={fNet.has(n)} onClick={() => setFNet((s) => toggleIn(s, n))} />
          ))}
          {typeFacets.length > 0 ? <span aria-hidden className="mx-1 h-4 w-px bg-line" /> : null}
          {typeFacets.map((ty) => (
            <Facet key={ty} label={<span dir="ltr">{ty}</span>} active={fType.has(ty)} onClick={() => setFType((s) => toggleIn(s, ty))} />
          ))}
          {srcFacets.length > 0 ? <span aria-hidden className="mx-1 h-4 w-px bg-line" /> : null}
          {srcFacets.map((s) => (
            <Facet key={s} label={<span dir="ltr">{s}</span>} active={fSrc.has(s)} onClick={() => setFSrc((x) => toggleIn(x, s))} />
          ))}
          <span aria-hidden className="mx-1 h-4 w-px bg-line" />
          <Facet label={t("search.highImportance")} icon={<StarIcon />} active={highImp} onClick={() => setHighImp((v) => !v)} />
          {hasFilters ? (
            <Button size="xs" variant="ghost" className="ms-auto" onClick={clearTuners}>
              <XIcon /> {t("search.clear")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {pending ? (
        <div className="divide-y divide-line border-b border-line" aria-busy>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-2 px-6 py-4">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      ) : null}

      {!pending && ran && !state.error && raw.length === 0 ? (
        <section className="border-b border-line">
          <div aria-hidden className="hatch-band h-3 border-b border-line" />
          <div className="px-6 py-10 text-center">
            <p className="text-sm font-medium text-grid-fg">
              {t("search.noMemoryOf")} <bdi dir="auto">“{state.q}”</bdi>
            </p>
            <p className="mt-1 text-sm text-grid-muted">{t("search.noMemoryHint")}</p>
          </div>
        </section>
      ) : null}

      {!pending && raw.length > 0 && results.length === 0 ? (
        <p className="border-b border-line px-6 py-8 text-center text-sm text-grid-muted">{t("search.allFiltered", { n: formatNumber(raw.length) })}</p>
      ) : null}

      {!pending && results.length > 0 ? (
        <>
          <div className="px-6 pt-6 pb-3 text-xs text-grid-muted">
            {hasFilters
              ? t("search.countOf", { n: formatNumber(results.length), total: formatNumber(raw.length) })
              : t(results.length === 1 ? "search.countOne" : "search.countMany", { n: formatNumber(results.length) })}
          </div>
          <ol className="divide-y divide-line border-y border-line">
            {results.map((r) => (
              <li key={`${r.namespace ?? namespace}:${r.id}`} className="px-6 py-3 transition-colors hover:bg-grid-soft">
                <div className="flex items-start gap-3">
                  <p dir="auto" className="line-clamp-4 flex-1 text-sm leading-relaxed whitespace-pre-wrap text-grid-fg">
                    {r.content}
                  </p>
                  <Button size="sm" variant="outline" className="shrink-0" onClick={() => setOpen(r)}>
                    {t("search.openMemory")}
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-grid-muted">
                  <Badge variant="outline" className="font-mono" dir="ltr">
                    {r.network}·{r.memoryType}
                  </Badge>
                  {r.sourceKind ? (
                    <span dir="ltr" className="truncate font-mono">
                      {r.sourceKind}
                      {r.sourceRef ? ` · ${r.sourceRef}` : ""}
                    </span>
                  ) : null}
                  {r.viaEntity ? <span className="text-grid-action">{t("search.via", { entity: r.viaEntity })}</span> : null}
                  <span className="ms-auto flex items-center gap-3">
                    <Grade score={r.score} />
                    <span className="font-mono">{t("search.imp", { n: formatNumber(r.importance ?? 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}</span>
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      {!ran && !pending ? (
        <p className="px-6 py-8 text-sm text-grid-muted">{t("search.idle")}</p>
      ) : null}

      <MemoryDialog namespace={namespace} hit={open} onClose={() => setOpen(null)} onSaved={patch} />
    </div>
  )
}
