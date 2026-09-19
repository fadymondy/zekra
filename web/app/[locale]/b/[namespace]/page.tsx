"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ArrowRightIcon, MessagesSquareIcon, NetworkIcon, PinIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { ActivityRow } from "@/components/activity/activity-row"
import { Ltr } from "@/components/copy-field"
import { BrainGraphView, type FocusRequest } from "@/components/graph/graph-view"
import { DetailStrip, RowList, SectionHeader, SectionTitle } from "@/components/page"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useBrainActivity, useGraph, useSecretCount } from "@/lib/brains"
import { ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { notesApi, useNotes } from "@/lib/notes"
import { useBrain } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"

function StatLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="underline decoration-line underline-offset-4 hover:decoration-grid-fg">
      {children}
    </Link>
  )
}

/** The five latest notes, plus a shortcut to start one. */
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
    <>
      <SectionTitle
        action={
          <div className="flex items-center gap-3">
            <Link href={`${base}/notes`} className="inline-flex items-center gap-1 text-xs text-grid-fg underline underline-offset-4">
              {t("common.viewAll")} <ArrowRightIcon className="size-3 rtl:-scale-x-100" />
            </Link>
            <Button size="sm" variant="outline" onClick={create} disabled={creating}>
              <PlusIcon />
              {t("notes.new")}
            </Button>
          </div>
        }
      >
        {t("notes.recent")}
      </SectionTitle>
      {notes.error ? (
        <ErrorState error={notes.error} />
      ) : notes.isLoading ? (
        <LoadingRows rows={2} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("notes.recentEmpty")} />
      ) : (
        <RowList label={t("notes.recent")}>
          {rows.map((n) => (
            <li key={n.id}>
              <Link
                href={`${base}/notes?id=${encodeURIComponent(n.id)}`}
                className="flex items-center gap-3 px-6 py-3 text-sm transition-colors hover:bg-grid-soft"
              >
                {n.pinned ? <PinIcon className="size-3.5 shrink-0 text-grid-action" /> : null}
                <span dir="auto" className="min-w-0 flex-1 truncate text-grid-fg">
                  {n.title || t("notes.untitled")}
                </span>
                <span className="shrink-0 text-xs text-grid-muted">{timeAgo(n.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </RowList>
      )}
    </>
  )
}

export default function BrainOverviewPage() {
  const { t, locale, formatNumber } = useTranslations()
  const ns = decodeURIComponent(useParams<{ namespace: string }>().namespace)
  useDocumentTitle(`${t("overview.micro")} · ${ns}`)
  const base = `/${locale}/b/${encodeURIComponent(ns)}`

  const detail = useBrain(ns)
  const graph = useGraph(ns)
  const secrets = useSecretCount(ns)
  const activity = useBrainActivity(ns)

  const d = detail.data
  const nodes = graph.data?.nodes ?? []
  const edges = graph.data?.edges ?? []
  const nodeTotal = graph.data?.totalNodes || nodes.length
  const edgeTotal = graph.data?.totalEdges || edges.length
  const recent = activity.rows.slice(0, 8)

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
  const gaps = d?.openGaps ?? 0

  // Suggested questions from the brain's own named entities, so the page opens somewhere to go.
  const suggestions = useMemo(() => {
    const named = nodes.filter((n) => !["root", "type"].includes(n.group ?? "")).map((n) => n.name).filter(Boolean)
    return Array.from(new Set(named)).slice(0, 4)
  }, [nodes])

  const num = (n: number | undefined, loading: boolean) => (loading || n === undefined ? "—" : formatNumber(n))

  return (
    <>
      <SectionHeader
        micro={t("overview.micro")}
        title={<Ltr>{ns}</Ltr>}
        action={
          <Badge variant="outline">
            {d ? t("overview.memoriesBadge", { count: formatNumber(d.memories) }) : t("overview.brainBadge")}
          </Badge>
        }
      />

      {detail.error ? <ErrorState error={detail.error} /> : null}

      <DetailStrip
        className="sm:grid-cols-3 lg:grid-cols-6"
        items={[
          { label: t("overview.stat.memories"), value: num(d?.memories, detail.isLoading) },
          { label: t("overview.stat.nodes"), value: num(nodeTotal, graph.isLoading) },
          { label: t("overview.stat.edges"), value: num(edgeTotal, graph.isLoading) },
          { label: t("overview.stat.recalls"), value: num(d?.recalls, detail.isLoading) },
          {
            label: t("overview.stat.gaps"),
            value: (
              <StatLink href={`${base}/gaps`}>
                <span className={gaps ? "text-grid-warn" : undefined}>{num(d?.openGaps, detail.isLoading)}</span>
              </StatLink>
            ),
          },
          {
            label: t("overview.stat.secrets"),
            value: <StatLink href={`${base}/secrets`}>{num(secrets.data, secrets.isLoading)}</StatLink>,
          },
        ]}
      />

      {/* Ask this brain: the recall panel as an invitation, seeded with the brain's own entities. */}
      <section className="flex flex-col gap-4 border-b border-line bg-grid-card px-6 py-6 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="size-2.5 shrink-0 bg-grid-action" />
            <span className="text-[15px] font-medium text-grid-fg">
              {t("overview.ask.title", { brain: "⁨" + ns + "⁩" })}
            </span>
          </div>
          <p className="text-sm text-grid-body">{t("overview.ask.body")}</p>
          {suggestions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1.5">
              {suggestions.map((s) => (
                <Link
                  key={s}
                  href={`${base}/chat?q=${encodeURIComponent(t("overview.ask.suggestion", { topic: s }))}`}
                  className="grid-chip transition-colors hover:text-grid-fg"
                >
                  {t("overview.ask.suggestion", { topic: "⁨" + s + "⁩" })}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
        <Button nativeButton={false} render={<Link href={`${base}/chat`} />}>
          <MessagesSquareIcon />
          {t("overview.ask.chat")}
        </Button>
      </section>

      <RecentNotes ns={ns} base={base} />

      <SectionTitle
        action={
          graph.data?.derived ? <span className="grid-micro">{t("overview.graph.derived")}</span> : null
        }
      >
        {t("overview.graph.title")}
      </SectionTitle>
      <div ref={graphRef} className="flex h-[680px] flex-col border-y border-line">
        {graph.error ? (
          <ErrorState error={graph.error} />
        ) : nodes.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-grid-muted">
            <NetworkIcon className="size-8 opacity-40" />
            <p className="text-sm">{graph.isLoading ? t("graph.loading") : t("graph.empty")}</p>
          </div>
        ) : (
          focusReq === undefined ? null : (
            <BrainGraphView key={`${ns}|${focusReq?.id ?? ""}|${focusReq?.noteId ?? ""}`} data={graph.data!} namespace={ns} focus={focusReq} />
          )
        )}
      </div>

      <SectionTitle
        action={
          <Link href={`${base}/activity`} className="inline-flex items-center gap-1 text-xs text-grid-fg underline underline-offset-4">
            {t("common.viewAll")} <ArrowRightIcon className="size-3 rtl:-scale-x-100" />
          </Link>
        }
      >
        {t("overview.recentActivity")}
      </SectionTitle>
      {activity.error ? (
        <ErrorState error={activity.error} />
      ) : activity.isLoading ? (
        <LoadingRows rows={3} />
      ) : recent.length === 0 ? (
        <EmptyState title={t("overview.noActivity")} />
      ) : (
        <RowList label={t("overview.recentActivity")} className="mb-6">
          {recent.map((a) => (
            <ActivityRow key={a.id} a={a} />
          ))}
        </RowList>
      )}
    </>
  )
}
