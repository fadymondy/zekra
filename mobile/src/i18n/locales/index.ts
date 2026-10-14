// Catalogs for every language beyond en/ar (machine-assisted, awaiting native review — see
// lang/glossary.md). Written by scripts/i18n/merge.mjs; a missing key falls back to English.
// require() inside a function, so Metro only evaluates the language actually in use.
/* eslint-disable @typescript-eslint/no-require-imports */
export const LOCALE_DICTS: Record<string, () => Record<string, string>> = {
  es: () => require("./es.json"),
  fr: () => require("./fr.json"),
  de: () => require("./de.json"),
  "pt-BR": () => require("./pt-BR.json"),
  it: () => require("./it.json"),
  ru: () => require("./ru.json"),
  tr: () => require("./tr.json"),
  "zh-Hans": () => require("./zh-Hans.json"),
  ja: () => require("./ja.json"),
  ko: () => require("./ko.json"),
  hi: () => require("./hi.json"),
  id: () => require("./id.json"),
  nl: () => require("./nl.json"),
  pl: () => require("./pl.json"),
  vi: () => require("./vi.json"),
  uk: () => require("./uk.json"),
};
