import { fetchOwned } from "@/lib/presentations/api"
import { publicOrigin, renderExport } from "@/lib/presentations/export-server"
import { presentationsHref } from "@/lib/presentations/href"
import type { PageContent, PLocale } from "@/lib/presentations/types"

/*
/{locale}/b/{namespace}/presentations/{id}/export/{format} — the owner's export.
The caller's session is forwarded to the API, which answers only the owner;
anyone else gets the same 404 as a missing document. Embedded page previews
are loaded the same way. Speaker notes are never part of an export.
*/
export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string; namespace: string; id: string; format: string }> },
) {
  const { locale: raw, namespace: rawNs, id: rawId, format } = await params
  const namespace = decodeURIComponent(rawNs)
  const id = decodeURIComponent(rawId)
  const doc = await fetchOwned(id, request)
  // A document is only exported from its own brain's URL.
  if (!doc || (doc.namespace && doc.namespace !== namespace)) {
    return new Response("Not found.\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } })
  }
  const want: PLocale = raw === "ar" ? "ar" : "en"
  const locale: PLocale = doc.content[want] ? want : doc.locale
  const content = doc.content[locale] ?? {}
  const embeds: Record<string, { content: PageContent }> = {}
  if (doc.kind === "deck") {
    const slides = (content.slides as { type: string; document_id?: string }[] | undefined) ?? []
    for (const s of slides) {
      if (s.type !== "embed" || !s.document_id) continue
      const page = await fetchOwned(s.document_id, request)
      const pc = page?.content[locale] ?? page?.content[page?.locale ?? "en"]
      if (page && pc) embeds[s.document_id] = { content: pc as unknown as PageContent }
    }
  }
  return renderExport({
    kind: doc.kind,
    format,
    locale,
    content,
    customer: doc.customer.name,
    company: doc.customer.company,
    origin: new URL(request.url).origin,
    embeds,
    // The owner copy links the owner page; a share link prints the public one.
    embedLink: (docId) => `${publicOrigin(request)}${presentationsHref(locale, namespace, docId)}`,
  })
}
