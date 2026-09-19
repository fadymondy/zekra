import { readFileSync, statSync } from "node:fs"
import path from "node:path"

import { REPO, REPO_BRANCH } from "@/lib/site/config"

/*
zekra.dev's documentation: this repo's docs/ folder, bundled by scripts/sync-site-docs.mjs
(run from next.config.mjs) into content/site/docs.gen.json. Ported from fadymondy.com-v2
web/lib/docs/source.ts, minus the GitHub sync and the multi-site keys.
*/

export type DocPage = {
  /** Path under docs/ without extension; "" is the index. */
  slug: string
  title: string
  description?: string
  order?: number
  /** Repo path, for "edit on GitHub" and relative-link resolution. */
  file: string
  content: string
}

export type DocsBundle = { name: string; pages: DocPage[] }

const FILE = path.join(/* turbopackIgnore: true */ process.cwd(), "content", "site", "docs.gen.json")
let memo: { mtime: number; bundle: DocsBundle } | null = null

export function loadDocs(): DocsBundle {
  try {
    const { mtimeMs } = statSync(FILE)
    if (memo && memo.mtime === mtimeMs) return memo.bundle
    const bundle = JSON.parse(readFileSync(FILE, "utf8")) as DocsBundle
    memo = { mtime: mtimeMs, bundle }
    return bundle
  } catch {
    return { name: "Zekra", pages: [] }
  }
}

export function docsBase(locale: string): string {
  return `/${locale}/docs`
}

export function docHref(locale: string, slug: string): string {
  return slug ? `${docsBase(locale)}/${slug}` : docsBase(locale)
}

export function editUrl(page: DocPage): string {
  return `https://github.com/${REPO}/blob/${REPO_BRANCH}/${page.file}`
}

const posix = path.posix

function slugFor(file: string): string {
  return posix
    .relative("docs", file)
    .replace(/\.mdx?$/i, "")
    .replace(/(^|\/)(readme|index)$/i, "")
    .replace(/\/$/, "")
}

/**
 * Where a link inside a doc points: a relative .md link becomes the docs route, any other
 * relative path goes to the file on GitHub, absolute URLs and anchors are left alone.
 */
export function resolveHref(href: string, page: DocPage, locale: string): string {
  if (!href || /^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) return href
  const [target, hash = ""] = href.split("#")
  const resolved = href.startsWith("/")
    ? target.replace(/^\/+/, "")
    : posix.normalize(posix.join(posix.dirname(page.file), target))
  if (/\.mdx?$/i.test(resolved) && resolved.startsWith("docs/")) {
    return `${docHref(locale, slugFor(resolved))}${hash ? `#${hash}` : ""}`
  }
  return `https://raw.githubusercontent.com/${REPO}/${REPO_BRANCH}/${resolved.split("/").map(encodeURIComponent).join("/")}`
}

/** A link to a docs page that does not exist renders as text, not as a 404. */
export function isMissingDocLink(href: string, page: DocPage, bundle: DocsBundle): boolean {
  if (!href || /^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) return false
  const [target] = href.split("#")
  const resolved = href.startsWith("/")
    ? target.replace(/^\/+/, "")
    : posix.normalize(posix.join(posix.dirname(page.file), target))
  if (!/\.mdx?$/i.test(resolved) || !resolved.startsWith("docs/")) return false
  const slug = slugFor(resolved)
  return !bundle.pages.some((p) => p.slug === slug)
}

/** Heading text → anchor id, the same way for the heading and the TOC link. */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
}

/** The h2/h3 outline of a doc, for "On this page". Code fences are skipped. */
export function outline(markdown: string): { title: string; id: string; depth: 2 | 3 }[] {
  const out: { title: string; id: string; depth: 2 | 3 }[] = []
  let fenced = false
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced
    if (fenced) continue
    const m = line.match(/^(##|###)\s+(.+?)\s*#*\s*$/)
    if (m) {
      const title = m[2].replace(/[`*_]/g, "")
      out.push({ title, id: headingId(title), depth: m[1].length as 2 | 3 })
    }
  }
  return out
}

/** The doc's own leading "# Title" is dropped — the page header already says it. */
export function withoutLeadingTitle(content: string): string {
  return content.replace(/^\s*#\s+[^\n]+\n+/, "")
}

/** First real paragraph as plain text, cut near 160 characters — a fallback meta description. */
export function summarise(markdown: string, max = 160): string | null {
  const SKIP = /^(#|>|\||[-*+] |\d+\. |!\[|<|:::|\[!)/
  const body = markdown.replace(/```[\s\S]*?```/g, "")
  for (const block of body.split(/\n\s*\n/)) {
    const text = block.trim()
    if (!text || SKIP.test(text)) continue
    const plain = text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[`*_~]/g, "")
      .replace(/\s+/g, " ")
      .trim()
    if (plain.length < 40) continue
    if (plain.length <= max) return plain
    const cut = plain.slice(0, max - 3)
    return cut.slice(0, cut.lastIndexOf(" ")) + "…"
  }
  return null
}

/** Typography for rendered markdown (fadymondy.com-v2 web/lib/prose.ts). */
export const PROSE = `flex flex-col gap-4 text-pretty [overflow-wrap:anywhere]
  [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:[overflow-wrap:normal]
  [&_a]:underline [&_a]:underline-offset-4 [&_a]:decoration-foreground/30 hover:[&_a]:decoration-foreground
  [&_blockquote]:border-s-2 [&_blockquote]:border-line [&_blockquote]:ps-4 [&_blockquote]:text-muted-foreground
  [&_:not(pre)>code]:bg-muted/60 [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-px [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-sm
  [&_h1]:mt-6 [&_h1]:text-2xl [&_h1]:font-medium [&_h1]:tracking-tight
  [&_h2]:mt-6 [&_h2]:scroll-mt-20 [&_h2]:text-2xl [&_h2]:font-medium [&_h2]:tracking-tight
  [&_h3]:mt-4 [&_h3]:scroll-mt-20 [&_h3]:text-xl [&_h3]:font-medium
  [&_li]:ms-5 [&_li]:list-disc [&_ol_li]:list-decimal
  [&_strong]:font-medium [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2
  [&_table]:block [&_table]:overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm
  [&_td]:border [&_td]:border-line [&_td]:px-3 [&_td]:py-2
  [&_th]:border [&_th]:border-line [&_th]:bg-muted/40 [&_th]:px-3 [&_th]:py-2 [&_th]:text-start [&_th]:font-medium
  [&_hr]:border-line [&_img]:max-w-full`
