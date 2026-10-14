import { getLocales } from "expo-localization";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { I18nManager, Platform } from "react-native";

import { formatMessage } from "@shared/intl/icu";
import { LOCALES, LOCALE_INFO, isLocale, isRtlLocale, matchLocale, type Locale } from "@shared/intl/locales";

import { setAgoFormatter } from "@/features/brains/brains-core";
import { FEATURE_DICTS, type FeatureKey } from "@/i18n/features";
import base from "@/i18n/features/base";
import { LOCALE_DICTS } from "@/i18n/locales";
import type { DictKey } from "@/i18n/define";
import { getStored, setStored } from "@/lib/storage";
import { setUiFontLocale } from "@/theme";

// Zekra ships in 18 languages, the same list as web and desktop (web/lib/intl/locales.ts).
// English and Arabic are hand-written TS dictionaries (src/i18n/features/*); the rest are JSON
// catalogs in src/i18n/locales/. The Arabic product name is ذكرى.
export type { Locale };

/** Every language the app ships, in switcher order. Each language names itself; `english` is
 *  the subtitle. Direction follows the language (isRtlLocale), never a per-locale flag. */
export const LANGUAGES: readonly { code: Locale; name: string; english: string; rtl: boolean; script: string }[] = LOCALES.map((code) => ({
  code,
  name: LOCALE_INFO[code].name,
  english: LOCALE_INFO[code].english,
  rtl: isRtlLocale(code),
  script: LOCALE_INFO[code].script,
}));

export function languageName(code: Locale): string {
  return LOCALE_INFO[code]?.name ?? code;
}

type Dict = Record<string, string>;

// Feature dictionaries (src/i18n/features/*) merge over the base one.
const EN: Dict = Object.assign({}, base.en, ...FEATURE_DICTS.map((d) => d.en));
const AR: Dict = Object.assign({}, base.ar, ...FEATURE_DICTS.map((d) => d.ar));
const loaded: Partial<Record<Locale, Dict>> = { en: EN, ar: AR };

function dict(locale: Locale): Dict {
  let d = loaded[locale];
  if (!d) {
    try {
      d = LOCALE_DICTS[locale]?.() ?? {};
    } catch {
      d = {};
    }
    loaded[locale] = d;
  }
  return d;
}

export type TKey = DictKey<typeof base> | FeatureKey;
export type TVars = Record<string, string | number>;

/** Look up a string (falling back to English) and fill its `{name}` / ICU plural arguments. */
export function translate(locale: Locale, key: TKey, vars?: TVars): string {
  const raw = dict(locale)[key] ?? EN[key] ?? key;
  return formatMessage(raw, vars, LOCALE_INFO[locale]?.intl ?? "en");
}

// Relative time in brains-core (cards, widgets, the notification center) for the languages
// it doesn't format by hand.
setAgoFormatter((locale, unit, n) => {
  if (!isLocale(locale)) return null;
  const key = `brains.ago.${unit}` as TKey;
  return dict(locale)[key] ? translate(locale, key, { n }) : null;
});

/** Arabic and Devanagari need taller lines than Latin or CJK at the same size. */
export function tallScript(locale: string): boolean {
  const script = LOCALE_INFO[locale as Locale]?.script;
  return script === "arabic" || script === "devanagari";
}

/** The device's preferred language when it is one we ship, else English. */
export function deviceLocale(): Locale {
  try {
    return matchLocale(getLocales().map((l) => l.languageTag)) ?? "en";
  } catch {
    return "en";
  }
}

/** Native layout direction. The root view also sets `direction`, so the UI
 *  flips at once; this keeps I18nManager (swipe gestures, stack slide
 *  direction, native alerts) in step from the next launch on. */
function applyNativeDirection(locale: Locale) {
  if (Platform.OS === "web") return;
  const rtl = isRtlLocale(locale);
  I18nManager.allowRTL(rtl);
  if (I18nManager.isRTL !== rtl) I18nManager.forceRTL(rtl);
}
const STORE_KEY = "zekra.locale";

type I18nValue = {
  locale: Locale;
  isRtl: boolean;
  t: (key: TKey, vars?: TVars) => string;
  setLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18nValue>({
  locale: "en",
  isRtl: false,
  t: (key, vars) => translate("en", key, vars),
  setLocale: () => {},
});

export function I18nProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<Locale>(() => deviceLocale());

  useEffect(() => {
    void (async () => {
      try {
        // A language picked in Settings wins; otherwise follow the device.
        const saved = await getStored(STORE_KEY);
        const next = isLocale(saved) ? saved : deviceLocale();
        setLocaleState(next);
        applyNativeDirection(next);
      } catch {}
    })();
  }, []);

  // Web: mirror the document. Native: Yoga handles it from Screen's direction.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const doc = (globalThis as { document?: Document }).document;
    if (!doc?.documentElement) return;
    doc.documentElement.dir = isRtlLocale(locale) ? "rtl" : "ltr";
    doc.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    applyNativeDirection(next);
    void setStored(STORE_KEY, next);
  }, []);

  // The UI face follows the language (Inter, IBM Plex Sans Arabic, or the system face for
  // CJK and Devanagari); set before children render.
  setUiFontLocale(locale);

  const value = useMemo<I18nValue>(() => ({
    locale,
    isRtl: isRtlLocale(locale),
    t: (key: TKey, vars?: TVars) => translate(locale, key, vars),
    setLocale,
  }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
