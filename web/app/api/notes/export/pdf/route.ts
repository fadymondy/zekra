import { NextResponse } from "next/server"

import { htmlToPdf } from "@/lib/presentations/pdf"
import { noteToHtml } from "@/lib/notes/export/html"

/*
PDF export for a note.

This reuses the presentations' puppeteer pipeline rather than adding a second
engine. mark-it-down draws its PDF with pdfkit, which means re-implementing
every markdown construct and getting a document that does not match what the
reader saw. Printing the exported HTML gives a PDF identical to the reading
pane — themes, syntax highlighting, tables and all — for no new dependency,
since puppeteer-core and @sparticuz/chromium are already in
serverExternalPackages.

The markdown arrives in the request rather than being fetched by id: the
client already holds the body, and fetching it here would mean re-implementing
the note's access checks in a second place.
*/

// Chromium is not available on the edge runtime.
export const runtime = "nodejs"
// Rendering a large note can exceed the default budget.
export const maxDuration = 60

/** Bound the payload: a PDF render is expensive and this route is authenticated only by session. */
const MAX_MARKDOWN_BYTES = 1_000_000

export async function POST(request: Request) {
  let body: { markdown?: string; title?: string; theme?: string | null; dir?: "ltr" | "rtl" | "auto" }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }

  const markdown = typeof body.markdown === "string" ? body.markdown : ""
  if (!markdown.trim()) {
    return NextResponse.json({ error: "markdown is required" }, { status: 400 })
  }
  if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES) {
    return NextResponse.json({ error: "note is too large to export" }, { status: 413 })
  }

  const title = (typeof body.title === "string" && body.title.trim()) || "Note"

  try {
    const html = noteToHtml(markdown, { title, theme: body.theme ?? null, dir: body.dir ?? "auto" })
    // htmlToPdf takes the document language for PDF metadata; an RTL note is
    // the only case where "ar" is the better answer.
    const pdf = await htmlToPdf(html, { title, lang: body.dir === "rtl" ? "ar" : "en" })
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        // The filename is quoted and stripped of quotes/newlines so a note
        // title cannot forge extra header fields.
        "Content-Disposition": `attachment; filename="${safeFilename(title)}.pdf"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    // Chromium can fail to launch in constrained environments; report it
    // rather than returning a zero-byte "PDF" the user has to debug.
    const message = err instanceof Error ? err.message : "PDF generation failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function safeFilename(title: string): string {
  return title
    .replace(/[\r\n"\\]/g, "")
    .replace(/[/\\?%*:|<>]/g, "-")
    .slice(0, 80)
    .trim() || "note"
}
