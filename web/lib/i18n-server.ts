import { headers } from "next/headers"

import { AR, EN, LOADERS } from "@/lang"
import { dirForLocale, intlTag, isLocale, type Locale } from "@/lib/i18n-locale"
import { formatMessage } from "@/lib/intl/icu"

/*
Server-side counterpart to useTranslations() (lib/i18n.tsx is a client module, so Server
Components and route handlers can't call its trans()). Same dictionaries, same ICU messages,
same fallback: the language → English → the key itself.
*/
type Dict = Record<string, string>
const loaded: Partial<Record<Locale, Dict>> = { en: EN, ar: AR }

/** The full dictionary for `locale`, loaded once per server process. */
export async function loadMessages(locale: string): Promise<Dict> {
  const l: Locale = isLocale(locale) ? locale : "en"
  const have = loaded[l]
  if (have) return have
  let dict: Dict = {}
  try {
    dict = (await LOADERS[l]?.()) ?? {}
  } catch {
    // A missing catalog reads as English rather than failing the page.
  }
  loaded[l] = dict
  return dict
}

/** Sync lookup; await loadMessages(locale) first for languages other than English and Arabic. */
export function translate(key: string, locale: string, vars?: Record<string, string | number>): string {
  const l: Locale = isLocale(locale) ? locale : "en"
  const str = loaded[l]?.[key] ?? EN[key] ?? key
  return formatMessage(str, vars, intlTag(l))
}

/** Pass the `locale` route param when you have it; falls back to the x-locale header proxy.ts sets. */
export async function getI18n(locale?: string) {
  const header = (await headers()).get("x-locale") ?? undefined
  const resolved: Locale = isLocale(locale) ? locale : isLocale(header) ? header : "en"
  await loadMessages(resolved)
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
