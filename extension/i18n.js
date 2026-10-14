// UI language: Chrome's own i18n (_locales/<lang>/messages.json), which follows the
// browser's language and falls back to English (manifest default_locale) per message.
// HTML keeps the English text inline; localizePage() swaps in the translation and sets
// lang/dir from the catalog in use, so Arabic renders right-to-left. Works in pages and the
// service worker.

/** The message for key in the browser's language, with $1…$9 filled from subs. */
export function t(key, ...subs) {
  try {
    const msg = chrome.i18n?.getMessage(key, subs.map(String));
    if (msg) return msg;
  } catch {
    // no i18n API (plain-browser preview)
  }
  return subs.reduce((s, v, i) => s.replaceAll(`$${i + 1}`, String(v)), key);
}

/** The browser UI language as a BCP-47 tag (Chrome reports "pt_BR"). */
export function uiLocale() {
  try {
    const l = chrome.i18n?.getUILanguage?.() || chrome.i18n?.getMessage("@@ui_locale");
    if (l) return l.replace("_", "-");
  } catch {
    // ignore
  }
  return navigator.language || "en";
}

export function formatDateTime(value) {
  try {
    return new Date(value).toLocaleString(uiLocale(), { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return new Date(value).toLocaleString();
  }
}

/** Applies data-i18n (text), data-i18n-placeholder and data-i18n-title, then lang and dir. */
export function localizePage(root = document) {
  const apply = (attr, set) => {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const msg = chrome.i18n?.getMessage(el.getAttribute(attr));
      if (msg) set(el, msg);
    }
  };
  try {
    apply("data-i18n", (el, msg) => (el.textContent = msg));
    apply("data-i18n-placeholder", (el, msg) => (el.placeholder = msg));
    apply("data-i18n-title", (el, msg) => (el.title = msg));
    // The language the messages actually came from, so the page never claims Arabic while
    // showing English (Chrome's @@bidi_dir follows the browser, not the catalog used).
    const lang = chrome.i18n?.getMessage("langTag");
    if (lang) document.documentElement.lang = lang;
    const dir = chrome.i18n?.getMessage("langDir");
    if (dir) document.documentElement.dir = dir;
  } catch {
    // preview without chrome.i18n: the English in the HTML stays
  }
}
