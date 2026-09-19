// Mahaam Feedback, server side: an error thrown while Next renders a page or runs a route handler
// is filed as an issue in the Zekra project on Mahaam (the Node SDK's installExceptionHook, for
// Next's onRequestError hook). Server reports send no Origin, so page_url must sit on one of the
// key's allowed origins: MAHAAM_APP_URL.
import type { Instrumentation } from "next"

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const key = process.env.MAHAAM_FEEDBACK_KEY ?? process.env.NEXT_PUBLIC_MAHAAM_FEEDBACK_KEY
  if (!key) return
  const base = process.env.MAHAAM_URL ?? "https://console.mahaam.app"
  const app = process.env.MAHAAM_APP_URL ?? "https://app.zekra.dev"
  const e = err as Error & { digest?: string }
  const form = new FormData()
  form.set("public_key", key)
  form.set("title", `Server error: ${(e?.message || String(err)).slice(0, 180)}`)
  form.set(
    "body",
    [
      `**${request.method} ${request.path}**`,
      `Router: ${context.routerKind} · route: ${context.routePath} · type: ${context.routeType}`,
      e?.digest ? `Digest: ${e.digest}` : "",
      "```",
      (e?.stack || String(err)).slice(0, 6000),
      "```",
    ]
      .filter(Boolean)
      .join("\n"),
  )
  form.set("issue_type", "bug")
  form.set("page_url", app + request.path)
  form.set("meta", JSON.stringify({ product: "zekra", source: "next-server" }))
  try {
    await fetch(`${base}/api/feedback/embed`, { method: "POST", body: form, signal: AbortSignal.timeout(5000) })
  } catch {
    // Reporting must never break the response.
  }
}
