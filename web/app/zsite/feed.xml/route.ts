import { feedXml } from "@/lib/site/feeds"

export const dynamic = "force-dynamic"

export function GET() {
  return new Response(feedXml(), { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } })
}
