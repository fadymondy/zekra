"use client"

import { Badge, Button, Card, CardContent, InputGroup, InputGroupAddon, InputGroupInput, Meter, Skeleton, Toggle, ToggleGroup } from "@fadymondy/nasaq/web"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useParams } from "next/navigation"
import { CheckIcon, SearchIcon, SlidersHorizontalIcon, SparklesIcon, StarIcon, XIcon } from "lucide-react"

import { SectionHeader } from "@/components/page"
import { MemoryDialog } from "@/components/search/memory-dialog"
import { ErrorState } from "@/components/states"
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
      <Meter size="sm" value={pct} max={100} tone="info" className="w-14" aria-hidden />
      <span className="font-mono">{fig}</span>
    </span>
  )
}

function Facet({ label, active, onClick, icon }: { label: ReactNode; active: boolean; onClick: () => void; icon?: ReactNode }) {
  return (
    <Button type="button" size="sm" variant={active ? "primary" : "secondary"} aria-pressed={active} onClick={onClick}>
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
  const { t, formatNumber } = useTranslations()
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

  // The Overview's Ask box lands here as ?q=: fill the box and search once.
  useEffect(() => {
    const initial = new URL(window.location.href).searchParams.get("q")?.trim()
    if (initial) {
      setQ(initial)
      void run(initial)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function run(override?: string) {
    const query = (override ?? q).trim()
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
            <span dir="ltr" className="font-medium text-foreground">
              {namespace}
            </span>
          </>
        }
      />

      <div className="flex flex-col gap-4 p-4 md:p-6">
        <Card className="rounded-xl">
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup aria-label={t("search.mode")} variant="outline" value={[mode]} onValueChange={(v: string[]) => v[0] && setMode(v[0] as Mode)}>
                <Toggle value="recall">
                  <SparklesIcon /> {t("search.modeRecall")}
                </Toggle>
                <Toggle value="search">
                  <SearchIcon /> {t("search.modeSearch")}
                </Toggle>
              </ToggleGroup>
              <span className="ms-auto text-xs text-muted-foreground">{t("search.limit")}</span>
              <ToggleGroup aria-label={t("search.limit")} variant="outline" value={[String(limit)]} onValueChange={(v: string[]) => v[0] && setLimit(Number(v[0]))}>
                {LIMITS.map((n) => (
                  <Toggle key={n} value={String(n)}>
                    {formatNumber(n)}
                  </Toggle>
                ))}
              </ToggleGroup>
            </div>
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault()
                void run()
              }}
            >
              <InputGroup className="h-10 flex-1">
                <InputGroupAddon>
                  <SearchIcon aria-hidden className="size-4 text-muted-foreground" />
                </InputGroupAddon>
                <InputGroupInput dir="auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search.placeholder")} aria-label={t("search.placeholder")} autoFocus />
              </InputGroup>
              <Button variant="primary" type="submit" className="h-10 px-5" disabled={pending || !q.trim()}>
                <SearchIcon /> {pending ? t("search.searching") : t(mode === "recall" ? "search.modeRecall" : "search.modeSearch")}
              </Button>
            </form>
          </CardContent>
        </Card>

        {state.error ? <ErrorState error={state.error} /> : null}

        {ran || pending ? (
          <Card className="rounded-xl">
            <CardContent className="flex flex-col gap-3">
              {raw.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="me-1 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <SlidersHorizontalIcon className="size-3.5" /> {t("search.tune")}
                  </span>
                  {netFacets.map((n) => (
                    <Facet key={n} label={<span dir="ltr">{n}</span>} active={fNet.has(n)} onClick={() => setFNet((s) => toggleIn(s, n))} />
                  ))}
                  {typeFacets.map((ty) => (
                    <Facet key={ty} label={<span dir="ltr">{ty}</span>} active={fType.has(ty)} onClick={() => setFType((s) => toggleIn(s, ty))} />
                  ))}
                  {srcFacets.map((s) => (
                    <Facet key={s} label={<span dir="ltr">{s}</span>} active={fSrc.has(s)} onClick={() => setFSrc((x) => toggleIn(x, s))} />
                  ))}
                  <Facet label={t("search.highImportance")} icon={<StarIcon />} active={highImp} onClick={() => setHighImp((v) => !v)} />
                  {hasFilters ? (
                    <Button size="sm" variant="ghost" className="ms-auto" onClick={clearTuners}>
                      <XIcon /> {t("search.clear")}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {pending ? (
                <div className="flex flex-col gap-2" aria-busy>
                  {Array.from({ length: 4 }, (_, i) => (
                    <div key={i} className="space-y-2 rounded-lg bg-nq-surface-soft p-3">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  ))}
                </div>
              ) : null}

              {!pending && !state.error && raw.length === 0 ? (
                <div className="rounded-lg bg-nq-surface-soft px-6 py-10 text-center">
                  <SearchIcon aria-hidden className="mx-auto mb-2 size-6 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">
                    {t("search.noMemoryOf")} <bdi dir="auto">“{state.q}”</bdi>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{t("search.noMemoryHint")}</p>
                </div>
              ) : null}

              {!pending && raw.length > 0 && results.length === 0 ? (
                <p className="rounded-lg bg-nq-surface-soft px-6 py-8 text-center text-sm text-muted-foreground">{t("search.allFiltered", { n: formatNumber(raw.length) })}</p>
              ) : null}

              {!pending && results.length > 0 ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    {hasFilters
                      ? t("search.countOf", { n: formatNumber(results.length), total: formatNumber(raw.length) })
                      : t(results.length === 1 ? "search.countOne" : "search.countMany", { n: formatNumber(results.length) })}
                  </p>
                  <ol className="-mx-2 flex flex-col gap-1">
                    {results.map((r) => (
                      <li key={`${r.namespace ?? namespace}:${r.id}`}>
                        <button
                          type="button"
                          onClick={() => setOpen(r)}
                          className="flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-start transition-colors hover:bg-nq-hover focus-visible:outline-2 focus-visible:outline-nq-focus"
                        >
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--nq-action)_14%,transparent)] text-nq-action">
                            <SparklesIcon className="size-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span dir="auto" className="line-clamp-3 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                              {r.content}
                            </span>
                            <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <Badge variant="outline" className="font-mono" dir="ltr">
                                {r.network}·{r.memoryType}
                              </Badge>
                              {r.sourceKind ? (
                                <span dir="ltr" className="max-w-64 truncate font-mono">
                                  {r.sourceKind}
                                  {r.sourceRef ? ` · ${r.sourceRef}` : ""}
                                </span>
                              ) : null}
                              {r.viaEntity ? <span className="text-nq-action">{t("search.via", { entity: r.viaEntity })}</span> : null}
                              <span className="ms-auto flex items-center gap-3">
                                <Grade score={r.score} />
                                <span className="font-mono">{t("search.imp", { n: formatNumber(r.importance ?? 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}</span>
                              </span>
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <p className="px-1 text-sm text-muted-foreground">{t("search.idle")}</p>
        )}
      </div>

      <MemoryDialog namespace={namespace} hit={open} onClose={() => setOpen(null)} onSaved={patch} />
    </div>
  )
}
