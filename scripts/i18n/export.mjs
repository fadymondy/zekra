// Writes the English sources translators work from into .i18n-work/source/, flat key → message.
// Translations come back as .i18n-work/out/<locale>/<same path>; scripts/i18n/merge.mjs files them.
//   node scripts/i18n/export.mjs
import fs from "node:fs"
import path from "node:path"
import { EXTENSION_META_KEYS, ROOT, allCatalogs } from "./catalogs.mjs"

const SRC = path.join(ROOT, ".i18n-work/source")
const write = (rel, data) => {
  const file = path.join(SRC, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n")
}

for (const c of await allCatalogs()) {
  const en = c.byLocale.en
  if (!en || !Object.keys(en).length) continue
  if (c.name === "web") {
    for (const area of c.parts.areas) {
      const d = JSON.parse(fs.readFileSync(path.join(ROOT, `web/lang/${area}.en.json`), "utf8"))
      write(`web/${area}.json`, d)
    }
  } else if (c.name === "extension") {
    write("extension.json", Object.fromEntries(Object.entries(en).filter(([k]) => !EXTENSION_META_KEYS.includes(k))))
  } else {
    write(`${c.name}.json`, en)
  }
}
write("store/asc.json", JSON.parse(fs.readFileSync(path.join(ROOT, "store/asc/en-US.json"), "utf8")))
write("store/play.json", JSON.parse(fs.readFileSync(path.join(ROOT, "store/play/en-US.json"), "utf8")))
write("store/web.md", fs.readFileSync(path.join(ROOT, "store/web/en.md"), "utf8"))
console.log("sources in", path.relative(ROOT, SRC))
