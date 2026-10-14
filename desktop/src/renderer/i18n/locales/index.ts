// Catalogs for every language beyond en/ar (machine-assisted; see lang/glossary.md), loaded
// eagerly: the desktop bundle is local, and t() stays synchronous. Each language is the mobile
// feature catalog (shared keys) under the desktop's own one. Written by scripts/i18n/merge.mjs;
// a missing key falls back to English.
import d_es from "./es.json";
import m_es from "@mobile/i18n/locales/es.json";
import d_fr from "./fr.json";
import m_fr from "@mobile/i18n/locales/fr.json";
import d_de from "./de.json";
import m_de from "@mobile/i18n/locales/de.json";
import d_pt_BR from "./pt-BR.json";
import m_pt_BR from "@mobile/i18n/locales/pt-BR.json";
import d_it from "./it.json";
import m_it from "@mobile/i18n/locales/it.json";
import d_ru from "./ru.json";
import m_ru from "@mobile/i18n/locales/ru.json";
import d_tr from "./tr.json";
import m_tr from "@mobile/i18n/locales/tr.json";
import d_zh_Hans from "./zh-Hans.json";
import m_zh_Hans from "@mobile/i18n/locales/zh-Hans.json";
import d_ja from "./ja.json";
import m_ja from "@mobile/i18n/locales/ja.json";
import d_ko from "./ko.json";
import m_ko from "@mobile/i18n/locales/ko.json";
import d_hi from "./hi.json";
import m_hi from "@mobile/i18n/locales/hi.json";
import d_id from "./id.json";
import m_id from "@mobile/i18n/locales/id.json";
import d_nl from "./nl.json";
import m_nl from "@mobile/i18n/locales/nl.json";
import d_pl from "./pl.json";
import m_pl from "@mobile/i18n/locales/pl.json";
import d_vi from "./vi.json";
import m_vi from "@mobile/i18n/locales/vi.json";
import d_uk from "./uk.json";
import m_uk from "@mobile/i18n/locales/uk.json";

type Dict = Record<string, string>;

/** Mobile strings first, desktop over them (the same order as en/ar in lib/i18n.tsx). */
export const LOCALE_DICTS: Record<string, Dict> = {
  "es": { ...(m_es as Dict), ...(d_es as Dict) },
  "fr": { ...(m_fr as Dict), ...(d_fr as Dict) },
  "de": { ...(m_de as Dict), ...(d_de as Dict) },
  "pt-BR": { ...(m_pt_BR as Dict), ...(d_pt_BR as Dict) },
  "it": { ...(m_it as Dict), ...(d_it as Dict) },
  "ru": { ...(m_ru as Dict), ...(d_ru as Dict) },
  "tr": { ...(m_tr as Dict), ...(d_tr as Dict) },
  "zh-Hans": { ...(m_zh_Hans as Dict), ...(d_zh_Hans as Dict) },
  "ja": { ...(m_ja as Dict), ...(d_ja as Dict) },
  "ko": { ...(m_ko as Dict), ...(d_ko as Dict) },
  "hi": { ...(m_hi as Dict), ...(d_hi as Dict) },
  "id": { ...(m_id as Dict), ...(d_id as Dict) },
  "nl": { ...(m_nl as Dict), ...(d_nl as Dict) },
  "pl": { ...(m_pl as Dict), ...(d_pl as Dict) },
  "vi": { ...(m_vi as Dict), ...(d_vi as Dict) },
  "uk": { ...(m_uk as Dict), ...(d_uk as Dict) },
};
