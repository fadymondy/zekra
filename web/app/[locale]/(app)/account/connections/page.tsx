"use client"

import { ConnectedAccounts } from "@/components/account/connected-accounts"
import { SectionHeader } from "@/components/page"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

export default function ConnectionsPage() {
  const { t, locale } = useTranslations()
  useDocumentTitle(t("account.connections.title"))
  return (
    <div className="pb-10">
      <SectionHeader micro={t("account.micro")} title={t("account.connections.title")} description={t("account.connections.hint")} />
      <ConnectedAccounts returnPath={`/${locale}/account/connections`} />
    </div>
  )
}
