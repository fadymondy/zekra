"use client"

import { useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import { DownloadIcon } from "lucide-react"

import { StatusLine } from "@/components/account/section"
import { HatchBand } from "@/components/page"
import { ErrorState, LoadingRows } from "@/components/states"
import { Button } from "@/components/ui/button"
import { exportDownloadURL, getExport, requestExport, type ExportState } from "@/lib/account"
import { authMessage } from "@/lib/auth"
import { useTranslations } from "@/lib/i18n"

/**
 * Download my data, ported from fadymondy.com-v2: ask for an export; the one-time link arrives by
 * email. A queued export is built within seconds, so the status is polled until it settles.
 */
export function DataExport() {
  const { t, locale, formatDate } = useTranslations()
  const state = useSWR<ExportState>("/api/me/account/export", getExport, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    refreshInterval: (s) => (s?.status === "queued" ? 3000 : 0),
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (state.isLoading) return <LoadingRows rows={2} />
  if (state.error) return <ErrorState error={state.error} />

  const s = state.data
  const when = (iso?: string) => formatDate(iso, { dateStyle: "medium", timeStyle: "short" })
  const waiting = !!s?.next_allowed_at && new Date(s.next_allowed_at) > new Date()

  let line: string | null = null
  switch (s?.status) {
    case "queued":
      line = t("account.export.queued")
      break
    case "ready":
      line = t("account.export.ready", { time: when(s.expires_at) })
      break
    case "downloaded":
      line = t("account.export.downloaded", { time: when(s.downloaded_at) })
      break
    case "expired":
      line = t("account.export.expired")
      break
    case "failed":
      line = t("account.export.failed")
      break
    default:
      line = t("account.export.none")
  }

  return (
    <>
      <div className="border-y border-line px-6 py-4">
        <p role="status" className="text-sm text-grid-fg">
          {line}
        </p>
        {s?.requested_at ? (
          <p className="text-xs text-grid-muted">{t("account.export.requestedAt", { time: when(s.requested_at) })}</p>
        ) : null}
        {waiting ? <p className="text-xs text-grid-muted">{t("account.export.nextAllowed", { time: when(s?.next_allowed_at) })}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-6 py-6">
        <Button
          variant="outline"
          disabled={busy || waiting || s?.status === "queued"}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await state.mutate(await requestExport(locale), { revalidate: false })
            } catch (err) {
              setError(authMessage(err, t))
            } finally {
              setBusy(false)
            }
          }}
        >
          <DownloadIcon />
          {busy ? t("common.working") : t("account.export.request")}
        </Button>
        <StatusLine notice={error ? { ok: false, text: error } : null} />
      </div>
    </>
  )
}

/**
 * Where the export email lands (?token=). The link works once, and only for the account that
 * asked; the shell has already made sure someone is signed in.
 */
export function ExportDownload({ token }: { token: string }) {
  const { t, locale } = useTranslations()
  const [phase, setPhase] = useState<"idle" | "busy" | "done" | "gone" | "error">("idle")

  if (!/^[0-9a-f]{32,128}$/i.test(token)) {
    return (
      <HatchBand>
        <p className="text-sm text-grid-danger-text">{t("account.export.badLink")}</p>
      </HatchBand>
    )
  }

  async function download() {
    setPhase("busy")
    try {
      const res = await fetch(exportDownloadURL(token), { credentials: "same-origin", cache: "no-store" })
      if (!res.ok) return setPhase(res.status >= 500 ? "error" : "gone")
      const name = /filename="?([^";]+)"?/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "zekra-data.zip"
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement("a")
      a.href = url
      a.download = name
      document.body.append(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setPhase("done")
    } catch {
      setPhase("error")
    }
  }

  return (
    <HatchBand>
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-grid-fg">{t("account.export.linkTitle")}</p>
        <p className="text-sm text-pretty text-grid-muted">{t("account.export.once")}</p>
        <Button className="self-start" disabled={phase === "busy" || phase === "done" || phase === "gone"} onClick={() => void download()}>
          <DownloadIcon />
          {phase === "busy" ? t("common.working") : t("account.export.download")}
        </Button>
        {phase === "done" ? <StatusLine notice={{ ok: true, text: t("account.export.afterClick") }} /> : null}
        {phase === "gone" ? <StatusLine notice={{ ok: false, text: t("account.export.gone") }} /> : null}
        {phase === "error" ? <StatusLine notice={{ ok: false, text: t("common.apiUnavailable") }} /> : null}
        {phase === "gone" ? (
          <Link href={`/${locale}/account/export`} className="text-sm text-grid-muted underline underline-offset-4 hover:text-grid-fg">
            {t("account.export.requestNew")}
          </Link>
        ) : null}
      </div>
    </HatchBand>
  )
}
