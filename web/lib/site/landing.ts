import en from "@/content/site/landing.en.json"
import ar from "@/content/site/landing.ar.json"

/*
zekra.dev's landing content, one JSON file per language. Exported from fadymondy.com-v2's
LANDINGS spec (the entry for this product) by scripts/export-site-landing.mjs, then edited here —
this repo is now its source of truth. The shape is that spec with each { en, ar } pair
resolved to one language.
*/

export type IconName = string
export type Link = { label: string; href: string }
export type Card = { icon: IconName; title: string; copy: string }

export type Landing = {
  wordmark: string
  localWordmark?: string
  name: string
  headline?: string
  metaTitle: string
  metaDescription?: string
  eyebrow: string
  tagline: string
  nav: Link[]
  primaryAction: Link
  secondaryAction?: Link
  install?: string
  chips: { icon: IconName; label: string }[]
  terminal?: { title: string; lines: { text: string; tone?: "prompt" | "ok" | "muted" }[] }
  features: { id?: string; title: string; note?: string; cards: Card[] }
  explainer?: { id: string; title: string; note?: string; diagram: string; items: { title: string; copy: string }[] }
  presentations?: { id: string; eyebrow?: string; title: string; copy: string; cards: Card[]; actions: Link[] }
  grid?: { title: string; items: { icon: IconName; label: string }[] }
  groups?: { title: string; groups: { label: string; items: string[] }[] }
  steps?: { id?: string; title: string; note?: string; steps: { title: string; code?: string; copy?: string }[] }
  closing?: { title: string; copy: string }
  cta?: { title: string; copy?: string; code?: string; actions: Link[] }
  related?: { domain: string; copy: string }[]
  community?: boolean
  repo?: string
  copyright: string
}

/** Sentinel hrefs kept from the source spec. */
export const DOCS_HREF = "@docs"

const LANDINGS: Record<string, Landing> = { en: en as Landing, ar: ar as Landing }

export function landing(locale: string): Landing {
  return LANDINGS[locale] ?? LANDINGS.en
}

/** The siblings the "More from the ecosystem" block links to: name and mark key per domain. */
export const RELATED: Record<string, { name: string; mark: "togo" | "orchestra-mcp" }> = {
  "to-go.dev": { name: "ToGO", mark: "togo" },
  "orchestra-mcp.dev": { name: "Orchestra MCP", mark: "orchestra-mcp" },
}
