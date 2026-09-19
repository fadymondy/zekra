/*
One export path for both doors: the customer's share link
(/{locale}/p/{token}/download/{format}) and the owner's
(/{locale}/b/{namespace}/presentations/{id}/export/{format}). Both hand over already-loaded
content; this renders it. Server only.
*/
import { translate } from "@/lib/i18n-server"

import { deckPrintHTML, reportPrintHTML } from "./export-html.ts"
import { markdownToHtml } from "./md-html.ts"
import type { DeckContent, Kind, PageContent, ReportContent } from "./types.ts"

export const EXPORT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

export function formatsFor(kind: Kind): string[] {
  return kind === "deck" ? ["pdf"] : kind === "report" ? ["pdf", "docx"] : []
}

function text(body: string, status: number): Response {
  return new Response(body + "\n", {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" },
  })
}

export function filename(title: string, locale: string, format: string): string {
  const base =
    title
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 60) || "document"
  return `${base}-${locale}.${format}`
}

/** The origin the visitor used (behind the reverse proxy, not the Node binding). */
export function publicOrigin(request: Request): string {
  const h = request.headers
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim()
  const proto = (h.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "")).split(",")[0].trim()
  return host ? `${proto}://${host}` : new URL(request.url).origin
}

let iconCache: Map<string, string> | undefined

/** The lucide SVG for an accepted icon name, rendered once per process (FM-341 polish). */
async function iconRenderer(): Promise<(name?: string) => string> {
  const [{ ICONS }, { createElement }, { renderToStaticMarkup }] = await Promise.all([
    import("@/components/presentations/icon"),
    import("react"),
    import("react-dom/server"),
  ])
  iconCache ??= new Map()
  const cache = iconCache
  return (name?: string) => {
    if (!name || !ICONS[name]) return ""
    let svg = cache.get(name)
    if (svg === undefined) {
      svg = renderToStaticMarkup(createElement(ICONS[name], { "aria-hidden": true }))
      cache.set(name, svg)
    }
    return svg
  }
}

export async function renderExport(input: {
  kind: Kind
  format: string
  locale: "en" | "ar"
  content: Record<string, unknown>
  customer: string
  company: string
  origin: string
  embeds?: Record<string, { content: PageContent }>
  /** Where an embedded page opens (printed as a link under its first screen). */
  embedLink?: (documentId: string) => string | undefined
}): Promise<Response> {
  const { kind, format, locale } = input
  if (!formatsFor(kind).includes(format)) {
    return text(`This ${kind} has no ${format} export. Available: ${formatsFor(kind).join(", ") || "none"}.`, 404)
  }
  const t = (key: string) => translate(key, locale)
  const title = String(input.content.title ?? "document")
  const headers = {
    "Content-Type": EXPORT_TYPES[format],
    "Content-Disposition": `attachment; filename="${filename(title, locale, format)}"; filename*=UTF-8''${encodeURIComponent(
      title.slice(0, 80),
    )}-${locale}.${format}`,
    "Content-Language": locale,
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  }
  const exact = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

  if (format === "docx") {
    const { reportDocx } = await import("./export-docx.ts")
    const buf = await reportDocx(input.content as unknown as ReportContent, { locale, customer: input.customer, company: input.company }, {
      preparedFor: t("presentations.export.preparedFor"),
      summary: t("presentations.export.summary"),
      data: t("presentations.export.data"),
      step: t("presentations.export.step"),
      details: t("presentations.export.details"),
      owner: t("presentations.export.owner"),
      next: t("presentations.export.next"),
      part: t("presentations.export.part"),
      contents: t("presentations.export.contents"),
      marker: t("presentations.export.marker"),
      kind: t("presentations.export.kind"),
      label: t("presentations.export.label"),
      status: t("presentations.export.status"),
    })
    return new Response(exact(buf), { headers })
  }

  try {
    const { htmlToPdf, pdfFontCSS } = await import("./pdf.ts")
    const icon = await iconRenderer()
    const doc = { locale, title, customer: input.customer, company: input.company, fontCss: pdfFontCSS(), origin: input.origin }
    const html =
      kind === "deck"
        ? deckPrintHTML(input.content as unknown as DeckContent, doc, markdownToHtml, input.embeds ?? {}, { icon, embedLink: input.embedLink })
        : reportPrintHTML(input.content as unknown as ReportContent, doc, markdownToHtml, {
            preparedFor: t("presentations.export.preparedFor"),
            summary: t("presentations.export.summary"),
          }, { icon })
    const pdf = await htmlToPdf(html, { title, lang: locale, subject: input.company || input.customer })
    return new Response(exact(pdf), { headers })
  } catch (err) {
    const reason = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").trim().slice(0, 400)
    console.error("[presentations] PDF render failed:", err)
    return text(`The PDF could not be generated on this server: ${reason}`, 503)
  }
}
