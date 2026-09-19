import { headers } from "next/headers"
import type { Metadata } from "next"

import "./globals.css"
import { Providers } from "@/components/providers"
import { dirForLocale, isLocale, type Locale } from "@/lib/i18n-locale"

export async function generateMetadata(): Promise<Metadata> {
  const ar = (await headers()).get("x-locale") === "ar"
  return {
    title: "Zekra",
    applicationName: "Zekra",
    description: ar ? "ذاكرة طويلة المدى مشتركة لوكلاء الذكاء الاصطناعي." : "Shared long-term memory for AI agents.",
    // The console is behind a login: zekra.dev is what search engines index.
    robots: { index: false, follow: false },
  }
}

// The locale lives in the URL (/en/…, /ar/…). A root layout cannot read route params, so
// proxy.ts resolves it and forwards it on x-locale.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const raw = (await headers()).get("x-locale")
  const locale: Locale = isLocale(raw) ? raw : "en"
  return (
    <html lang={locale} dir={dirForLocale(locale)} data-brand="cabrain" className="grid-surface" suppressHydrationWarning>
      <body className="min-h-dvh" suppressHydrationWarning>
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  )
}
