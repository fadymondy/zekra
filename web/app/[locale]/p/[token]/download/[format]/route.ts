import { fetchShared } from "@/lib/presentations/api"
import { publicOrigin, renderExport } from "@/lib/presentations/export-server"
import type { PageContent } from "@/lib/presentations/types"

/*
/{locale}/p/{token}/download/{format} — a shared deck or report as a file
(FM-343/344). The share token is the only authorization, exactly as for the
page: the API refuses unknown, revoked, expired and archived links alike, and
counts the download for the owner.
*/
export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string; token: string; format: string }> },
) {
  const { locale, token, format } = await params
  const { status, data } = await fetchShared(token, {
    locale,
    event: "download",
    forwardedFor: request.headers.get("x-forwarded-for"),
  })
  if (!data) {
    return new Response(status === 429 ? "Too many requests.\n" : "This link is not available.\n", {
      status: status === 429 ? 429 : 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" },
    })
  }
  return renderExport({
    kind: data.kind,
    format,
    locale: data.locale,
    content: data.content,
    customer: data.customer,
    company: data.company,
    origin: new URL(request.url).origin,
    embeds: data.embeds as Record<string, { content: PageContent }>,
    embedLink: (id) => `${publicOrigin(request)}/${data.locale}/p/${token}/embed/${encodeURIComponent(id)}`,
  })
}
