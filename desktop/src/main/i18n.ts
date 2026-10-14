// Main-process strings beyond English and Arabic. en/ar live in the string modules
// (menu-strings.ts, tray.ts, …), typed; every other language is a JSON catalog in ./locales
// with the same sections (machine-assisted, see lang/glossary.md), written by
// scripts/i18n/merge.mjs. A missing string falls back to English.
import type { LocaleId } from "../shared/ipc";

import es from "./locales/es.json";
import fr from "./locales/fr.json";
import de from "./locales/de.json";
import pt_BR from "./locales/pt-BR.json";
import it from "./locales/it.json";
import ru from "./locales/ru.json";
import tr from "./locales/tr.json";
import zh_Hans from "./locales/zh-Hans.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import hi from "./locales/hi.json";
import id from "./locales/id.json";
import nl from "./locales/nl.json";
import pl from "./locales/pl.json";
import vi from "./locales/vi.json";
import uk from "./locales/uk.json";

type Catalog = Record<string, Record<string, string> | string>;

const CATALOGS: Partial<Record<LocaleId, Catalog>> = {
  es: es as Catalog,
  fr: fr as Catalog,
  de: de as Catalog,
  "pt-BR": pt_BR as Catalog,
  it: it as Catalog,
  ru: ru as Catalog,
  tr: tr as Catalog,
  "zh-Hans": zh_Hans as Catalog,
  ja: ja as Catalog,
  ko: ko as Catalog,
  hi: hi as Catalog,
  id: id as Catalog,
  nl: nl as Catalog,
  pl: pl as Catalog,
  vi: vi as Catalog,
  uk: uk as Catalog,
};

const SHIPPED: readonly LocaleId[] = ["en", "ar", "es", "fr", "de", "pt-BR", "it", "ru", "tr", "zh-Hans", "ja", "ko", "hi", "id", "nl", "pl", "vi", "uk"];

/** First shipped locale for the OS preference list (mirrors matchLocale in web/lib/intl/locales.ts). */
export function matchSystemLocale(tags: readonly string[]): LocaleId | null {
  for (const tag of tags) {
    const t = tag.replace(/_/g, "-").toLowerCase();
    const exact = SHIPPED.find((l) => l.toLowerCase() === t);
    if (exact) return exact;
    const lang = t.split("-")[0];
    const mapped = lang === "zh" ? "zh-Hans" : lang === "pt" ? "pt-BR" : lang === "in" ? "id" : SHIPPED.find((l) => l === lang);
    if (mapped) return mapped as LocaleId;
  }
  return null;
}

/** Right-to-left languages, by primary subtag (mirrors RTL_LANGUAGES in web/lib/intl/locales.ts). */
const RTL = new Set(["ar", "fa", "ur", "he", "ps", "sd", "ug", "yi", "dv", "ckb"]);

export function isRtlLocale(locale: string): boolean {
  return RTL.has(locale.toLowerCase().split(/[-_]/)[0]);
}

/** A section's strings in `locale`: the typed en/ar objects, or the JSON catalog over English. */
export function localized<K extends string>(locale: LocaleId, section: string, en: Record<K, string>, ar: Record<K, string>): Record<K, string> {
  if (locale === "en") return en;
  if (locale === "ar") return ar;
  const sec = CATALOGS[locale]?.[section];
  return sec && typeof sec === "object" ? { ...en, ...(sec as Partial<Record<K, string>>) } : en;
}
