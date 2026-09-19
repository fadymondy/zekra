// Bundles this repo's docs/ folder into content/site/docs.gen.json for the zekra.dev docs.
//
// zekra.dev used to sync these same files from GitHub (fadymondy.com-v2 lib/docs/source.ts).
// Here they are read at build time instead: next.config.mjs calls syncSiteDocs() whenever Next
// loads its config (dev and build), so the standalone server ships the JSON and never needs
// ../docs at runtime. Frontmatter conventions are the same: title, description, order
// (or sidebar_position / weight); the first "# Heading" is the fallback title.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DOCS = path.resolve(WEB, "..", "docs")
const OUT = path.join(WEB, "content", "site", "docs.gen.json")

function splitFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { data: {}, body: raw }
  const data = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (kv) data[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "")
  }
  return { data, body: raw.slice(match[0].length) }
}

function walk(dir, rel = "") {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    const r = rel ? `${rel}/${name}` : name
    if (statSync(full).isDirectory()) return walk(full, r)
    return /\.mdx?$/i.test(name) ? [r] : []
  })
}

const LEADS = ["introduction", "overview", "getting-started", "installation", "quickstart"]
const lead = (slug) => {
  const i = LEADS.indexOf(slug.slice(slug.lastIndexOf("/") + 1).toLowerCase())
  return i === -1 ? LEADS.length : i
}

/** Index first, then by folder, then frontmatter order, then the leading pages, then title. */
function sortPages(pages) {
  const folder = (p) => (p.slug.includes("/") ? p.slug.slice(0, p.slug.lastIndexOf("/")) : "")
  return pages.slice().sort((a, b) => {
    if (a.slug === "") return -1
    if (b.slug === "") return 1
    const fa = folder(a), fb = folder(b)
    if (fa !== fb) return fa.localeCompare(fb)
    const oa = a.order ?? Infinity, ob = b.order ?? Infinity
    if (oa !== ob) return oa - ob
    if (lead(a.slug) !== lead(b.slug)) return lead(a.slug) - lead(b.slug)
    return a.title.localeCompare(b.title)
  })
}

export function syncSiteDocs() {
  if (!existsSync(DOCS)) return false // a standalone checkout without docs/: keep the last bundle
  const pages = walk(DOCS).map((rel) => {
    const { data, body } = splitFrontmatter(readFileSync(path.join(DOCS, rel), "utf8"))
    const order = Number(data.order ?? data.sidebar_position ?? data.weight)
    const heading = body.match(/^#\s+(.+)$/m)
    const slug = rel.replace(/\.mdx?$/i, "").replace(/(^|\/)(readme|index)$/i, "").replace(/\/$/, "")
    return {
      slug,
      title: data.title || (heading ? heading[1].replace(/[*_`]/g, "").trim() : path.basename(rel).replace(/\.mdx?$/i, "")),
      description: data.description || undefined,
      order: Number.isFinite(order) ? order : undefined,
      file: `docs/${rel}`,
      content: body,
    }
  })
  const json = JSON.stringify({ name: "Zekra", pages: sortPages(pages) })
  if (existsSync(OUT) && readFileSync(OUT, "utf8") === json) return true
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(`${OUT}.tmp`, json)
  renameSync(`${OUT}.tmp`, OUT)
  return true
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(syncSiteDocs() ? `wrote ${OUT}` : `no ${DOCS}; kept ${OUT}`)
}
