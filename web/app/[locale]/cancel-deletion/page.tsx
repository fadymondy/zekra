"use client"

import { CancelForm } from "@/components/account/delete-account"
import { PublicFrame, PublicPanel } from "@/components/public-frame"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

// Public: a scheduled deletion signs the account out everywhere, so cancelling it during the
// grace period has to work without a session. The form proves ownership with email + password.
export default function CancelDeletionPage() {
  const { t } = useTranslations()
  useDocumentTitle(t("account.delete.cancelTitle"))
  return (
    <PublicFrame eyebrow={t("nav.account")} title={t("account.delete.cancelTitle")} description={t("account.delete.cancelHint")}>
      <PublicPanel className="py-10">
        <CancelForm />
      </PublicPanel>
    </PublicFrame>
  )
}
