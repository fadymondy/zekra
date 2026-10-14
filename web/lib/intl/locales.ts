// The languages Zekra ships, shared by every client: web (this app), desktop (alias @ -> web)
// and mobile (alias @shared -> web/lib). Pure TypeScript — no React, no Next, no RN — so the
// node:test suites and the i18n check scripts can import it as-is.
//
// Adding a language: one entry in LOCALES + LOCALE_INFO, then its catalogs (see docs/i18n.md).
// Direction is NOT listed per locale: it follows the language subtag (RTL_LANGUAGES), so fa, ur
// or he become RTL the day they are added.

export const LOCALES = [
  "en",
  "ar",
  "es",
  "fr",
  "de",
  "pt-BR",
  "it",
  "ru",
  "tr",
  "zh-Hans",
  "ja",
  "ko",
  "hi",
  "id",
  "nl",
  "pl",
  "vi",
  "uk",
] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = "en"

export type LocaleInfo = {
  /** The language's own name (endonym) — what the picker shows. */
  name: string
  /** English name, the picker's secondary line. */
  english: string
  /** BCP-47 tag for Intl (dates, numbers, relative time, plural rules). */
  intl: string
  /** Script family, for font stacks: CJK and Devanagari need their own faces. */
  script: "latin" | "arabic" | "cyrillic" | "han" | "japanese" | "hangul" | "devanagari"
}

export const LOCALE_INFO: Record<Locale, LocaleInfo> = {
  en: { name: "English", english: "English", intl: "en-US", script: "latin" },
  ar: { name: "العربية", english: "Arabic", intl: "ar-EG", script: "arabic" },
  es: { name: "Español", english: "Spanish", intl: "es-ES", script: "latin" },
  fr: { name: "Français", english: "French", intl: "fr-FR", script: "latin" },
  de: { name: "Deutsch", english: "German", intl: "de-DE", script: "latin" },
  "pt-BR": { name: "Português (Brasil)", english: "Portuguese (Brazil)", intl: "pt-BR", script: "latin" },
  it: { name: "Italiano", english: "Italian", intl: "it-IT", script: "latin" },
  ru: { name: "Русский", english: "Russian", intl: "ru-RU", script: "cyrillic" },
  tr: { name: "Türkçe", english: "Turkish", intl: "tr-TR", script: "latin" },
  "zh-Hans": { name: "简体中文", english: "Chinese (Simplified)", intl: "zh-Hans-CN", script: "han" },
  ja: { name: "日本語", english: "Japanese", intl: "ja-JP", script: "japanese" },
  ko: { name: "한국어", english: "Korean", intl: "ko-KR", script: "hangul" },
  hi: { name: "हिन्दी", english: "Hindi", intl: "hi-IN", script: "devanagari" },
  id: { name: "Bahasa Indonesia", english: "Indonesian", intl: "id-ID", script: "latin" },
  nl: { name: "Nederlands", english: "Dutch", intl: "nl-NL", script: "latin" },
  pl: { name: "Polski", english: "Polish", intl: "pl-PL", script: "latin" },
  vi: { name: "Tiếng Việt", english: "Vietnamese", intl: "vi-VN", script: "latin" },
  uk: { name: "Українська", english: "Ukrainian", intl: "uk-UA", script: "cyrillic" },
}

/** Right-to-left languages, by primary language subtag. Only `ar` ships today; the rest are
 *  here so adding Persian, Urdu or Hebrew needs no direction code. */
export const RTL_LANGUAGES: ReadonlySet<string> = new Set(["ar", "fa", "ur", "he", "ps", "sd", "ug", "yi", "dv", "ckb"])

function primary(tag: string): string {
  return tag.trim().toLowerCase().split(/[-_]/)[0] ?? ""
}

export function dirForLocale(locale: string): "ltr" | "rtl" {
  return RTL_LANGUAGES.has(primary(locale)) ? "rtl" : "ltr"
}

export function isRtlLocale(locale: string): boolean {
  return dirForLocale(locale) === "rtl"
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value)
}

/** The exact supported locale for `value`, ignoring case and `_` vs `-` ("PT_br" -> "pt-BR"). */
export function canonicalLocale(value: string | null | undefined): Locale | null {
  if (!value) return null
  const want = value.trim().replace(/_/g, "-").toLowerCase()
  return LOCALES.find((l) => l.toLowerCase() === want) ?? null
}

/** Intl tag for formatting; unknown input formats as English. */
export function intlTag(locale: string): string {
  const l = canonicalLocale(locale)
  return l ? LOCALE_INFO[l].intl : "en-US"
}

/** Endonym for the picker ("Deutsch"). */
export function localeName(locale: string): string {
  const l = canonicalLocale(locale)
  return l ? LOCALE_INFO[l].name : locale
}

/**
 * Best supported locale for one requested BCP-47 tag (browser, OS, Accept-Language entry):
 *   exact match ("pt-BR", "zh-Hans") → script/region rules → primary language.
 * Chinese: zh, zh-CN, zh-SG, zh-Hans-* map to zh-Hans; Traditional (zh-TW, zh-HK, zh-Hant)
 * also lands on zh-Hans — readable, and better than English — until zh-Hant ships.
 * Portuguese: any pt-* (incl. pt-PT) maps to pt-BR, the only Portuguese we ship.
 */
export function matchOne(tag: string): Locale | null {
  const exact = canonicalLocale(tag)
  if (exact) return exact
  const lang = primary(tag)
  if (lang === "zh") return "zh-Hans"
  if (lang === "pt") return "pt-BR"
  if (lang === "iw") return null // legacy Hebrew code: not shipped
  if (lang === "in") return "id" // legacy Indonesian code (old Android)
  return canonicalLocale(lang)
}

/** First supported locale for a preference list (most preferred first). */
export function matchLocale(tags: readonly (string | null | undefined)[]): Locale | null {
  for (const t of tags) {
    if (!t) continue
    const m = matchOne(t)
    if (m) return m
  }
  return null
}

/** Parses an Accept-Language header into tags, highest q first (stable for equal q). */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return []
  return header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";")
      const qp = params.map((p) => p.trim()).find((p) => p.startsWith("q="))
      const q = qp ? Number(qp.slice(2)) : 1
      return { tag: (tag ?? "").trim(), q: Number.isFinite(q) ? q : 0, i }
    })
    .filter((x) => x.tag && x.tag !== "*" && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((x) => x.tag)
}

/** Picks the best supported locale from an Accept-Language header. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  return matchLocale(parseAcceptLanguage(header))
}
