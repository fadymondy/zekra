"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { cn } from "cn"

import { aspectRatio, codeSceneDocument, codeSceneFrameProps, isReadyMessage } from "@/lib/presentations/code-scene"
import { Skeleton } from "@/components/ui/skeleton"

/*
A "code" scene (FM-346): model-written HTML/JS in a sandboxed srcdoc iframe.
See lib/presentations/code-scene.ts for the guarantees. The frame gets its
document only once it is near the viewport, keeps a fixed aspect ratio (or
fills its parent in a hero), and the parent listens for nothing but the ready
ping from this exact frame.
*/
export default function CodeScene({
  params,
  label,
  dir,
  fill = false,
  className,
}: {
  params: Record<string, unknown>
  label: string
  dir: "ltr" | "rtl"
  fill?: boolean
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const nonce = useId().replace(/[^\w-]/g, "")
  const [near, setNear] = useState(false)
  const [ready, setReady] = useState(false)
  const [scheme, setScheme] = useState<"light" | "dark">("light")
  const html = typeof params.html === "string" ? params.html : ""

  // The frame follows the page theme (class-based), not only the OS setting.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const read = () => setScheme(el.closest(".dark") ? "dark" : "light")
    read()
    const mo = new MutationObserver(read)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"], subtree: false })
    return () => mo.disconnect()
  }, [])

  useEffect(() => {
    const el = box.current
    if (!el || near) return
    if (typeof IntersectionObserver === "undefined") {
      setNear(true)
      return
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setNear(true)
    }, { rootMargin: "300px" })
    io.observe(el)
    return () => io.disconnect()
  }, [near])

  useEffect(() => {
    setReady(false)
    const onMessage = (e: MessageEvent) => {
      if (isReadyMessage(e, frame.current?.contentWindow, nonce)) setReady(true)
    }
    window.addEventListener("message", onMessage)
    // Never leave a skeleton forever if the author's page throws before load.
    const t = window.setTimeout(() => setReady(true), 6000)
    return () => {
      window.removeEventListener("message", onMessage)
      window.clearTimeout(t)
    }
  }, [nonce, html, scheme])

  const srcDoc = useMemo(() => codeSceneDocument(html, { nonce, colorScheme: scheme, dir }), [html, nonce, scheme, dir])

  return (
    <div
      ref={box}
      data-scene="code"
      className={cn("relative w-full overflow-hidden", fill && "h-full", className)}
      style={fill ? undefined : { aspectRatio: aspectRatio(params.aspect) }}
    >
      {!ready ? <Skeleton className="absolute inset-0 rounded-none" aria-hidden /> : null}
      {near ? (
        <iframe
          ref={frame}
          key={srcDoc}
          {...codeSceneFrameProps(label)}
          srcDoc={srcDoc}
          className="absolute inset-0 block size-full border-0 bg-transparent"
          style={{ colorScheme: scheme }}
        />
      ) : null}
    </div>
  )
}
