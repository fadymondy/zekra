// Loads every Zekra message catalog as flat { key: message } objects, per surface and locale.
// Shared by scripts/i18n/check.mjs (CI) and the export/merge helpers. Node >= 22.15 (module hooks).
//
// Surfaces and where their catalogs live:
//   web              web/lang/<area>.<locale>.json                     (all 18 locales)
//   mobile           mobile/src/i18n/features/*.ts (en, ar)            + mobile/src/i18n/locales/<locale>.json
//   desktop          desktop/src/renderer/i18n/*.ts (en, ar)           + desktop/src/renderer/i18n/locales/<locale>.json
//   desktop-main     desktop/src/main/locales/<locale>.json
//   extension        extension/_locales/<chrome code>/messages.json  (Chrome i18n format)
//   server-account   internal/account/locales/<locale>.json            (emails, API messages)
//   server-brain     plugins/brain/internal/brain/locales/<locale>.json (push notifications)
//   native           mobile/locales/<locale>.json                       (iOS/Android system strings)
import fs from "node:fs"
import path from "node:path"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const at = (...p) => path.join(ROOT, ...p)

// TS aliases used by the mobile/desktop dictionaries, plus extensionless relative imports.
registerHooks({
  resolve(specifier, context, next) {
    let s = specifier
    if (s.startsWith("@/i18n/")) s = pathToFileURL(at("mobile/src/i18n", s.slice(7))).href
    else if (s.startsWith("@mobile/")) s = pathToFileURL(at("mobile/src", s.slice(8))).href
    else if (s.startsWith("@shared/")) s = pathToFileURL(at("web/lib", s.slice(8))).href
    if ((s.startsWith("file:") || s.startsWith(".")) && !/\.[cm]?[jt]sx?$|\.json$/.test(s)) {
      const base = s.startsWith("file:") ? s : new URL(s, context.parentURL).href
      for (const ext of [".ts", "/index.ts"]) {
        if (fs.existsSync(fileURLToPath(base + ext))) return next(base + ext, context)
      }
    }
    // The desktop dictionaries import their per-locale JSON without an import attribute (Vite allows it).
    if (s.endsWith(".json") || /.json$/.test(new URL(s, context.parentURL).pathname)) return { ...next(s, context), importAttributes: { type: "json" } }
    return next(s, context)
  },
})

export const LOCALES = ["en", "ar", "es", "fr", "de", "pt-BR", "it", "ru", "tr", "zh-Hans", "ja", "ko", "hi", "id", "nl", "pl", "vi", "uk"]
/** Locales whose strings are machine-assisted and await native review. */
export const MACHINE_ASSISTED = LOCALES.filter((l) => l !== "en" && l !== "ar")

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"))
const jsonOrNull = (file) => (fs.existsSync(file) ? readJson(file) : null)
/** Flattens nested sections to dotted keys ({menu: {quit}} → "menu.quit") and drops "//"
 *  metadata keys (the machine-assisted note). */
export function strip(dict, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(dict ?? {})) {
    if (k.startsWith("//")) continue
    if (v && typeof v === "object") strip(v, `${prefix}${k}.`, out)
    else out[prefix + k] = v
  }
  return out
}

async function tsDicts(dir) {
  const files = fs.readdirSync(at(dir)).filter((f) => f.endsWith(".ts") && f !== "index.ts" && f !== "define.ts")
  const out = []
  for (const f of files.sort()) {
    const mod = await import(pathToFileURL(at(dir, f)).href)
    if (mod.default?.en) out.push({ file: `${dir}/${f}`, en: mod.default.en, ar: mod.default.ar })
  }
  return out
}

/** One logical catalog: `files` maps each locale to its source file (for error messages). */
function catalog(name, byLocale, files, parts) {
  return { name, byLocale, files, parts }
}

export async function webCatalog() {
  const dir = at("web/lang")
  const areas = fs.readdirSync(dir).filter((f) => f.endsWith(".en.json")).map((f) => f.slice(0, -".en.json".length)).sort()
  const byLocale = {}
  const files = {}
  for (const l of LOCALES) {
    byLocale[l] = {}
    files[l] = `web/lang/<area>.${l}.json`
    for (const a of areas) {
      const d = jsonOrNull(path.join(dir, `${a}.${l}.json`))
      if (d) Object.assign(byLocale[l], strip(d))
    }
  }
  return catalog("web", byLocale, files, { areas })
}

export async function mobileCatalog() {
  const dicts = await tsDicts("mobile/src/i18n/features")
  const byLocale = { en: {}, ar: {} }
  for (const d of dicts) {
    Object.assign(byLocale.en, d.en)
    Object.assign(byLocale.ar, d.ar)
  }
  const files = { en: "mobile/src/i18n/features/*.ts", ar: "mobile/src/i18n/features/*.ts" }
  for (const l of MACHINE_ASSISTED) {
    files[l] = `mobile/src/i18n/locales/${l}.json`
    byLocale[l] = strip(jsonOrNull(at(files[l])))
  }
  return catalog("mobile", byLocale, files, { dicts })
}

export async function desktopCatalog() {
  const dicts = await tsDicts("desktop/src/renderer/i18n")
  const byLocale = { en: {}, ar: {} }
  for (const d of dicts) {
    Object.assign(byLocale.en, d.en)
    Object.assign(byLocale.ar, d.ar)
  }
  const files = { en: "desktop/src/renderer/i18n/*.ts", ar: "desktop/src/renderer/i18n/*.ts" }
  for (const l of MACHINE_ASSISTED) {
    files[l] = `desktop/src/renderer/i18n/locales/${l}.json`
    byLocale[l] = strip(jsonOrNull(at(files[l])))
  }
  return catalog("desktop", byLocale, files, { dicts })
}

/** Chrome names two of Zekra's locales differently (_locales/<code>). */
export const CHROME_LOCALE = Object.fromEntries(LOCALES.map((l) => [l, { "pt-BR": "pt_BR", "zh-Hans": "zh_CN" }[l] ?? l]))
/** Keys the extension sets per catalog itself (lang tag and direction), never translated. */
export const EXTENSION_META_KEYS = ["langTag", "langDir"]

/** The browser extension: Chrome's { key: { message } } files, flattened to { key: message }. */
export function extensionCatalog() {
  const byLocale = {}
  const files = {}
  for (const l of LOCALES) {
    files[l] = `extension/_locales/${CHROME_LOCALE[l]}/messages.json`
    const d = jsonOrNull(at(files[l]))
    if (d) byLocale[l] = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.message]))
  }
  return catalog("extension", byLocale, files, {})
}

/** A catalog stored as one flat JSON per locale under `dir`. */
export function jsonCatalog(name, dir) {
  const byLocale = {}
  const files = {}
  for (const l of LOCALES) {
    files[l] = `${dir}/${l}.json`
    const d = jsonOrNull(at(files[l]))
    if (d) byLocale[l] = strip(d)
  }
  return catalog(name, byLocale, files, {})
}

export async function allCatalogs() {
  return [
    await webCatalog(),
    await mobileCatalog(),
    await desktopCatalog(),
    jsonCatalog("desktop-main", "desktop/src/main/locales"),
    extensionCatalog(),
    jsonCatalog("server-account", "internal/account/locales"),
    jsonCatalog("server-brain", "plugins/brain/internal/brain/locales"),
    jsonCatalog("native", "mobile/locales"),
  ]
}
