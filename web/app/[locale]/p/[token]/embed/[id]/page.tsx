import type { Metadata } from "next"
import { headers } from "next/headers"
import { LinkIcon } from "lucide-react"

import { getI18n } from "@/lib/i18n-server"
import { fetchSharedEmbed } from "@/lib/presentations/api"
import { SharedFrame } from "@/components/presentations/shared-frame"
import { SharedView } from "@/components/presentations/shared-view"
import { PresTheme } from "@/components/presentations/pres-theme"
import { CubeMark } from "@/components/brand/cube-mark"
import { ZEKRA_MARK } from "@/lib/brand/mark"
import "@/components/presentations/presentations.css"

/*
/{locale}/p/{deckToken}/embed/{documentId} — a page preview opened from a
shared deck's embed slide. The deck's token is the only
authorization, and the API answers only for pages that deck embeds; anything
else looks exactly like a dead link. Never indexed, no referrer.
*/
export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ locale: string; token: string; id: string }> }): Promise<Metadata> {
  const { locale, token, id } = await params
  const { t } = await getI18n(locale)
  const { data } = await fetchSharedEmbed(token, id, { locale })
  return {
    title: data ? `${data.title} — ${t("presentations.shared.home")}` : t("presentations.shared.unavailableTitle"),
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
    referrer: "no-referrer",
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string; token: string; id: string }> }) {
  const { locale, token, id } = await params
  const { t } = await getI18n(locale)
  const h = await headers()
  const { status, data } = await fetchSharedEmbed(token, id, {
    locale,
    forwardedFor: h.get("x-forwarded-for") ?? h.get("x-real-ip"),
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
    <PresTheme className="min-h-dvh">
      <SharedFrame
        t={t}
        token={token}
        suffix={`/embed/${encodeURIComponent(id)}`}
        locale={locale}
        locales={data.locales ?? []}
        formats={[]}
        who={who}
        expiresAt={data.expires_at}
      />
      <main lang={data.locale}>
        <SharedView doc={data} who={who} />
      </main>
    </PresTheme>
  )
}
