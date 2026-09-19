import { AI_SUMMARY, INDEXNOW_KEY, SITE_LOCALES, SITE_URL, siteUrl } from "@/lib/site/config"
import { loadDocs, summarise } from "@/lib/site/docs"
import { landing } from "@/lib/site/landing"

/*
zekra.dev's machine-readable files, served by app/zsite/*.{xml,txt}/route.ts (proxy.ts maps
/sitemap.xml, /robots.txt, /llms.txt, /feed.xml and the IndexNow key file onto them). Ported
from fadymondy.com-v2 app/sitemap.ts, robots.ts, llms.txt and feed.xml for this one site.
*/

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** Every public path, locale-less, with its sitemap priority. */
function paths(): { path: string; priority: number }[] {
  return [
    { path: "", priority: 1 },
    ...loadDocs().pages.map((p) => ({ path: `/docs${p.slug ? `/${p.slug}` : ""}`, priority: p.slug ? 0.7 : 0.8 })),
  ]
}

export function sitemapXml(): string {
  const urls = paths().flatMap(({ path, priority }) =>
    SITE_LOCALES.map((locale) => {
      const alts = [
        ...SITE_LOCALES.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${siteUrl(`/${l}${path}`)}" />`),
        `<xhtml:link rel="alternate" hreflang="x-default" href="${siteUrl(`/en${path}`)}" />`,
      ]
      return `<url>\n<loc>${siteUrl(`/${locale}${path}`)}</loc>\n${alts.join("\n")}\n<priority>${priority}</priority>\n</url>`
    }),
  )
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`
}

export function robotsTxt(): string {
  const host = new URL(SITE_URL).host
  return `User-Agent: *\nAllow: /\nDisallow: /api/\n\nHost: ${host}\nSitemap: ${siteUrl("/sitemap.xml")}\n`
}

export function llmsTxt(): string {
  const spec = landing("en")
  const docs = loadDocs()
  const lines = [
    `# ${spec.name}`,
    "",
    `> ${AI_SUMMARY}`,
    "",
    "Entity type: SoftwareApplication",
    "",
    spec.tagline,
    "",
    "Install the CLI:",
    "",
    "```",
    spec.install ?? "",
    "```",
    "",
    "## Features",
    "",
    ...spec.features.cards.map((c) => `- **${c.title}**: ${c.copy}`),
  ]
  if (spec.presentations) {
    lines.push("", `## ${spec.presentations.title}`, "", spec.presentations.copy, "", ...spec.presentations.cards.map((c) => `- **${c.title}**: ${c.copy}`))
  }
  if (spec.steps) {
    lines.push(
      "",
      `## ${spec.steps.title}`,
      "",
      ...spec.steps.steps.map((s, i) => `${i + 1}. **${s.title}**${s.code ? ` — \`${s.code}\`` : ""}`),
    )
  }
  lines.push(
    "",
    "## Links",
    "",
    "- [Console](https://app.zekra.dev)",
    "- [Remote MCP server](https://mcp.zekra.dev)",
    ...(spec.repo ? [`- [Source code](${spec.repo})`] : []),
    "",
    "## Pages",
    "",
    `- [Home](${siteUrl("/en")})`,
    `- [Home (Arabic)](${siteUrl("/ar")})`,
    "",
    "## Documentation",
    "",
    `- [${docs.name} docs](${siteUrl("/en/docs")}): ${docs.pages.length} pages`,
    ...docs.pages.map((p) => `  - [${p.title}](${siteUrl(`/en/docs${p.slug ? `/${p.slug}` : ""}`)})${p.description ? `: ${p.description}` : ""}`),
    "",
  )
  return lines.join("\n")
}

export function feedXml(): string {
  const docs = loadDocs()
  const now = new Date().toUTCString()
  const items = docs.pages.map((p) => {
    const link = siteUrl(`/en/docs${p.slug ? `/${p.slug}` : ""}`)
    const description = p.description || summarise(p.content) || p.title
    return `    <item>\n      <title>${esc(p.title)}</title>\n      <link>${link}</link>\n      <guid isPermaLink="false">docs/${p.slug || "index"}</guid>\n      <pubDate>${now}</pubDate>\n      <description>${esc(description)}</description>\n    </item>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n    <title>${esc(docs.name)} documentation</title>\n    <link>${siteUrl("/en/docs")}</link>\n    <description>${esc(landing("en").tagline)}</description>\n    <language>en</language>\n    <lastBuildDate>${now}</lastBuildDate>\n    <atom:link href="${siteUrl("/feed.xml")}" rel="self" type="application/rss+xml" />\n${items.join("\n")}\n  </channel>\n</rss>\n`
}

/** IndexNow ownership file: /{key}.txt and /indexnow.txt answer the key. */
export function indexNowKey(): string {
  return INDEXNOW_KEY
}
