/*
The public marketing + docs site (zekra.dev), served by this app when the request's host is a
site host (proxy.ts). Single-tenant: everything fadymondy.com-v2 kept on its `sites` row for
zekra.dev is here, read from env with the live values as defaults.
*/

/** Canonical origin of the public site. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://zekra.dev").replace(/\/+$/, "")
/** The console the landing's calls to action open. */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://app.zekra.dev").replace(/\/+$/, "")
/** GA4 measurement id; loaded only after the visitor accepts analytics cookies. */
export const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? ""
export const INDEXNOW_KEY = process.env.INDEXNOW_KEY ?? ""
export const YANDEX_VERIFICATION = process.env.SITE_YANDEX_VERIFICATION ?? "82433c928d884e93"
export const FACEBOOK_APP_ID = process.env.SITE_FACEBOOK_APP_ID ?? "1566096978602727"
export const TWITTER_HANDLE = "@fadymondy"
export const REPO = "fadymondy/zekra"
export const REPO_BRANCH = "main"

/** The Site record's `ai_summary`: the one-paragraph answer for assistants (llms.txt, JSON-LD). */
export const AI_SUMMARY =
  "Zekra is a memory service for AI agents: hybrid vector and keyword recall plus a typed entity graph, reachable from any agent over MCP, so knowledge persists across sessions and projects."

export const KEYWORDS = ["Zekra", "AI memory", "agent memory", "MCP server", "knowledge graph", "vector search", "Claude Code", "RAG"]

export const SITE_LOCALES = ["en", "ar"] as const
export type SiteLocale = (typeof SITE_LOCALES)[number]

/** Hosts that get the site instead of the console. `ZEKRA_SITE_HOSTS` adds more (comma list). */
export function siteHosts(): string[] {
  const extra = (process.env.ZEKRA_SITE_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  return ["zekra.dev", "www.zekra.dev", ...extra]
}

/** Absolute URL on the public site. */
export function siteUrl(path = ""): string {
  return `${SITE_URL}${path.startsWith("/") || path === "" ? path : `/${path}`}`
}
