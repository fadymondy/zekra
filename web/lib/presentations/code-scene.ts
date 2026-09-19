/*
The "code" scene frame (FM-346), as pure strings so it is testable without a
browser. Model-written HTML/CSS/JS runs ONLY inside the document built here,
in an <iframe sandbox="allow-scripts" srcdoc> (opaque origin: no cookies,
storage, parent DOM, forms, popups, modals or top navigation) under the CSP
below. The Go validator (internal/presentations/code_scene.go) refuses the
worst markup on save; this frame is the real guard.

The parent never reads from the frame. The frame's only message is a "ready"
ping carrying a per-frame nonce, which the parent accepts only when
event.source is that frame's contentWindow.
*/

/** Must equal CodeSceneCSP in code_scene.go (tested). */
export const CODE_SCENE_CSP =
  "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net/npm/three@0.180.0/ https://unpkg.com/three@0.180.0/; " +
  "style-src 'unsafe-inline'; img-src data: blob: https:; font-src data: https:; connect-src 'none'; " +
  "frame-src 'none'; form-action 'none'"

/**
 * The response CSP of a public share page (/{locale}/p/{token}), set in
 * proxy.ts. It governs framing only: frames from this origin (the srcdoc
 * scenes) and nothing else, and the page itself is never framed. In Chrome a
 * srcdoc document inherits this policy ON TOP of its own <meta> CSP, so it
 * must not restrict script/style/img/font: the frame's own CSP does that.
 */
export const SHARE_PAGE_CSP =
  "frame-src 'self'; child-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

/** The one sandbox value a code scene frame ever gets. Never add allow-same-origin. */
export const CODE_SCENE_SANDBOX = "allow-scripts"

export const CODE_SCENE_READY = "fm-code-scene-ready"

/** Must equal CodeSceneAspects in code_scene.go (tested). */
export const CODE_SCENE_ASPECTS = ["16:9", "4:3", "1:1", "21:9", "3:1"] as const

/** "4:3" → "4 / 3"; anything else → the 16:9 default. */
export function aspectRatio(value: unknown): string {
  const v = (CODE_SCENE_ASPECTS as readonly string[]).includes(String(value)) ? String(value) : "16:9"
  const [w, h] = v.split(":")
  return `${w} / ${h}`
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")

/**
 * The srcdoc for a code scene. The CSP <meta> is the first element in <head>,
 * before anything the model wrote, so it governs every script that follows.
 */
export function codeSceneDocument(html: string, opts: { nonce: string; colorScheme: "light" | "dark"; dir: "ltr" | "rtl" }): string {
  const nonce = JSON.stringify(String(opts.nonce).replace(/[^\w-]/g, ""))
  return `<!doctype html>
<html dir="${opts.dir === "rtl" ? "rtl" : "ltr"}" data-theme="${opts.colorScheme === "dark" ? "dark" : "light"}" style="color-scheme:${opts.colorScheme === "dark" ? "dark" : "light"}">
<head>
<meta http-equiv="Content-Security-Policy" content="${attr(CODE_SCENE_CSP)}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}</style>
<script>addEventListener("load",function(){try{parent.postMessage({type:${JSON.stringify(CODE_SCENE_READY)},nonce:${nonce}},"*")}catch(e){}})</script>
</head>
<body>
${String(html ?? "")}
</body>
</html>`
}

/** The frame's attributes, in one place so the test pins them. */
export function codeSceneFrameProps(title: string) {
  return {
    sandbox: CODE_SCENE_SANDBOX,
    title,
    loading: "lazy" as const,
    referrerPolicy: "no-referrer" as const,
    // Deny powerful features outright (the opaque origin already lacks most).
    allow: "camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; usb 'none'; serial 'none'; bluetooth 'none'; clipboard-read 'none'; clipboard-write 'none'; display-capture 'none'; fullscreen 'none'",
  }
}

/** Accept a message only from this frame, only the ready ping, only with its nonce. */
export function isReadyMessage(e: { source: unknown; data: unknown }, frame: unknown, nonce: string): boolean {
  if (!frame || e.source !== frame) return false
  const d = e.data as { type?: unknown; nonce?: unknown } | null
  return !!d && typeof d === "object" && d.type === CODE_SCENE_READY && d.nonce === nonce
}
