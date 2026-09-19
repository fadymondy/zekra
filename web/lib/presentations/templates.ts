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
    image: { type: "image", title: "Image", image_url: "/site/og.png", alt: "Describe the image" },
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
    gallery: { type: "gallery", heading: "Screens", images: [{ url: "/site/og.png", alt: "Screenshot" }] },
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

// The starter text in Arabic, so "Add" in an Arabic document does not drop English into it.
const AR: Record<string, string> = {
  Title: "العنوان",
  Subtitle: "العنوان الفرعي",
  "Key points": "أهم النقاط",
  "First point": "النقطة الأولى",
  "Second point": "النقطة الثانية",
  Image: "صورة",
  "Describe the image": "صف الصورة",
  "A quote worth repeating.": "اقتباس يستحق أن يُذكر.",
  Name: "الاسم",
  Numbers: "أرقام",
  Metric: "مؤشر",
  Compare: "مقارنة",
  Left: "الأول",
  Right: "الثاني",
  Point: "نقطة",
  Code: "شيفرة",
  "Concept page": "صفحة التصور",
  "How it works": "كيف يعمل",
  Request: "الطلب",
  Customer: "العميل",
  Check: "المراجعة",
  Delivered: "التسليم",
  "The main screen": "الشاشة الرئيسية",
  Dashboard: "لوحة المتابعة",
  Orders: "الطلبات",
  Open: "مفتوحة",
  Item: "البند",
  Owner: "المسؤول",
  First: "الأول",
  Team: "الفريق",
  Done: "تم",
  "What the team sees first": "أول ما يراه الفريق",
  "Write the section here.": "اكتب القسم هنا.",
  Value: "القيمة",
  Note: "ملاحظة",
  "Something to highlight.": "أمر يستحق الانتباه.",
  Chart: "رسم بياني",
  Series: "السلسلة",
  Concept: "تصور",
  "A clear promise": "وعد واضح",
  "One sentence that explains it.": "جملة واحدة تشرح الفكرة.",
  "Get started": "ابدأ الآن",
  "Why it works": "لماذا ينجح",
  Fast: "سريع",
  "Explain.": "اشرح.",
  Plans: "الباقات",
  Starter: "الأساسية",
  "/month": "/شهريًا",
  Feature: "ميزة",
  "It changed how we work.": "غيّر طريقة عملنا.",
  "Ready?": "جاهز؟",
  "Talk to us": "تحدث معنا",
  Screens: "الشاشات",
  Screenshot: "لقطة شاشة",
  "New section": "قسم جديد",
}

// Never translated: they are data, not words.
const KEEP = new Set(["type", "id", "icon", "kind", "frame", "layout", "tone", "trend", "chart", "language", "code", "url", "image_url", "cta_href", "document_id", "height", "from", "to"])

/** A template with its starter words in the document's language. */
export function localized<V>(value: V, locale: string): V {
  if (locale !== "ar") return JSON.parse(JSON.stringify(value)) as V
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === "string") return key && KEEP.has(key) ? v : (AR[v] ?? v)
    if (Array.isArray(v)) return v.map((x) => walk(x, key))
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Obj).filter(([, x]) => x !== undefined).map(([k, x]) => [k, walk(x, k)]))
    return v
  }
  return walk(value) as V
}
