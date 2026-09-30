"use client"

import { Badge } from "@fadymondy/nasaq/web"

import type { AdminUser } from "@/lib/admin"
import { useTranslations } from "@/lib/i18n"

/** Disabled beats unverified beats active. */
export function UserStatusBadge({ user }: { user: AdminUser }) {
  const { t } = useTranslations()
  if (user.disabled) return <Badge variant="danger">{t("admin.users.statusDisabled")}</Badge>
  if (!user.email_verified) return <Badge variant="outline" className="text-nq-warning-text">{t("admin.users.statusUnverified")}</Badge>
  return <Badge variant="neutral">{t("admin.users.statusActive")}</Badge>
}
