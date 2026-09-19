/*
Print HTML for the FM-350 blocks and the embed first screen (FM-341 polish).

Pure string builders (tested under node): a workflow is a static SVG (same
connector geometry as the live view), a screen is static HTML in a device
frame, and an embedded page is its first screen drawn as HTML plus the link as
text. Icons come in as SVG strings from the caller (the server renders the
same lucide set the site uses); tests pass a stub. Every value is escaped.
*/
import type { PageContent, ScreenBlock, ScreenPart, Tone, WorkflowBlock } from "./types.ts"
import { connector, rowsFor, workflowEdges, type Box } from "./workflow.ts"
import { MARKER_ICON, PRINT_PALETTE as MP, cityFor, markerColor, pt, routePath, routePoints } from "./map.ts"
import type { MapPart } from "./types.ts"

export type IconFn = (name?: string) => string

const INK = "#0e1a3c"
const MUTED = "#5d6270"
const RULE = "#d9d3c7"
const BRAND = "#e2661c"
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"]

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** The children of a lucide <svg>, re-wrapped at a position and size inside another SVG. */
function iconInSVG(svg: string, x: number, y: number, size: number, color: string): string {
  const open = svg.indexOf(">")
  const close = svg.lastIndexOf("</svg>")
  if (open < 0 || close < 0) return ""
  const inner = svg.slice(open + 1, close)
  const s = size / 24
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`
}

/** Break text into lines of about `per` characters (words kept whole where possible). */
function wrap(text: string, per: number, max: number): string[] {
  const words = String(text).split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ""
  for (const w of words) {
    if ((cur + " " + w).trim().length > per && cur) {
      lines.push(cur)
      cur = w
    } else {
      cur = (cur + " " + w).trim()
    }
  }
  if (cur) lines.push(cur)
  if (lines.length > max) {
    const kept = lines.slice(0, max)
    kept[max - 1] = kept[max - 1].replace(/.?$/, "…")
    return kept
  }
  return lines
}

const KIND_FILL: Record<string, string> = {
  step: "#ffffff",
  decision: "#fff8e6",
  human_review: "#ffffff",
  system: "#f3f1ec",
  output: "#fdf0e8",
}

/** A workflow as a static SVG, right-to-left in Arabic, wrapped into rows. */
export function workflowSVG(block: WorkflowBlock, locale: "en" | "ar", icon: IconFn, opts: { width?: number; perRow?: number } = {}): string {
  const rtl = locale === "ar"
  const W = opts.width ?? 640
  const n = block.steps.length
  const vertical = block.layout === "vertical"
  const rows = vertical ? block.steps.map(() => 1) : rowsFor(n, opts.perRow ?? (n <= 5 ? 5 : 4))
  const gapX = 26
  const gapY = 34
  const nodeH = 88
  const maxPer = Math.max(...rows)
  const nodeW = vertical ? Math.min(300, W) : (W - gapX * (maxPer - 1)) / maxPer
  const boxes: Box[] = []
  let idx = 0
  rows.forEach((count, r) => {
    const rowW = count * nodeW + (count - 1) * gapX
    const x0 = (W - rowW) / 2
    for (let c = 0; c < count; c++) {
      const pos = rtl ? count - 1 - c : c
      boxes[idx++] = { x: x0 + pos * (nodeW + gapX), y: 24 + r * (nodeH + gapY), w: nodeW, h: nodeH }
    }
  })
  const H = 24 + rows.length * (nodeH + gapY) - gapY + 12
  const parts: string[] = []
  parts.push(
    `<defs><marker id="wfa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#9a9488"/></marker>` +
      `<marker id="wfh" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${BRAND}"/></marker></defs>`,
  )
  const labels: string[] = []
  for (const e of workflowEdges(block)) {
    const c = connector(boxes[e.from], boxes[e.to])
    const hot = !!block.highlight && (block.steps[e.from].id === block.highlight || block.steps[e.to].id === block.highlight)
    parts.push(
      `<path d="${c.d}" fill="none" stroke="${hot ? BRAND : "#9a9488"}" stroke-width="${hot ? 1.8 : 1.3}" marker-end="url(#${hot ? "wfh" : "wfa"})"/>`,
    )
    if (e.label) {
      const w = Math.min(120, 10 + e.label.length * 5.4)
      labels.push(
        `<g><rect x="${c.mid.x - w / 2}" y="${c.mid.y - 8}" width="${w}" height="16" rx="8" fill="#fff" stroke="${RULE}"/>` +
          `<text x="${c.mid.x}" y="${c.mid.y + 3.5}" text-anchor="middle" font-size="10" fill="${MUTED}">${esc(e.label)}</text></g>`,
      )
    }
  }
  // "start" follows the text direction: the right edge in Arabic.
  const anchor = "start"
  block.steps.forEach((s, i) => {
    const b = boxes[i]
    const kind = s.kind ?? "step"
    const hi = s.id === block.highlight
    parts.push(
      `<g data-step="${esc(s.id)}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="9" fill="${KIND_FILL[kind] ?? "#fff"}" stroke="${
        hi ? BRAND : kind === "output" ? "#f0b48f" : RULE
      }" stroke-width="${hi ? 2 : 1}"${kind === "human_review" ? ' stroke-dasharray="4 3"' : ""}/>`,
    )
    const ix = rtl ? b.x + b.w - 30 : b.x + 8
    parts.push(`<rect x="${ix}" y="${b.y + 8}" width="22" height="22" rx="6" fill="${kind === "output" ? BRAND : "#f3f1ec"}"/>`)
    const svg = icon(s.icon ?? (kind === "decision" ? "git-branch" : kind === "human_review" ? "user-check" : kind === "system" ? "cpu" : undefined))
    if (svg) parts.push(iconInSVG(svg, ix + 4, b.y + 12, 14, kind === "output" ? "#ffffff" : BRAND))
    const tx = rtl ? b.x + b.w - 36 : b.x + 36
    const per = Math.max(8, Math.floor((b.w - 44) / 7.2))
    const title = wrap(s.title, per, 2)
    title.forEach((line, li) =>
      parts.push(
        `<text x="${tx}" y="${b.y + 22 + li * 14}" text-anchor="${anchor}" font-size="12" font-weight="600" fill="${INK}" direction="${rtl ? "rtl" : "ltr"}">${esc(line)}</text>`,
      ),
    )
    const tx2 = rtl ? b.x + b.w - 8 : b.x + 8
    let y = b.y + 22 + title.length * 14 + 4
    if (s.text) {
      wrap(s.text, Math.floor((b.w - 16) / 6), 2).forEach((line) => {
        parts.push(`<text x="${tx2}" y="${y}" text-anchor="${anchor}" font-size="10" fill="${MUTED}" direction="${rtl ? "rtl" : "ltr"}">${esc(line)}</text>`)
        y += 12
      })
    }
    if (s.owner) {
      parts.push(
        `<text x="${tx2}" y="${b.y + b.h - 7}" text-anchor="${anchor}" font-size="10" font-weight="600" fill="${BRAND}" direction="${rtl ? "rtl" : "ltr"}">${esc(s.owner)}</text>`,
      )
    }
    parts.push("</g>")
  })
  parts.push(...labels)
  return `<svg xmlns="http://www.w3.org/2000/svg" class="wf" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(block.title ?? "")}">${parts.join("")}</svg>`
}

export function workflowHTML(block: WorkflowBlock, locale: "en" | "ar", icon: IconFn, md?: (s: string) => string): string {
  return `<figure class="wf-block">${block.title ? `<figcaption class="ct">${esc(block.title)}</figcaption>` : ""}${
    block.body && md ? `<div class="md">${md(block.body)}</div>` : ""
  }${workflowSVG(block, locale, icon)}${block.caption ? `<p class="caption">${esc(block.caption)}</p>` : ""}</figure>`
}

// ---- screen ---------------------------------------------------------------------

const TONE: Record<Tone, string> = {
  neutral: "background:#f3f1ec;color:#5d6270",
  info: "background:#e8f0fb;color:#2a78d6",
  success: "background:#e5f3e5;color:#008300",
  warning: "background:#fdf3dc;color:#8a5a00",
  danger: "background:#fbe6e6;color:#b42323",
}

const badge = (text?: string, tone?: Tone) => (text ? `<span class="sb" style="${TONE[tone ?? "neutral"]}">${esc(text)}</span>` : "")

function miniChart(part: Extract<ScreenPart, { type: "chart" }>): string {
  const W = 260
  const H = 90
  if (part.chart === "donut") {
    const vals = part.series[0]?.values ?? []
    const total = vals.reduce((a, b) => a + Math.max(0, b), 0) || 1
    let a0 = -Math.PI / 2
    const segs = vals.map((v, i) => {
      const a1 = a0 + (Math.max(0, v) / total) * Math.PI * 2
      const large = a1 - a0 > Math.PI ? 1 : 0
      const r = 36
      const cx = 45
      const cy = 45
      const d = `M ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`
      a0 = a1
      return `<path d="${d}" fill="none" stroke="${SERIES[i % 6]}" stroke-width="14"/>`
    })
    const legend = part.labels
      .map((l, i) => `<text x="100" y="${16 + i * 13}" font-size="9" fill="${MUTED}"><tspan fill="${SERIES[i % 6]}">■</tspan> ${esc(l)}</text>`)
      .join("")
    return `<svg viewBox="0 0 ${W} ${H}" width="100%">${segs.join("")}${legend}</svg>`
  }
  const max = Math.max(1, ...part.series.flatMap((s) => s.values))
  const n = part.labels.length
  const band = W / n
  const out: string[] = []
  if (part.chart === "line") {
    part.series.forEach((s, si) => {
      const pts = s.values.slice(0, n).map((v, i) => `${band * (i + 0.5)},${H - 14 - (v / max) * (H - 24)}`)
      out.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${SERIES[si % 6]}" stroke-width="2"/>`)
    })
  } else {
    const g = part.series.length
    const bw = Math.min(16, (band * 0.7) / g)
    part.labels.forEach((_, i) =>
      part.series.forEach((s, si) => {
        const v = Math.max(0, s.values[i] ?? 0)
        const h = (v / max) * (H - 24)
        out.push(`<rect x="${band * (i + 0.5) - (g * bw) / 2 + si * bw}" y="${H - 14 - h}" width="${bw - 1}" height="${h}" rx="1.5" fill="${SERIES[si % 6]}"/>`)
      }),
    )
  }
  part.labels.forEach((l, i) => out.push(`<text x="${band * (i + 0.5)}" y="${H - 2}" text-anchor="middle" font-size="7.5" fill="${MUTED}">${esc(l)}</text>`))
  return `<svg viewBox="0 0 ${W} ${H}" width="100%">${out.join("")}</svg>`
}

/** A dispatch map as a static SVG (print): the same procedural city, zones, routes, markers and suggestion. */
export function mapSVG(part: MapPart, locale: "en" | "ar", icon: IconFn, portrait = false): string {
  const city = cityFor(part, part.height ?? (portrait ? "sm" : "md"), portrait)
  const out: string[] = [`<rect width="${city.w}" height="${city.h}" fill="${MP.bg}"/>`]
  const pk = city.park
  out.push(`<rect x="${pk.x}" y="${pk.y}" width="${pk.w}" height="${pk.h}" rx="14" fill="${MP.park}"/>`)
  out.push(`<path d="${city.river.d}" fill="none" stroke="${MP.river}" stroke-width="${city.river.width}" stroke-linecap="round"/>`)
  for (const st of city.streets) out.push(`<path d="${st.d}" stroke="${MP.casing}" stroke-width="${st.width + 3}" fill="none"/>`)
  for (const st of city.streets) out.push(`<path d="${st.d}" stroke="${MP.street}" stroke-width="${st.width}" fill="none"/>`)
  for (const z of part.zones ?? []) {
    const c = pt(city, z.x, z.y)
    const col = MP[z.tone ?? "info"]
    out.push(`<circle cx="${c.x}" cy="${c.y}" r="${(z.r / 100) * city.w}" fill="${col}" fill-opacity="0.1" stroke="${col}" stroke-opacity="0.55" stroke-width="2" stroke-dasharray="8 6"/>`)
    if (z.label) out.push(`<text x="${c.x}" y="${c.y - (z.r / 100) * city.w + 26}" text-anchor="middle" font-size="22" font-weight="700" fill="${MP.neutral}">${esc(z.label)}</text>`)
  }
  for (const r of part.routes ?? []) {
    const pts = routePoints(part, city, r)
    if (!pts) continue
    out.push(`<path data-route d="${routePath(pts)}" fill="none" stroke="${MP[r.tone ?? "info"]}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"${r.dashed ? ' stroke-dasharray="2 12"' : ""}/>`)
    if (r.label) {
      const m = pts[Math.floor(pts.length / 2)]
      const w = 16 + r.label.length * 11
      out.push(`<rect x="${m.x - w / 2}" y="${m.y - 15}" width="${w}" height="30" rx="15" fill="#fff" stroke="${MP.casing}"/><text x="${m.x}" y="${m.y + 7}" text-anchor="middle" font-size="19" fill="${MP.ink}">${esc(r.label)}</text>`)
    }
  }
  const byId = new Map(part.markers.map((m) => [m.id, m]))
  const sv = part.suggest && byId.get(part.suggest.vendor)
  const sd = part.suggest && byId.get(part.suggest.driver)
  if (sv && sd) {
    const a = pt(city, sd.x, sd.y)
    const b = pt(city, sv.x, sv.y)
    out.push(`<line data-suggest x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${MP.brand}" stroke-width="4" stroke-dasharray="10 8" stroke-linecap="round"/>`)
    out.push(`<circle cx="${a.x}" cy="${a.y}" r="34" fill="none" stroke="${MP.brand}" stroke-width="3" stroke-opacity="0.6"/>`)
  }
  for (const m of part.markers) {
    const c = pt(city, m.x, m.y)
    const col = markerColor(m, MP)
    const round = m.kind === "driver" || m.kind === "hub"
    const cy = round ? c.y : c.y - 30
    if (!round) out.push(`<path d="M ${c.x - 9} ${cy + 16} L ${c.x} ${c.y} L ${c.x + 9} ${cy + 16} Z" fill="${col}"/>`)
    out.push(`<circle data-marker="${esc(m.id)}" cx="${c.x}" cy="${cy}" r="20" fill="${col}" stroke="#fff" stroke-width="3"/>`)
    const svg = icon(MARKER_ICON[m.kind])
    if (svg) out.push(iconInSVG(svg, c.x - 11, cy - 11, 22, "#ffffff"))
    if (m.label) {
      const w = 14 + m.label.length * 10
      const ly = round ? c.y + 38 : c.y + 20
      out.push(`<rect x="${c.x - w / 2}" y="${ly - 17}" width="${w}" height="26" rx="6" fill="#fff" fill-opacity="0.95"/><text x="${c.x}" y="${ly + 2}" text-anchor="middle" font-size="18" font-weight="600" fill="${MP.ink}" direction="${locale === "ar" ? "rtl" : "ltr"}">${esc(m.label)}</text>`)
    }
  }
  if (sv && sd && part.suggest) {
    const a = pt(city, (sv.x + sd.x) / 2, (sv.y + sd.y) / 2 + 6)
    const text = [`${sd.label ?? sd.id} → ${sv.label ?? sv.id}`, [part.suggest.eta, part.suggest.distance].filter(Boolean).join(" · ")].filter(Boolean)
    const w = 40 + Math.max(...text.map((t) => t.length)) * 11
    out.push(`<g data-suggest-card><rect x="${a.x - w / 2}" y="${a.y}" width="${w}" height="${22 + text.length * 26}" rx="10" fill="#fff" stroke="${MP.brand}"/>${text
      .map((t, i) => `<text x="${a.x}" y="${a.y + 30 + i * 26}" text-anchor="middle" font-size="${i ? 18 : 20}" font-weight="${i ? 400 : 700}" fill="${i ? MP.neutral : MP.ink}" direction="${locale === "ar" ? "rtl" : "ltr"}">${esc(t)}</text>`)
      .join("")}</g>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="map" viewBox="0 0 ${city.w} ${city.h}" width="100%" role="img" aria-label="${esc(part.title ?? "")}" direction="ltr">${out.join("")}</svg>`
}

function mapLegend(part: MapPart, locale: "en" | "ar"): string {
  if (!part.legend) return ""
  const names: Record<string, [string, string]> = { driver: ["Driver", "مندوب"], vendor: ["Vendor", "متجر"], customer: ["Customer", "عميل"], hub: ["Hub", "مركز"] }
  const kinds = Array.from(new Set(part.markers.map((m) => m.kind)))
  return `<p class="legend">${kinds
    .map((k) => `<span><i style="background:${markerColor({ id: "", x: 0, y: 0, kind: k }, MP)}"></i>${esc(names[k][locale === "ar" ? 1 : 0])}</span>`)
    .join("")}</p>`
}

function partHTML(part: ScreenPart, icon: IconFn, origin: string, phone = false, locale: "en" | "ar" = "en"): string {
  const title = (t?: string) => (t ? `<p class="pt">${esc(t)}</p>` : "")
  const ic = (name?: string) => (name ? `<span class="si">${icon(name)}</span>` : "")
  switch (part.type) {
    case "map":
      return `<figure class="card mapc">${title(part.title)}${mapSVG(part, locale, icon, phone)}${mapLegend(part, locale)}</figure>`
    case "kpis":
      return `<div class="kpis">${part.items
        .map(
          (k) =>
            `<div class="kpi"><div class="kl">${esc(k.label)}${ic(k.icon)}</div><div class="kv"><bdi>${esc(k.value)}</bdi></div>${
              k.delta ? `<div class="kd">${k.trend === "up" ? "▲" : k.trend === "down" ? "▼" : "•"} <bdi>${esc(k.delta)}</bdi></div>` : ""
            }</div>`,
        )
        .join("")}</div>`
    case "table": {
      const st = part.rows.some((r) => r.status)
      if (phone) {
        return `${title(part.title)}${part.rows
          .map(
            (r) =>
              `<div class="prow"><div class="prh"><strong>${esc(r.cells[0] ?? "")}</strong>${badge(r.status, r.tone)}</div>${part.columns
                .slice(1)
                .map((c, j) => (r.cells[j + 1] ? `<div class="prc"><span>${esc(c)}</span><span>${esc(r.cells[j + 1])}</span></div>` : ""))
                .join("")}</div>`,
          )
          .join("")}`
      }
      return `${title(part.title)}<table class="st"><thead><tr>${part.columns.map((c) => `<th>${esc(c)}</th>`).join("")}${st ? "<th></th>" : ""}</tr></thead><tbody>${part.rows
        .map((r) => `<tr>${part.columns.map((_, j) => `<td>${esc(r.cells[j] ?? "")}</td>`).join("")}${st ? `<td>${badge(r.status, r.tone)}</td>` : ""}</tr>`)
        .join("")}</tbody></table>`
    }
    case "form":
      return `<div class="card">${title(part.title)}${part.fields
        .map(
          (f) =>
            `<div class="ff"><div class="fl">${esc(f.label)}</div><div class="fi ${f.state ?? ""}"><bdi>${esc(f.value || "—")}</bdi><span>${
              f.state === "ok" ? "✓" : f.state === "missing" ? "!" : f.state === "warning" ? "⚠" : ""
            }</span></div>${f.hint ? `<div class="fh">${esc(f.hint)}</div>` : ""}</div>`,
        )
        .join("")}${part.submit_label ? `<span class="btn">${esc(part.submit_label)}</span>` : ""}</div>`
    case "chart":
      return `<div class="card">${title(part.title)}${miniChart(part)}</div>`
    case "list":
    case "timeline":
      return `<div class="card">${title(part.title)}<ol class="${part.type}">${part.items
        .map(
          (it) =>
            `<li>${part.type === "list" ? ic(it.icon ?? "check") : '<i class="dot"></i>'}<div class="lt"><div>${esc(it.title)}</div>${
              it.meta ? `<small>${esc(it.meta)}</small>` : ""
            }</div>${badge(it.status, it.tone)}</li>`,
        )
        .join("")}</ol></div>`
    case "board":
      return `${title(part.title)}<div class="board">${part.columns
        .map(
          (c) =>
            `<div class="bc"><div class="bh">${esc(c.title)} <small>${c.cards?.length ?? 0}</small></div>${(c.cards ?? [])
              .map((k) => `<div class="bk">${ic(k.icon)}${esc(k.title)}${k.meta ? `<small>${esc(k.meta)}</small>` : ""}</div>`)
              .join("")}</div>`,
        )
        .join("")}</div>`
    case "split":
      return `<div class="split">${(["left", "right"] as const)
        .map(
          (s) =>
            `<div class="side">${(s === "left" ? part.left_label : part.right_label) ? `<span class="sb">${esc(s === "left" ? part.left_label : part.right_label)}</span>` : ""}${part[
              s
            ]
              .map((p) => partHTML(p, icon, origin, phone, locale))
              .join("")}</div>`,
        )
        .join("")}</div>`
    case "callout":
      return `<div class="co ${esc(part.tone)}">${part.title ? `<strong>${esc(part.title)}</strong> ` : ""}${esc(part.text)}</div>`
    case "image": {
      const src = /^https?:\/\//i.test(part.url) ? part.url : part.url.startsWith("/") && !part.url.startsWith("//") ? origin + part.url : ""
      return src ? `<figure class="card"><img src="${esc(src)}" alt="${esc(part.alt)}">${part.caption ? `<figcaption>${esc(part.caption)}</figcaption>` : ""}</figure>` : ""
    }
  }
}

const WIDE = new Set(["kpis", "table", "board", "split", "callout", "map"])

/** frame "app": a static portrait phone at a fixed size, with its notes beside it. */
export function phoneHTML(block: ScreenBlock, locale: "en" | "ar", icon: IconFn, origin: string, opts: { title?: boolean } = {}): string {
  const marks = new Map<number, number[]>()
  ;(block.annotations ?? []).forEach((a, i) => marks.set(a.target_part_index, [...(marks.get(a.target_part_index) ?? []), i + 1]))
  const nav = (block.nav ?? []).slice(0, 5)
  const tabs = nav.length && block.layout !== "none"
  const parts = block.parts
    .map(
      (p, i) =>
        `<div class="part">${partHTML(p, icon, origin, true, locale)}${
          marks.has(i) ? `<span class="marks">${marks.get(i)!.map((n) => `<b>${n}</b>`).join("")}</span>` : ""
        }</div>`,
    )
    .join("")
  const notes = block.annotations?.length
    ? `<ol class="notes">${block.annotations.map((a, i) => `<li><b>${i + 1}</b>${esc(a.text)}</li>`).join("")}</ol>`
    : ""
  return `<figure class="screen-block phone-block" dir="${locale === "ar" ? "rtl" : "ltr"}">${opts.title !== false && block.title ? `<figcaption class="ct">${esc(block.title)}</figcaption>` : ""}<div class="phone-row"><div class="phone"><div class="pstatus" dir="ltr"><span>9:41</span><span class="pisland"></span><span>▮▮▮ ▰</span></div>${
    block.screen_title || block.url ? `<div class="phead">${esc(block.screen_title || block.url)}</div>` : ""
  }<div class="pbody">${parts}</div>${
    tabs
      ? `<nav class="ptabs">${nav.map((n) => `<span class="${n.active ? "on" : ""}">${n.icon ? `<span class="si">${icon(n.icon)}</span>` : ""}${esc(n.label)}</span>`).join("")}</nav>`
      : ""
  }<div class="phome"><i></i></div></div>${notes}</div>${block.caption ? `<p class="caption">${esc(block.caption)}</p>` : ""}</figure>`
}

export function screenHTML(block: ScreenBlock, locale: "en" | "ar", icon: IconFn, origin: string, opts: { title?: boolean } = {}): string {
  if (block.frame === "app") return phoneHTML(block, locale, icon, origin, opts)
  const notes = new Map<number, number[]>()
  ;(block.annotations ?? []).forEach((a, i) => notes.set(a.target_part_index, [...(notes.get(a.target_part_index) ?? []), i + 1]))
  const nav = block.nav ?? []
  const layout = nav.length ? (block.layout ?? "none") : "none"
  const top =
    block.frame === "browser"
      ? `<div class="bar" dir="ltr"><i></i><i></i><i></i><span class="url">${esc(block.url || block.screen_title || "")}</span></div>`
      : block.frame === "desktop"
        ? `<div class="bar" dir="ltr"><i></i><i></i><i></i><span class="appname">${esc(block.screen_title || block.url || "")}</span></div>`
        : block.frame === "tablet"
          ? `<div class="tbar" dir="ltr"><span>9:41</span><span>▮▮▮ ▰</span></div>`
          : ""
  const navHTML = nav
    .map((n) => `<span class="${n.active ? "on" : ""}">${n.icon ? `<span class="si">${icon(n.icon)}</span>` : ""}${esc(n.label)}</span>`)
    .join("")
  const parts = block.parts
    .map(
      (p, i) =>
        `<div class="part${WIDE.has(p.type) ? " wide" : ""}">${partHTML(p, icon, origin, false, locale)}${
          notes.has(i) ? `<span class="marks">${notes.get(i)!.map((n) => `<b>${n}</b>`).join("")}</span>` : ""
        }</div>`,
    )
    .join("")
  const legend = block.annotations?.length
    ? `<ol class="notes">${block.annotations.map((a, i) => `<li><b>${i + 1}</b>${esc(a.text)}</li>`).join("")}</ol>`
    : ""
  return `<figure class="screen-block" dir="${locale === "ar" ? "rtl" : "ltr"}">${opts.title !== false && block.title ? `<figcaption class="ct">${esc(block.title)}</figcaption>` : ""}<div class="frame ${esc(block.frame)}">${top}<div class="sbody ${esc(layout)}">${
    layout === "sidebar" ? `<nav class="side-nav">${navHTML}</nav>` : layout === "topbar" ? `<nav class="top-nav">${navHTML}</nav>` : ""
  }<div class="parts">${parts}</div></div></div>${legend}${block.caption ? `<p class="caption">${esc(block.caption)}</p>` : ""}</figure>`
}

// ---- embed first screen -----------------------------------------------------------

export function embedShotHTML(page: PageContent, icon: IconFn, opts: { link?: string; linkLabel: string; placeholder?: string }): string {
  const hero = page.sections.find((s) => s.type === "hero")
  const feats = page.sections.find((s) => s.type === "features")
  const heading = hero && hero.type === "hero" ? hero.heading : page.title
  const body = hero && hero.type === "hero" ? hero.body : page.description
  const cta = hero && hero.type === "hero" ? hero.cta_label : undefined
  const cards =
    feats && feats.type === "features"
      ? `<div class="shot-feats">${feats.items
          .slice(0, 3)
          .map((it) => `<div class="shot-card">${it.icon ? `<span class="si">${icon(it.icon)}</span>` : ""}<strong>${esc(it.title)}</strong></div>`)
          .join("")}</div>`
      : ""
  return `<div class="shot"><div class="shot-bar"><i></i><i></i><i></i></div><div class="shot-hero">${
    hero && hero.type === "hero" && hero.eyebrow ? `<p class="eyebrow">${esc(hero.eyebrow)}</p>` : ""
  }<div class="shot-h">${esc(heading)}</div>${body ? `<p class="shot-b">${esc(body.replace(/[*_`#>]/g, ""))}</p>` : ""}${
    cta ? `<span class="btn">${esc(cta)}</span>` : ""
  }</div>${cards}${opts.placeholder ? `<p class="interactive">${esc(opts.placeholder)}</p>` : ""}</div>${
    opts.link ? `<p class="shot-link">${esc(opts.linkLabel)}: <a href="${esc(opts.link)}">${esc(opts.link)}</a></p>` : ""
  }`
}

/** CSS for everything above; shared by the deck and report print templates. */
export const BLOCK_CSS = `
  .wf-block, .screen-block { margin: 3mm 0; break-inside: avoid; }
  svg.wf { display: block; max-height: 120mm; }
  .screen-block .frame { border: .75pt solid ${RULE}; border-radius: 3mm; overflow: hidden; background: #fbfaf7; }
  .screen-block .frame.tablet { border: 3mm solid ${INK}; border-radius: 6mm; }
  .screen-block .bar { display: flex; align-items: center; gap: 1.2mm; padding: 1.6mm 2.5mm; background: #efece5; border-bottom: .75pt solid ${RULE}; font-size: 8.5pt; color: ${MUTED}; }
  .screen-block .bar i { width: 2mm; height: 2mm; border-radius: 50%; background: #d4cfc4; display: inline-block; }
  .screen-block .bar .url { margin: 0 auto; background: #fff; border: .75pt solid ${RULE}; border-radius: 3mm; padding: .4mm 4mm; }
  .screen-block .bar.app { font-weight: 600; color: ${INK}; }
  .sbody { display: flex; }
  .sbody.topbar { flex-direction: column; }
  .side-nav { width: 34mm; flex: none; border-inline-end: .75pt solid ${RULE}; padding: 2mm; display: flex; flex-direction: column; gap: .8mm; font-size: 8.5pt; color: ${MUTED}; }
  .top-nav { display: flex; gap: 2mm; padding: 1.4mm 2.5mm; border-bottom: .75pt solid ${RULE}; font-size: 8.5pt; color: ${MUTED}; }
  .side-nav span, .top-nav span { display: flex; align-items: center; gap: 1mm; padding: .6mm 1.2mm; border-radius: 1mm; }
  .side-nav .on, .top-nav .on { background: #fff; color: ${INK}; font-weight: 600; }
  .parts { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 2.4mm; padding: 2.8mm; min-width: 0; }
  .part { position: relative; min-width: 0; font-size: 9.5pt; }
  .part.wide { grid-column: span 2; }
  .marks { position: absolute; top: -1.6mm; inset-inline-end: -1mm; display: flex; gap: .6mm; }
  .marks b, .notes b { display: inline-flex; align-items: center; justify-content: center; width: 4mm; height: 4mm; border-radius: 50%; background: ${BRAND}; color: #fff; font-size: 8pt; }
  .notes { list-style: none; padding: 0; margin: 2mm 0 0; display: grid; gap: 1mm; font-size: 8.5pt; }
  .notes li { display: flex; gap: 1.5mm; align-items: center; }
  .si { display: inline-flex; width: 3mm; height: 3mm; color: ${BRAND}; }
  .si svg { width: 100%; height: 100%; }
  .pt { font-size: 8.5pt; font-weight: 700; color: ${MUTED}; text-transform: uppercase; margin: 0 0 1mm; }
  .card { background: #fff; border: .75pt solid ${RULE}; border-radius: 2mm; padding: 2mm; margin: 0; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(28mm, 1fr)); gap: 2mm; }
  .kpi { background: #fff; border: .75pt solid ${RULE}; border-radius: 2mm; padding: 2mm; }
  .kl { display: flex; justify-content: space-between; color: ${MUTED}; font-size: 8.5pt; }
  .kv { font-size: 13pt; font-weight: 700; }
  .kd { font-size: 8.5pt; color: ${MUTED}; }
  table.st { width: 100%; border-collapse: collapse; background: #fff; font-size: 8.5pt; margin: 0; }
  table.st th, table.st td { border-bottom: .5pt solid ${RULE}; padding: 1mm 1.5mm; text-align: start; }
  .sb { display: inline-block; border-radius: 3mm; padding: .2mm 1.6mm; font-size: 8pt; font-weight: 600; background: #f3f1ec; }
  .ff { margin-bottom: 1.4mm; }
  .fl { font-size: 8.5pt; font-weight: 600; }
  .fi { display: flex; justify-content: space-between; border: .75pt solid ${RULE}; border-radius: 1.2mm; padding: .8mm 1.5mm; background: #fff; }
  .fi.missing { border-color: #d03b3b; } .fi.warning { border-color: #c98500; } .fi.ok span { color: #008300; }
  .fh { font-size: 8pt; color: ${MUTED}; }
  .btn { display: inline-block; background: ${BRAND}; color: #fff; border-radius: 1.2mm; padding: .8mm 3mm; font-size: 8.5pt; font-weight: 600; }
  ol.list, ol.timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 1.2mm; }
  ol.list li, ol.timeline li { display: flex; align-items: center; gap: 1.5mm; }
  ol.timeline { border-inline-start: .75pt solid ${RULE}; padding-inline-start: 2.5mm; }
  .dot { width: 1.8mm; height: 1.8mm; border-radius: 50%; background: ${BRAND}; margin-inline-start: -3.5mm; flex: none; }
  .lt { flex: 1; min-width: 0; } .lt small { color: ${MUTED}; display: block; }
  .board { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 1.6mm; }
  .bc { background: #f3f1ec; border-radius: 1.6mm; padding: 1.2mm; }
  .bh { font-weight: 700; font-size: 8.5pt; margin-bottom: 1mm; } .bh small { color: ${MUTED}; }
  .bk { background: #fff; border: .5pt solid ${RULE}; border-radius: 1.2mm; padding: 1mm; margin-bottom: 1mm; display: flex; flex-wrap: wrap; gap: 1mm; align-items: center; }
  .bk small { width: 100%; color: ${MUTED}; }
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm; }
  .side { border: .75pt dashed ${RULE}; border-radius: 2mm; padding: 1.6mm; display: grid; gap: 1.6mm; align-content: start; }
  .co { border-inline-start: 1mm solid #2a78d6; background: #f3f6fb; border-radius: 1mm; padding: 1.4mm 2mm; }
  .co.success { border-color: #008300; background: #eef6ee; } .co.warning { border-color: #c98500; background: #fcf6e8; } .co.danger { border-color: #d03b3b; background: #fbeeee; }
  .card img { width: 100%; max-height: 40mm; object-fit: cover; }
  .bar .appname { margin: 0 auto; font-weight: 700; color: ${INK}; }
  .tbar { display: flex; justify-content: space-between; padding: 1mm 4mm .4mm; font-size: 8pt; font-weight: 700; }
  .mapc { padding: 1.4mm; }
  .mapc svg.map { display: block; border-radius: 1.4mm; }
  .phone-row { display: flex; gap: 6mm; align-items: center; justify-content: center; }
  .phone { width: 64mm; height: 128mm; flex: none; display: flex; flex-direction: column; overflow: hidden; border: 2.4mm solid ${INK}; border-radius: 9mm; background: #fbfaf7; }
  .pstatus { display: flex; justify-content: space-between; align-items: center; padding: 1.6mm 4mm .6mm; font-size: 8pt; font-weight: 700; position: relative; }
  .pisland { position: absolute; left: 50%; top: 1.2mm; width: 16mm; height: 4mm; margin-left: -8mm; border-radius: 3mm; background: ${INK}; }
  .phead { padding: 1.4mm 3mm; font-weight: 700; font-size: 10pt; border-bottom: .75pt solid ${RULE}; }
  .pbody { flex: 1; overflow: hidden; padding: 2.4mm; display: grid; gap: 2mm; align-content: start; }
  .pbody .kpis { grid-template-columns: 1fr 1fr; }
  .prow { background: #fff; border: .75pt solid ${RULE}; border-radius: 1.8mm; padding: 1.6mm 2mm; margin-bottom: 1.4mm; }
  .prh { display: flex; justify-content: space-between; align-items: center; gap: 2mm; }
  .prc { display: flex; justify-content: space-between; gap: 2mm; color: ${MUTED}; }
  .ptabs { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; border-top: .75pt solid ${RULE}; padding: 1.2mm .5mm 0; font-size: 8pt; color: ${MUTED}; text-align: center; }
  .ptabs span { display: flex; flex-direction: column; align-items: center; gap: .4mm; }
  .ptabs .on { color: ${BRAND}; font-weight: 700; }
  .ptabs .si { width: 4mm; height: 4mm; }
  .phome { display: flex; justify-content: center; padding: 1.2mm 0 1.6mm; }
  .phome i { width: 20mm; height: 1.1mm; border-radius: 1mm; background: ${INK}; }
  .phone-block .notes { max-width: 70mm; }
  .shot { border: .75pt solid ${RULE}; border-radius: 3mm; overflow: hidden; background: #fbfaf7; }
  .shot-bar { display: flex; gap: 1.2mm; padding: 1.6mm 2.5mm; background: #efece5; }
  .shot-bar i { width: 2mm; height: 2mm; border-radius: 50%; background: #d4cfc4; }
  .shot-hero { padding: 8mm 10mm 5mm; }
  .shot-h { font-size: 22pt; font-weight: 700; line-height: 1.1; max-width: 70%; }
  .shot-b { color: ${MUTED}; font-size: 10.5pt; max-width: 70%; margin: 2.5mm 0 3mm; }
  .shot-feats { display: flex; gap: 3mm; padding: 0 10mm 7mm; }
  .shot-card { flex: 1; background: #fff; border: .75pt solid ${RULE}; border-radius: 2mm; padding: 3mm; display: flex; gap: 2mm; align-items: center; font-size: 9pt; }
  .shot-link { font-size: 9pt; color: ${MUTED}; margin: 2.5mm 0 0; word-break: break-all; }
  .shot-link a { color: ${BRAND}; }`
