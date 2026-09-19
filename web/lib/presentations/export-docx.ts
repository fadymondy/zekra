/*
A report as a real Word document (FM-344).

Same approach as the CV (lib/cv-document.ts): Arabic paragraphs carry Word's
own bidi flag and every run is right-to-left, tables are marked visually
right-to-left, and Segoe UI is named because it ships with Office and covers
Arabic. Markdown is reduced to paragraphs, headings and list items with bold
and italic runs; a chart becomes its data table (Word has no safe way to embed
our chart, and the table is the accessible form anyway).

FM-350: a workflow becomes a table of its steps (who, what, and where each
leads), a screen a table of its parts; both keep the reading direction.
*/

/** One line of text per screen part, for the Word fallback. */
export function partSummary(p: ScreenPart): string {
  switch (p.type) {
    case "map":
      return [
        p.title,
        `${p.markers.length} markers, ${p.routes?.length ?? 0} routes`,
        p.suggest ? `${p.suggest.driver} → ${p.suggest.vendor} ${[p.suggest.eta, p.suggest.distance].filter(Boolean).join(" · ")}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    case "kpis":
      return p.items.map((k) => `${k.label}: ${k.value}${k.delta ? ` (${k.delta})` : ""}`).join(" · ")
    case "table":
      return [p.title, p.columns.join(" | "), ...p.rows.map((r) => r.cells.join(" | ") + (r.status ? ` — ${r.status}` : ""))].filter(Boolean).join("\n")
    case "form":
      return [p.title, ...p.fields.map((f) => `${f.label}: ${f.value ?? "—"}${f.state && f.state !== "ok" ? ` (${f.state})` : ""}`)].filter(Boolean).join("\n")
    case "chart":
      return [p.title, ...p.series.map((s) => `${s.name}: ${p.labels.map((l, i) => `${l} ${s.values[i] ?? ""}`).join(", ")}`)].filter(Boolean).join("\n")
    case "list":
    case "timeline":
      return [p.title, ...p.items.map((i) => [i.title, i.meta, i.status].filter(Boolean).join(" — "))].filter(Boolean).join("\n")
    case "board":
      return p.columns.map((c) => `${c.title}: ${(c.cards ?? []).map((k) => k.title).join(", ")}`).join("\n")
    case "split":
      return [p.left_label, ...p.left.map(partSummary), p.right_label, ...p.right.map(partSummary)].filter(Boolean).join("\n")
    case "callout":
      return [p.title, p.text].filter(Boolean).join(": ")
    case "image":
      return p.alt
  }
}
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
} from "docx"

import type { Block, MapPart, ReportContent, ScreenPart } from "./types.ts"
import { workflowEdges } from "./workflow.ts"

const FONT = "Segoe UI"
const INK = "0E1A3C"
const MUTED = "5D6270"
const RULE = "D9D3C7"

type Ctx = { rtl: boolean; locale: "en" | "ar" }

/** Splits **bold** and *italic* into runs; links keep their text. */
export function inlineRuns(text: string, ctx: Ctx, base: { size?: number; color?: string; bold?: boolean } = {}): TextRun[] {
  const clean = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/`([^`]+)`/g, "$1")
  const out: TextRun[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g
  let last = 0
  for (const m of clean.matchAll(re)) {
    if (m.index! > last) out.push(run(clean.slice(last, m.index), ctx, base))
    const tok = m[0]
    if (tok.startsWith("**")) out.push(run(tok.slice(2, -2), ctx, { ...base, bold: true }))
    else out.push(run(tok.slice(1, -1), ctx, { ...base, italics: true }))
    last = m.index! + tok.length
  }
  if (last < clean.length) out.push(run(clean.slice(last), ctx, base))
  return out
}

function run(text: string, ctx: Ctx, o: { size?: number; color?: string; bold?: boolean; italics?: boolean } = {}) {
  return new TextRun({
    text,
    font: FONT,
    rightToLeft: ctx.rtl,
    bold: o.bold,
    italics: o.italics,
    size: o.size,
    color: o.color ?? INK,
  })
}

function para(children: TextRun[], ctx: Ctx, extra: Omit<IParagraphOptions, "children"> = {}) {
  return new Paragraph({
    bidirectional: ctx.rtl,
    alignment: ctx.rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
    ...extra,
    children,
  })
}

/** Markdown → Word paragraphs (headings, bullets, numbered items, paragraphs). */
export function markdownParagraphs(md: string, ctx: Ctx): Paragraph[] {
  const out: Paragraph[] = []
  const lines = md.replace(/\r/g, "").split("\n")
  let buf: string[] = []
  const flush = () => {
    if (buf.length) out.push(para(inlineRuns(buf.join(" "), ctx), ctx, { spacing: { after: 120 } }))
    buf = []
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    const li = /^[-*+]\s+(.*)$/.exec(line)
    const ol = /^(\d+)[.)]\s+(.*)$/.exec(line)
    if (h) {
      flush()
      out.push(para(inlineRuns(h[2], ctx, { bold: true, size: 24 }), ctx, { keepNext: true, spacing: { before: 160, after: 80 } }))
    } else if (li) {
      flush()
      out.push(para(inlineRuns(li[1], ctx), ctx, { bullet: { level: 0 } }))
    } else if (ol) {
      flush()
      out.push(para([run(`${ol[1]}. `, ctx), ...inlineRuns(ol[2], ctx)], ctx, { indent: { start: 360 } }))
    } else {
      buf.push(line)
    }
  }
  flush()
  return out
}

function table(header: string[], rows: string[][], ctx: Ctx): Table {
  const border = { style: BorderStyle.SINGLE, size: 4, color: RULE }
  const cell = (text: string, head: boolean) =>
    new TableCell({
      borders: { top: border, bottom: border, left: border, right: border },
      shading: head ? { type: ShadingType.CLEAR, color: "auto", fill: "F3F0E8" } : undefined,
      children: [para([run(text, ctx, { bold: head, size: 18 })], ctx)],
    })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    visuallyRightToLeft: ctx.rtl,
    rows: [
      new TableRow({ tableHeader: true, children: header.map((h) => cell(h, true)) }),
      ...rows.map((r) => new TableRow({ children: header.map((_, i) => cell(r[i] ?? "", false)) })),
    ],
  })
}

function fmt(n: number, locale: string) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US", { maximumFractionDigits: 2 }).format(n)
}

function mapParts(parts: ScreenPart[]): MapPart[] {
  return parts.flatMap((p) => (p.type === "map" ? [p] : p.type === "split" ? mapParts([...p.left, ...p.right]) : []))
}

export type DocxLabels = { marker?: string; kind?: string; label?: string; status?: string; data: string; step?: string; details?: string; owner?: string; next?: string; part?: string; contents?: string }

function multiline(text: string, ctx: Ctx, head = false) {
  return text.split("\n").map((line) => para([run(line, ctx, { bold: head, size: 18 })], ctx))
}

function block(b: Block, ctx: Ctx, labels: DocxLabels): (Paragraph | Table)[] {
  switch (b.type) {
    case "markdown":
      return markdownParagraphs(b.text, ctx)
    case "table":
      return [
        table(b.columns, b.rows, ctx),
        ...(b.caption ? [para([run(b.caption, ctx, { size: 16, color: MUTED })], ctx, { spacing: { after: 160 } })] : []),
      ]
    case "callout": {
      const fill = { info: "E8F0FB", success: "E6F3E6", warning: "FBF1DC", danger: "FBE6E6" }[b.tone]
      const shading = { type: ShadingType.CLEAR, color: "auto", fill }
      const text = b.text.replace(/\s*\n\s*/g, " ").replace(/^[-*+]\s+/, "")
      return [
        ...(b.title ? [para([run(b.title, ctx, { bold: true })], ctx, { shading, keepNext: true })] : []),
        para(inlineRuns(text, ctx), ctx, { shading, spacing: { after: 160 } }),
      ]
    }
    case "chart": {
      const unit = b.unit ?? ""
      return [
        para([run(`${b.title ?? labels.data}`, ctx, { bold: true })], ctx, { keepNext: true, spacing: { before: 160, after: 80 } }),
        table(
          ["", ...b.series.map((s) => s.name)],
          b.labels.map((l, i) => [l, ...b.series.map((s) => (s.values[i] === undefined ? "" : fmt(s.values[i], ctx.locale) + unit))]),
          ctx,
        ),
        ...(b.caption ? [para([run(b.caption, ctx, { size: 16, color: MUTED })], ctx)] : []),
      ]
    }
    case "workflow": {
      const edges = workflowEdges(b)
      const rows = b.steps.map((st, i) => [
        `${i + 1}. ${st.title}`,
        st.text ?? "",
        st.owner ?? "",
        edges
          .filter((e) => e.from === i)
          .map((e) => `→ ${b.steps[e.to].title}${e.label ? ` (${e.label})` : ""}`)
          .join("\n"),
      ])
      return [
        ...(b.title ? [para([run(b.title, ctx, { bold: true })], ctx, { keepNext: true, spacing: { before: 160, after: 80 } })] : []),
        ...(b.body ? markdownParagraphs(b.body, ctx) : []),
        tableML([labels.step ?? "Step", labels.details ?? "Details", labels.owner ?? "Owner", labels.next ?? "Next"], rows, ctx),
        ...(b.caption ? [para([run(b.caption, ctx, { size: 16, color: MUTED })], ctx, { spacing: { after: 160 } })] : []),
      ]
    }
    case "screen":
      return [
        para([run(b.title ?? b.screen_title ?? b.url ?? "", ctx, { bold: true })], ctx, { keepNext: true, spacing: { before: 160, after: 80 } }),
        tableML(
          [labels.part ?? "Part", labels.contents ?? "Contents"],
          [
            ...b.parts.map((p, i) => [`${i + 1}. ${p.type}`, partSummary(p)]),
            ...(b.annotations ?? []).map((a, i) => [`(${i + 1}) → ${a.target_part_index + 1}`, a.text]),
          ],
          ctx,
        ),
        // A map becomes a table of its markers.
        ...mapParts(b.parts).map((m) =>
          tableML(
            [labels.marker ?? "Marker", labels.kind ?? "Kind", labels.label ?? "Label", labels.status ?? "Status"],
            m.markers.map((mk) => [mk.id, mk.kind, mk.label ?? "", mk.status ?? ""]),
            ctx,
          ),
        ),
        ...(b.caption ? [para([run(b.caption, ctx, { size: 16, color: MUTED })], ctx, { spacing: { after: 160 } })] : []),
      ]
  }
}

/** A table whose cells may hold several lines. */
function tableML(header: string[], rows: string[][], ctx: Ctx): Table {
  const border = { style: BorderStyle.SINGLE, size: 4, color: RULE }
  const cell = (text: string, head: boolean) =>
    new TableCell({
      borders: { top: border, bottom: border, left: border, right: border },
      shading: head ? { type: ShadingType.CLEAR, color: "auto", fill: "F3F0E8" } : undefined,
      children: multiline(text, ctx, head),
    })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    visuallyRightToLeft: ctx.rtl,
    rows: [
      new TableRow({ tableHeader: true, children: header.map((h) => cell(h, true)) }),
      ...rows.map((r) => new TableRow({ children: header.map((_, i) => cell(r[i] ?? "", false)) })),
    ],
  })
}

export async function reportDocx(
  content: ReportContent,
  meta: { locale: "en" | "ar"; customer: string; company: string },
  labels: { preparedFor: string; summary: string } & DocxLabels,
): Promise<Buffer> {
  const ctx: Ctx = { rtl: meta.locale === "ar", locale: meta.locale }
  const who = [meta.customer, meta.company].filter(Boolean).join(" · ")
  const children: (Paragraph | Table)[] = [
    para([run(content.title, ctx, { bold: true, size: 44 })], ctx, { heading: HeadingLevel.TITLE, spacing: { after: 80 } }),
    ...(content.subtitle ? [para([run(content.subtitle, ctx, { size: 24, color: MUTED })], ctx)] : []),
    ...(who ? [para([run(`${labels.preparedFor}: ${who}`, ctx, { size: 20, color: MUTED })], ctx, { spacing: { after: 240 } })] : []),
  ]
  const heading = (text: string) =>
    para([run(text, ctx, { bold: true, size: 30 })], ctx, {
      heading: HeadingLevel.HEADING_1,
      keepNext: true,
      spacing: { before: 320, after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 4 } },
    })
  if (content.summary) children.push(heading(labels.summary), ...markdownParagraphs(content.summary, ctx))
  for (const s of content.sections) {
    children.push(heading(s.heading))
    for (const b of s.blocks) children.push(...block(b, ctx, labels))
  }
  const doc = new Document({
    creator: "Zekra",
    title: content.title,
    styles: { default: { document: { run: { font: FONT, size: 21, color: INK } } } },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children }],
  })
  return Packer.toBuffer(doc)
}
