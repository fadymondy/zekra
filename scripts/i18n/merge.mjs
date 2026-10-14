// Files translators' output (.i18n-work/out/<locale>/, see export.mjs) into every catalog:
// web, mobile, desktop renderer + main, native (iOS/Android), extension, server, store listings,
// and the glossary's term table. Re-runnable: it overwrites the machine-assisted catalogs only,
// never English or Arabic.
//   node scripts/i18n/merge.mjs            all locales found in .i18n-work/out
//   node scripts/i18n/merge.mjs de fr      just these
import fs from "node:fs"
import path from "node:path"
import { CHROME_LOCALE, MACHINE_ASSISTED, ROOT } from "./catalogs.mjs"

const OUT = path.join(ROOT, ".i18n-work/out")
const NOTE = "Machine-assisted translation (2026-10-14), awaiting native-speaker review. Terms: lang/glossary.md"

/** App Store Connect and Google Play name some languages differently from Zekra. */
export const ASC_LOCALE = {
  es: "es-ES", fr: "fr-FR", de: "de-DE", "pt-BR": "pt-BR", it: "it", ru: "ru", tr: "tr", "zh-Hans": "zh-Hans",
  ja: "ja", ko: "ko", hi: "hi", id: "id", nl: "nl-NL", pl: "pl", vi: "vi", uk: "uk",
}
export const PLAY_LOCALE = {
  es: "es-ES", fr: "fr-FR", de: "de-DE", "pt-BR": "pt-BR", it: "it-IT", ru: "ru-RU", tr: "tr-TR", "zh-Hans": "zh-CN",
  ja: "ja-JP", ko: "ko-KR", hi: "hi-IN", id: "id", nl: "nl-NL", pl: "pl-PL", vi: "vi", uk: "uk",
}

const at = (...p) => path.join(ROOT, ...p)
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"))
function write(rel, data) {
  const file = at(rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n")
}
/** "menu.quit" → { menu: { quit } }, for catalogs stored by section. */
function nest(flat) {
  const out = {}
  for (const [k, v] of Object.entries(flat)) {
    const i = k.indexOf(".")
    const [sec, key] = i < 0 ? ["", k] : [k.slice(0, i), k.slice(i + 1)]
    ;(out[sec] ??= {})[key] = v
  }
  return out
}
const withNote = (d) => ({ "//": NOTE, ...d })

const wanted = process.argv.slice(2)
const locales = (wanted.length ? wanted : MACHINE_ASSISTED).filter((l) => fs.existsSync(path.join(OUT, l)))
const glossaries = {}

for (const l of locales) {
  const src = (rel) => path.join(OUT, l, rel)
  const has = (rel) => fs.existsSync(src(rel))
  const files = []
  const put = (rel, data) => {
    write(rel, data)
    files.push(rel)
  }

  if (has("web")) {
    for (const f of fs.readdirSync(src("web")).filter((f) => f.endsWith(".json"))) {
      put(`web/lang/${f.slice(0, -5)}.${l}.json`, withNote(read(src(`web/${f}`))))
    }
  }
  if (has("mobile.json")) put(`mobile/src/i18n/locales/${l}.json`, withNote(read(src("mobile.json"))))
  if (has("desktop.json")) put(`desktop/src/renderer/i18n/locales/${l}.json`, withNote(read(src("desktop.json"))))
  if (has("desktop-sections.json")) put(`desktop/src/renderer/i18n/sections/${l}.json`, withNote(nest(read(src("desktop-sections.json")))))
  if (has("desktop-main.json")) put(`desktop/src/main/locales/${l}.json`, withNote(nest(read(src("desktop-main.json")))))
  if (has("native.json")) put(`mobile/locales/${l}.json`, nest(read(src("native.json")))) // read by Expo: no extra keys
  if (has("extension.json")) {
    // Chrome's format, without the "//" note; lang and direction are set here, never translated.
    const flat = { ...read(src("extension.json")), langTag: l, langDir: "ltr" }
    for (const k of Object.keys(flat)) if (k.startsWith("//")) delete flat[k]
    put(`extension/_locales/${CHROME_LOCALE[l]}/messages.json`, Object.fromEntries(Object.entries(flat).map(([k, v]) => [k, { message: v }])))
  }
  if (has("server-account.json")) put(`internal/account/locales/${l}.json`, withNote(read(src("server-account.json"))))
  if (has("server-brain.json")) put(`plugins/brain/internal/brain/locales/${l}.json`, withNote(read(src("server-brain.json"))))

  if (has("store/asc.json")) put(`store/asc/${ASC_LOCALE[l]}.json`, read(src("store/asc.json")))
  if (has("store/play.json")) put(`store/play/${PLAY_LOCALE[l]}.json`, read(src("store/play.json")))
  if (has("store/web.md")) {
    const md = fs.readFileSync(src("store/web.md"), "utf8")
    put(`store/web/${l}.md`, md.startsWith("<!--") ? md : `<!-- ${NOTE} -->\n\n${md}`)
  }
  if (has("glossary.json")) glossaries[l] = read(src("glossary.json"))
  console.log(`${l}: ${files.length} files`)
}

// lang/glossary.md: one row per English term, one column per language.
if (Object.keys(glossaries).length) {
  const file = at("lang/glossary.md")
  const md = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")
  const cols = MACHINE_ASSISTED.filter((l) => glossaries[l])
  const terms = [...new Set(cols.flatMap((l) => Object.keys(glossaries[l])))]
  const cell = (s) => String(s ?? "").replace(/\|/g, "\\|")
  const table = [
    `| English | ${cols.join(" | ")} |`,
    `|---|${cols.map(() => "---").join("|")}|`,
    ...terms.map((t) => `| ${cell(t)} | ${cols.map((l) => cell(glossaries[l][t])).join(" | ")} |`),
  ].join("\n")
  const begin = md.indexOf("<!-- TERMS:BEGIN")
  const end = md.indexOf("<!-- TERMS:END -->")
  if (begin < 0 || end < 0) throw new Error("lang/glossary.md: TERMS markers missing")
  const head = md.slice(0, md.indexOf("\n", begin) + 1)
  fs.writeFileSync(file, `${head}${table}\n${md.slice(end)}`)
  console.log(`glossary: ${terms.length} terms × ${cols.length} languages`)
}
