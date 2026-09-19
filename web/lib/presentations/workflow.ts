/*
Workflow geometry shared by the live renderer and the print SVG (FM-350).
Pure: no DOM, testable under node.
*/
import type { WorkflowBlock } from "./types.ts"

export type WEdge = { from: number; to: number; label?: string }

/** The block's edges as step indexes; without edges the steps run in order. Unknown ids are dropped. */
export function workflowEdges(block: WorkflowBlock): WEdge[] {
  const index = new Map(block.steps.map((s, i) => [s.id, i]))
  if (!block.edges || block.edges.length === 0) {
    return block.steps.slice(1).map((_, i) => ({ from: i, to: i + 1 }))
  }
  const out: WEdge[] = []
  for (const e of block.edges) {
    const from = index.get(e.from)
    const to = index.get(e.to)
    if (from === undefined || to === undefined || from === to) continue
    out.push({ from, to, label: e.label })
  }
  return out
}

/** Columns per row for a horizontal flow: at most `max`, balanced across rows. */
export function rowsFor(count: number, max: number): number[] {
  const rows = Math.max(1, Math.ceil(count / Math.max(1, max)))
  const per = Math.ceil(count / rows)
  const out: number[] = []
  let left = count
  while (left > 0) {
    out.push(Math.min(per, left))
    left -= per
  }
  return out
}

export type Box = { x: number; y: number; w: number; h: number }

/**
 * A connector between two boxes as an SVG path. Neighbours on a row join
 * side to side, rows join bottom to top, and a jump over other steps on the
 * same row arcs above them. Works for any reading direction: it only looks
 * at where the boxes are.
 */
export function connector(a: Box, b: Box): { d: string; mid: { x: number; y: number } } {
  const acx = a.x + a.w / 2
  const acy = a.y + a.h / 2
  const bcx = b.x + b.w / 2
  const bcy = b.y + b.h / 2
  const sameRow = Math.abs(acy - bcy) < Math.min(a.h, b.h) / 2
  if (sameRow) {
    const gap = Math.abs(bcx - acx)
    // Adjacent unless another box could fit between them.
    const neighbour = gap < (a.w + b.w) / 2 + Math.max(a.w, b.w) * 0.9
    if (neighbour) {
      const sx = bcx > acx ? a.x + a.w : a.x
      const ex = bcx > acx ? b.x : b.x + b.w
      const dx = (ex - sx) / 2
      return { d: `M ${sx} ${acy} C ${sx + dx} ${acy}, ${ex - dx} ${bcy}, ${ex} ${bcy}`, mid: { x: (sx + ex) / 2, y: (acy + bcy) / 2 } }
    }
    const lift = Math.min(60, 18 + gap * 0.12)
    const sy = a.y
    const ey = b.y
    return {
      d: `M ${acx} ${sy} C ${acx} ${sy - lift}, ${bcx} ${ey - lift}, ${bcx} ${ey}`,
      mid: { x: (acx + bcx) / 2, y: Math.min(sy, ey) - lift * 0.75 },
    }
  }
  const down = bcy > acy
  const sy = down ? a.y + a.h : a.y
  const ey = down ? b.y : b.y + b.h
  const dy = (ey - sy) / 2
  return { d: `M ${acx} ${sy} C ${acx} ${sy + dy}, ${bcx} ${ey - dy}, ${bcx} ${ey}`, mid: { x: (acx + bcx) / 2, y: (sy + ey) / 2 } }
}

/**
 * Report chart series in draw order (FM-341 polish). Grouped bars are drawn
 * left to right in child order, so in RTL the children are reversed to put
 * the first series on the right, next to the right-to-left legend.
 */
export function seriesDrawOrder<T>(keys: T[], rtl: boolean, chart: string): T[] {
  return rtl && chart === "bar" ? [...keys].reverse() : keys
}
