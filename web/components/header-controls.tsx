"use client"

import { Button, LocaleSwitcher, useNasaq } from "@fadymondy/nasaq/web"
import { MoonIcon, SunIcon } from "lucide-react"

import { useTranslations } from "@/lib/i18n"

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useNasaq()
  const { t } = useTranslations()
  const dark = resolvedTheme === "dark"
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t("header.toggleTheme")}
      title={t("header.toggleTheme")}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  )
}

/** Nasaq's language menu; Providers turns the choice into a navigation to the other locale's URL. */
export function LanguageSwitcher() {
  const { t } = useTranslations()
  return <LocaleSwitcher label={t("header.language")} />
}
