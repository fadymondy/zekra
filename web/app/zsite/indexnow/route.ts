import { indexNowKey } from "@/lib/site/feeds"

export const dynamic = "force-dynamic"

// The IndexNow ownership file (proxy.ts maps /indexnow.txt and /{INDEXNOW_KEY}.txt here).
export function GET() {
  const key = indexNowKey()
  if (!key) return new Response("Not found", { status: 404 })
  return new Response(key, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
}
