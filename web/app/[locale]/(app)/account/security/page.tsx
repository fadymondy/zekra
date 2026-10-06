"use client"

import { TwoFactorSettings } from "@/components/account/two-factor"
import { SectionHeader } from "@/components/page"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

export default function SecurityPage() {
  const { t } = useTranslations()
  useDocumentTitle(t("account.security.title"))
  return (
    <div className="pb-10">
      <SectionHeader micro={t("account.micro")} title={t("account.security.title")} description={t("account.security.intro")} />
      <TwoFactorSettings />
    </div>
  )
}
