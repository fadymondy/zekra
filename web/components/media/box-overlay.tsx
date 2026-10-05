"use client"

import type { MediaLine } from "@/lib/media"

/** Read text boxes drawn over an image or video frame. The SVG shares the media's pixel space
 * (viewBox = its natural size), so it scales with the element under it. Hovering a box shows its text. */
export function BoxOverlay({ lines, width, height, active }: { lines: MediaLine[]; width: number; height: number; active?: number }) {
  if (!width || !height || lines.length === 0) return null
  return (
    <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      {lines.map((l, i) => (
        <polygon
          key={i}
          points={l.box.map(([x, y]) => `${x},${y}`).join(" ")}
          className="pointer-events-auto fill-[color-mix(in_oklab,var(--nq-action)_14%,transparent)] stroke-nq-action transition-[fill]"
          strokeWidth={Math.max(1.5, width / 600)}
          vectorEffect="non-scaling-stroke"
          style={active === i ? { fill: "color-mix(in oklab, var(--nq-action) 38%, transparent)" } : undefined}
        >
          <title>{l.text}</title>
        </polygon>
      ))}
    </svg>
  )
}
