"use client"

import { useEffect, useRef } from "react"

import { int, num, numbers, oneOf, strings, token, tokens } from "@/lib/presentations/scene-params"
import { onThemeChange, prefersReducedMotion, tokenCSS } from "./color"

/*
The vetted 2D canvas scenes (FM-346): gradient_mesh, generative_lines, chart.
Same contract as three-scene.tsx: clamped params, colour tokens only, paused
off screen, one still frame under reduced motion, `data-frames` for checks.
The chart scene is decorative; readable data belongs in a report chart.
*/
type Params = Record<string, unknown>
type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, el: Element) => void

function gradientMesh(p: Params): Draw {
  const colors = tokens(p, "colors", ["brand", "chart-2", "chart-4"])
  const speed = num(p, "speed", 0, 3, 0.5)
  const blur = num(p, "blur", 0, 120, 60)
  return (ctx, w, h, t, el) => {
    ctx.clearRect(0, 0, w, h)
    ctx.filter = blur ? `blur(${blur}px)` : "none"
    colors.forEach((c, i) => {
      const a = t * 0.3 * speed + (i / colors.length) * Math.PI * 2
      const x = w / 2 + Math.cos(a) * w * 0.28
      const y = h / 2 + Math.sin(a * 1.3) * h * 0.28
      const r = Math.max(w, h) * 0.38
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, tokenCSS(el, c, 0.75))
      g.addColorStop(1, tokenCSS(el, c, 0))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    })
    ctx.filter = "none"
  }
}

function lines(p: Params): Draw {
  const n = int(p, "lines", 3, 200, 40)
  const amp = num(p, "amplitude", 0.01, 0.5, 0.15)
  const freq = num(p, "frequency", 0.5, 12, 3)
  const speed = num(p, "speed", 0, 3, 0.6)
  const color = token(p, "color", "brand")
  return (ctx, w, h, t, el) => {
    ctx.clearRect(0, 0, w, h)
    ctx.lineWidth = 1
    for (let i = 0; i < n; i++) {
      const k = i / Math.max(1, n - 1)
      ctx.strokeStyle = tokenCSS(el, color, 0.15 + 0.6 * (1 - Math.abs(k - 0.5) * 2))
      ctx.beginPath()
      for (let x = 0; x <= w; x += 8) {
        const y = h * (0.15 + 0.7 * k) + Math.sin((x / w) * freq * Math.PI * 2 + t * speed + k * 3) * h * amp * Math.sin(k * Math.PI)
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }
}

function chart(p: Params, rtl: boolean): Draw {
  const kind = oneOf(p, "kind", ["bar", "line"], "bar")
  const values = numbers(p, "values", 24)
  const labels = strings(p, "labels", 24, 24)
  const color = token(p, "color", "brand")
  const max = Math.max(1, ...values)
  return (ctx, w, h, t, el) => {
    ctx.clearRect(0, 0, w, h)
    if (values.length < 2) return
    const grow = Math.min(1, t / 1.2)
    const pad = 28
    const iw = w - pad * 2
    const ih = h - pad * 2 - (labels.length ? 14 : 0)
    const band = iw / values.length
    const xAt = (i: number) => (rtl ? pad + iw - band * (i + 0.5) : pad + band * (i + 0.5))
    const yAt = (v: number) => pad + ih - (v / max) * ih * grow
    ctx.strokeStyle = tokenCSS(el, "muted", 0.35)
    ctx.beginPath()
    ctx.moveTo(pad, pad + ih)
    ctx.lineTo(pad + iw, pad + ih)
    ctx.stroke()
    ctx.fillStyle = tokenCSS(el, color)
    ctx.strokeStyle = tokenCSS(el, color)
    if (kind === "bar") {
      const bw = Math.min(24, band * 0.6)
      values.forEach((v, i) => {
        const y = yAt(Math.max(0, v))
        ctx.beginPath()
        ctx.roundRect(xAt(i) - bw / 2, y, bw, pad + ih - y, [4, 4, 0, 0])
        ctx.fill()
      })
    } else {
      ctx.lineWidth = 2
      ctx.lineJoin = "round"
      ctx.beginPath()
      values.forEach((v, i) => (i ? ctx.lineTo(xAt(i), yAt(v)) : ctx.moveTo(xAt(i), yAt(v))))
      ctx.stroke()
    }
    ctx.fillStyle = tokenCSS(el, "muted")
    ctx.font = "11px system-ui, sans-serif"
    ctx.textAlign = "center"
    labels.slice(0, values.length).forEach((l, i) => ctx.fillText(l, xAt(i), h - pad + 4))
  }
}

export default function CanvasScene({ type, params, label, dir }: { type: string; params: Params; label: string; dir: "ltr" | "rtl" }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const key = JSON.stringify(params)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    const draw: Draw | null =
      type === "gradient_mesh" ? gradientMesh(params) : type === "generative_lines" ? lines(params) : type === "chart" ? chart(params, dir === "rtl") : null
    if (!draw) return
    let w = 1
    let h = 1
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2)
      w = canvas.clientWidth || 1
      h = canvas.clientHeight || 1
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    let visible = true
    const io = new IntersectionObserver((e) => (visible = e.some((x) => x.isIntersecting)))
    io.observe(canvas)
    const start = performance.now()
    let frames = 0
    let raf = 0
    const still = prefersReducedMotion()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (!visible) return
      draw(ctx, w, h, (now - start) / 1000, canvas)
      frames++
      if (frames % 10 === 0 || frames < 10) canvas.dataset.frames = String(frames)
    }
    if (still) {
      draw(ctx, w, h, 5, canvas)
      canvas.dataset.frames = "1"
    } else raf = requestAnimationFrame(tick)
    const stop = onThemeChange(() => draw(ctx, w, h, (performance.now() - start) / 1000, canvas))
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the params value, not identity
  }, [type, key, dir])

  return <canvas ref={ref} className="block size-full" role="img" aria-label={label} data-scene={type} data-engine="canvas" />
}
