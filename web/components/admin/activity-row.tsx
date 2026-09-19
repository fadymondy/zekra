"use client"

import { Badge } from "@/components/ui/badge"
import { Ltr } from "@/components/copy-field"
import type { ActivityItem } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"

const OUTCOMES = ["hit", "empty", "error", "running"]

/** One memory operation in a feed: what, where, who, how long, the outcome and when. */
export function ActivityRow({ a, showNamespace = true }: { a: ActivityItem; showNamespace?: boolean }) {
  const { t, formatNumber, timeAgo, formatDate } = useTranslations()
  const tone = a.outcome === "error" ? "destructive" : a.outcome === "hit" ? "secondary" : "outline"
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-3 text-sm">
      <Ltr mono className="font-medium text-grid-fg">{a.op}</Ltr>
      {showNamespace ? <Ltr mono className="text-xs text-grid-muted">{a.namespace || "—"}</Ltr> : null}
      <Ltr className="min-w-0 truncate text-xs text-grid-muted">{a.agentId || t("admin.activity.anonymous")}</Ltr>
      <span className="ms-auto text-xs text-grid-muted tabular-nums">
        {a.latencyMs ? t("admin.activity.ms", { n: formatNumber(a.latencyMs) }) : ""}
      </span>
      <Badge variant={tone}>{OUTCOMES.includes(a.outcome) ? t(`admin.outcome.${a.outcome}`) : a.outcome}</Badge>
      <time dateTime={a.ts} title={formatDate(a.ts, { dateStyle: "medium", timeStyle: "medium" })} className="min-w-24 text-end text-xs text-grid-muted">
        {timeAgo(a.ts)}
      </time>
    </li>
  )
}
