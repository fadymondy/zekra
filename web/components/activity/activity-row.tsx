"use client"

import type { ReactNode } from "react"

import { Ltr } from "@/components/copy-field"
import type { ActivityItem } from "@/lib/api"
import { toneFor, type Tone } from "@/lib/brains"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const TONE_FILL: Record<Tone, string> = {
  ok: "bg-nq-success",
  warn: "bg-nq-warning",
  danger: "bg-nq-danger",
  muted: "bg-muted-foreground",
  active: "bg-nq-action",
}

/** The grid's state square: the brand's memory square, coloured by state. */
export function ToneSquare({ tone, className }: { tone: Tone; className?: string }) {
  return <span aria-hidden className={cn("size-1.5 shrink-0", TONE_FILL[tone], className)} />
}

/** A state tag: a hairline chip with a tone square. The label always carries the meaning. */
export function ToneTag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="grid-chip shrink-0">
      <ToneSquare tone={tone} />
      <span className={tone === "danger" ? "text-nq-danger" : undefined}>{children}</span>
    </span>
  )
}

/** A dictionary label with the raw value as fallback (unknown ops/outcomes from newer APIs). */
export function useLabel() {
  const { t } = useTranslations()
  return (prefix: string, value: string) => {
    const k = `${prefix}.${value}`
    const s = t(k)
    return s === k ? value : s
  }
}

export function Monogram({ id }: { id: string }) {
  const ch = id.replace(/[^\p{L}\p{N}]/gu, "").charAt(0) || "?"
  return (
    <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center bg-nq-surface-soft font-mono text-[12px] font-medium uppercase text-foreground">
      {ch}
    </span>
  )
}

/** One memory operation: who, what, how long, the outcome and when. */
export function ActivityRow({ a, showNamespace = false, showAgent = true }: { a: ActivityItem; showNamespace?: boolean; showAgent?: boolean }) {
  const { t, formatNumber, formatDate } = useTranslations()
  const label = useLabel()
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-3 text-sm">
      {showAgent ? <Monogram id={a.agentId || "?"} /> : null}
      <span className="font-medium text-foreground">{label("activity.op", a.op)}</span>
      {showNamespace ? (
        <Ltr mono className="text-xs text-muted-foreground">
          {a.namespace || "—"}
        </Ltr>
      ) : null}
      {showAgent ? (
        <Ltr className="min-w-0 truncate text-xs text-muted-foreground">{a.agentId || t("activity.anonymous")}</Ltr>
      ) : null}
      <span className="ms-auto text-[12.5px] text-muted-foreground">
        {a.latencyMs ? t("activity.latency", { ms: formatNumber(a.latencyMs) }) : ""}
      </span>
      <ToneTag tone={toneFor(a.outcome)}>{label("activity.outcome", a.outcome)}</ToneTag>
      <time dateTime={a.ts} title={formatDate(a.ts, { dateStyle: "medium", timeStyle: "medium" })} className="min-w-[5.5rem] text-end text-[12.5px] text-muted-foreground">
        {a.ts ? formatDate(a.ts, { timeStyle: "medium" }) : ""}
      </time>
    </li>
  )
}
