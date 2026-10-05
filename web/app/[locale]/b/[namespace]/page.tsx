"use client"

// Brain Overview: what this brain holds and what it has been doing, on Nasaq cards. Stat cards on top
// (memories carry a 14-day trend), the memory graph, then Ask + "What it knows" (types and sources as meters), recent
// notes and activity side by side.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import useSWR from "swr"
import {
  ArrowRightIcon,
  BrainIcon,
  CircleHelpIcon,
  KeyRoundIcon,
  MessagesSquareIcon,
  NetworkIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SplineIcon,
} from "lucide-react"
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Chip,
  ChipGroup,
  Input,
  Meter,
  StatCard,
  StatGrid,
  toast,
} from "@fadymondy/nasaq/web"

import { ActivityRow } from "@/components/activity/activity-row"
import { BrainDescription, BrainMicro, BrainTitle } from "@/components/brains/brain-header"
import { BrainGraphView, type FocusRequest } from "@/components/graph/graph-view"
import { RowList, SectionHeader } from "@/components/page"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { ApiError, brainApi } from "@/lib/api"
import { useBrainActivity, useGraph, useSecretCount } from "@/lib/brains"
import { useTranslations } from "@/lib/i18n"
import { notesApi, useNotes } from "@/lib/notes"
import { useBrain } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"

const DAYS = 14
const DAY_MS = 24 * 3600 * 1000

/** Daily operation counts over the last DAYS days, oldest first. */
function dailyActivity(items: { ts: string }[]): number[] {
  const out = new Array<number>(DAYS).fill(0)
  const today = new Date()
  today.setHours(23, 59, 59, 999)
  for (const it of items) {
    const age = Math.floor((today.getTime() - new Date(it.ts).getTime()) / DAY_MS)
    if (age < 0 || age >= DAYS) continue
    out[DAYS - 1 - age] += 1
  }
  return out
}

/** Change of the last 7 days against the 7 before, as a fraction; undefined without a baseline. */
function weekDelta(trend: number[]): number | undefined {
  const prev = trend.slice(0, 7).reduce((a, b) => a + b, 0)
  const last = trend.slice(7).reduce((a, b) => a + b, 0)
  return prev ? (last - prev) / prev : undefined
}

/** Largest entries of a count map, biggest first. */
function top(map: Record<string, number> | undefined, n: number): [string, number][] {
  return Object.entries(map ?? {}).sort((a, b) => b[1] - a[1]).slice(0, n)
}

function ViewAll({ href }: { href: string }) {
  const { t } = useTranslations()
  return (
    <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={href} />}>
      {t("common.viewAll")}
      <ArrowRightIcon className="rtl:-scale-x-100" />
    </Button>
  )
}

/** A rounded Nasaq card with a titled header and an optional action. */
function Panel({
  title,
  description,
  action,
  className,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <Card className={`rounded-xl ${className ?? ""}`}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/** A count map as labelled meters, each measured against the brain's total memories. */
function Breakdown({ title, rows, total }: { title: string; rows: [string, number][]; total: number }) {
  const { formatNumber, locale } = useTranslations()
  if (rows.length === 0) return null
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {rows.map(([k, v]) => (
        <Meter
          key={k}
          size="sm"
          label={<span dir="auto" className="truncate">{k}</span>}
          value={v}
          max={Math.max(total, v, 1)}
          tone="info"
          valueText={formatNumber(v)}
          locale={locale}
        />
      ))}
    </div>
  )
}

function RecentNotes({ ns, base }: { ns: string; base: string }) {
  const { t, timeAgo } = useTranslations()
  const router = useRouter()
  const notes = useNotes({ namespace: ns, limit: 5 })
  const [creating, setCreating] = useState(false)
  const rows = notes.data?.notes ?? []

  async function create() {
    setCreating(true)
    try {
      const n = await notesApi.create(ns)
      router.push(`${base}/notes?id=${encodeURIComponent(n.id)}`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
      setCreating(false)
    }
  }

  return (
    <Panel
      title={t("notes.recent")}
      action={
        <div className="flex items-center gap-1">
          <ViewAll href={`${base}/notes`} />
          <Button size="sm" variant="secondary" onClick={create} disabled={creating}>
            <PlusIcon />
            {t("notes.new")}
          </Button>
        </div>
      }
    >
      {notes.error ? (
        <ErrorState error={notes.error} />
      ) : notes.isLoading ? (
        <LoadingRows rows={2} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("notes.recentEmpty")} />
      ) : (
        <RowList label={t("notes.recent")} className="-mx-4 border-y-0">
          {rows.map((n) => (
            <li key={n.id}>
              <Link
                href={`${base}/notes?id=${encodeURIComponent(n.id)}`}
                className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-nq-surface-soft"
              >
                {n.pinned ? <PinIcon className="size-3.5 shrink-0 text-nq-action" /> : null}
                <span dir="auto" className="min-w-0 flex-1 truncate text-foreground">
                  {n.title || t("notes.untitled")}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(n.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </RowList>
      )}
    </Panel>
  )
}

export default function BrainOverviewPage() {
  const { t, locale, formatNumber, timeAgo } = useTranslations()
  const router = useRouter()
  const ns = decodeURIComponent(useParams<{ namespace: string }>().namespace)
  useDocumentTitle(`${t("overview.micro")} · ${ns}`)
  const base = `/${locale}/b/${encodeURIComponent(ns)}`

  const detail = useBrain(ns)
  const graph = useGraph(ns)
  const secrets = useSecretCount(ns)
  const activity = useBrainActivity(ns)
  const since = useMemo(() => new Date(Date.now() - DAYS * DAY_MS).toISOString(), [])
  const trendData = useSWR(["/api/brain/activity", ns, DAYS], () =>
    brainApi.brainActivity({ namespace: ns, since, limit: 200 }).then((r) => r.items ?? []),
  )
  const trend = useMemo(() => dailyActivity(trendData.data ?? []), [trendData.data])
  const trendTotal = trend.reduce((a, b) => a + b, 0)

  const d = detail.data
  const nodes = graph.data?.nodes ?? []
  const edges = graph.data?.edges ?? []
  const nodeTotal = graph.data?.totalNodes || nodes.length
  const edgeTotal = graph.data?.totalEdges || edges.length
  const recent = activity.rows.slice(0, 6)
  const gaps = d?.openGaps ?? 0

  // ?focus=<entityId>&note=<noteId> (from a note's "View in graph"): open the graph on that node.
  // Read from window once (no Suspense boundary); the graph waits for it so the focus is initial.
  const [focusReq, setFocusReq] = useState<FocusRequest | null | undefined>(undefined)
  const graphRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const sp = new URL(window.location.href).searchParams
    const req = { id: sp.get("focus"), noteId: sp.get("note") }
    setFocusReq(req.id || req.noteId ? req : null)
  }, [])
  useEffect(() => {
    if (focusReq && graph.data) graphRef.current?.scrollIntoView({ block: "center" })
  }, [focusReq, graph.data])

  // Suggested questions from the brain's own named entities, so the page opens somewhere to go.
  const suggestions = useMemo(() => {
    const named = nodes.filter((n) => !["root", "type"].includes(n.group ?? "")).map((n) => n.name).filter(Boolean)
    return Array.from(new Set(named)).slice(0, 4)
  }, [nodes])

  const [question, setQuestion] = useState("")
  const ask = (q: string) => {
    const text = q.trim()
    router.push(text ? `${base}/chat?q=${encodeURIComponent(text)}` : `${base}/chat`)
  }

  const types = top(d?.types, 6)
  const sources = top(d?.sources, 5)
  const total = d?.memories ?? 0

  return (
    <>
      <SectionHeader
        micro={<BrainMicro ns={ns} label={t("overview.micro")} />}
        title={<BrainTitle ns={ns} />}
        description={<BrainDescription ns={ns} />}
        action={
          <Button variant="primary" nativeButton={false} render={<Link href={`${base}/chat`} />}>
            <MessagesSquareIcon />
            {t("overview.ask.chat")}
          </Button>
        }
      />

      <div className="flex flex-col gap-4 p-4 md:p-6">
        {detail.error ? <ErrorState error={detail.error} /> : null}

        <StatGrid className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard
            className="rounded-xl"
            loading={detail.isLoading}
            icon={<BrainIcon />}
            label={t("overview.stat.memories")}
            value={total}
            sparkline={trend}
            delta={weekDelta(trend)}
            deltaLabel={t("overview.stat.vsLastWeek")}
          />
          <StatCard
            className="rounded-xl"
            loading={graph.isLoading}
            icon={<NetworkIcon />}
            label={t("overview.stat.nodes")}
            value={nodeTotal}
          />
          <StatCard
            className="rounded-xl"
            loading={graph.isLoading}
            icon={<SplineIcon />}
            label={t("overview.stat.edges")}
            value={edgeTotal}
          />
          <StatCard
            className="rounded-xl"
            loading={detail.isLoading}
            icon={<SearchIcon />}
            label={t("overview.stat.recalls")}
            value={d?.recalls ?? 0}
          />
          <Link href={`${base}/gaps`} className="rounded-xl">
            <StatCard
              className={`h-full rounded-xl transition-colors hover:bg-nq-surface-soft ${gaps ? "text-nq-warning" : ""}`}
              loading={detail.isLoading}
              icon={<CircleHelpIcon />}
              label={t("overview.stat.gaps")}
              value={gaps}
            />
          </Link>
          <Link href={`${base}/secrets`} className="rounded-xl">
            <StatCard
              className="h-full rounded-xl transition-colors hover:bg-nq-surface-soft"
              loading={secrets.isLoading}
              icon={<KeyRoundIcon />}
              label={t("overview.stat.secrets")}
              value={secrets.data ?? 0}
            />
          </Link>
        </StatGrid>

        <Panel
          className="overflow-hidden"
          title={t("overview.graph.title")}
          description={t("overview.graph.summary", { nodes: formatNumber(nodeTotal), edges: formatNumber(edgeTotal) })}
          action={graph.data?.derived ? <Badge variant="outline">{t("overview.graph.derived")}</Badge> : null}
        >
          <div ref={graphRef} className="flex h-[560px] flex-col overflow-hidden rounded-lg border border-border bg-background">
            {graph.error ? (
              <ErrorState error={graph.error} />
            ) : nodes.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
                <NetworkIcon className="size-8 opacity-40" />
                <p className="text-sm">{graph.isLoading ? t("graph.loading") : t("graph.empty")}</p>
              </div>
            ) : focusReq === undefined ? null : (
              <BrainGraphView
                key={`${ns}|${focusReq?.id ?? ""}|${focusReq?.noteId ?? ""}`}
                data={graph.data!}
                namespace={ns}
                focus={focusReq}
              />
            )}
          </div>
        </Panel>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel
            className="lg:col-span-2"
            title={t("overview.ask.title", { brain: "⁨" + ns + "⁩" })}
            description={t("overview.ask.body")}
          >
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                ask(question)
              }}
            >
              <Input
                dir="auto"
                className="min-w-0 flex-1"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={t("overview.ask.placeholder")}
                aria-label={t("overview.ask.placeholder")}
              />
              <Button type="submit" variant="primary">
                <MessagesSquareIcon />
                {t("overview.ask.send")}
              </Button>
            </form>
            {suggestions.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {t("overview.ask.try")}
                <ChipGroup
                  aria-label={t("overview.ask.try")}
                  value=""
                  onValueChange={(s) => ask(t("overview.ask.suggestion", { topic: s }))}
                >
                  {suggestions.map((s) => (
                    <Chip key={s} value={s}>
                      {t("overview.ask.suggestion", { topic: "⁨" + s + "⁩" })}
                    </Chip>
                  ))}
                </ChipGroup>
              </div>
            ) : null}

            <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">{t("overview.since")}</dt>
                <dd className="text-foreground">{d?.firstAt ? timeAgo(d.firstAt) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("overview.lastLearned")}</dt>
                <dd className="text-foreground">{d?.lastAt ? timeAgo(d.lastAt) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("overview.ops", { days: DAYS })}</dt>
                <dd className="text-foreground">{formatNumber(trendTotal)}</dd>
              </div>
            </dl>
          </Panel>

          <Panel title={t("overview.knows.title")} action={<ViewAll href={`${base}/sources`} />}>
            {detail.isLoading ? (
              <LoadingRows rows={4} />
            ) : types.length === 0 && sources.length === 0 ? (
              <EmptyState title={t("overview.knows.empty")} />
            ) : (
              <div className="flex flex-col gap-5">
                <Breakdown title={t("overview.knows.types")} rows={types} total={total} />
                <Breakdown title={t("overview.knows.sources")} rows={sources} total={total} />
              </div>
            )}
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <RecentNotes ns={ns} base={base} />
          <Panel title={t("overview.recentActivity")} action={<ViewAll href={`${base}/activity`} />}>
            {activity.error ? (
              <ErrorState error={activity.error} />
            ) : activity.isLoading ? (
              <LoadingRows rows={3} />
            ) : recent.length === 0 ? (
              <EmptyState title={t("overview.noActivity")} />
            ) : (
              <RowList label={t("overview.recentActivity")} className="-mx-4 border-y-0">
                {recent.map((a) => (
                  <ActivityRow key={a.id} a={a} />
                ))}
              </RowList>
            )}
          </Panel>
        </div>

      </div>
    </>
  )
}
