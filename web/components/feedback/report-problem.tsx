"use client"

import { toast } from "sonner"
import { useTheme } from "next-themes"

// The shared "Report a problem" SDK: a GENERATED copy of fadymondy.com-v2/packages/feedback-sdk,
// synced into lib/feedback (`node …/packages/sync-feedback.mjs lib/feedback`). Never edit it here.
import { ReportDialog, type FeedbackSubmission } from "@/lib/feedback/react"
import { dataUrlToBlob } from "@/lib/feedback/core"
import { useTranslations } from "@/lib/i18n"

const TYPES = ["bug", "feature", "task"] as const

// Reports are filed into Zekra's project on Mahaam through its public embed intake
// (POST /api/feedback/embed). The only credential is the project's public key (pfk_…), and
// Mahaam checks this app's Origin against the key's allowlist.
const MAHAAM_URL = process.env.NEXT_PUBLIC_MAHAAM_URL ?? "https://console.mahaam.app"
const FEEDBACK_KEY = process.env.NEXT_PUBLIC_MAHAAM_FEEDBACK_KEY ?? ""

export const feedbackEnabled = FEEDBACK_KEY !== ""

/**
 * The host adapter, as in Mahaam: the SDK owns the dialog, screenshot, element picker and
 * console/network capture; this file owns the transport and the report's `meta`.
 */
export function ReportProblemDialog({
  open,
  onOpenChange,
  brain,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  brain?: string
}) {
  const { t, locale } = useTranslations()
  const { resolvedTheme } = useTheme()

  async function onSubmit(payload: FeedbackSubmission) {
    const form = new FormData()
    const meta = { product: "zekra", brain: brain ?? null, locale, theme: resolvedTheme ?? null }
    const fields: Record<string, string | undefined> = {
      public_key: FEEDBACK_KEY,
      title: payload.title,
      body: payload.body,
      issue_type: payload.issue_type,
      page_url: payload.page_url,
      route: payload.route,
      selector: payload.selector,
      console_log: payload.console_log,
      network_log: payload.network_log,
      user_agent: payload.user_agent,
      viewport: payload.viewport,
      meta: JSON.stringify({ ...(payload.meta ?? {}), ...meta }),
    }
    for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v)
    if (payload.screenshot) {
      const blob = dataUrlToBlob(payload.screenshot)
      form.append("screenshot", blob, `screenshot.${blob.type.split("/")[1] || "png"}`)
    }

    // A thrown error keeps the SDK dialog open and shows its message.
    const res = await fetch(`${MAHAAM_URL}/api/feedback/embed`, { method: "POST", body: form })
    if (!res.ok) throw new Error(t("feedback.failed"))
    const data = (await res.json().catch(() => ({}))) as { key?: string }
    toast.success(data.key ? t("feedback.sentWithKey", { key: data.key }) : t("feedback.sent"), {
      description: t("feedback.sentHint"),
    })
  }

  return (
    <ReportDialog
      open={open}
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
      locale={locale}
      types={TYPES}
      defaultType="bug"
      typeLabels={{ bug: t("feedback.type.bug"), feature: t("feedback.type.feature"), task: t("feedback.type.task") }}
      idPrefix="zekra-feedback"
    />
  )
}
