"use client"

import { useRouter } from "next/navigation"
import { useSWRConfig } from "swr"
import { CircleUserIcon, ShieldCheckIcon } from "lucide-react"
import { DropdownMenuItem, UserMenu as NasaqUserMenu, toast } from "@fadymondy/nasaq/web"

import { api, resetCsrf } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { isAdmin, type User } from "@/lib/queries"

/** The account menu: identity, account/admin links, theme, language and sign out (Nasaq's UserMenu). */
export function UserMenu({ user }: { user: User }) {
  const { t, locale } = useTranslations()
  const router = useRouter()
  const { mutate } = useSWRConfig()

  async function signOut() {
    try {
      await api("/api/auth/logout", { method: "POST" })
    } catch {
      toast.error(t("common.networkError"))
      return
    }
    resetCsrf()
    // Drop every cached response: the next account must not see this one's data.
    await mutate(() => true, undefined, { revalidate: false })
    // A full load (not a client navigation) also unloads the signed-in-only feedback widget.
    window.location.assign(`/${locale}/login`)
  }

  return (
    <NasaqUserMenu
      user={{ name: user.name || user.email, email: user.email }}
      onSignOut={signOut}
      labels={{ theme: t("header.theme"), language: t("header.language"), signOut: t("header.signOut") }}
    >
      <DropdownMenuItem onClick={() => router.push(`/${locale}/account`)}>
        <CircleUserIcon />
        {t("header.account")}
      </DropdownMenuItem>
      {isAdmin(user) ? (
        <DropdownMenuItem onClick={() => router.push(`/${locale}/admin`)}>
          <ShieldCheckIcon />
          {t("header.admin")}
        </DropdownMenuItem>
      ) : null}
    </NasaqUserMenu>
  )
}
