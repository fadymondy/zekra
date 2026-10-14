// The i18n gate (CI): every catalog in every shipped language is complete and safe to render.
//   node scripts/i18n/check.mjs                     run every check
//   node scripts/i18n/check.mjs --update-baseline   accept today's hard-coded strings (see below)
//
//  1. Locale lists agree: web/lib/intl/locales.ts, scripts/i18n/catalogs.mjs and the two Go
//     tables (internal/account/i18n.go, plugins/brain/internal/brain/i18n.go).
//  2. Catalog parity: every language has exactly the English keys, for every surface
//     (Arabic included, so en/ar never drift apart).
//  3. Messages: ICU parses, placeholders and markup match English; the extension's Chrome
//     positional $1…$9 match too.
//  4. Store listings: App Store / Google Play field limits, in characters.
//  5. No new hard-coded UI strings: literal JSX text and literal user-facing props in the
//     web, mobile and desktop UI are counted per file against hardcoded-baseline.json.
//     A file may only go down. New copy belongs in a catalog.
import fs from "node:fs"
import path from "node:path"
import { LOCALES, ROOT, allCatalogs } from "./catalogs.mjs"
import { LOCALES as WEB_LOCALES } from "../../web/lib/intl/locales.ts"
import { validateTranslation } from "../../web/lib/intl/icu.ts"

const problems = []
const fail = (msg) => problems.push(msg)
const at = (...p) => path.join(ROOT, ...p)
const read = (rel) => fs.readFileSync(at(rel), "utf8")

// 1. Locale lists ------------------------------------------------------------------------
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
if (!same(WEB_LOCALES, LOCALES)) fail(`locales: web/lib/intl/locales.ts [${WEB_LOCALES}] ≠ catalogs.mjs [${LOCALES}]`)
for (const go of ["internal/account/i18n.go", "plugins/brain/internal/brain/i18n.go"]) {
  const m = read(go).match(/var Locales = \[\]string\{([^}]*)\}/)
  const list = m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : []
  if (!same(list, LOCALES)) fail(`locales: ${go} [${list}] ≠ [${LOCALES}]`)
}

// 2 + 3. Catalogs ------------------------------------------------------------------------
const positional = (s) => (s.match(/\$\d/g) ?? []).sort().join(",")
let messages = 0
for (const c of await allCatalogs()) {
  const en = c.byLocale.en
  if (!en) {
    fail(`${c.name}: no English catalog`)
    continue
  }
  // The Go servers keep Arabic inline next to English (tested in Go), not in a catalog.
  const inline = c.name.startsWith("server-") ? ["en", "ar"] : ["en"]
  for (const l of LOCALES.filter((l) => !inline.includes(l))) {
    const tr = c.byLocale[l]
    if (!tr) {
      fail(`${c.name}: no ${l} catalog (${c.files[l]})`)
      continue
    }
    for (const [k, v] of Object.entries(en)) {
      if (!(k in tr)) {
        fail(`${c.files[l]}: missing ${k}`)
        continue
      }
      if (typeof v !== "string") continue
      if (typeof tr[k] !== "string") {
        fail(`${c.files[l]}: ${k} is not a string`)
        continue
      }
      messages++
      // Chrome's $1 is not ICU; the extension's own lang/dir keys are not translations.
      if (c.name === "extension") {
        if (positional(v) !== positional(tr[k])) fail(`${c.files[l]}: ${k}: placeholders [${positional(tr[k])}], English [${positional(v)}]`)
        if (k === "langTag" || k === "langDir") continue
        if (!tr[k].trim()) fail(`${c.files[l]}: ${k}: empty translation`)
        continue
      }
      for (const err of validateTranslation(v, tr[k])) fail(`${c.files[l]}: ${k}: ${err}`)
    }
    for (const k of Object.keys(tr)) if (!(k in en)) fail(`${c.files[l]}: unknown key ${k} (not in English)`)
  }
}

// 4. Store listings ----------------------------------------------------------------------
const LIMITS = {
  asc: { name: 30, subtitle: 30, keywords: 100, promotionalText: 170, description: 4000, whatsNew: 4000 },
  play: { title: 30, shortDescription: 80, fullDescription: 4000 },
}
for (const [store, limits] of Object.entries(LIMITS)) {
  const files = fs.readdirSync(at("store", store)).filter((f) => f.endsWith(".json"))
  if (files.length < LOCALES.length) fail(`store/${store}: ${files.length} listings, want ${LOCALES.length}`)
  for (const f of files) {
    const d = JSON.parse(read(`store/${store}/${f}`))
    for (const [field, max] of Object.entries(limits)) {
      const v = d[field]
      if (typeof v !== "string" || !v.trim()) fail(`store/${store}/${f}: ${field} missing`)
      else if ([...v].length > max) fail(`store/${store}/${f}: ${field} is ${[...v].length} characters, limit ${max}`)
    }
  }
}
const webListings = fs.readdirSync(at("store/web")).filter((f) => f.endsWith(".md"))
for (const l of LOCALES) if (!webListings.includes(`${l}.md`)) fail(`store/web/${l}.md missing`)

// 5. Hard-coded strings ------------------------------------------------------------------
const UI_DIRS = ["web/app", "web/components", "mobile/app", "mobile/src/components", "mobile/src/screens", "desktop/src/renderer"]
const BASELINE = "scripts/i18n/hardcoded-baseline.json"
// Two or more Latin words between tags, or a literal user-facing prop. Code, URLs and
// single tokens ("OK", "MCP", "Zekra") are not counted.
const JSX_TEXT = /(?<![=-])>\s*([A-Za-z][A-Za-z'’,.!?]*(?:\s+[A-Za-z'’,.!?&-]+)+)\s*</g
const PROP_TEXT = /\b(?:placeholder|title|aria-label|alt|label)="([^"{}]*[A-Za-z]{2,}\s+[A-Za-z][^"{}]*)"/g

function walk(dir) {
  if (!fs.existsSync(at(dir))) return []
  return fs.readdirSync(at(dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) return e.name === "node_modules" || e.name.startsWith(".") ? [] : walk(rel)
    return /\.tsx$/.test(e.name) && !/\.(test|stories)\.tsx$/.test(e.name) ? [rel] : []
  })
}
function hardcoded(src) {
  // Drop comments so prose in them is not counted.
  const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  const hits = []
  for (const m of code.matchAll(JSX_TEXT)) hits.push(m[1].trim())
  for (const m of code.matchAll(PROP_TEXT)) hits.push(m[1].trim())
  return hits
}
const counts = {}
for (const f of UI_DIRS.flatMap(walk).sort()) {
  const n = hardcoded(read(f)).length
  if (n) counts[f] = n
}
if (process.argv.includes("--update-baseline")) {
  fs.writeFileSync(at(BASELINE), JSON.stringify(counts, null, 2) + "\n")
  console.log(`${BASELINE}: ${Object.keys(counts).length} files, ${Object.values(counts).reduce((a, b) => a + b, 0)} strings`)
} else {
  const baseline = fs.existsSync(at(BASELINE)) ? JSON.parse(read(BASELINE)) : {}
  for (const [f, n] of Object.entries(counts)) {
    const allowed = baseline[f] ?? 0
    if (n > allowed) {
      const sample = hardcoded(read(f)).slice(0, 3).map((s) => JSON.stringify(s)).join(", ")
      fail(`${f}: ${n} hard-coded UI strings (baseline ${allowed}), e.g. ${sample}. Move them to a catalog.`)
    }
  }
  const stale = Object.keys(baseline).filter((f) => (counts[f] ?? 0) < baseline[f])
  if (stale.length) console.log(`note: ${stale.length} file(s) improved on the baseline; run with --update-baseline to lock it in`)
}

for (const p of problems) console.log(p)
console.log(`i18n: ${LOCALES.length} locales, ${messages} messages checked, ${problems.length} problem(s)`)
process.exit(problems.length ? 1 : 0)
