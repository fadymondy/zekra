import { headers } from "next/headers"

import { AR, EN } from "@/lang"
import { dirForLocale, isLocale, type Locale } from "@/lib/i18n-locale"

/*
Server-side counterpart to useTranslations() (lib/i18n.tsx is a client module, so Server
Components and route handlers can't call its trans()). Same dictionaries, same fallback:
Arabic → English → the key itself.
*/
export function translate(key: string, locale: string, vars?: Record<string, string | number>): string {
  const dict = locale === "ar" ? AR : EN
  let str = dict[key] ?? EN[key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, String(v))
  return str
}

/** Pass the `locale` route param when you have it; falls back to the x-locale header proxy.ts sets. */
export async function getI18n(locale?: string) {
  const header = (await headers()).get("x-locale") ?? undefined
  const resolved: Locale = isLocale(locale) ? locale : isLocale(header) ? header : "en"
  const dir = dirForLocale(resolved)
  return {
    locale: resolved,
    dir,
    isRtl: dir === "rtl",
    t: (key: string, vars?: Record<string, string | number>) => translate(key, resolved, vars),
  }
}

export type I18n = Awaited<ReturnType<typeof getI18n>>
export type T = I18n["t"]
