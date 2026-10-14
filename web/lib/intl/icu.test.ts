import assert from "node:assert/strict"
import { test } from "node:test"

import { cldrCardinal, formatMessage, messageArgs, validateTranslation } from "./icu.ts"
import { LOCALES, LOCALE_INFO, dirForLocale, localeFromAcceptLanguage, matchLocale, parseAcceptLanguage } from "./locales.ts"

test("plain arguments, missing ones stay visible", () => {
  assert.equal(formatMessage("Hello {name}", { name: "Fady" }), "Hello Fady")
  assert.equal(formatMessage("Hello {name}"), "Hello {name}")
  assert.equal(formatMessage("Delete '{name}'? Don't worry.", { name: "x" }), "Delete 'x'? Don't worry.")
})

test("plural uses CLDR rules per locale", () => {
  const msg = "{count, plural, =0 {no notes} one {# note} other {# notes}}"
  assert.equal(formatMessage(msg, { count: 0 }, "en"), "no notes")
  assert.equal(formatMessage(msg, { count: 1 }, "en"), "1 note")
  assert.equal(formatMessage(msg, { count: 1200 }, "en"), "1,200 notes")
  const ru = "{n, plural, one {# заметка} few {# заметки} many {# заметок} other {# заметки}}"
  assert.equal(formatMessage(ru, { n: 1 }, "ru"), "1 заметка")
  assert.equal(formatMessage(ru, { n: 3 }, "ru"), "3 заметки")
  assert.equal(formatMessage(ru, { n: 5 }, "ru"), "5 заметок")
  const ar = "{n, plural, zero {لا ملاحظات} one {ملاحظة واحدة} two {ملاحظتان} few {# ملاحظات} many {# ملاحظة} other {# ملاحظة}}"
  assert.equal(formatMessage(ar, { n: 2 }, "ar"), "ملاحظتان")
  assert.equal(formatMessage(ar, { n: 3 }, "ar"), "3 ملاحظات")
  assert.equal(formatMessage(ar, { n: 11 }, "ar"), "11 ملاحظة")
})

test("select and nesting", () => {
  const msg = "{kind, select, note {{count, plural, one {# note} other {# notes}}} other {# items}}"
  assert.equal(formatMessage(msg, { kind: "note", count: 2 }), "2 notes")
  assert.equal(formatMessage(msg, { kind: "x", count: 2 }), "# items")
})

test("a broken message degrades to simple substitution", () => {
  assert.equal(formatMessage("Hi {name} {", { name: "A" }), "Hi A {")
})

test("validateTranslation catches broken placeholders and ICU", () => {
  assert.deepEqual(validateTranslation("{count} results", "{count, plural, one {# Ergebnis} other {# Ergebnisse}}"), [])
  assert.deepEqual(validateTranslation("Hi {name}", "Hallo {nom}"), ["missing placeholder {name}", "unknown placeholder {nom}"])
  assert.match(validateTranslation("{n, plural, one {#} other {#}}", "{n, plural, one {#}}")[0]!, /other/)
  assert.match(validateTranslation("Hi {name}", "Hallo {name")[0]!, /does not parse/)
  assert.match(validateTranslation("Press <b>Save</b>", "Drücke Speichern")[0]!, /markup/)
  assert.deepEqual([...messageArgs("{a} {b, select, x {{c}} other {}}")].sort(), ["a", "b", "c"])
})

test("locale negotiation", () => {
  assert.deepEqual(parseAcceptLanguage("fr-CA;q=0.8, de;q=0.9, *;q=0.1"), ["de", "fr-CA"])
  assert.equal(localeFromAcceptLanguage("zh-CN,zh;q=0.9,en;q=0.8"), "zh-Hans")
  assert.equal(localeFromAcceptLanguage("pt-PT"), "pt-BR")
  assert.equal(localeFromAcceptLanguage("sw, uk;q=0.5"), "uk")
  assert.equal(localeFromAcceptLanguage("sw"), null)
  assert.equal(matchLocale(["zh-Hans-CN", "en"]), "zh-Hans")
  assert.equal(matchLocale(["in-ID"]), "id")
  assert.equal(matchLocale(["ja_JP"]), "ja")
})

test("direction is generic by language", () => {
  assert.equal(dirForLocale("ar"), "rtl")
  assert.equal(dirForLocale("ar-EG"), "rtl")
  assert.equal(dirForLocale("fa"), "rtl")
  assert.equal(dirForLocale("he-IL"), "rtl")
  assert.equal(dirForLocale("ur"), "rtl")
  assert.equal(dirForLocale("de"), "ltr")
  assert.equal(dirForLocale("zh-Hans"), "ltr")
})

test("the Hermes plural fallback matches Intl.PluralRules for every shipped language", () => {
  for (const l of LOCALES) {
    const tag = LOCALE_INFO[l].intl
    const pr = new Intl.PluralRules(tag)
    for (let n = 0; n <= 230; n++) assert.equal(cldrCardinal(tag, n), pr.select(n), `${l} ${n}`)
  }
})
