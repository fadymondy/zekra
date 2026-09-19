"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Columns3Icon, FileTextIcon, Link2Icon, Loader2Icon, NetworkIcon, XIcon } from "lucide-react"

import { SpiderGraphView } from "@/components/graph/spider-view"
import { ZoomControls } from "@/components/graph/zoom-controls"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ApiError, type GraphData, type GraphNode } from "@/lib/api"
import { useMemory } from "@/lib/brains"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

import { colorForGroup, compareGroups, GRAPH_PALETTE_CSS, makeGroupPalette, OTHER_COLOR, type GroupPalette } from "./colors"

type GraphMode = "schema" | "spider"
const VIEW_KEY = "brain-graph-view-mode"

/** Injects the graph's series colours (scoped to .zk-graph). */
export function GraphPaletteStyle() {
  return <style>{GRAPH_PALETTE_CSS}</style>
}

/** Graph explorer: a Schema / Spider toggle and a shared colour legend over the columnar memory
 *  schema and the force-directed spider. One palette, built from the whole graph's type counts,
 *  so groups read the same in both views and sampling never repaints them. */
export function BrainGraphView({ data, namespace }: { data: GraphData; namespace: string }) {
  const { t, formatNumber } = useTranslations()
  const [mode, setMode] = useState<GraphMode>("schema")
  useEffect(() => {
    if (window.localStorage.getItem(VIEW_KEY) === "spider") setMode("spider")
  }, [])
  const setModePersist = useCallback((m: GraphMode) => {
    setMode(m)
    window.localStorage.setItem(VIEW_KEY, m)
  }, [])

  const { palette, items, other } = useMemo(() => {
    const counts = new Map<string, number>()
    if (data.typeCounts?.length) {
      for (const tc of data.typeCounts) counts.set(tc.type, tc.count)
    } else {
      for (const n of data.nodes ?? []) {
        const g = n.group ?? "entity"
        counts.set(g, (counts.get(g) ?? 0) + 1)
      }
    }
    const palette = makeGroupPalette(counts)
    const entries = [...counts.entries()].sort((a, b) => compareGroups(a[0], b[0]))
    const named = entries.filter(([g]) => palette.isNamed(g))
    const folded = entries.filter(([g]) => !palette.isNamed(g))
    return {
      palette,
      items: named.map(([group, count]) => ({ group, count, color: palette(group) })),
      other: folded.length ? { groups: folded.map(([g]) => g), count: folded.reduce((s, [, c]) => s + c, 0) } : null,
    }
  }, [data])

  const nodeCount = data.totalNodes || data.nodes?.length || 0
  const edgeCount = data.totalEdges || data.edges?.length || 0
  const shownNodes = data.nodes?.length ?? 0
  const shownEdges = data.edges?.length ?? 0
  const sampled = data.sampled ?? shownNodes < nodeCount

  const toggle = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 px-2.5 py-1 font-medium transition-colors",
      active ? "bg-primary text-primary-foreground" : "text-grid-muted hover:bg-grid-soft hover:text-grid-fg",
    )

  return (
    <div className="zk-graph flex min-h-0 flex-1 flex-col">
      <GraphPaletteStyle />
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-b border-line px-6 py-2 text-xs">
        <div className="inline-flex overflow-hidden border border-line bg-grid-card" role="group" aria-label={t("graph.view")}>
          <button
            type="button"
            onClick={() => setModePersist("schema")}
            aria-pressed={mode === "schema"}
            className={toggle(mode === "schema")}
            title={t("graph.schemaHint")}
          >
            <Columns3Icon className="size-3.5" /> {t("graph.schema")}
          </button>
          <button
            type="button"
            onClick={() => setModePersist("spider")}
            aria-pressed={mode === "spider"}
            className={cn("border-s border-line", toggle(mode === "spider"))}
            title={t("graph.spiderHint")}
          >
            <NetworkIcon className="size-3.5" /> {t("graph.spider")}
          </button>
        </div>

        <span className="h-4 w-px bg-line" aria-hidden />

        {items.map((l) => (
          <span key={l.group} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 shrink-0" style={{ background: l.color }} />
            <span className="text-grid-fg" dir="auto">
              {l.group}
            </span>
            <span className="text-grid-muted">{formatNumber(l.count)}</span>
          </span>
        ))}
        {other ? (
          <span className="inline-flex items-center gap-1.5" title={other.groups.join(", ")}>
            <span aria-hidden className="size-2.5 shrink-0" style={{ background: OTHER_COLOR }} />
            <span className="text-grid-fg">{t("graph.other", { count: formatNumber(other.groups.length) })}</span>
            <span className="text-grid-muted">{formatNumber(other.count)}</span>
          </span>
        ) : null}

        <span
          className="ms-auto whitespace-nowrap text-[11px] text-grid-muted"
          title={
            sampled
              ? t("graph.sampledTitle", {
                  shownNodes: formatNumber(shownNodes),
                  nodes: formatNumber(nodeCount),
                  shownEdges: formatNumber(shownEdges),
                  edges: formatNumber(edgeCount),
                })
              : undefined
          }
        >
          {t("graph.counts", { nodes: formatNumber(nodeCount), edges: formatNumber(edgeCount) })}
          {sampled ? <span> · {t("graph.showing", { count: formatNumber(shownNodes) })}</span> : null}
        </span>
      </div>

      {mode === "schema" ? (
        <SchemaGraphView data={data} namespace={namespace} palette={palette} />
      ) : (
        <SpiderGraphView data={data} namespace={namespace} palette={palette} />
      )}
    </div>
  )
}

// ── Layout geometry (world coordinates) ───────────────────────────────────
const CARD_W = 190
const CARD_H = 44
const CARD_GAP = 9
const COL_PITCH = CARD_W + 104 // the gap is the edge lane
const HEADER_H = 40
const PAD = 44
const MIN_K = 0.15
const MAX_K = 2.4

type Placed = { node: GraphNode; x: number; y: number }
type Column = { group: string; count: number; nodes: GraphNode[]; x: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Cubic-bezier path between two card anchors, routed horizontally. */
function edgePath(a: Placed, b: Placed): string {
  const forward = b.x >= a.x
  const sx = forward ? a.x + CARD_W : a.x
  const sy = a.y + CARD_H / 2
  const tx = forward ? b.x : b.x + CARD_W
  const ty = b.y + CARD_H / 2
  const dx = Math.max(40, Math.abs(tx - sx) * 0.5) * (forward ? 1 : -1)
  return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`
}

function addAdj(adj: Map<string, Set<string>>, a: string, b: string) {
  let s = adj.get(a)
  if (!s) adj.set(a, (s = new Set()))
  s.add(b)
}

/** Adjacency over the edges whose endpoints are both drawn. */
export function buildAdjacency(edges: { source: string; target: string }[], has: (id: string) => boolean) {
  const adj = new Map<string, Set<string>>()
  for (const e of edges) {
    if (!has(e.source) || !has(e.target)) continue
    addAdj(adj, e.source, e.target)
    addAdj(adj, e.target, e.source)
  }
  return adj
}

export function sortedNeighbors(focusId: string | null, adj: Map<string, Set<string>>, nodeById: Map<string, GraphNode>): GraphNode[] {
  if (!focusId) return []
  return [...(adj.get(focusId) ?? [])]
    .map((id) => nodeById.get(id))
    .filter((n): n is GraphNode => !!n)
    .sort((a, b) => compareGroups(a.group ?? "", b.group ?? "") || a.name.localeCompare(b.name))
}

/** The focus banner shared by both views. */
export function FocusBanner({ node, palette, onClear }: { node: GraphNode; palette: (g?: string | null) => string; onClear: () => void }) {
  const { t } = useTranslations()
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center p-3">
      <div className="pointer-events-auto flex items-center gap-2 border border-line bg-grid-card px-3 py-1.5 text-xs">
        <span aria-hidden className="size-2 shrink-0" style={{ background: palette(node.group) }} />
        <span className="text-grid-muted">{t("graph.focusedOn")}</span>
        <span className="max-w-[220px] truncate font-medium text-grid-fg" dir="auto">
          {node.name}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="ms-1 inline-flex items-center gap-1 px-2 py-0.5 text-grid-muted hover:bg-grid-soft hover:text-grid-fg"
        >
          <XIcon className="size-3" /> {t("graph.clearFocus")}
        </button>
      </div>
    </div>
  )
}

function SchemaGraphView({ data, namespace, palette }: { data: GraphData; namespace: string; palette: GroupPalette }) {
  const [focusId, setFocusId] = useState<string | null>(null)
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 })
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [vpSize, setVpSize] = useState({ w: 0, h: 0 })
  const [dragging, setDragging] = useState(false)

  // Columnar layout: group → column, index → row.
  const layout = useMemo(() => {
    const nodes = data.nodes ?? []
    const edges = data.edges ?? []
    const byGroup = new Map<string, GraphNode[]>()
    for (const n of nodes) {
      const g = n.group ?? "entity"
      const arr = byGroup.get(g) ?? []
      arr.push(n)
      byGroup.set(g, arr)
    }
    const groups = [...byGroup.keys()].sort(compareGroups)
    // Column headers show the TRUE population, not how many cards this sampled column holds.
    const trueCount = new Map((data.typeCounts ?? []).map((tc) => [tc.type, tc.count]))
    const pos = new Map<string, Placed>()
    const columns: Column[] = groups.map((group, ci) => {
      const colNodes = byGroup.get(group)!
      const x = PAD + ci * COL_PITCH
      colNodes.forEach((node, ri) => pos.set(node.id, { node, x, y: PAD + HEADER_H + ri * (CARD_H + CARD_GAP) }))
      return { group, count: trueCount.get(group) ?? colNodes.length, nodes: colNodes, x }
    })
    const maxRows = Math.max(1, ...columns.map((c) => c.nodes.length))
    const worldW = PAD * 2 + Math.max(0, columns.length - 1) * COL_PITCH + CARD_W
    const worldH = PAD * 2 + HEADER_H + maxRows * (CARD_H + CARD_GAP)
    const adj = buildAdjacency(edges, (id) => pos.has(id))
    const nodeById = new Map(nodes.map((n) => [n.id, n]))
    return { columns, pos, edges, worldW, worldH, adj, nodeById }
  }, [data])

  const { columns, pos, edges, worldW, worldH, adj, nodeById } = layout

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setVpSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setVpSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const fit = useCallback(() => {
    if (!vpSize.w || !vpSize.h) return
    const k = clamp(Math.min(vpSize.w / (worldW + 40), vpSize.h / (worldH + 40)), MIN_K, MAX_K)
    setView({ k, tx: (vpSize.w - worldW * k) / 2, ty: (vpSize.h - worldH * k) / 2 })
  }, [vpSize, worldW, worldH])

  // Auto-fit on a new dataset or first measure.
  const fitKey = `${namespace}|${worldW}|${worldH}|${vpSize.w}x${vpSize.h}`
  const lastFit = useRef("")
  useEffect(() => {
    if (!vpSize.w || lastFit.current === fitKey) return
    lastFit.current = fitKey
    fit()
  }, [fitKey, vpSize.w, fit])

  useEffect(() => setFocusId(null), [namespace])

  // Wheel zooms toward the cursor.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      setView((v) => {
        const k = clamp(v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12), MIN_K, MAX_K)
        const wx = (mx - v.tx) / v.k
        const wy = (my - v.ty) / v.k
        return { k, tx: mx - wx * k, ty: my - wy * k }
      })
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  const zoomBy = (factor: number) =>
    setView((v) => {
      const k = clamp(v.k * factor, MIN_K, MAX_K)
      const cx = vpSize.w / 2
      const cy = vpSize.h / 2
      const wx = (cx - v.tx) / v.k
      const wy = (cy - v.ty) / v.k
      return { k, tx: cx - wx * k, ty: cy - wy * k }
    })

  // Pan by dragging the background.
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    setView((v) => ({ ...v, tx: d.tx + dx, ty: d.ty + dy }))
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    // A click on empty background (no drag) clears focus.
    if (d && !d.moved && (e.target as HTMLElement).dataset.bg === "1") setFocusId(null)
  }

  const neighbors = useMemo(() => {
    if (!focusId) return null
    const set = new Set<string>([focusId])
    for (const id of adj.get(focusId) ?? []) set.add(id)
    return set
  }, [focusId, adj])

  const focusNode = focusId ? nodeById.get(focusId) : null
  const neighborNodes = useMemo(() => sortedNeighbors(focusId, adj, nodeById), [focusId, adj, nodeById])

  return (
    <div className="relative flex min-h-0 flex-1">
      <div
        ref={viewportRef}
        className="relative min-w-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_1px_1px,var(--grid-line)_1px,transparent_0)] [background-size:22px_22px]"
        style={{ cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div data-bg="1" className="absolute inset-0" />
        {focusNode ? <FocusBanner node={focusNode} palette={palette} onClear={() => setFocusId(null)} /> : null}

        {/* The world is laid out in LTR coordinates in both languages. */}
        <div
          dir="ltr"
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.k})` }}
        >
          <svg width={worldW} height={worldH} className="pointer-events-none absolute left-0 top-0 overflow-visible">
            {edges.map((e, i) => {
              const a = pos.get(e.source)
              const b = pos.get(e.target)
              if (!a || !b) return null
              const color = palette((a.node.group === "root" ? b.node.group : a.node.group) ?? undefined)
              const lit = focusId ? e.source === focusId || e.target === focusId : false
              return (
                <path
                  key={i}
                  d={edgePath(a, b)}
                  fill="none"
                  style={{ stroke: color }}
                  strokeWidth={lit ? 2 : 1.25}
                  strokeOpacity={focusId ? (lit ? 0.95 : 0.05) : 0.32}
                />
              )
            })}
          </svg>

          {columns.map((c) => (
            <div
              key={`h-${c.group}`}
              className="absolute flex items-center gap-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.2em]"
              style={{ left: c.x, top: PAD - 6, width: CARD_W }}
            >
              <span aria-hidden className="size-2.5 shrink-0" style={{ background: palette(c.group) }} />
              <span className="truncate text-grid-fg">{c.group}</span>
              <span className="text-grid-muted">{c.count}</span>
            </div>
          ))}

          {columns.map((c) =>
            c.nodes.map((n) => {
              const p = pos.get(n.id)!
              const color = palette(n.group)
              const isFocus = n.id === focusId
              const inFocus = !neighbors || neighbors.has(n.id)
              return (
                <button
                  key={n.id}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    setFocusId(n.id)
                  }}
                  title={n.name}
                  className="absolute flex items-center gap-2 border border-line bg-grid-card px-2.5 text-start"
                  style={{
                    left: p.x,
                    top: p.y,
                    width: CARD_W,
                    height: CARD_H,
                    opacity: inFocus ? 1 : 0.12,
                    outline: isFocus ? `2px solid ${color}` : undefined,
                    outlineOffset: isFocus ? 1 : undefined,
                  }}
                >
                  <span aria-hidden className="h-6 w-1 shrink-0" style={{ background: color }} />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-grid-fg" dir="auto">
                    {n.name}
                  </span>
                </button>
              )
            }),
          )}
        </div>

        <ZoomControls zoomPct={Math.round(view.k * 100)} onZoomIn={() => zoomBy(1.2)} onZoomOut={() => zoomBy(1 / 1.2)} onFit={fit} />
      </div>

      {focusNode ? (
        <NodeDetail
          key={focusNode.id}
          node={focusNode}
          namespace={namespace}
          neighbors={neighborNodes}
          palette={palette}
          onFocus={setFocusId}
          onClose={() => setFocusId(null)}
        />
      ) : null}
    </div>
  )
}

/** The side panel for a focused node: its connections and, for entity nodes, the memory itself. */
export function NodeDetail({
  node,
  namespace,
  neighbors,
  palette = colorForGroup,
  onFocus,
  onClose,
}: {
  node: GraphNode
  namespace: string
  neighbors: GraphNode[]
  palette?: (group?: string | null) => string
  onFocus: (id: string) => void
  onClose: () => void
}) {
  const { t, formatNumber } = useTranslations()
  const uuid = node.id.startsWith("ent:") ? node.id.slice(4) : null
  const mem = useMemory(namespace, uuid)
  const color = palette(node.group)

  return (
    <aside className="flex w-80 shrink-0 flex-col border-s border-line bg-grid-card">
      <div className="flex items-start justify-between gap-2 border-b border-line p-4">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 shrink-0" style={{ background: color }} />
            <Badge variant="outline">{node.group ?? t("graph.node")}</Badge>
          </div>
          <h2 className="break-words text-sm font-medium leading-snug text-grid-fg" dir="auto">
            {node.name}
          </h2>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("common.close")}>
          <XIcon />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mb-5">
          <div className="grid-micro mb-2 flex items-center gap-1.5">
            <Link2Icon className="size-3.5" /> {t("graph.connections")}
            <span>{formatNumber(neighbors.length)}</span>
          </div>
          {neighbors.length === 0 ? (
            <p className="text-xs text-grid-muted">{t("graph.noConnections")}</p>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {neighbors.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onFocus(n.id)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-start hover:bg-grid-soft"
                  >
                    <span aria-hidden className="h-4 w-1 shrink-0" style={{ background: palette(n.group) }} />
                    <span className="min-w-0 flex-1 truncate text-xs text-grid-fg" dir="auto">
                      {n.name}
                    </span>
                    <span className="shrink-0 text-[10px] text-grid-muted">{n.group}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {uuid ? (
          <div>
            <div className="grid-micro mb-2 flex items-center gap-1.5">
              <FileTextIcon className="size-3.5" /> {t("graph.memory")}
            </div>
            {mem.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-grid-muted">
                <Loader2Icon className="size-3.5 animate-spin" /> {t("graph.loadingMemory")}
              </div>
            ) : mem.data?.content ? (
              <>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {mem.data.memoryType ? <Badge variant="secondary">{mem.data.memoryType}</Badge> : null}
                  {mem.data.network ? <Badge variant="secondary">{mem.data.network}</Badge> : null}
                  {mem.data.sourceKind ? <Badge variant="secondary">{mem.data.sourceKind}</Badge> : null}
                </div>
                <pre
                  dir="auto"
                  className="max-h-[46vh] overflow-auto whitespace-pre-wrap break-words border border-line bg-grid-bg p-3 font-mono text-xs leading-relaxed text-grid-body"
                >
                  {mem.data.content}
                </pre>
              </>
            ) : (
              <p className="text-xs text-grid-muted">{mem.error instanceof ApiError ? mem.error.message : t("graph.noMemory")}</p>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  )
}
