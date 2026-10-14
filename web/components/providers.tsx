"use client"

import { usePathname } from "next/navigation"
import { type ReactNode } from "react"
import { NasaqProvider, Toaster } from "@fadymondy/nasaq/web"

import { I18nProvider } from "@/lib/i18n"
import { saveProfile } from "@/lib/account"
import { LOCALE_COOKIE, isLocale, localeOptions } from "@/lib/i18n-locale"
import { SITE_LOCALES } from "@/lib/site/config"
import { PwaRegister } from "@/components/pwa"

// Dark is Zekra's default ground (memory is read on a dark ground); the toggle offers light.
// Nasaq owns theme, direction and density: it writes data-theme / data-brand / dir onto <html>.
// The locale lives in the URL, so a language change is a full navigation to the other locale's
// path (the root layout sets <html lang dir> on the server) rather than a client-side flip.
// zekra.dev (`site`) is published in fewer languages than the console, so its menu offers only those.
const CONSOLE_LOCALES = localeOptions()
const SITE_LOCALE_OPTIONS = localeOptions(SITE_LOCALES)

export function Providers({
  locale,
  messages,
  site = false,
  children,
}: {
  locale: string
  messages?: Record<string, string>
  site?: boolean
  children: ReactNode
}) {
  const pathname = usePathname()

  async function switchTo(next: string) {
    if (!isLocale(next) || next === locale) return
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    // The console also saves it on the account, so emails and notifications follow (best
    // effort, never blocking the switch for long; signed out it is a 401, ignored).
    if (!site) await Promise.race([saveProfile({ locale: next }).catch(() => {}), new Promise((r) => setTimeout(r, 800))])
    const parts = pathname.split("/")
    if (isLocale(parts[1])) parts[1] = next
    else parts.splice(1, 0, next)
    window.location.assign(parts.join("/") + window.location.search)
  }

  return (
    <NasaqProvider brand="zekra" defaultTheme="dark" locale={locale} locales={site ? SITE_LOCALE_OPTIONS : CONSOLE_LOCALES} onLocaleChange={switchTo} density="compact" expression="native">
      <I18nProvider locale={locale} messages={messages}>
        {children}
        <Toaster />
        {site ? null : <PwaRegister />}
      </I18nProvider>
    </NasaqProvider>
  )
}
