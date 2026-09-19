// One-off export of zekra.dev's landing content from fadymondy.com-v2 (read-only).
//
// zekra.dev's landing is not stored in the database: fadymondy.com-v2 renders it from the
// LANDINGS["cabrain.fadymondy.com"] spec in web/lib/brand/landings.ts (the `sites` row only
// carries SEO/GA fields). This transpiles that file with TypeScript into a temp dir, imports
// it, and splits every { en, ar } pair into content/site/landing.{en,ar}.json.
//
//   node scripts/export-site-landing.mjs [path-to-fadymondy.com-v2]
//
// The JSON was then edited by hand for accuracy (see git history); re-running overwrites it.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import ts from "typescript"

const src = path.resolve(process.argv[2] ?? "../../../fadymondy.com-v2", "web/lib/brand")
const out = mkdtempSync(path.join(tmpdir(), "zekra-landing-"))
for (const name of ["landings", "marks", "domains"]) {
  const code = readFileSync(path.join(src, `${name}.ts`), "utf8")
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  writeFileSync(path.join(out, `${name}.mjs`), js.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"'))
}
const { LANDINGS } = await import(pathToFileURL(path.join(out, "landings.mjs")).href)
const spec = LANDINGS["cabrain.fadymondy.com"]

const isBi = (v) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === "ar,en"
const pick = (v, lang) =>
  isBi(v) ? v[lang] : Array.isArray(v) ? v.map((x) => pick(x, lang)) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "mark").map(([k, x]) => [k, pick(x, lang)]))
    : v

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"))
for (const lang of ["en", "ar"]) {
  writeFileSync(path.join(here, "..", "content", "site", `landing.${lang}.json`), JSON.stringify(pick(spec, lang), null, 2) + "\n")
}
console.log("exported", Object.keys(spec).join(", "))
