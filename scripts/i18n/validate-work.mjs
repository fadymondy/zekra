// Checks a translator's output in .i18n-work/out/<locale>/ against .i18n-work/source/:
// same keys, placeholders and ICU intact, store fields within limits.
//   node scripts/i18n/validate-work.mjs de
import fs from "node:fs"
import path from "node:path"
import { ROOT, strip } from "./catalogs.mjs"
import { validateTranslation } from "../../web/lib/intl/icu.ts"

const locale = process.argv[2]
if (!locale) {
  console.error("usage: node scripts/i18n/validate-work.mjs <locale>")
  process.exit(2)
}
const SRC = path.join(ROOT, ".i18n-work/source")
const OUT = path.join(ROOT, ".i18n-work/out", locale)
const problems = []
let checked = 0

function walk(dir, rel = "") {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(dir, path.join(rel, e.name)) : [path.join(rel, e.name).replace(/\\/g, "/")],
  )
}

const LIMITS = {
  "store/asc.json": { name: 30, subtitle: 30, keywords: 100, promotionalText: 170, description: 4000, whatsNew: 4000 },
  "store/play.json": { title: 30, shortDescription: 80, fullDescription: 4000 },
}

for (const rel of walk(SRC)) {
  const outFile = path.join(OUT, rel)
  if (!fs.existsSync(outFile)) {
    problems.push(`${rel}: missing`)
    continue
  }
  if (rel.endsWith(".md")) {
    const src = fs.readFileSync(path.join(SRC, rel), "utf8")
    const got = fs.readFileSync(outFile, "utf8")
    const heads = (t) => (t.match(/^#{1,3} /gm) ?? []).length
    if (heads(src) !== heads(got)) problems.push(`${rel}: ${heads(got)} headings, source has ${heads(src)}`)
    for (const url of src.match(/https?:\/\/[^\s)`]+/g) ?? []) if (!got.includes(url)) problems.push(`${rel}: lost ${url}`)
    checked++
    continue
  }
  let got
  try {
    got = JSON.parse(fs.readFileSync(outFile, "utf8"))
  } catch (e) {
    problems.push(`${rel}: invalid JSON (${e.message})`)
    continue
  }
  const src = strip(JSON.parse(fs.readFileSync(path.join(SRC, rel), "utf8")))
  const tr = strip(got)
  for (const [k, v] of Object.entries(src)) {
    if (!(k in tr)) {
      problems.push(`${rel}: missing key ${k}`)
      continue
    }
    if (typeof tr[k] !== "string") {
      problems.push(`${rel}: ${k} is not a string`)
      continue
    }
    for (const err of validateTranslation(v, tr[k])) problems.push(`${rel}: ${k}: ${err}`)
    const limit = LIMITS[rel]?.[k]
    if (limit && [...tr[k]].length > limit) problems.push(`${rel}: ${k} is ${[...tr[k]].length} chars, limit ${limit}`)
    checked++
  }
  for (const k of Object.keys(tr)) if (!(k in src)) problems.push(`${rel}: unknown key ${k}`)
}

for (const p of problems) console.log(p)
console.log(`${locale}: ${checked} strings checked, ${problems.length} problem(s)`)
process.exit(problems.length ? 1 : 0)
