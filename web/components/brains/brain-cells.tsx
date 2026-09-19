"use client"

import type { CSSProperties } from "react"
import Link from "next/link"
import { ArrowRightIcon, CircleCheckIcon, CircleHelpIcon, DownloadIcon, EllipsisIcon, RocketIcon, SettingsIcon, SquareArrowOutUpRightIcon, Trash2Icon } from "lucide-react"

import { ToneTag } from "@/components/activity/activity-row"
import { Ltr } from "@/components/copy-field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { brainApi, type BrainDetail, type NamespaceInfo } from "@/lib/api"
import { resolveColor, type ProfileSummary } from "@/lib/brain-profile"
import { useTranslations } from "@/lib/i18n"
import { useBrain } from "@/lib/queries"

/** A brain's identity tile: its avatar image when it has one; otherwise a hairline square with
 *  its icon (emoji) or a two-letter mono monogram, tinted with the brain's colour, and the colour
 *  as the memory square in the corner. */
export function BrainAvatar({
  namespace,
  profile,
  size = 40,
}: {
  namespace: string
  profile?: ProfileSummary
  size?: number
}) {
  const mono = namespace.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "··"
  const hex = profile?.colorHex || resolveColor(profile?.color)
  const style: CSSProperties = { height: size, width: size, fontSize: Math.round(size * (profile?.icon ? 0.5 : 0.3)) }
  if (hex) style.backgroundColor = `color-mix(in srgb, ${hex} 14%, transparent)`
  if (profile?.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- member-only API image, not optimizable
      <img aria-hidden alt="" src={profile.imageUrl} className="shrink-0 border border-line object-cover" style={{ height: size, width: size }} />
    )
  }
  return (
    <span
      aria-hidden
      className="relative flex shrink-0 items-center justify-center border border-line bg-grid-soft font-mono font-medium text-grid-fg"
      style={style}
    >
      {profile?.icon ? <span className="font-sans leading-none">{profile.icon}</span> : mono}
      <span className="absolute -end-px -top-px size-2 bg-grid-action" style={hex ? { backgroundColor: hex } : undefined} />
    </span>
  )
}

/** The brain's shown name: its display name, else the namespace. */
export const brainName = (b: { namespace: string; displayName?: string }) => b.displayName?.trim() || b.namespace

function BrainMenu({ namespace, onDelete }: { namespace: string; onDelete: () => void }) {
  const { t, locale } = useTranslations()
  const base = `/${locale}/b/${encodeURIComponent(namespace)}`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="relative z-20 shrink-0" aria-label={t("brains.menu.label", { brain: namespace })} />}>
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem render={<Link href={base} />}>
          <SquareArrowOutUpRightIcon />
          {t("brains.menu.open")}
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`${base}/sessions`} />}>
          <RocketIcon />
          {t("brains.menu.launch")}
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`${base}/settings`} />}>
          <SettingsIcon />
          {t("brainSettings.menu")}
        </DropdownMenuItem>
        <DropdownMenuItem render={<a href={brainApi.exportUrl(namespace)} download />}>
          <DownloadIcon />
          {t("brains.menu.export")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2Icon />
          {t("brains.menu.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TypeTags({ detail }: { detail?: BrainDetail }) {
  const { t, formatNumber } = useTranslations()
  if (!detail) return <Skeleton className="h-5 w-40" />
  const types = Object.entries(detail.types ?? {}).sort((a, b) => b[1] - a[1])
  if (types.length === 0) return <span className="text-xs text-grid-muted">{t("brains.noTypes")}</span>
  const top = types.slice(0, 3)
  const rest = types.length - top.length
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {top.map(([type, n]) => (
        <Badge key={type} variant="secondary" className="font-normal">
          {type}
          <span className="ms-1.5 text-grid-muted">{formatNumber(n)}</span>
        </Badge>
      ))}
      {rest > 0 ? <span className="text-xs text-grid-muted">{t("brains.moreTypes", { count: formatNumber(rest) })}</span> : null}
    </div>
  )
}

function GapState({ detail, compact = false }: { detail?: BrainDetail; compact?: boolean }) {
  const { t, formatNumber } = useTranslations()
  if (!detail) return null
  if (detail.openGaps > 0)
    return (
      <ToneTag tone="warn">
        <span className="inline-flex items-center gap-1">
          <CircleHelpIcon className="size-3" />
          {compact ? formatNumber(detail.openGaps) : t(detail.openGaps === 1 ? "brains.openGap" : "brains.openGaps", { count: formatNumber(detail.openGaps) })}
        </span>
      </ToneTag>
    )
  if (compact) return null
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-grid-muted">
      <CircleCheckIcon className="size-3.5 text-grid-ok" /> {t("brains.noGaps")}
    </span>
  )
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="truncate text-[15px] font-medium text-grid-fg">{value}</div>
      <div className="grid-micro mt-1">{label}</div>
    </div>
  )
}

/** A brain as a hairline cell; hover lifts the ground one step and draws the active rule. */
export function BrainCard({ b, onDelete }: { b: NamespaceInfo; onDelete: () => void }) {
  const { t, locale, formatNumber, timeAgo } = useTranslations()
  const { data: d } = useBrain(b.namespace)
  const href = `/${locale}/b/${encodeURIComponent(b.namespace)}`
  const name = brainName(b)
  const hex = b.colorHex || resolveColor(b.color)
  return (
    <div className="group relative flex flex-col bg-grid-card transition-colors hover:bg-grid-soft focus-within:bg-grid-soft">
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-0.5 bg-transparent opacity-60 transition-[background-color,opacity] group-hover:bg-grid-action group-hover:opacity-100"
        style={hex ? { backgroundColor: hex } : undefined}
      />
      <Link href={href} aria-label={t("brains.openBrain", { brain: name })} className="absolute inset-0 z-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" />

      <div className="pointer-events-none relative z-10 flex items-start gap-3 p-4">
        <BrainAvatar namespace={b.namespace} profile={b} size={44} />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium text-grid-fg">{name}</span>
          <div className="mt-1 truncate text-[11px] text-grid-muted">
            {name !== b.namespace ? (
              <>
                <Ltr mono>{b.namespace}</Ltr> ·{" "}
              </>
            ) : null}
            {t("brains.updated", { when: b.lastAt ? timeAgo(b.lastAt) : t("common.never") })}
          </div>
          {b.description ? <p className="mt-2 line-clamp-2 text-xs text-grid-muted">{b.description}</p> : null}
        </div>
        <div className="pointer-events-auto -me-1 -mt-1">
          <BrainMenu namespace={b.namespace} onDelete={onDelete} />
        </div>
      </div>

      <div className="pointer-events-none relative z-10 grid grid-cols-3 divide-x divide-line border-y border-line rtl:divide-x-reverse">
        <Metric value={formatNumber(b.memories)} label={t("brains.metric.memories")} />
        <Metric value={d ? formatNumber(d.recalls) : "—"} label={t("brains.metric.recalls")} />
        <Metric value={d ? formatNumber(Object.keys(d.types ?? {}).length) : "—"} label={t("brains.metric.types")} />
      </div>

      <div className="pointer-events-none relative z-10 min-h-[3.25rem] px-4 py-3">
        <TypeTags detail={d} />
      </div>

      <div className="pointer-events-none relative z-10 mt-auto flex items-center justify-between border-t border-line px-4 py-2.5">
        <GapState detail={d} />
        <span className="inline-flex items-center gap-1 text-sm text-grid-muted transition-colors group-hover:text-grid-fg">
          {t("brains.open")} <ArrowRightIcon className="size-4 rtl:-scale-x-100" />
        </span>
      </div>
    </div>
  )
}

/** The same brain as a hairline row (list view). */
export function BrainRow({ b, onDelete }: { b: NamespaceInfo; onDelete: () => void }) {
  const { t, locale, formatNumber, timeAgo } = useTranslations()
  const { data: d } = useBrain(b.namespace)
  const href = `/${locale}/b/${encodeURIComponent(b.namespace)}`
  const stats: [string, string][] = [
    [formatNumber(b.memories), t("brains.metric.memories")],
    [d ? formatNumber(d.recalls) : "—", t("brains.metric.recalls")],
    [d ? formatNumber(Object.keys(d.types ?? {}).length) : "—", t("brains.metric.types")],
  ]
  return (
    <li className="group relative flex items-center gap-3 px-6 py-3 transition-colors hover:bg-grid-soft">
      <Link href={href} aria-label={t("brains.openBrain", { brain: brainName(b) })} className="absolute inset-0 z-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      <div className="pointer-events-none">
        <BrainAvatar namespace={b.namespace} profile={b} size={36} />
      </div>
      <div className="pointer-events-none min-w-0 flex-1">
        <span className="block truncate font-medium text-grid-fg">{brainName(b)}</span>
        <div className="mt-0.5 truncate text-[11px] text-grid-muted">
          {brainName(b) !== b.namespace ? (
            <>
              <Ltr mono>{b.namespace}</Ltr> ·{" "}
            </>
          ) : null}
          {b.description ? <span className="hidden lg:inline">{b.description} · </span> : null}
          {b.lastAt ? timeAgo(b.lastAt) : t("common.never")}
          <span className="sm:hidden"> · {t("brains.memoriesCount", { count: formatNumber(b.memories) })}</span>
        </div>
      </div>
      <div className="pointer-events-none hidden items-center gap-8 sm:flex">
        {stats.map(([v, l]) => (
          <div key={l} className="text-end">
            <div className="text-sm font-medium text-grid-fg">{v}</div>
            <div className="grid-micro mt-0.5">{l}</div>
          </div>
        ))}
      </div>
      <div className="pointer-events-none hidden md:block">
        <GapState detail={d} compact />
      </div>
      <ArrowRightIcon className="pointer-events-none hidden size-4 shrink-0 text-grid-muted group-hover:text-grid-fg sm:block rtl:-scale-x-100" />
      <div className="relative z-20">
        <BrainMenu namespace={b.namespace} onDelete={onDelete} />
      </div>
    </li>
  )
}
