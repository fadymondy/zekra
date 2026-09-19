"use client"

import { useLiveStatus } from "@/lib/realtime"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** Realtime status as the grid draws state: a square in the status colour beside a micro-label. */
export function LiveIndicator() {
  const status = useLiveStatus()
  const { t } = useTranslations()
  return (
    <span
      className="hidden items-center gap-2 border border-line px-2 py-1 sm:inline-flex"
      title={t("shell.realtime", { status: t(`shell.live.${status}`) })}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0",
          status === "live" ? "bg-emerald-500" : status === "connecting" ? "bg-amber-500" : "bg-grid-muted",
        )}
      />
      <span className="grid-micro">{t(`shell.live.${status}`)}</span>
    </span>
  )
}
