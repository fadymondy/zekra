// Unit tests for the main process's OS-language match (src/main/i18n.ts) and its
// locale list, which must mirror LOCALES in web/lib/intl/locales.ts. Run against
// the tsc output: `npm test` builds main first.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const i18n = require(path.join(__dirname, "..", "out", "main/i18n.js"));

test("matchSystemLocale picks the first shipped OS language", () => {
  assert.equal(i18n.matchSystemLocale(["de-DE", "en-US"]), "de");
  assert.equal(i18n.matchSystemLocale(["sw-KE", "fr-CA"]), "fr");
  assert.equal(i18n.matchSystemLocale(["pt-PT"]), "pt-BR");
  assert.equal(i18n.matchSystemLocale(["zh-Hans-CN"]), "zh-Hans");
  assert.equal(i18n.matchSystemLocale(["zh_CN"]), "zh-Hans");
  assert.equal(i18n.matchSystemLocale(["ar-EG"]), "ar");
  assert.equal(i18n.matchSystemLocale(["sw", "fa"]), null);
  assert.equal(i18n.matchSystemLocale([]), null);
});

test("RTL follows the language subtag", () => {
  assert.equal(i18n.isRtlLocale("ar"), true);
  assert.equal(i18n.isRtlLocale("ar-SA"), true);
  for (const l of ["en", "de", "ru", "zh-Hans", "ja", "hi", "uk"]) assert.equal(i18n.isRtlLocale(l), false, l);
});

test("the desktop locale lists mirror web/lib/intl/locales.ts", () => {
  const web = fs.readFileSync(path.join(__dirname, "..", "..", "web/lib/intl/locales.ts"), "utf8");
  const block = web.match(/export const LOCALES = \[([\s\S]*?)\] as const/)[1];
  const want = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const ipc = fs.readFileSync(path.join(__dirname, "..", "src/shared/ipc.ts"), "utf8");
  const type = [...ipc.match(/export type LocaleId = ([^;]+);/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(type, want);
  for (const l of want) assert.equal(i18n.matchSystemLocale([l]), l);
});
