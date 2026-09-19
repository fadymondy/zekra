import type { Metadata } from "next"
import { headers } from "next/headers"
import { LinkIcon } from "lucide-react"

import { getI18n } from "@/lib/i18n-server"
import { SHARE_HOST_HEADER, fetchShared } from "@/lib/presentations/api"
import { SharedFrame } from "@/components/presentations/shared-frame"
import { SharedView } from "@/components/presentations/shared-view"
import { PresTheme } from "@/components/presentations/pres-theme"
import { CubeMark } from "@/components/brand/cube-mark"
import { ZEKRA_MARK } from "@/lib/brand/mark"
import "@/components/presentations/presentations.css"

/*
/{locale}/p/{token} — a deck, report or page preview shared with a customer
(FM-342). The token is the only authorization; the API answers unknown,
revoked, expired and archived links alike. Never indexed, never sends the
token onward as a referrer, and records one view per page load.
*/
export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ locale: string; token: string }> }): Promise<Metadata> {
  const { locale, token } = await params
  const { t } = await getI18n(locale)
  // No event: reading the title for the tab is not a view.
  const { data } = await fetchShared(token, { locale, host: (await headers()).get(SHARE_HOST_HEADER) })
  return {
    title: data ? `${data.title} — ${t("presentations.shared.home")}` : t("presentations.shared.unavailableTitle"),
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
    referrer: "no-referrer",
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params
  const { t } = await getI18n(locale)
  const h = await headers()
  const { status, data } = await fetchShared(token, {
    locale,
    event: "view",
    forwardedFor: h.get("x-forwarded-for") ?? h.get("x-real-ip"),
    host: h.get(SHARE_HOST_HEADER),
  })

  if (!data) {
    return (
      <PresTheme className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <CubeMark mark={ZEKRA_MARK} size={32} />
        <LinkIcon className="size-6 text-muted-foreground" aria-hidden />
        <h1 className="text-2xl font-semibold">
          {status === 429 ? t("presentations.shared.slowDown") : t("presentations.shared.unavailableTitle")}
        </h1>
        <p className="max-w-md text-muted-foreground">
          {status === 429 ? t("presentations.shared.slowDownBody") : t("presentations.shared.unavailableBody")}
        </p>
      </PresTheme>
    )
  }

  const who = [data.customer, data.company].filter(Boolean).join(" · ")
  return (
    <PresTheme className={data.kind === "deck" ? "flex h-dvh flex-col" : "min-h-dvh"}>
      <SharedFrame
        t={t}
        token={token}
        locale={locale}
        locales={data.locales ?? []}
        formats={data.formats ?? []}
        who={who}
        expiresAt={data.expires_at}
      />
      <main className={data.kind === "deck" ? "flex min-h-0 flex-1 flex-col" : undefined} lang={data.locale}>
        <SharedView doc={data} who={who} token={token} />
      </main>
    </PresTheme>
  )
}
