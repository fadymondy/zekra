"use client"

import { usePathname } from "next/navigation"
import { type ReactNode } from "react"
import { NasaqProvider, Toaster } from "@fadymondy/nasaq/web"

import { I18nProvider } from "@/lib/i18n"
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n-locale"
import { PwaRegister } from "@/components/pwa"

// Dark is Zekra's default ground (memory is read on a dark ground); the toggle offers light.
// Nasaq owns theme, direction and density: it writes data-theme / data-brand / dir onto <html>.
// The locale lives in the URL, so a language change is a full navigation to the other locale's
// path (the root layout sets <html lang dir> on the server) rather than a client-side flip.
export function Providers({ locale, pwa = true, children }: { locale: string; pwa?: boolean; children: ReactNode }) {
  const pathname = usePathname()

  function switchTo(next: string) {
    if (!isLocale(next) || next === locale) return
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    const parts = pathname.split("/")
    if (isLocale(parts[1])) parts[1] = next
    else parts.splice(1, 0, next)
    window.location.assign(parts.join("/") + window.location.search)
  }

  return (
    <NasaqProvider brand="zekra" defaultTheme="dark" locale={locale} onLocaleChange={switchTo} density="compact" expression="native">
      <I18nProvider locale={locale}>
        {children}
        <Toaster />
        {pwa ? <PwaRegister /> : null}
      </I18nProvider>
    </NasaqProvider>
  )
}
