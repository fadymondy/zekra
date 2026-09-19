/*
Print HTML for the PDF exports (FM-343 decks, FM-344 reports).

Pure string builders so they can be tested without a browser; the route hands
the result to Chromium (lib/cv-pdf.ts, the same engine and font as the CV).
Every value is escaped; markdown is rendered by the caller-supplied `md`
(react-markdown on the server, no raw HTML). Speaker notes are never read.

Decks: one landscape 16:9 page per slide. Reports: A4, headings in document
order, each chart drawn as SVG AND followed by its data table (the palette's
light slots 3–5 are under 3:1 on white, so values must be readable without
colour — the dataviz relief rule).
*/
import { BLOCK_CSS, embedShotHTML, screenHTML, workflowHTML, type IconFn } from "./export-blocks.ts"
import { bulletIcon, bulletText, type Block, type ChartBlock, type DeckContent, type PageContent, type ReportContent, type Slide } from "./types.ts"

export type MdRenderer = (markdown: string) => string

/** Print palette: the light steps of the validated series palette. */
export const PRINT_SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"]

const INK = "#0e1a3c"
const MUTED = "#5d6270"
const RULE = "#d9d3c7"
const BRAND = "#e2661c"

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Only http(s) and site paths reach an src; anything else is dropped. */
export function safeSrc(url: string, origin: string): string {
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith("/") && !url.startsWith("//")) return origin + url
  return ""
}

type Doc = { locale: "en" | "ar"; title: string; customer: string; company: string; fontCss: string; origin: string }

function shell(doc: Doc, pageCss: string, body: string): string {
  const rtl = doc.locale === "ar"
  return `<!doctype html>
<html lang="${doc.locale}" dir="${rtl ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>${esc(doc.title)}</title>
<style>
${doc.fontCss}
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: "Print Readex", sans-serif; color: ${INK}; line-height: 1.5;
    font-feature-settings: "rlig" 0, "liga" 0, "clig" 0, "dlig" 0; }
  bdi { unicode-bidi: isolate; }
  pre, code { font-family: ui-monospace, Consolas, monospace; direction: ltr; text-align: left; unicode-bidi: isolate; }
  a { color: inherit; }
${pageCss}
</style>
</head>
<body>
${body}
</body>
</html>`
}

/** FM-346: code scenes cannot run in a PDF or Word file; say so instead. */
export const INTERACTIVE_PLACEHOLDER = { en: "Interactive scene — open the link", ar: "مشهد تفاعلي — افتح الرابط" } as const

export function hasCodeScene(page: PageContent): boolean {
  return page.sections.some((s) => (s.type === "hero" || s.type === "scene") && s.scene?.type === "code")
}

export function interactivePlaceholder(locale: "en" | "ar"): string {
  return `<p class="interactive">${esc(INTERACTIVE_PLACEHOLDER[locale] ?? INTERACTIVE_PLACEHOLDER.en)}</p>`
}

// ---- deck -----------------------------------------------------------------------

/** Print options: icons as SVG strings, and where an embedded page lives (FM-341 polish). */
export type DeckPrintOptions = { icon?: IconFn; embedLink?: (documentId: string) => string | undefined }

const OPEN_PAGE = { en: "Open the page", ar: "افتح الصفحة" } as const

function slideBody(slide: Slide, md: MdRenderer, doc: Doc, embeds: Record<string, { content: PageContent }>, opts: DeckPrintOptions): string {
  const h = (t?: string) => (t ? `<h2>${esc(t)}</h2>` : "")
  const icon: IconFn = opts.icon ?? (() => "")
  const ic = (name?: string, cls = "pi") => {
    const svg = name ? icon(name) : ""
    return svg ? `<span class="${cls}">${svg}</span>` : ""
  }
  switch (slide.type) {
    case "title":
      return `<div class="center">${ic(slide.icon, "pi big")}${slide.eyebrow ? `<p class="eyebrow">${esc(slide.eyebrow)}</p>` : ""}<h1>${esc(slide.title)}</h1>${
        slide.subtitle ? `<p class="sub">${esc(slide.subtitle)}</p>` : ""
      }</div>`
    case "bullets":
      return `${h(slide.title)}<ul class="bullets">${slide.bullets
        .map((b) => {
          const i = ic(bulletIcon(b))
          return `<li${i ? ' class="has-icon"' : ""}>${i}<span>${esc(bulletText(b))}</span></li>`
        })
        .join("")}</ul>`
    case "image": {
      const src = safeSrc(slide.image_url, doc.origin)
      return `${h(slide.title)}<figure>${src ? `<img src="${esc(src)}" alt="${esc(slide.alt)}">` : ""}${
        slide.caption ? `<figcaption>${esc(slide.caption)}</figcaption>` : ""
      }</figure>`
    }
    case "quote":
      return `<blockquote><p>“${esc(slide.quote)}”</p>${
        slide.author ? `<footer>${esc(slide.author)}${slide.role ? ` · ${esc(slide.role)}` : ""}</footer>` : ""
      }</blockquote>`
    case "metric":
      return `${h(slide.title)}<div class="metrics">${slide.metrics
        .map(
          (m) =>
            `<div class="metric">${ic(m.icon, "pi end")}<div class="value"><bdi>${esc(m.value)}</bdi></div><div class="label">${esc(m.label)}</div>${
              m.delta ? `<div class="delta">${m.trend === "up" ? "▲" : m.trend === "down" ? "▼" : "•"} <bdi>${esc(m.delta)}</bdi></div>` : ""
            }</div>`,
        )
        .join("")}</div>`
    case "two_column": {
      const col = (c: { heading?: string; icon?: string; body?: string; bullets?: string[] }) =>
        `<div class="col">${c.heading ? `<h3>${ic(c.icon)}${esc(c.heading)}</h3>` : ""}${c.body ? `<div class="md">${md(c.body)}</div>` : ""}${
          c.bullets?.length ? `<ul>${c.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""
        }</div>`
      return `${h(slide.title)}<div class="cols">${col(slide.left)}${col(slide.right)}</div>`
    }
    case "code":
      return `${h(slide.title)}<pre><code>${esc(slide.code)}</code></pre>`
    case "workflow":
      return `${h(slide.title)}${workflowHTML({ ...slide, title: undefined, body: undefined }, doc.locale, icon)}`
    case "screen":
      return `${h(slide.title)}<div class="screen-fit">${screenHTML(slide, doc.locale, icon, doc.origin, { title: false })}</div>`
    case "embed": {
      const page = embeds[slide.document_id]?.content
      if (!page) return h(slide.title)
      return `${h(slide.title || page.title)}${embedShotHTML(page, icon, {
        link: opts.embedLink?.(slide.document_id),
        linkLabel: OPEN_PAGE[doc.locale] ?? OPEN_PAGE.en,
        placeholder: hasCodeScene(page) ? INTERACTIVE_PLACEHOLDER[doc.locale] : undefined,
      })}`
    }
  }
}

export function deckPrintHTML(
  content: DeckContent,
  doc: Doc,
  md: MdRenderer,
  embeds: Record<string, { content: PageContent }> = {},
  opts: DeckPrintOptions = {},
): string {
  const total = content.slides.length
  const footer = [doc.company || doc.customer, content.title].filter(Boolean).map(esc).join(" · ")
  const slides = content.slides
    .map(
      (s, i) => `<section class="slide slide-${esc(s.type)}">
  <div class="body">${slideBody(s, md, doc, embeds, opts)}</div>
  <footer class="foot"><span>${footer}</span><span><bdi>${i + 1} / ${total}</bdi></span></footer>
</section>`,
    )
    .join("\n")
  const css = `
  @page { size: 297mm 167.06mm; margin: 0; }
  .slide { width: 297mm; height: 167.06mm; padding: 14mm 18mm 12mm; position: relative; display: flex; flex-direction: column;
    break-after: page; overflow: hidden; border-top: 3mm solid ${BRAND}; }
  .slide:last-child { break-after: auto; }
  .body { flex: 1; display: flex; flex-direction: column; justify-content: center; min-height: 0; }
  .center { text-align: center; }
  h1 { font-size: 34pt; line-height: 1.1; margin: 0; }
  h2 { font-size: 22pt; margin: 0 0 6mm; line-height: 1.15; }
  h3 { font-size: 14pt; margin: 0 0 2mm; }
  .eyebrow { color: ${BRAND}; font-size: 10pt; text-transform: uppercase; letter-spacing: .08em; margin: 0 0 3mm; }
  html[dir=rtl] .eyebrow { text-transform: none; letter-spacing: 0; }
  .sub { color: ${MUTED}; font-size: 15pt; margin: 4mm 0 0; }
  .bullets { font-size: 15pt; margin: 0; padding-inline-start: 7mm; }
  .bullets li { margin: 0 0 2.5mm; }
  figure { margin: 0; text-align: center; min-height: 0; }
  img { max-width: 100%; max-height: 95mm; object-fit: contain; }
  figcaption { color: ${MUTED}; font-size: 10pt; margin-top: 2mm; }
  blockquote { margin: 0 auto; max-width: 220mm; text-align: center; }
  blockquote p { font-size: 24pt; line-height: 1.3; margin: 0; }
  blockquote footer { color: ${MUTED}; margin-top: 5mm; font-size: 12pt; }
  .metrics { display: flex; gap: 6mm; }
  .metric { flex: 1; border: .75pt solid ${RULE}; border-radius: 3mm; padding: 6mm; }
  .metric .value { font-size: 28pt; font-weight: 700; line-height: 1.1; }
  .metric .label { color: ${MUTED}; font-size: 11pt; margin-top: 2mm; }
  .metric .delta { font-size: 11pt; margin-top: 2mm; }
  .cols { display: flex; gap: 10mm; font-size: 12pt; }
  .col { flex: 1; }
  pre { background: #f5f2ea; border: .75pt solid ${RULE}; border-radius: 2mm; padding: 5mm; font-size: 10.5pt; white-space: pre-wrap; margin: 0; }
  .embed { border: .75pt solid ${RULE}; border-radius: 3mm; padding: 7mm; }
  .interactive { margin-top: 4mm; padding: 3mm 4mm; border: .75pt dashed ${RULE}; border-radius: 2mm; color: ${MUTED}; }
  .foot { display: flex; justify-content: space-between; color: ${MUTED}; font-size: 8.5pt; border-top: .75pt solid ${RULE}; padding-top: 2.5mm; }
  .md p { margin: 0 0 2mm; }
  .pi { display: inline-flex; width: 1.1em; height: 1.1em; color: ${BRAND}; vertical-align: -0.15em; margin-inline-end: 2mm; }
  .pi svg { width: 100%; height: 100%; }
  .pi.big { width: 16mm; height: 16mm; margin: 0 auto 5mm; display: flex; padding: 3mm; border: .75pt solid ${RULE}; border-radius: 4mm; }
  .pi.end { float: inline-end; width: 7mm; height: 7mm; margin: 0; }
  .bullets li.has-icon { list-style: none; margin-inline-start: -7mm; display: flex; gap: 2.5mm; align-items: baseline; }
  .bullets li.has-icon .pi { margin: 0; }
  .slide-workflow svg.wf { max-height: 110mm; }
  .slide-screen .part { font-size: 10pt; }
  .slide-screen .body, .slide-embed .body { justify-content: flex-start; }
  .slide-embed .shot { max-height: 108mm; }
${BLOCK_CSS}`
  return shell(doc, css, slides)
}

// ---- report ---------------------------------------------------------------------

const NICE = [1, 2, 2.5, 5, 10]

/** A clean axis maximum (0 / 1,000 / 2,000 …), never below the data. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(value)))
  const f = value / exp
  return (NICE.find((n) => n >= f) ?? 10) * exp
}

export function fmt(n: number, locale: string): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US", { maximumFractionDigits: 2 }).format(n)
}

/** A static SVG of a chart block, for print. One axis, thin marks, legend for ≥2 series. */
export function chartSVG(block: ChartBlock, locale: "en" | "ar"): string {
  const W = 640
  const H = 260
  const pad = { top: 12, right: 12, bottom: 34, left: 52 }
  const iw = W - pad.left - pad.right
  const ih = H - pad.top - pad.bottom
  const series = block.series.slice(0, PRINT_SERIES.length)
  const n = block.labels.length
  const stacked = block.chart === "stacked_bar"
  const totals = block.labels.map((_, i) => series.reduce((s, x) => s + Math.max(0, x.values[i] ?? 0), 0))
  const peak = stacked ? Math.max(...totals) : Math.max(...series.flatMap((s) => s.values))
  const max = niceMax(peak)
  const y = (v: number) => pad.top + ih - (Math.max(0, v) / max) * ih
  const band = iw / n
  const rtl = locale === "ar"
  const xAt = (i: number) => (rtl ? pad.left + iw - band * (i + 0.5) : pad.left + band * (i + 0.5))
  const parts: string[] = []
  for (let t = 0; t <= 4; t++) {
    const v = (max / 4) * t
    parts.push(
      `<line x1="${pad.left}" x2="${W - pad.right}" y1="${y(v)}" y2="${y(v)}" stroke="#e6e1d6" stroke-width="1"/>`,
      `<text x="${pad.left - 6}" y="${y(v) + 3}" text-anchor="end" font-size="9" fill="${MUTED}">${esc(fmt(v, locale))}${esc(block.unit ?? "")}</text>`,
    )
  }
  block.labels.forEach((l, i) =>
    parts.push(`<text x="${xAt(i)}" y="${H - pad.bottom + 16}" text-anchor="middle" font-size="9" fill="${MUTED}">${esc(l)}</text>`),
  )
  if (block.chart === "bar" || stacked) {
    const groups = stacked ? 1 : series.length
    const bw = Math.min(24, (band * 0.7) / groups)
    block.labels.forEach((_, i) => {
      let base = 0
      series.forEach((s, si) => {
        const v = Math.max(0, s.values[i] ?? 0)
        const x = stacked ? xAt(i) - bw / 2 : xAt(i) - (groups * bw) / 2 + si * bw
        const top = y(base + v)
        const bottom = y(base)
        const hgt = Math.max(0, bottom - top - (stacked && si > 0 ? 2 : 0))
        parts.push(`<rect x="${x + 1}" y="${top}" width="${bw - 2}" height="${hgt}" rx="2" fill="${PRINT_SERIES[si]}"/>`)
        if (stacked) base += v
      })
    })
  } else {
    series.forEach((s, si) => {
      const pts = s.values.slice(0, n).map((v, i) => `${xAt(i)},${y(v)}`)
      if (block.chart === "area") {
        parts.push(
          `<polygon points="${xAt(0)},${y(0)} ${pts.join(" ")} ${xAt(Math.min(n, s.values.length) - 1)},${y(0)}" fill="${PRINT_SERIES[si]}" fill-opacity="0.1"/>`,
        )
      }
      parts.push(
        `<polyline points="${pts.join(" ")}" fill="none" stroke="${PRINT_SERIES[si]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
      )
      const last = s.values.slice(0, n).length - 1
      if (last >= 0) {
        parts.push(`<circle cx="${xAt(last)}" cy="${y(s.values[last])}" r="4" fill="${PRINT_SERIES[si]}" stroke="#fff" stroke-width="2"/>`)
      }
    })
  }
  parts.push(`<line x1="${pad.left}" x2="${W - pad.right}" y1="${y(0)}" y2="${y(0)}" stroke="#bdb6a8" stroke-width="1"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(block.title ?? "")}">${parts.join("")}</svg>`
}

function legend(block: ChartBlock): string {
  if (block.series.length < 2) return ""
  return `<p class="legend">${block.series
    .slice(0, PRINT_SERIES.length)
    .map((s, i) => `<span><i style="background:${PRINT_SERIES[i]}"></i>${esc(s.name)}</span>`)
    .join("")}</p>`
}

export function chartTable(block: ChartBlock, locale: "en" | "ar"): string {
  return `<table class="data"><thead><tr><th></th>${block.series.map((s) => `<th>${esc(s.name)}</th>`).join("")}</tr></thead><tbody>${block.labels
    .map(
      (l, i) =>
        `<tr><th>${esc(l)}</th>${block.series
          .map((s) => `<td>${s.values[i] === undefined ? "" : `<bdi>${esc(fmt(s.values[i], locale))}${esc(block.unit ?? "")}</bdi>`}</td>`)
          .join("")}</tr>`,
    )
    .join("")}</tbody></table>`
}

function blockHTML(block: Block, md: MdRenderer, locale: "en" | "ar", icon: IconFn, origin: string): string {
  switch (block.type) {
    case "markdown":
      return `<div class="md">${md(block.text)}</div>`
    case "table":
      return `<table><thead><tr>${block.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${block.rows
        .map((r) => `<tr>${block.columns.map((_, i) => `<td>${esc(r[i] ?? "")}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>${block.caption ? `<p class="caption">${esc(block.caption)}</p>` : ""}`
    case "callout":
      return `<aside class="callout ${esc(block.tone)}">${block.title ? `<strong>${esc(block.title)}</strong>` : ""}<div class="md">${md(block.text)}</div></aside>`
    case "chart":
      return `<figure class="chart">${block.title ? `<figcaption class="ct">${esc(block.title)}</figcaption>` : ""}${legend(block)}${chartSVG(
        block,
        locale,
      )}${chartTable(block, locale)}${block.caption ? `<p class="caption">${esc(block.caption)}</p>` : ""}</figure>`
    case "workflow":
      return workflowHTML(block, locale, icon, md)
    case "screen":
      return screenHTML(block, locale, icon, origin)
  }
}

export function reportPrintHTML(
  content: ReportContent,
  doc: Doc,
  md: MdRenderer,
  labels: { preparedFor: string; summary: string },
  opts: { icon?: IconFn } = {},
): string {
  const icon: IconFn = opts.icon ?? (() => "")
  const who = [doc.customer, doc.company].filter(Boolean).map(esc).join(" · ")
  const body = `<header class="cover">
  <div class="band"></div>
  <h1>${esc(content.title)}</h1>
  ${content.subtitle ? `<p class="sub">${esc(content.subtitle)}</p>` : ""}
  ${who ? `<p class="for">${esc(labels.preparedFor)}: ${who}</p>` : ""}
</header>
${content.summary ? `<section><h2>${esc(labels.summary)}</h2><div class="md">${md(content.summary)}</div></section>` : ""}
${content.sections
  .map((s) => `<section><h2>${esc(s.heading)}</h2>${s.blocks.map((b) => blockHTML(b, md, doc.locale, icon, doc.origin)).join("\n")}</section>`)
  .join("\n")}`
  const css = `
  @page { size: A4; margin: 16mm 17mm 18mm; }
  body { font-size: 10.5pt; }
  .band { height: 3mm; background: ${BRAND}; margin-bottom: 8mm; }
  h1 { font-size: 24pt; line-height: 1.15; margin: 0; }
  .sub { color: ${MUTED}; font-size: 13pt; margin: 2mm 0 0; }
  .for { color: ${MUTED}; margin: 4mm 0 0; }
  .cover { border-bottom: .75pt solid ${RULE}; padding-bottom: 6mm; margin-bottom: 4mm; }
  h2 { font-size: 15pt; margin: 9mm 0 3mm; padding-bottom: 1.5mm; border-bottom: .75pt solid ${RULE}; break-after: avoid; }
  .md p { margin: 0 0 3mm; }
  .md ul, .md ol { margin: 0 0 3mm; padding-inline-start: 6mm; }
  table { width: 100%; border-collapse: collapse; margin: 3mm 0; break-inside: avoid; }
  th, td { border-bottom: .75pt solid ${RULE}; padding: 1.8mm 2mm; text-align: start; vertical-align: top; }
  thead th { font-weight: 600; border-bottom: 1.2pt solid ${INK}; }
  .caption { color: ${MUTED}; font-size: 9pt; margin: 1mm 0 3mm; }
  .callout { border-inline-start: 1.2mm solid; border-radius: 1mm; padding: 3mm 4mm; margin: 3mm 0; break-inside: avoid; background: #f7f5f0; }
  .callout strong { display: block; margin-bottom: 1mm; }
  .callout.info { border-color: #2a78d6; } .callout.success { border-color: #008300; }
  .callout.warning { border-color: #c98500; } .callout.danger { border-color: #d03b3b; }
  .chart { margin: 4mm 0; break-inside: avoid; }
  .ct { font-weight: 600; margin-bottom: 1mm; }
  .legend { margin: 0 0 1mm; font-size: 9pt; color: ${MUTED}; display: flex; gap: 4mm; flex-wrap: wrap; }
  .legend i { display: inline-block; width: 3mm; height: 3mm; border-radius: .6mm; margin-inline-end: 1.2mm; vertical-align: -.3mm; }
  table.data { font-size: 9pt; }
  .wf-block .ct, .screen-block .ct { font-weight: 600; margin-bottom: 1.5mm; }
  .screen-block table.st { margin: 0; }
${BLOCK_CSS}`
  return shell(doc, css, body)
}
