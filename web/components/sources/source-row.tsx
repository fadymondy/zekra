"use client"

import { useState } from "react"
import { ChevronDownIcon, Link2Icon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"

import { ConfirmButton } from "@/components/confirm-button"
import { iconFor } from "@/components/sources/kinds"
import { PushEndpoint } from "@/components/sources/push-endpoint"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ApiError, brainApi, type Datasource } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

function statusVariant(s: string) {
  return s === "ok" ? "default" : s === "error" ? "destructive" : s === "syncing" ? "secondary" : "outline"
}

/** One connector: kind, status, docs, last sync, and sync / delete. Webhooks reveal their push URL. */
export function SourceRow({ s, onChanged }: { s: Datasource; onChanged: () => void }) {
  const { t, formatNumber, formatDate, timeAgo } = useTranslations()
  const [busy, setBusy] = useState(false)
  const [showHook, setShowHook] = useState(false)
  const Icon = iconFor(s.kind)
  const isWebhook = s.kind === "webhook"
  const syncing = busy || s.status === "syncing"
  const status = s.status || "idle"
  const known = ["idle", "syncing", "ok", "error"].includes(status)

  const errText = (err: unknown) => (err instanceof ApiError ? err.message : t("common.networkError"))

  async function sync() {
    setBusy(true)
    try {
      const r = await brainApi.syncDatasource({ id: s.id })
      if (r.error) toast.error(r.error)
      else toast.success(t("sources.synced", { n: formatNumber(r.ingested) }))
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  return (
    <li className="space-y-3 px-6 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center border border-line bg-grid-card text-grid-action">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span dir="auto" className="truncate text-sm font-medium text-grid-fg">
              {s.name}
            </span>
            <Badge variant="outline" dir="ltr" className="font-mono">
              {s.kind}
            </Badge>
            <Badge variant={statusVariant(status)}>{known ? t(`sources.status.${status}`) : status}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-grid-muted">
            <span>{t("sources.docs", { n: formatNumber(s.docCount ?? 0) })}</span>
            <span title={s.lastSyncAt ? formatDate(s.lastSyncAt, { dateStyle: "medium", timeStyle: "short" }) : undefined}>
              {s.lastSyncAt ? t("sources.lastSync", { when: timeAgo(s.lastSyncAt) }) : t("sources.neverSynced")}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isWebhook ? (
            <Button variant="outline" size="sm" aria-expanded={showHook} onClick={() => setShowHook((v) => !v)}>
              <Link2Icon /> {t("sources.pushUrl")}
              <ChevronDownIcon className={cn("transition-transform", showHook && "rotate-180")} />
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled={syncing} onClick={sync}>
              <RefreshCwIcon className={syncing ? "animate-spin" : undefined} />
              {syncing ? t("sources.syncing") : t("sources.syncNow")}
            </Button>
          )}
          <ConfirmButton
            label={t("common.delete")}
            title={t("sources.deleteTitle", { name: s.name })}
            description={t("sources.deleteBody")}
            confirmLabel={t("common.delete")}
            onConfirm={async () => {
              try {
                await brainApi.deleteDatasource({ id: s.id })
                toast.success(t("sources.deleted"))
              } catch (err) {
                toast.error(errText(err))
              }
              onChanged()
            }}
          />
        </div>
      </div>
      {s.lastError ? (
        <p dir="auto" className="text-sm text-grid-danger-text">
          {s.lastError}
        </p>
      ) : null}
      {isWebhook && showHook ? (
        <div className="border border-line bg-grid-soft p-3">
          <PushEndpoint id={s.id} secret={s.config?.secret} />
        </div>
      ) : null}
    </li>
  )
}
