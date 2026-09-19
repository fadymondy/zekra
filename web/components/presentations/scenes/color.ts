"use client"

import { resolveToken } from "@/lib/presentations/scene-params"

/*
A design token as sRGB bytes. CSS variables here may be hex or oklch(); a
1×1 canvas converts whatever the browser understands into pixels, which is
the one format three.js and canvas gradients both accept.
*/
let probe: CanvasRenderingContext2D | null = null

export function tokenRGB(el: Element, token: string): [number, number, number] {
  const css = resolveToken(el, token)
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })
  if (!probe) return [226, 102, 28]
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = "#000"
  probe.fillStyle = css
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data
  return [r, g, b]
}

export function tokenCSS(el: Element, token: string, alpha = 1): string {
  const [r, g, b] = tokenRGB(el, token)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Calls back when the site theme flips (the `dark` class on <html>). */
export function onThemeChange(cb: () => void): () => void {
  const mo = new MutationObserver(cb)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] })
  return () => mo.disconnect()
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}
