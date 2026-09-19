"use client"

import { NotificationPrefs } from "@/components/account/notification-prefs"
import { SectionHeader } from "@/components/page"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

export default function NotificationsPage() {
  const { t } = useTranslations()
  useDocumentTitle(t("account.notifications.title"))
  return (
    <div className="pb-10">
      <SectionHeader micro={t("account.micro")} title={t("account.notifications.title")} description={t("account.notifications.hint")} />
      <NotificationPrefs />
    </div>
  )
}
