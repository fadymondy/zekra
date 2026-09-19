"use client"

import { CopyField } from "@/components/copy-field"
import { brainApi } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { isRedacted } from "@/lib/sources"

/** A webhook source's push endpoint: the URL to POST to and the X-Webhook-Secret header value. */
export function PushEndpoint({ id, secret }: { id: string; secret?: unknown }) {
  const { t } = useTranslations()
  const url = brainApi.ingestUrl(id)
  const example = `curl -X POST '${url}' \\\n  -H 'X-Webhook-Secret: ${isRedacted(secret) ? "<secret>" : String(secret)}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"content":"…","sourceRef":"…"}'`
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="grid-micro">{t("sources.pushUrl")}</p>
        <CopyField value={url} label={t("sources.pushUrl")} />
      </div>
      <div className="space-y-1.5">
        <p className="grid-micro">
          {t("sources.secretHeader")} · <span dir="ltr">X-Webhook-Secret</span>
        </p>
        {isRedacted(secret) ? (
          <p className="text-sm text-grid-muted">{t("sources.secretHidden")}</p>
        ) : (
          <CopyField value={String(secret)} label={t("sources.secretHeader")} />
        )}
      </div>
      <div className="space-y-1.5">
        <p className="grid-micro">{t("sources.example")}</p>
        <CopyField value={example} label={t("sources.example")} />
      </div>
    </div>
  )
}
