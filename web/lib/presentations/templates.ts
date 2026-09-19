/*
Starter content for the editor (FM-345): one valid document per kind, and one
valid item per slide / block / section type, so "Add" always produces
something the API accepts.
*/
import type { Kind } from "./types.ts"

type Obj = Record<string, unknown>

const WORKFLOW: Obj = {
  type: "workflow",
  title: "How it works",
  steps: [
    { id: "request", title: "Request", icon: "inbox", owner: "Customer" },
    { id: "check", title: "Check", icon: "search-check", kind: "decision" },
    { id: "done", title: "Delivered", icon: "badge-check", kind: "output" },
  ],
}
const SCREEN: Obj = {
  type: "screen",
  title: "The main screen",
  frame: "browser",
  url: "app.example.com",
  layout: "sidebar",
  nav: [
    { label: "Dashboard", icon: "layout-dashboard", active: true },
    { label: "Orders", icon: "package" },
  ],
  parts: [
    { type: "kpis", items: [{ label: "Open", value: "12", icon: "inbox" }] },
    { type: "table", columns: ["Item", "Owner"], rows: [{ cells: ["First", "Team"], status: "Done", tone: "success" }] },
  ],
  annotations: [{ target_part_index: 0, text: "What the team sees first" }],
}

export const ITEM_TEMPLATES: Record<Kind, Record<string, Obj>> = {
  deck: {
    title: { type: "title", title: "Title", subtitle: "Subtitle" },
    bullets: { type: "bullets", title: "Key points", bullets: ["First point", "Second point"] },
    image: { type: "image", title: "Image", image_url: "/brand/og.png", alt: "Describe the image" },
    quote: { type: "quote", quote: "A quote worth repeating.", author: "Name" },
    metric: { type: "metric", title: "Numbers", metrics: [{ label: "Metric", value: "42%", trend: "up" }] },
    two_column: { type: "two_column", title: "Compare", left: { heading: "Left", bullets: ["Point"] }, right: { heading: "Right", bullets: ["Point"] } },
    code: { type: "code", title: "Code", language: "ts", code: "console.log('hello')" },
    embed: { type: "embed", title: "Concept page", document_id: "" },
    workflow: WORKFLOW,
    screen: SCREEN,
  },
  report: {
    markdown: { type: "markdown", text: "Write the section here." },
    table: { type: "table", columns: ["Item", "Value"], rows: [["A", "1"]] },
    callout: { type: "callout", tone: "info", title: "Note", text: "Something to highlight." },
    chart: { type: "chart", chart: "bar", title: "Chart", labels: ["A", "B", "C"], series: [{ name: "Series", values: [3, 5, 4] }] },
    workflow: WORKFLOW,
    screen: SCREEN,
  },
  page: {
    hero: {
      type: "hero",
      eyebrow: "Concept",
      heading: "A clear promise",
      body: "One sentence that explains it.",
      cta_label: "Get started",
      cta_href: "/en/contact",
      // The product screen beside the promise; remove it for a full-width text hero.
      visual: { ...SCREEN, title: undefined, annotations: undefined },
    },
    features: { type: "features", heading: "Why it works", items: [{ title: "Fast", body: "Explain.", icon: "zap" }] },
    pricing: { type: "pricing", heading: "Plans", plans: [{ name: "Starter", price: "$49", period: "/month", features: ["Feature"] }] },
    testimonial: { type: "testimonial", quote: "It changed how we work.", author: "Customer" },
    cta: { type: "cta", heading: "Ready?", cta_label: "Talk to us", cta_href: "/en/contact" },
    gallery: { type: "gallery", heading: "Screens", images: [{ url: "/brand/og.png", alt: "Screenshot" }] },
    scene: { type: "scene", heading: "", scene: { type: "particles", params: {} }, height: "md" },
    workflow: WORKFLOW,
    screen: SCREEN,
  },
}

/** Where a kind keeps its ordered items. Reports nest blocks inside sections. */
export const ITEMS_KEY: Record<Kind, "slides" | "sections"> = { deck: "slides", report: "sections", page: "sections" }

export function starter(kind: Kind, title: string): Obj {
  switch (kind) {
    case "deck":
      return { title, slides: [{ ...ITEM_TEMPLATES.deck.title, title }] }
    case "report":
      return { title, summary: "", sections: [{ heading: "Overview", blocks: [ITEM_TEMPLATES.report.markdown] }] }
    case "page":
      return { title, sections: [{ ...ITEM_TEMPLATES.page.hero, heading: title }] }
  }
}

export function newReportSection(): Obj {
  return { heading: "New section", blocks: [ITEM_TEMPLATES.report.markdown] }
}

/** Moves one item; out-of-range moves return the list unchanged. */
export function move<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list
  const out = list.slice()
  const [item] = out.splice(from, 1)
  out.splice(to, 0, item)
  return out
}
