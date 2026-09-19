// Copies the full runtime dependency tree of packages the standalone tracer can't follow
// (Chromium for PDF export loads them dynamically) into .next/standalone/node_modules.
// Run after `next build`: node scripts/copy-runtime-deps.mjs
import { cpSync, existsSync, readFileSync } from "node:fs"
import path from "node:path"

const ROOTS = ["@sparticuz/chromium", "puppeteer-core"]
const src = path.resolve("node_modules")
const dst = path.resolve(".next/standalone/node_modules")
const seen = new Set()

function visit(name) {
  if (seen.has(name)) return
  seen.add(name)
  const dir = path.join(src, name)
  const pkgFile = path.join(dir, "package.json")
  if (!existsSync(pkgFile)) return
  cpSync(dir, path.join(dst, name), { recursive: true, dereference: true })
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8"))
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) visit(dep)
}
ROOTS.forEach(visit)
console.log(`copied ${seen.size} packages for ${ROOTS.join(", ")}`)
