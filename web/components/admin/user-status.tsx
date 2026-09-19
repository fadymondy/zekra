"use client"

import { Badge } from "@/components/ui/badge"
import type { AdminUser } from "@/lib/admin"
import { useTranslations } from "@/lib/i18n"

/** Disabled beats unverified beats active. */
export function UserStatusBadge({ user }: { user: AdminUser }) {
  const { t } = useTranslations()
  if (user.disabled) return <Badge variant="destructive">{t("admin.users.statusDisabled")}</Badge>
  if (!user.email_verified) return <Badge variant="outline" className="text-grid-warn-text">{t("admin.users.statusUnverified")}</Badge>
  return <Badge variant="secondary">{t("admin.users.statusActive")}</Badge>
}
