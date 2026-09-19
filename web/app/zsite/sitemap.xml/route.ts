import { sitemapXml } from "@/lib/site/feeds"

export const dynamic = "force-dynamic"

export function GET() {
  return new Response(sitemapXml(), { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } })
}
