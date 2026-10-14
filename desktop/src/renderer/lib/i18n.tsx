import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { FEATURE_DICTS, type FeatureKey } from "@mobile/i18n/features";
import type { DictKey } from "@mobile/i18n/define";
import { formatMessage } from "@/lib/intl/icu";
import { LOCALE_INFO, dirForLocale } from "@/lib/intl/locales";

import base from "../i18n/base";
import { LOCALE_DICTS } from "../i18n/locales";

// Desktop feature dictionaries (src/renderer/i18n/*.ts, MH-450). MERGE POINT:
// import yours here, add it to DESKTOP_FEATURE_DICTS and to DesktopFeatureKey.
import presentationsVaultLock from "../i18n/presentations-vault-lock";
import account from "../i18n/account"; // search, notifications, settings, sign-in
import notesWs from "../i18n/notes"; // brains home, notes workspace, spotlight
import mid from "../i18n/mid"; // importers, opened documents, markdown extras, updates
import shell from "../i18n/shell"; // macOS shell: sidebar, toolbar, notes list
import updates from "../i18n/updates"; // Software Update: loader, ready card, sheet, About
import windows from "../i18n/windows"; // app windows: Settings, Spotlight, New Note/Brain

const DESKTOP_FEATURE_DICTS = [presentationsVaultLock, account, notesWs, mid, shell, updates, windows];
type DesktopFeatureKey =
  | DictKey<typeof presentationsVaultLock>
  | DictKey<typeof account>
  | DictKey<typeof notesWs>
  | DictKey<typeof mid>
  | DictKey<typeof shell>
  | DictKey<typeof updates>
  | DictKey<typeof windows>;

import type { LocaleId } from "./bridge";

/** The translate function, for helpers that build strings outside React. */
export type TFn = (key: TKey, vars?: TVars) => string;

/*
18 languages, the same list as the web console and the mobile app
(web/lib/intl/locales.ts). The Arabic product name is ذكرى.

Two sources, one `t()`:
  1. The mobile app's FEATURE dictionaries (mobile/src/i18n/features/*.ts,
     imported via the @mobile alias). They are pure TS, EN/AR at key parity
     (enforced by defineDict), and cover brains, notes, editor, presentations,
     vault, notifications, settings, auth/app-lock… Feature teams should REUSE
     those keys rather than invent desktop copies, so the two apps say the same
     thing.
  2. The desktop's own dictionary below: shell chrome and anything
     desktop-specific. It is merged OVER the mobile ones, so an existing desktop
     key keeps its desktop wording even if mobile defines the same key.

English and Arabic are the TS dictionaries; the other languages are JSON catalogs
(src/renderer/i18n/locales, mobile/src/i18n/locales) with the same keys. A missing
string falls back to English.

Placeholders use mobile's syntax: t("nav.scopeIn", { brain: "flowos" }) with
"In {brain}", plus ICU plurals: "{n, plural, one {# note} other {# notes}}".
*/

/** Keys the desktop itself owns. */
export type DesktopKey = DictKey<typeof base>;
/** Every key `t()` accepts: desktop + the shared mobile feature dictionaries. */
export type TKey = DesktopKey | FeatureKey | DesktopFeatureKey;


// Mobile features first, desktop over them (see the header comment).
const DICTS: Partial<Record<LocaleId, Record<string, string>>> = {
  ...LOCALE_DICTS,
  en: Object.assign(
    {},
    ...FEATURE_DICTS.map((d) => d.en as Record<string, string>),
    ...DESKTOP_FEATURE_DICTS.map((d) => d.en as Record<string, string>),
    base.en,
  ),
  ar: Object.assign(
    {},
    ...FEATURE_DICTS.map((d) => d.ar as Record<string, string>),
    ...DESKTOP_FEATURE_DICTS.map((d) => d.ar as Record<string, string>),
    base.ar,
  ),
};

export type TVars = Record<string, string | number>;

const EN = DICTS.en as Record<string, string>;

function translate(locale: LocaleId, key: TKey, vars?: TVars): string {
  const raw = DICTS[locale]?.[key] ?? EN[key] ?? key;
  return formatMessage(raw, vars, LOCALE_INFO[locale]?.intl ?? "en");
}

type I18nValue = {
  locale: LocaleId;
  isRtl: boolean;
  dir: "ltr" | "rtl";
  t: (key: TKey, vars?: TVars) => string;
  setLocale: (locale: LocaleId) => void;
};

const I18nContext = createContext<I18nValue>({
  locale: "en",
  isRtl: false,
  dir: "ltr",
  t: (k, vars) => translate("en", k, vars),
  setLocale: () => {},
});

export function I18nProvider({ initial, onChange, children }: {
  initial: LocaleId;
  onChange?: (locale: LocaleId) => void;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<LocaleId>(initial);
  // Follow a locale change made elsewhere (settings reloaded, another window).
  useEffect(() => setLocaleState(initial), [initial]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dirForLocale(locale);
  }, [locale]);

  const setLocale = useCallback((next: LocaleId) => {
    setLocaleState(next);
    onChange?.(next);
  }, [onChange]);

  const value = useMemo<I18nValue>(() => ({
    locale,
    isRtl: dirForLocale(locale) === "rtl",
    dir: dirForLocale(locale),
    t: (key: TKey, vars?: TVars) => translate(locale, key, vars),
    setLocale,
  }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
