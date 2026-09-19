"use client"

import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "cn"

/*
Scales its content down (never up) so it fits the box without scrolling — a
screen mockup or a long workflow on a 16:9 slide (FM-350). The content is laid
out wider by the same factor, so it keeps its desktop shape instead of
wrapping into a tall column. Below `minScale` it stops shrinking and scrolls,
so text never becomes unreadable (phones).
*/
export function FitBox({
  children,
  className,
  dir,
  minScale = 0.55,
}: {
  children: ReactNode
  className?: string
  dir: "ltr" | "rtl"
  minScale?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ s: 1, w: 0, h: 0, box: 0 })

  useLayoutEffect(() => {
    const b = box.current
    const c = inner.current
    if (!b || !c) return
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const availH = b.clientHeight
        const availW = b.clientWidth
        if (!availH || !availW) return
        // Phones: keep text readable and scroll rather than shrink far.
        const floor = availW < 640 ? 1 : minScale
        let s = 1
        for (let pass = 0; pass < 4; pass++) {
          c.style.width = `${availW / s}px`
          const next = Math.max(floor, Math.min(1, availH / c.scrollHeight))
          if (Math.abs(next - s) < 0.01) break
          s = next
        }
        c.style.width = `${availW / s}px`
        setFit((f) =>
          Math.abs(f.s - s) < 0.005 && f.w === availW && f.h === c.scrollHeight && f.box === availH ? f : { s, w: availW, h: c.scrollHeight, box: availH },
        )
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(b)
    ro.observe(c)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
    }
  }, [minScale])

  return (
    <div ref={box} className={cn("relative min-h-0", fit.h * fit.s > fit.box + 1 ? "overflow-y-auto" : "overflow-hidden", className)} data-fit-scale={fit.s.toFixed(2)}>
      <div style={{ height: fit.h ? fit.h * fit.s : undefined, position: "relative", marginTop: fit.h ? Math.max(0, (fit.box - fit.h * fit.s) / 2) : undefined }}>
        <div
          ref={inner}
          style={{
            position: fit.h ? "absolute" : "relative",
            top: 0,
            [dir === "rtl" ? "right" : "left"]: 0,
            transform: fit.s < 1 ? `scale(${fit.s})` : undefined,
            transformOrigin: dir === "rtl" ? "top right" : "top left",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
