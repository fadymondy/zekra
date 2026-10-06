"use client"

import { DeleteAccount } from "@/components/account/delete-account"
import { SectionHeader } from "@/components/page"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

export default function DeleteAccountPage() {
  const { t } = useTranslations()
  useDocumentTitle(t("account.delete.title"))
  return (
    <div className="pb-10">
      <SectionHeader micro={t("account.micro")} title={t("account.delete.title")} description={t("account.delete.description")} />
      <DeleteAccount />
    </div>
  )
}
