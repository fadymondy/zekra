import { headers } from "next/headers"
import type { Metadata, Viewport } from "next"

import "./globals.css"
import { Providers } from "@/components/providers"
import { dirForLocale, isLocale, type Locale } from "@/lib/i18n-locale"

export async function generateMetadata(): Promise<Metadata> {
  const ar = (await headers()).get("x-locale") === "ar"
  return {
    title: ar ? "ذكرة" : "Zekra",
    applicationName: ar ? "ذكرة" : "Zekra",
    description: ar ? "ذاكرة طويلة المدى مشتركة لوكلاء الذكاء الاصطناعي." : "Shared long-term memory for AI agents.",
    // The console is behind a login: zekra.dev is what search engines index.
    robots: { index: false, follow: false },
    // Installed as a PWA (app/manifest.ts): iOS home-screen behaviour.
    appleWebApp: { capable: true, title: ar ? "ذكرة" : "Zekra", statusBarStyle: "black-translucent" },
  }
}

export const viewport: Viewport = {
  themeColor: "#0B1429",
  colorScheme: "dark light",
}

// The locale lives in the URL (/en/…, /ar/…). A root layout cannot read route params, so
// proxy.ts resolves it and forwards it on x-locale.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers()
  const raw = h.get("x-locale")
  const locale: Locale = isLocale(raw) ? raw : "en"
  // zekra.dev (proxy.ts sets this on its rewrites) is a website, not the installable console.
  const site = h.get("x-zekra-site") === "1"
  return (
    <html lang={locale} dir={dirForLocale(locale)} data-brand="zekra" className="grid-surface" suppressHydrationWarning>
      <body className="min-h-dvh" suppressHydrationWarning>
        <Providers locale={locale} pwa={!site}>
          {children}
        </Providers>
      </body>
    </html>
  )
}
