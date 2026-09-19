"use client"

import { HatchBand } from "@/components/page"
import { ErrorState } from "@/components/states"
import { isNotLive } from "@/lib/admin"
import { useTranslations } from "@/lib/i18n"

/** The error state for /api/admin/* calls: a calm "not available yet" band while the backend
 *  endpoint isn't deployed, the regular error state otherwise. */
export function AdminErrorState({ error, what }: { error: unknown; what?: string }) {
  const { t } = useTranslations()
  if (!isNotLive(error)) return <ErrorState error={error} />
  return (
    <HatchBand>
      <p className="text-sm font-medium text-grid-fg">{t("admin.notLive.title")}</p>
      <p className="mt-1 text-sm text-grid-muted">{what ?? t("admin.notLive.body")}</p>
    </HatchBand>
  )
}
