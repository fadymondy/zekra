"use client"

import { Status } from "@fadymondy/nasaq/web"

import { useLiveStatus } from "@/lib/realtime"
import { useTranslations } from "@/lib/i18n"

/** Realtime status as a Nasaq Status: live is success, connecting is info, down is neutral. */
export function LiveIndicator() {
  const status = useLiveStatus()
  const { t } = useTranslations()
  return (
    <span className="hidden sm:inline-flex" title={t("shell.realtime", { status: t(`shell.live.${status}`) })}>
      <Status tone={status === "live" ? "success" : status === "connecting" ? "info" : "neutral"}>{t(`shell.live.${status}`)}</Status>
    </span>
  )
}
