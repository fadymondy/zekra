"use client"

// Frontend i18n, as in Managy: flat key dictionaries per locale. Each product area owns a pair of
// files, lang/<area>.en.json and lang/<area>.ar.json, with keys prefixed by the area
// ("brains.title"). A missing Arabic key falls back to English, and English to the key itself.
import { createContext, useContext, useMemo, type ReactNode } from "react"
import { dirForLocale, intlTag, isLocale, type Locale } from "@/lib/i18n-locale"
import { AR, EN } from "@/lang"

export { LOCALES, dirForLocale, isLocale } from "@/lib/i18n-locale"
export type { Locale } from "@/lib/i18n-locale"

type Dict = Record<string, string>
const DICTIONARIES: Record<Locale, Dict> = { en: EN, ar: AR }

/** Non-reactive lookup — for use outside React. */
export function trans(key: string, locale: string = "en", vars?: Record<string, string | number>): string {
  const dict = DICTIONARIES[isLocale(locale) ? locale : "en"]
  let str = dict[key] ?? DICTIONARIES.en[key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, String(v))
  return str
}

const I18nContext = createContext<Locale | null>(null)

export function I18nProvider({ locale: raw, children }: { locale: string; children: ReactNode }) {
  const locale = isLocale(raw) ? raw : "en"
  return <I18nContext.Provider value={locale}>{children}</I18nContext.Provider>
}

export function useTranslations() {
  const locale = useContext(I18nContext)
  if (!locale) throw new Error("useTranslations must be used inside <I18nProvider>")

  const t = useMemo(
    () => (key: string, vars?: Record<string, string | number>) => trans(key, locale, vars),
    [locale],
  )
  const tag = intlTag(locale)

  const formatDate = useMemo(
    () => (value: string | number | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) => {
      if (value == null || value === "") return "—"
      const d = new Date(value)
      if (Number.isNaN(d.getTime())) return "—"
      return new Intl.DateTimeFormat(tag, opts).format(d)
    },
    [tag],
  )
  // Data (counts, latency, ids) keeps Latin digits in both languages.
  const formatNumber = useMemo(
    () => (n: number, opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat(`${tag}-u-nu-latn`, opts).format(n),
    [tag],
  )
  const timeAgo = useMemo(() => {
    const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" })
    return (value: string | number | Date | null | undefined) => {
      if (value == null || value === "") return "—"
      const s = (new Date(value).getTime() - Date.now()) / 1000
      if (Number.isNaN(s)) return "—"
      const abs = Math.abs(s)
      if (abs < 60) return rtf.format(Math.round(s), "second")
      if (abs < 3600) return rtf.format(Math.round(s / 60), "minute")
      if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour")
      if (abs < 2592000) return rtf.format(Math.round(s / 86400), "day")
      if (abs < 31536000) return rtf.format(Math.round(s / 2592000), "month")
      return rtf.format(Math.round(s / 31536000), "year")
    }
  }, [tag])

  const dir = dirForLocale(locale)
  return { t, locale, dir, isRtl: dir === "rtl", formatDate, formatNumber, timeAgo }
}
