// Pure helpers with no React/client dependency, so both Server Components
// (app/layout.tsx, proxy.ts) and client code (lib/i18n.tsx) can import them.
// The language list itself lives in lib/intl/locales.ts, shared with desktop and mobile.

import { LOCALES, LOCALE_INFO, dirForLocale, type Locale } from "@/lib/intl/locales"

export {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_INFO,
  dirForLocale,
  intlTag,
  isLocale,
  isRtlLocale,
  localeFromAcceptLanguage,
  matchLocale,
} from "@/lib/intl/locales"
export type { Locale } from "@/lib/intl/locales"

export const LOCALE_COOKIE = "NEXT_LOCALE"

/** Native name, for the language switcher. A language names itself. */
export const LOCALE_NAMES = Object.fromEntries(LOCALES.map((l) => [l, LOCALE_INFO[l].name])) as Record<Locale, string>

/** The language menu's options (Nasaq LocaleSwitcher / UserMenu), in switcher order. */
export function localeOptions(only: readonly string[] = LOCALES) {
  return LOCALES.filter((l) => only.includes(l)).map((l) => ({ value: l, label: LOCALE_INFO[l].name, dir: dirForLocale(l) }))
}
