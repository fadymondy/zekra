"use client"

// Home: every brain's status at a glance. A greeting, the headline numbers, an "ask your memory"
// box, the brains grid, and what needs attention / what happened lately / what the brains know.
import {
  Attention,
  BrainCard,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  ChipGroup,
  Input,
  Progress,
  Skeleton,
  StatCard,
  StatGrid,
  Timeline,
  TimelineItem,
} from "@fadymondy/nasaq/web"

import { useMemo, useState, type FormEvent, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { ActivityIcon, BrainIcon, CircleHelpIcon, DatabaseIcon, NetworkIcon, PlusIcon, SearchIcon, SparklesIcon, Trash2Icon } from "lucide-react"

import { brainName } from "@/components/brains/brain-cells"
import { DeleteBrainDialog, NewBrainDialog } from "@/components/brains/brain-dialogs"
import { EmptyState, ErrorState } from "@/components/states"
import { brainApi, type NamespaceInfo } from "@/lib/api"
import { useActivity, useStats } from "@/lib/brains"
import { useTranslations } from "@/lib/i18n"
import { getLastBrain } from "@/lib/last-brain"
import { useBrain, useBrains, useMe } from "@/lib/queries"
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
    <Card className="min-w-0 rounded-xl">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/** Nasaq's BrainCard for one brain; the detail call fills in sources and recalls. */
function HomeBrainCard({ b, onDelete }: { b: NamespaceInfo; onDelete: () => void }) {
  const { t, locale } = useTranslations()
  const { data: d } = useBrain(b.namespace)
  const href = `/${locale}/b/${encodeURIComponent(b.namespace)}`
  return (
    <BrainCard
      className="rounded-xl"
      brain={{
        id: b.namespace,
        name: brainName(b),
        description: b.description || undefined,
        avatar: b.imageUrl || undefined,
        status: "ready",
        visibility: "private",
        memories: b.memories,
        sources: d ? Object.keys(d.sources ?? {}).length : 0,
        chats: d?.recalls,
        lastActive: b.lastAt || null,
      }}
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button size="sm" variant="secondary" nativeButton={false} render={<Link href={href} />}>
            {t("brains.open")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete} aria-label={t("brains.menu.delete")}>
            <Trash2Icon />
          </Button>
        </div>
      }
    />
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
        <Card className="rounded-xl">
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
              <ChipGroup aria-label={t("home.ask.try")} value="" onValueChange={(k) => ask(t(k))}>
                {SUGGESTIONS.map((k) => (
                  <Chip key={k} value={k}>
                    {t(k)}
                  </Chip>
                ))}
              </ChipGroup>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <section className="flex flex-col gap-3" aria-label={t("brains.title")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ChipGroup aria-label={t("brains.title")} value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <Chip value="all">
              {t("home.filter.all")} · {formatNumber(all.length)}
            </Chip>
            <Chip value="active">
              {t("home.filter.active")} · {formatNumber(activeCount)}
            </Chip>
          </ChipGroup>
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {brains.map((b) => (
              <HomeBrainCard key={b.namespace} b={b} onDelete={() => setDeleteNs(b.namespace)} />
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Attention
          className="rounded-xl"
          title={t("home.attention.title")}
          headingLevel={2}
          loading={gaps.isLoading}
          empty={t("home.attention.empty")}
          items={(gaps.data ?? []).map((g) => ({
            id: String(g.id),
            title: g.query,
            description: nameOf(g.namespace),
            tone: "warning" as const,
            icon: CircleHelpIcon,
            count: g.hits,
            time: timeAgo(g.lastSeen),
            dateTime: g.lastSeen,
            href: `/${locale}/b/${encodeURIComponent(g.namespace)}/gaps`,
          }))}
        />

        <Panel title={t("home.activity.title")}>
          {activity.data?.length ? (
            <Timeline>
              {activity.data.map((a) => (
                <TimelineItem
                  key={a.id}
                  icon={<ActivityIcon className={a.outcome === "hit" ? "text-nq-success" : a.outcome === "error" ? "text-nq-danger" : undefined} />}
                  title={`${a.op} · ${nameOf(a.namespace)}`}
                  description={a.agentId || "—"}
                  time={a.ts}
                />
              ))}
            </Timeline>
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
                  <li key={b.namespace}>
                    <Progress
                      size="sm"
                      value={(b.memories / maxMemories) * 100}
                      label={<Link href={`/${locale}/b/${encodeURIComponent(b.namespace)}`} className="hover:text-primary">{brainName(b)}</Link>}
                      showValue
                      valueText={formatNumber(b.memories)}
                    />
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
