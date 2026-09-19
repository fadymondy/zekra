"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { FocusBanner, sortedNeighbors, useGraphFocus, useOpenNotePage } from "@/components/graph/graph-view"
import { NodeHoverCard, NodeInspector, useHoverCard } from "@/components/graph/node-inspector"
import { ZoomControls } from "@/components/graph/zoom-controls"
import type { GraphData, GraphNode } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"

import { colorForGroup } from "./colors"

// Zoom limits (the same feel as the schema view).
const MIN_K = 0.15
const MAX_K = 2.6

// Force-simulation tuning (velocity Verlet with d3-style alpha cooling).
const CHARGE = -800
const SPRING = 0.06
const REST = 74
const GRAV = 0.06
const DECAY = 0.62
const JITTER = 0.55
const ALPHA_DECAY = 0.018
const ALPHA_MIN = 0.0038
const ALPHA_WARM = 0.85
const MAX_V = 90
const SEED_SPREAD = 320

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Deterministic seeded RNG so initial positions are reproducible per node id.
function fnv1a(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// One simulated node, mutated in place by the rAF loop (never via React state).
type SimNode = {
  id: string
  name: string
  group?: string
  color: string
  deg: number
  r: number
  x: number
  y: number
  vx: number
  vy: number
  fx: number | null
  fy: number | null
  labeled: boolean
  gEl: SVGGElement | null
  setGEl: (el: SVGGElement | null) => void
}
type SimEdge = {
  s: SimNode
  t: SimNode
  color: string
  lineEl: SVGLineElement | null
  setLineEl: (el: SVGLineElement | null) => void
}
type View = { k: number; tx: number; ty: number }

/** Spider view: a force-directed layout. Nodes settle from deterministic seeds under repulsion,
 *  edge springs and centring gravity in one requestAnimationFrame loop that parks when cool and
 *  re-heats on interaction. Nodes drag (pin), click (focus + neighbour highlight), and the field
 *  pans and zooms. Nodes are the brand's memory square, sized by degree. */
export function SpiderGraphView({
  data,
  namespace,
  palette = colorForGroup,
  initialFocus = null,
}: {
  data: GraphData
  namespace: string
  palette?: (group?: string | null) => string
  initialFocus?: GraphNode | null
}) {
  const { t } = useTranslations()
  const openNotePage = useOpenNotePage(namespace)
  const hover = useHoverCard()
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [zoomPct, setZoomPct] = useState(100)
  const [panning, setPanning] = useState(false)

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const worldRef = useRef<SVGGElement | null>(null)
  const vpSizeRef = useRef({ w: 0, h: 0 })

  const sim = useMemo(() => {
    const rawNodes = data.nodes ?? []
    const rawEdges = data.edges ?? []
    const deg = new Map<string, number>()
    for (const e of rawEdges) {
      deg.set(e.source, (deg.get(e.source) ?? 0) + 1)
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1)
    }
    const maxDeg = Math.max(1, ...deg.values())
    const nodes: SimNode[] = rawNodes.map((n) => {
      const rng = mulberry32(fnv1a(n.id))
      const ang = rng() * Math.PI * 2
      const rad = Math.sqrt(rng()) * SEED_SPREAD
      const d = deg.get(n.id) ?? 0
      const node: SimNode = {
        id: n.id,
        name: n.name,
        group: n.group,
        color: palette(n.group),
        deg: d,
        r: 4 + Math.min(10, Math.sqrt(d) * 2.1),
        x: Math.cos(ang) * rad,
        y: Math.sin(ang) * rad,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
        labeled: d >= Math.max(4, maxDeg * 0.5),
        gEl: null,
        setGEl: () => {},
      }
      node.setGEl = (el) => {
        node.gEl = el
      }
      return node
    })
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const edges: SimEdge[] = []
    const adj = new Map<string, Set<string>>()
    const link = (a: string, b: string) => {
      let s = adj.get(a)
      if (!s) adj.set(a, (s = new Set()))
      s.add(b)
    }
    for (const e of rawEdges) {
      const s = byId.get(e.source)
      const tt = byId.get(e.target)
      if (!s || !tt) continue
      const edge: SimEdge = {
        s,
        t: tt,
        color: palette((s.group === "root" ? tt.group : s.group) ?? undefined),
        lineEl: null,
        setLineEl: () => {},
      }
      edge.setLineEl = (el) => {
        edge.lineEl = el
      }
      edges.push(edge)
      link(e.source, e.target)
      link(e.target, e.source)
    }
    const nodeById = new Map(rawNodes.map((n) => [n.id, n]))
    return { nodes, edges, adj, nodeById }
  }, [data, palette])

  const { nodes, edges, adj, nodeById } = sim
  const { focusId, focus: setFocusId, focusNode } = useGraphFocus(nodeById, initialFocus, namespace)

  const viewRef = useRef<View>({ k: 1, tx: 0, ty: 0 })
  const alphaRef = useRef(ALPHA_WARM)
  const rafRef = useRef<number | null>(null)
  const runningRef = useRef(false)
  const dragRef = useRef<SimNode | null>(null)
  const jitterRng = useRef(mulberry32(0x9e3779b9))

  const applyView = useCallback(() => {
    const g = worldRef.current
    const v = viewRef.current
    if (g) g.setAttribute("transform", `translate(${v.tx},${v.ty}) scale(${v.k})`)
  }, [])

  const tick = useCallback(() => {
    const ns = sim.nodes
    const es = sim.edges
    const n = ns.length
    let alpha = alphaRef.current
    const rng = jitterRng.current

    // Repulsion, all pairs. O(n²): fine for the sampled graph.
    for (let i = 0; i < n; i++) {
      const a = ns[i]
      for (let j = i + 1; j < n; j++) {
        const b = ns[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) {
          dx = (rng() - 0.5) * 0.1
          dy = (rng() - 0.5) * 0.1
          d2 = dx * dx + dy * dy + 0.01
        }
        const w = (CHARGE * alpha) / d2
        a.vx += dx * w
        a.vy += dy * w
        b.vx -= dx * w
        b.vy -= dy * w
      }
    }

    // Edge springs toward the rest length.
    for (let i = 0; i < es.length; i++) {
      const { s, t: tt } = es[i]
      const dx = tt.x - s.x
      const dy = tt.y - s.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
      const f = ((dist - REST) / dist) * SPRING * alpha
      s.vx += dx * f * 0.5
      s.vy += dy * f * 0.5
      tt.vx -= dx * f * 0.5
      tt.vy -= dy * f * 0.5
    }

    // Centring gravity and live jitter, then integrate.
    let kinetic = 0
    for (let i = 0; i < n; i++) {
      const a = ns[i]
      if (a.fx !== null && a.fy !== null) {
        a.x = a.fx
        a.y = a.fy
        a.vx = 0
        a.vy = 0
        continue
      }
      a.vx += -a.x * GRAV * alpha + (rng() - 0.5) * JITTER * alpha
      a.vy += -a.y * GRAV * alpha + (rng() - 0.5) * JITTER * alpha
      a.vx = clamp(a.vx * DECAY, -MAX_V, MAX_V)
      a.vy = clamp(a.vy * DECAY, -MAX_V, MAX_V)
      a.x += a.vx
      a.y += a.vy
      kinetic += a.vx * a.vx + a.vy * a.vy
    }

    alpha += (0 - alpha) * ALPHA_DECAY
    alphaRef.current = alpha

    // Write positions straight to the DOM, no React.
    for (let i = 0; i < n; i++) {
      const a = ns[i]
      if (a.gEl) a.gEl.setAttribute("transform", `translate(${a.x.toFixed(2)},${a.y.toFixed(2)})`)
    }
    for (let i = 0; i < es.length; i++) {
      const e = es[i]
      const l = e.lineEl
      if (!l) continue
      l.setAttribute("x1", e.s.x.toFixed(2))
      l.setAttribute("y1", e.s.y.toFixed(2))
      l.setAttribute("x2", e.t.x.toFixed(2))
      l.setAttribute("y2", e.t.y.toFixed(2))
    }

    return alpha > ALPHA_MIN || kinetic > 0.6 || dragRef.current !== null
  }, [sim])

  const loopRef = useRef<() => void>(() => {})
  loopRef.current = () => {
    const alive = tick()
    if (alive && !document.hidden) {
      rafRef.current = requestAnimationFrame(() => loopRef.current())
    } else {
      runningRef.current = false
      rafRef.current = null
    }
  }

  const heat = useCallback((to = ALPHA_WARM) => {
    alphaRef.current = Math.max(alphaRef.current, to)
    if (!runningRef.current) {
      runningRef.current = true
      rafRef.current = requestAnimationFrame(() => loopRef.current())
    }
  }, [])

  // Start (and restart on a new dataset) from the seeded layout, centred in the viewport.
  useEffect(() => {
    const { w, h } = vpSizeRef.current
    if (w && h) {
      viewRef.current = { k: 1, tx: w / 2, ty: h / 2 }
      applyView()
      setZoomPct(100)
    }
    alphaRef.current = 1
    heat(1)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      runningRef.current = false
      rafRef.current = null
    }
  }, [sim, heat, applyView])

  useEffect(() => {
    setFocusId(null)
    setHoverId(null)
  }, [namespace])

  useEffect(() => {
    const onVis = () => {
      if (!document.hidden) heat(Math.max(alphaRef.current, 0.05))
    }
    document.addEventListener("visibilitychange", onVis)
    return () => document.removeEventListener("visibilitychange", onVis)
  }, [heat])

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => {
      vpSizeRef.current = { w: el.clientWidth, h: el.clientHeight }
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])

  const fit = useCallback(
    (reheat = true) => {
      const { w, h } = vpSizeRef.current
      if (!w || !h || nodes.length === 0) return
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const nn of nodes) {
        minX = Math.min(minX, nn.x - nn.r)
        minY = Math.min(minY, nn.y - nn.r)
        maxX = Math.max(maxX, nn.x + nn.r)
        maxY = Math.max(maxY, nn.y + nn.r)
      }
      const k = clamp(Math.min(w / (Math.max(1, maxX - minX) + 120), h / (Math.max(1, maxY - minY) + 120)), MIN_K, MAX_K)
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      viewRef.current = { k, tx: w / 2 - cx * k, ty: h / 2 - cy * k }
      applyView()
      setZoomPct(Math.round(k * 100))
      if (reheat) heat(0.5)
    },
    [nodes, applyView, heat],
  )

  // Auto-fit once, shortly after mount, when the cloud has spread from its seeds.
  useEffect(() => {
    const timer = window.setTimeout(() => fit(false), 650)
    return () => window.clearTimeout(timer)
  }, [namespace, fit])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const v = viewRef.current
      const k = clamp(v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12), MIN_K, MAX_K)
      const wx = (mx - v.tx) / v.k
      const wy = (my - v.ty) / v.k
      viewRef.current = { k, tx: mx - wx * k, ty: my - wy * k }
      applyView()
      setZoomPct(Math.round(k * 100))
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [applyView])

  const zoomBy = useCallback(
    (factor: number) => {
      const { w, h } = vpSizeRef.current
      const v = viewRef.current
      const k = clamp(v.k * factor, MIN_K, MAX_K)
      const wx = (w / 2 - v.tx) / v.k
      const wy = (h / 2 - v.ty) / v.k
      viewRef.current = { k, tx: w / 2 - wx * k, ty: h / 2 - wy * k }
      applyView()
      setZoomPct(Math.round(k * 100))
    },
    [applyView],
  )

  // Pointer handling: drag a node (pin it) or pan the empty field.
  const pan = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null)
  const nodeDrag = useRef<{ node: SimNode; moved: boolean } | null>(null)

  const toWorld = (clientX: number, clientY: number) => {
    const rect = viewportRef.current!.getBoundingClientRect()
    const v = viewRef.current
    return { x: (clientX - rect.left - v.tx) / v.k, y: (clientY - rect.top - v.ty) / v.k }
  }

  const onNodePointerDown = (e: React.PointerEvent, node: SimNode) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const p = toWorld(e.clientX, e.clientY)
    node.fx = p.x
    node.fy = p.y
    nodeDrag.current = { node, moved: false }
    dragRef.current = node
    heat(0.6)
  }

  const onPointerDownBg = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const v = viewRef.current
    pan.current = { x: e.clientX, y: e.clientY, tx: v.tx, ty: v.ty, moved: false }
    setPanning(true)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const nd = nodeDrag.current
    if (nd) {
      const p = toWorld(e.clientX, e.clientY)
      nd.node.fx = p.x
      nd.node.fy = p.y
      nd.moved = true
      heat(0.4)
      return
    }
    const d = pan.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    viewRef.current = { ...viewRef.current, tx: d.tx + dx, ty: d.ty + dy }
    applyView()
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const nd = nodeDrag.current
    if (nd) {
      nodeDrag.current = null
      dragRef.current = null
      if (!nd.moved) {
        // A click: toggle focus and free the node again.
        nd.node.fx = null
        nd.node.fy = null
        hover.leave()
        setFocusId(focusId === nd.node.id ? null : nd.node.id)
      }
      heat(0.35)
      return
    }
    const d = pan.current
    pan.current = null
    setPanning(false)
    if (d && !d.moved && (e.target as HTMLElement).dataset.bg === "1") setFocusId(null)
  }

  const onNodeDoubleClick = (e: React.MouseEvent, node: SimNode) => {
    e.stopPropagation()
    node.fx = null
    node.fy = null
    heat(0.5)
    const g = nodeById.get(node.id)
    if (g) openNotePage(g)
  }

  const recenter = () => {
    for (const nn of nodes) {
      nn.fx = null
      nn.fy = null
    }
    heat(1)
    fit(false)
  }

  const neighbors = useMemo(() => {
    if (!focusId) return null
    const set = new Set<string>([focusId])
    for (const id of adj.get(focusId) ?? []) set.add(id)
    return set
  }, [focusId, adj])

  const neighborNodes = useMemo(() => sortedNeighbors(focusId, adj, nodeById), [focusId, adj, nodeById])

  const labelSet = useMemo(() => {
    const s = new Set<string>()
    if (neighbors) for (const id of neighbors) s.add(id)
    if (hoverId) s.add(hoverId)
    return s
  }, [neighbors, hoverId])

  // The static subtree, memoised so pan and zoom never rebuild it; the loop moves it.
  const graph = useMemo(() => {
    const dim = (id: string) => (neighbors ? !neighbors.has(id) : false)
    return (
      <>
        <g>
          {edges.map((e, i) => {
            const lit = focusId ? e.s.id === focusId || e.t.id === focusId : false
            const faded = neighbors ? !lit : false
            return (
              <line
                key={i}
                ref={e.setLineEl}
                style={{ stroke: e.color }}
                strokeWidth={lit ? 1.75 : 1}
                strokeOpacity={faded ? 0.04 : lit ? 0.85 : 0.24}
              />
            )
          })}
        </g>
        <g>
          {nodes.map((n) => {
            const isFocus = n.id === focusId
            const showLabel = isFocus || n.labeled || labelSet.has(n.id)
            const side = n.r * 2
            return (
              <g
                key={n.id}
                ref={n.setGEl}
                className="zk-node cursor-pointer"
                style={{ opacity: dim(n.id) ? 0.12 : 1 }}
                onPointerDown={(e) => onNodePointerDown(e, n)}
                onDoubleClick={(e) => onNodeDoubleClick(e, n)}
                onPointerEnter={(e) => {
                  setHoverId(n.id)
                  const g = nodeById.get(n.id)
                  if (g) hover.enter(g, e)
                }}
                onPointerLeave={() => {
                  setHoverId((h) => (h === n.id ? null : h))
                  hover.leave()
                }}
              >
                <rect x={-n.r - 8} y={-n.r - 8} width={side + 16} height={side + 16} fill="transparent" />
                <rect
                  className="zk-node-core"
                  x={-n.r}
                  y={-n.r}
                  width={side}
                  height={side}
                  shapeRendering="crispEdges"
                  style={{ fill: n.color, stroke: isFocus ? "var(--grid-fg)" : "none", strokeWidth: isFocus ? 2 : 0 }}
                />
                {n.fx !== null ? (
                  <rect
                    x={-n.r - 3.5}
                    y={-n.r - 3.5}
                    width={side + 7}
                    height={side + 7}
                    fill="none"
                    strokeWidth={1}
                    strokeDasharray="2 2"
                    style={{ stroke: n.color, pointerEvents: "none" }}
                  />
                ) : null}
                {showLabel ? (
                  <text
                    x={0}
                    y={-n.r - 6}
                    textAnchor="middle"
                    style={{
                      pointerEvents: "none",
                      fill: "var(--grid-fg)",
                      fontSize: isFocus ? 12 : 10,
                      fontWeight: 500,
                      paintOrder: "stroke",
                      stroke: "var(--grid-card)",
                      strokeWidth: 3,
                      strokeLinejoin: "round",
                    }}
                  >
                    {n.name.length > 26 ? n.name.slice(0, 25) + "…" : n.name}
                  </text>
                ) : null}
              </g>
            )
          })}
        </g>
      </>
    )
    // The node handlers only touch refs; they are deliberately left out of the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, focusId, neighbors, labelSet])

  return (
    <div className="relative flex min-h-0 flex-1">
      <div
        ref={viewportRef}
        className="relative min-w-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_1px_1px,var(--grid-line)_1px,transparent_0)] [background-size:22px_22px]"
        style={{ cursor: panning ? "grabbing" : "grab", touchAction: "none" }}
        onPointerDown={onPointerDownBg}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div data-bg="1" className="absolute inset-0" />
        {focusNode ? <FocusBanner node={focusNode} palette={palette} onClear={() => setFocusId(null)} /> : null}

        <svg direction="ltr" className="absolute inset-0 h-full w-full overflow-visible" style={{ pointerEvents: "none" }}>
          <g ref={worldRef} style={{ pointerEvents: "auto" }}>
            {graph}
          </g>
        </svg>

        <ZoomControls
          zoomPct={zoomPct}
          onZoomIn={() => zoomBy(1.2)}
          onZoomOut={() => zoomBy(1 / 1.2)}
          onFit={recenter}
          fitLabel={t("graph.fitReheat")}
        />
        <div className="pointer-events-none absolute bottom-3 end-3 z-20 hidden border border-line bg-grid-card px-2 py-1 text-[10px] text-grid-muted sm:block">
          {t("graph.spiderHelp")}
        </div>
      </div>

      {hover.card && hover.card.node.id !== focusId ? <NodeHoverCard {...hover.card} /> : null}

      {focusNode ? (
        <NodeInspector
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
