"use client"

import { type ReactNode } from "react"
import { ThemeProvider, useTheme } from "next-themes"
import { Toaster } from "sonner"

import { I18nProvider } from "@/lib/i18n"
import { dirForLocale } from "@/lib/i18n-locale"
import { PwaRegister } from "@/components/pwa"

function ThemedToaster({ locale }: { locale: string }) {
  const { resolvedTheme } = useTheme()
  const dir = dirForLocale(locale)
  return (
    <Toaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      dir={dir}
      position={dir === "rtl" ? "bottom-left" : "bottom-right"}
      toastOptions={{
        style: {
          background: "var(--grid-elevated)",
          color: "var(--grid-fg)",
          border: "1px solid var(--grid-elevated-line)",
        },
      }}
    />
  )
}

// Dark is Zekra's default ground (memory is read on a dark ground); the toggle offers light.
export function Providers({ locale, pwa = true, children }: { locale: string; pwa?: boolean; children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <I18nProvider locale={locale}>
        {children}
        <ThemedToaster locale={locale} />
        {pwa ? <PwaRegister /> : null}
      </I18nProvider>
    </ThemeProvider>
  )
}
