import { DownloadIcon, LanguagesIcon } from "lucide-react"

import type { T } from "@/lib/i18n-server"
import { Button } from "@/components/ui/button"
import { CubeMark } from "@/components/brand/cube-mark"
import { ZEKRA_MARK } from "@/lib/brand/mark"
import { ThemeToggle } from "@/components/header-controls"
import { dirForLocale, LOCALE_NAMES, LOCALES } from "@/lib/i18n-locale"

/*
The slim bar above a shared document (FM-342): the mark (never the wordmark),
who it was prepared for, the other languages the document has,
downloads that exist for this kind, and the theme switch. Nothing links to
the rest of the owner's documents.
*/
export function SharedFrame({
  t,
  token,
  locale,
  locales,
  formats,
  who,
  expiresAt,
  suffix = "",
}: {
  t: T
  token: string
  locale: string
  locales: string[]
  formats: string[]
  who: string
  expiresAt: string | null
  /** Extra path after the token (an embedded page: /embed/{id}). */
  suffix?: string
}) {
  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b bg-background/85 px-3 py-2 backdrop-blur sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <a href="https://zekra.dev" rel="noopener" aria-label={t("presentations.shared.home")} className="shrink-0">
          <CubeMark mark={ZEKRA_MARK} size={24} />
        </a>
        <div className="min-w-0 text-sm leading-tight">
          {who ? <p className="truncate font-medium">{t("presentations.shared.preparedFor", { who })}</p> : null}
          <p className="truncate text-xs text-muted-foreground">
            {t("presentations.shared.by")}
            {expiresAt
              ? ` · ${t("presentations.shared.expires", {
                  date: new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", { dateStyle: "medium" }).format(new Date(expiresAt)),
                })}`
              : ""}
          </p>
        </div>
      </div>
      <nav className="flex items-center gap-1" aria-label={t("presentations.shared.actions")}>
        {/* Every other language this presentation exists in — a list, not a toggle. */}
        {LOCALES.filter((l) => l !== locale && locales.includes(l)).map((l) => (
          <Button key={l} variant="ghost" size="sm" nativeButton={false} render={<a href={`/${l}/p/${token}${suffix}`} hrefLang={l} lang={l} dir={dirForLocale(l)} />}>
            <LanguagesIcon />
            {LOCALE_NAMES[l]}
          </Button>
        ))}
        {formats.map((f) => (
          <Button key={f} variant="outline" size="sm" nativeButton={false} render={<a href={`/${locale}/p/${token}/download/${f}`} download />}>
            <DownloadIcon />
            {t(`presentations.format.${f}`)}
          </Button>
        ))}
        <ThemeToggle />
      </nav>
    </header>
  )
}
