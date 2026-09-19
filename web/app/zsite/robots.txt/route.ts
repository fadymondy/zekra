import { robotsTxt } from "@/lib/site/feeds"

export const dynamic = "force-dynamic"

export function GET() {
  return new Response(robotsTxt(), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } })
}
