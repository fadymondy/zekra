"use client"

// Home: every brain's status at a glance. A greeting, the headline numbers, an "ask your memory"
// box, the brains grid, and what needs attention / what happened lately / what the brains know.
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton, StatCard, StatGrid, Toggle, ToggleGroup } from "@fadymondy/nasaq/web"

import { useMemo, useState, type FormEvent, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { ActivityIcon, BrainIcon, CircleHelpIcon, DatabaseIcon, NetworkIcon, PlusIcon, SearchIcon, SparklesIcon } from "lucide-react"

import { BrainCard, brainName } from "@/components/brains/brain-cells"
import { DeleteBrainDialog, NewBrainDialog } from "@/components/brains/brain-dialogs"
import { EmptyState, ErrorState } from "@/components/states"
import { brainApi } from "@/lib/api"
import { useActivity, useStats } from "@/lib/brains"
import { useTranslations } from "@/lib/i18n"
import { getLastBrain } from "@/lib/last-brain"
import { useBrains, useMe } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"

type Filter = "all" | "active"
const ACTIVE_MS = 7 * 24 * 3600 * 1000
const SUGGESTIONS = ["home.ask.s1", "home.ask.s2", "home.ask.s3"]

function greetingKey(): string {
  const h = new Date().getHours()
  return h < 12 ? "home.greeting.morning" : h < 18 ? "home.greeting.afternoon" : "home.greeting.evening"
}

const isActive = (lastAt?: string | null) => !!lastAt && Date.now() - new Date(lastAt).getTime() < ACTIVE_MS

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>
}

export default function HomePage() {
  const { t, locale, formatNumber, timeAgo } = useTranslations()
  useDocumentTitle(t("home.title"))
  const router = useRouter()
  const me = useMe()
  const brainsQ = useBrains()
  const stats = useStats()
  const activity = useActivity(8)
  const gaps = useSWR(["/api/brain/gaps", "home"], () => brainApi.gaps({ status: "open", limit: 6 }).then((r) => r.gaps ?? []))
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [question, setQuestion] = useState("")
  const [creating, setCreating] = useState(false)
  const [deleteNs, setDeleteNs] = useState<string | null>(null)

  const all = useMemo(
    () => [...(brainsQ.data ?? [])].sort((a, b) => new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime()),
    [brainsQ.data],
  )
  const activeCount = all.filter((b) => isActive(b.lastAt)).length
  const brains = useMemo(() => {
    const term = search.trim().toLowerCase()
    return all.filter(
      (b) =>
        (filter === "all" || isActive(b.lastAt)) &&
        (!term || [b.namespace, b.displayName ?? "", b.description ?? ""].some((s) => s.toLowerCase().includes(term))),
    )
  }, [all, search, filter])

  const last = getLastBrain()
  const scope = last && all.some((b) => b.namespace === last) ? last : all[0]?.namespace
  const scopeBrain = all.find((b) => b.namespace === scope)
  const maxMemories = Math.max(1, ...all.map((b) => b.memories))
  const nameOf = (ns: string) => {
    const b = all.find((x) => x.namespace === ns)
    return b ? brainName(b) : ns
  }

  function ask(q: string, e?: FormEvent) {
    e?.preventDefault()
    if (!scope || !q.trim()) return
    router.push(`/${locale}/b/${encodeURIComponent(scope)}/chat?q=${encodeURIComponent(q.trim())}`)
  }

  const s = stats.data
  const loading = stats.isLoading && !s
  const name = me.data?.name || me.data?.email?.split("@")[0] || ""
  const newButton = (
    <Button variant="primary" onClick={() => setCreating(true)}>
      <PlusIcon />
      {t("brains.new.button")}
    </Button>
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t(greetingKey(), { name })}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("home.subtitle")}</p>
        </div>
        {newButton}
      </header>

      <StatGrid>
        <StatCard loading={loading} icon={<BrainIcon />} label={t("brains.stat.brains")} value={s?.brains ?? all.length} />
        <StatCard loading={loading} icon={<DatabaseIcon />} label={t("brains.stat.memories")} value={s?.memories ?? 0} />
        <StatCard loading={loading} icon={<NetworkIcon />} label={t("home.stat.nodes")} value={s?.entities ?? 0} />
        <StatCard loading={loading} icon={<ActivityIcon />} label={t("brains.stat.recalls24h")} value={s?.recalls24h ?? 0} />
        <StatCard loading={loading} icon={<CircleHelpIcon />} label={t("brains.stat.openGaps")} value={s?.openGaps ?? 0} />
      </StatGrid>

      {scope ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <div className="flex items-center gap-2 text-sm font-medium">
              <SparklesIcon className="size-4 text-primary" />
              {t("home.ask.title", { brain: scopeBrain ? brainName(scopeBrain) : scope })}
            </div>
            <form className="flex gap-2" onSubmit={(e) => ask(question, e)}>
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={t("home.ask.placeholder")}
                aria-label={t("home.ask.placeholder")}
              />
              <Button type="submit" variant="primary" disabled={!question.trim()}>
                {t("home.ask.button")}
              </Button>
            </form>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {t("home.ask.try")}
              {SUGGESTIONS.map((k) => (
                <Button key={k} size="sm" variant="secondary" className="rounded-full" onClick={() => ask(t(k))}>
                  {t(k)}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <section className="flex flex-col gap-3" aria-label={t("brains.title")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ToggleGroup variant="outline" value={[filter]} onValueChange={(v: string[]) => v[0] && setFilter(v[0] as Filter)}>
            <Toggle value="all">
              {t("home.filter.all")} <Badge variant="neutral">{formatNumber(all.length)}</Badge>
            </Toggle>
            <Toggle value="active">
              {t("home.filter.active")} <Badge variant="neutral">{formatNumber(activeCount)}</Badge>
            </Toggle>
          </ToggleGroup>
          <div className="relative w-full sm:max-w-xs">
            <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("brains.searchPlaceholder")}
              aria-label={t("brains.searchPlaceholder")}
              className="ps-9"
            />
          </div>
        </div>

        {brainsQ.error ? (
          <ErrorState error={brainsQ.error} />
        ) : brainsQ.isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : brains.length === 0 ? (
          <EmptyState
            title={search ? t("brains.emptySearch") : t("brains.empty")}
            body={search ? t("brains.emptySearchBody") : t("brains.emptyBody")}
            action={search ? undefined : newButton}
          />
        ) : (
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 xl:grid-cols-3">
            {brains.map((b) => (
              <BrainCard key={b.namespace} b={b} onDelete={() => setDeleteNs(b.namespace)} />
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title={t("home.attention.title")}>
          {gaps.data?.length ? (
            <ul className="flex flex-col divide-y divide-border">
              {gaps.data.map((g) => (
                <li key={g.id}>
                  <Link href={`/${locale}/b/${encodeURIComponent(g.namespace)}/gaps`} className="flex items-start gap-2 py-2 text-sm hover:text-primary">
                    <CircleHelpIcon className="mt-0.5 size-4 shrink-0 text-nq-warning" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="line-clamp-1">{g.query}</span>
                      <span className="text-xs text-muted-foreground">
                        {nameOf(g.namespace)} · {timeAgo(g.lastSeen)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>{gaps.isLoading ? "…" : t("home.attention.empty")}</Empty>
          )}
        </Panel>

        <Panel title={t("home.activity.title")}>
          {activity.data?.length ? (
            <ul className="flex flex-col divide-y divide-border">
              {activity.data.map((a) => (
                <li key={a.id} className="flex items-center gap-2 py-2 text-sm">
                  <span
                    className={`size-2 shrink-0 rounded-full ${a.outcome === "hit" ? "bg-nq-success" : a.outcome === "error" ? "bg-nq-danger" : "bg-muted-foreground"}`}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="line-clamp-1">
                      {a.op} · {nameOf(a.namespace)}
                    </span>
                    <span className="text-xs text-muted-foreground">{a.agentId || "—"}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.ts)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>{activity.isLoading ? "…" : t("home.activity.empty")}</Empty>
          )}
        </Panel>

        <Panel title={t("home.knows.title")}>
          {all.length ? (
            <ul className="flex flex-col gap-3">
              {[...all]
                .sort((a, b) => b.memories - a.memories)
                .slice(0, 6)
                .map((b) => (
                  <li key={b.namespace} className="text-sm">
                    <div className="mb-1 flex justify-between gap-2">
                      <Link href={`/${locale}/b/${encodeURIComponent(b.namespace)}`} className="line-clamp-1 hover:text-primary">
                        {brainName(b)}
                      </Link>
                      <span className="tabular-nums text-muted-foreground">{formatNumber(b.memories)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${(b.memories / maxMemories) * 100}%`, background: b.colorHex || undefined }}
                      />
                    </div>
                  </li>
                ))}
            </ul>
          ) : (
            <Empty>{t("brains.empty")}</Empty>
          )}
        </Panel>
      </div>

      <NewBrainDialog open={creating} onOpenChange={setCreating} onCreated={(ns) => router.push(`/${locale}/b/${encodeURIComponent(ns)}`)} />
      <DeleteBrainDialog namespace={deleteNs} onClose={() => setDeleteNs(null)} />
    </div>
  )
}
