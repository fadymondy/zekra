"use client"

import { PasswordSection, ProfileSection } from "@/components/account/profile"
import { SectionHeader } from "@/components/page"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

export default function AccountPage() {
  const { t } = useTranslations()
  useDocumentTitle(t("account.title"))
  return (
    <div className="pb-10">
      <SectionHeader micro={t("account.micro")} title={t("account.title")} description={t("account.description")} />
      <ProfileSection />
      <PasswordSection />
    </div>
  )
}
