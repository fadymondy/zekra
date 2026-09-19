"use client"

import { useMemo, useState } from "react"

import type { GraphData, GraphNode } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"

import { colorForGroup as colorFor, compareGroups } from "./colors"
import { GraphPaletteStyle } from "./graph-view"

type Placed = GraphNode & { x: number; y: number; r: number }

/** Radial mindmap of the derived hierarchy (root → type → entity): root at the centre, type
 *  nodes on an inner ring, each type's entities fanned across its sector on an outer ring. */
export function BrainMindmap({ data, height = 560 }: { data: GraphData; height?: number }) {
  const { t, formatNumber } = useTranslations()
  const [hover, setHover] = useState<string | null>(null)

  const layout = useMemo(() => {
    const W = 960
    const H = height
    const cx = W / 2
    const cy = H / 2
    const R1 = Math.min(W, H) * 0.24
    const R2 = Math.min(W, H) * 0.44
    const nodes = data.nodes ?? []
    const edges = data.edges ?? []
    const root = nodes.find((n) => n.group === "root")
    const types = nodes.filter((n) => n.group === "type")
    const typeIds = new Set(types.map((tn) => tn.id))

    const parentOf = new Map<string, string>()
    for (const e of edges) {
      if (typeIds.has(e.source) && !typeIds.has(e.target) && e.target !== root?.id) parentOf.set(e.target, e.source)
    }
    const entitiesByType = new Map<string, GraphNode[]>()
    for (const n of nodes) {
      if (n.group === "root" || n.group === "type") continue
      const p = parentOf.get(n.id)
      if (!p) continue
      const arr = entitiesByType.get(p) ?? []
      arr.push(n)
      entitiesByType.set(p, arr)
    }

    const pos = new Map<string, Placed>()
    if (root) pos.set(root.id, { ...root, x: cx, y: cy, r: 11 })
    const nT = Math.max(types.length, 1)
    types.forEach((tn, i) => {
      const center = (2 * Math.PI * (i + 0.5)) / nT - Math.PI / 2
      pos.set(tn.id, { ...tn, x: cx + R1 * Math.cos(center), y: cy + R1 * Math.sin(center), r: 7 })
      const ents = entitiesByType.get(tn.id) ?? []
      const half = (Math.PI / nT) * 0.82
      const k = ents.length
      ents.forEach((en, j) => {
        const frac = k > 1 ? j / (k - 1) - 0.5 : 0
        const a = center + frac * 2 * half
        pos.set(en.id, { ...en, x: cx + R2 * Math.cos(a), y: cy + R2 * Math.sin(a), r: 4 })
      })
    })
    return { W, H, edges, placed: [...pos.values()], pos }
  }, [data, height])

  const { W, H, edges, placed, pos } = layout

  const neighbors = useMemo(() => {
    if (!hover) return null
    const set = new Set<string>([hover])
    for (const e of edges) {
      if (e.source === hover) set.add(e.target)
      if (e.target === hover) set.add(e.source)
    }
    return set
  }, [hover, edges])

  const legend = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of data.nodes ?? []) {
      if (n.group && n.group !== "root" && n.group !== "type") counts.set(n.group, (counts.get(n.group) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => compareGroups(a[0], b[0])).map(([group, count]) => ({ group, count }))
  }, [data])

  const hovered = hover ? pos.get(hover) : null
  const isStruct = (g?: string) => g === "root" || g === "type"

  return (
    <div className="zk-graph">
      <GraphPaletteStyle />
      <svg direction="ltr" viewBox={`0 0 ${W} ${H}`} className="w-full select-none" style={{ height }} role="img" aria-label={t("graph.mindmap")}>
        {edges.map((e, i) => {
          const a = pos.get(e.source)
          const b = pos.get(e.target)
          if (!a || !b) return null
          const lit = !!neighbors && neighbors.has(e.source) && neighbors.has(e.target)
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              style={{ stroke: lit ? "var(--grid-fg)" : "var(--grid-line)", opacity: neighbors ? (lit ? 0.9 : 0.08) : 0.5 }}
              strokeWidth={lit ? 1.5 : 1}
            />
          )
        })}
        {placed.map((n) => (
          <g
            key={n.id}
            style={{ opacity: neighbors && !neighbors.has(n.id) ? 0.12 : 1, cursor: "pointer" }}
            onMouseEnter={() => setHover(n.id)}
            onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
          >
            <rect x={n.x - n.r} y={n.y - n.r} width={n.r * 2} height={n.r * 2} style={{ fill: colorFor(n.group) }} shapeRendering="crispEdges" />
            {isStruct(n.group) ? (
              <text x={n.x} y={n.y - n.r - 5} textAnchor="middle" style={{ fill: "var(--grid-fg)", fontSize: 11, fontWeight: 500, pointerEvents: "none" }}>
                {n.name.length > 26 ? n.name.slice(0, 25) + "…" : n.name}
              </text>
            ) : null}
          </g>
        ))}
        {hovered && !isStruct(hovered.group) ? (
          <text x={hovered.x} y={hovered.y - hovered.r - 5} textAnchor="middle" style={{ fill: "var(--grid-fg)", fontSize: 11, fontWeight: 500, pointerEvents: "none" }}>
            {hovered.name.length > 44 ? hovered.name.slice(0, 43) + "…" : hovered.name}
          </text>
        ) : null}
      </svg>

      {legend.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-6 py-2 text-xs text-grid-muted">
          {legend.map((l) => (
            <span key={l.group} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2.5" style={{ background: colorFor(l.group) }} />
              <span dir="auto">{l.group}</span>
              <span>{formatNumber(l.count)}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
