import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Maximize2, Minus, Plus, X, Link2, FileText, Loader2, Columns3, Network } from "lucide-react";
import { Badge, Button } from "@togo-framework/ui";
import { brainApi, type GraphData, type GraphNode } from "../lib/brain";
import { colorForGroup, compareGroups, makeGroupPalette, OTHER_COLOR, type GroupPalette } from "../lib/brain-colors";
import { SpiderGraphView } from "./brain-spider-view";

type GraphMode = "schema" | "spider";
const VIEW_KEY = "brain-graph-view-mode";

function readMode(): GraphMode {
  if (typeof window === "undefined") return "schema";
  return window.localStorage.getItem(VIEW_KEY) === "spider" ? "spider" : "schema";
}

/** Graph explorer shell: a Schema ⇄ Spider view toggle + a shared colour legend, wrapping the
 * columnar "memory schema" and the force-directed views. Both surfaces share one palette built
 * from the WHOLE graph's type counts (lib/brain-colors), so groups read identically in both and
 * filtering or sampling never repaints them. */
export function BrainGraphView({ data, namespace }: { data: GraphData; namespace: string }) {
  const [mode, setMode] = useState<GraphMode>(readMode);

  const setModePersist = useCallback((m: GraphMode) => {
    setMode(m);
    if (typeof window !== "undefined") window.localStorage.setItem(VIEW_KEY, m);
  }, []);

  // Counts come from data.typeCounts, which the API computes over the WHOLE graph. Tallying
  // data.nodes instead reports the SAMPLE (the server gives each type a quota of
  // limit/#types). Fall back to tallying only for an API too old to send it.
  const { palette, items, other } = useMemo(() => {
    const counts = new Map<string, number>();
    if (data.typeCounts?.length) {
      for (const t of data.typeCounts) counts.set(t.type, t.count);
    } else {
      for (const n of data.nodes ?? []) {
        const g = n.group ?? "entity";
        counts.set(g, (counts.get(g) ?? 0) + 1);
      }
    }
    const palette = makeGroupPalette(counts);
    const entries = [...counts.entries()].sort((a, b) => compareGroups(a[0], b[0]));
    const named = entries.filter(([g]) => palette.isNamed(g));
    const folded = entries.filter(([g]) => !palette.isNamed(g));
    return {
      palette,
      items: named.map(([group, count]) => ({ group, count, color: palette(group) })),
      other: folded.length
        ? { groups: folded.map(([g]) => g), count: folded.reduce((s, [, c]) => s + c, 0) }
        : null,
    };
  }, [data]);

  const nodeCount = data.totalNodes ?? data.nodes?.length ?? 0;
  const edgeCount = data.totalEdges ?? data.edges?.length ?? 0;
  const shownNodes = data.nodes?.length ?? 0;
  const shownEdges = data.edges?.length ?? 0;
  const sampled = data.sampled ?? shownNodes < nodeCount;

  const toggle = (active: boolean) =>
    `inline-flex items-center gap-1.5 px-2.5 py-1 font-medium transition-colors ${
      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
    }`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar: view toggle + shared legend + counts */}
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-b border-border px-3 py-2 text-xs">
        <div className="inline-flex overflow-hidden border border-border bg-background">
          <button onClick={() => setModePersist("schema")} aria-pressed={mode === "schema"} className={toggle(mode === "schema")} title="Columnar memory-schema view">
            <Columns3 className="h-3.5 w-3.5" /> Schema
          </button>
          <button onClick={() => setModePersist("spider")} aria-pressed={mode === "spider"} className={`border-s border-border ${toggle(mode === "spider")}`} title="Force-directed spider view">
            <Network className="h-3.5 w-3.5" /> Spider
          </button>
        </div>

        <span className="h-4 w-px bg-border" aria-hidden />

        {items.map((l) => (
          <span key={l.group} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 shrink-0" style={{ background: l.color }} />
            <span className="capitalize text-foreground">{l.group}</span>
            <span className="num text-muted-foreground">{l.count.toLocaleString()}</span>
          </span>
        ))}
        {other && (
          <span className="inline-flex items-center gap-1.5" title={other.groups.join(", ")}>
            <span aria-hidden className="size-2.5 shrink-0" style={{ background: OTHER_COLOR }} />
            <span className="text-foreground">Other · {other.groups.length} types</span>
            <span className="num text-muted-foreground">{other.count.toLocaleString()}</span>
          </span>
        )}

        <span
          className="num ms-auto whitespace-nowrap text-[11px] text-muted-foreground"
          title={sampled ? `Drawing ${shownNodes} of ${nodeCount} nodes and ${shownEdges} of ${edgeCount} edges` : undefined}
        >
          {nodeCount} nodes · {edgeCount} edges
          {sampled && <span> · showing {shownNodes}</span>}
        </span>
      </div>

      {mode === "schema" ? (
        <SchemaGraphView data={data} namespace={namespace} palette={palette} />
      ) : (
        <SpiderGraphView data={data} namespace={namespace} palette={palette} />
      )}
    </div>
  );
}

// ── Layout geometry (world coordinates) ───────────────────────────────────
const CARD_W = 190;
const CARD_H = 44;
const CARD_GAP = 9;
const COL_PITCH = CARD_W + 104; // column stride — the gap is the edge lane
const HEADER_H = 40; // column header (group name + count)
const PAD = 44;
const MIN_K = 0.15;
const MAX_K = 2.4;

type Placed = { node: GraphNode; x: number; y: number };
type Column = { group: string; count: number; shown: number; nodes: GraphNode[]; x: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Cubic-bezier path between two card anchors, routed horizontally. */
function edgePath(a: Placed, b: Placed): string {
  const forward = b.x >= a.x;
  const sx = forward ? a.x + CARD_W : a.x;
  const sy = a.y + CARD_H / 2;
  const tx = forward ? b.x : b.x + CARD_W;
  const ty = b.y + CARD_H / 2;
  const dx = Math.max(40, Math.abs(tx - sx) * 0.5) * (forward ? 1 : -1);
  return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
}

function SchemaGraphView({ data, namespace, palette }: { data: GraphData; namespace: string; palette: GroupPalette }) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [vpSize, setVpSize] = useState({ w: 0, h: 0 });

  // ── Columnar layout: group → column, index → row ────────────────────────
  const layout = useMemo(() => {
    const nodes = data.nodes ?? [];
    const edges = data.edges ?? [];

    const byGroup = new Map<string, GraphNode[]>();
    for (const n of nodes) {
      const g = n.group ?? "entity";
      const arr = byGroup.get(g) ?? [];
      arr.push(n);
      byGroup.set(g, arr);
    }
    const groups = [...byGroup.keys()].sort(compareGroups);
    // Column headers must show the TRUE population, not how many cards this
    // sampled column happens to hold — same quota artefact as the legend.
    const trueCount = new Map((data.typeCounts ?? []).map((t) => [t.type, t.count]));

    const pos = new Map<string, Placed>();
    const columns: Column[] = groups.map((group, ci) => {
      const colNodes = byGroup.get(group)!;
      const x = PAD + ci * COL_PITCH;
      colNodes.forEach((node, ri) => {
        pos.set(node.id, { node, x, y: PAD + HEADER_H + ri * (CARD_H + CARD_GAP) });
      });
      return { group, count: trueCount.get(group) ?? colNodes.length, shown: colNodes.length, nodes: colNodes, x };
    });

    const maxRows = Math.max(1, ...columns.map((c) => c.nodes.length));
    const worldW = PAD * 2 + Math.max(0, columns.length - 1) * COL_PITCH + CARD_W;
    const worldH = PAD * 2 + HEADER_H + maxRows * (CARD_H + CARD_GAP);

    // adjacency for focus / neighbor lists
    const adj = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!pos.has(e.source) || !pos.has(e.target)) continue;
      (adj.get(e.source) ?? adj.set(e.source, new Set()).get(e.source)!).add(e.target);
      (adj.get(e.target) ?? adj.set(e.target, new Set()).get(e.target)!).add(e.source);
    }

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    return { columns, pos, edges, worldW, worldH, adj, nodeById };
  }, [data]);

  const { columns, pos, edges, worldW, worldH, adj, nodeById } = layout;

  // ── Measure viewport ────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setVpSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setVpSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ── Fit the whole world into the viewport ───────────────────────────────
  const fit = useCallback(() => {
    if (!vpSize.w || !vpSize.h) return;
    const k = clamp(Math.min(vpSize.w / (worldW + 40), vpSize.h / (worldH + 40)), MIN_K, MAX_K);
    setView({ k, tx: (vpSize.w - worldW * k) / 2, ty: (vpSize.h - worldH * k) / 2 });
  }, [vpSize, worldW, worldH]);

  // Auto-fit on new dataset / first measure.
  const fitKey = `${namespace}|${worldW}|${worldH}|${vpSize.w}x${vpSize.h}`;
  const lastFit = useRef("");
  useEffect(() => {
    if (!vpSize.w || lastFit.current === fitKey) return;
    lastFit.current = fitKey;
    fit();
  }, [fitKey, vpSize.w, fit]);

  // Clear focus when the dataset changes.
  useEffect(() => setFocusId(null), [namespace]);

  // ── Zoom (wheel toward cursor) ──────────────────────────────────────────
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const k = clamp(v.k * factor, MIN_K, MAX_K);
        const wx = (mx - v.tx) / v.k;
        const wy = (my - v.ty) / v.k;
        return { k, tx: mx - wx * k, ty: my - wy * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) =>
    setView((v) => {
      const k = clamp(v.k * factor, MIN_K, MAX_K);
      const cx = vpSize.w / 2, cy = vpSize.h / 2;
      const wx = (cx - v.tx) / v.k, wy = (cy - v.ty) / v.k;
      return { k, tx: cx - wx * k, ty: cy - wy * k };
    });

  // ── Pan (drag background) ───────────────────────────────────────────────
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setView((v) => ({ ...v, tx: d.tx + dx, ty: d.ty + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    // A click on empty background (no drag) clears focus.
    if (d && !d.moved && (e.target as HTMLElement).dataset.bg === "1") setFocusId(null);
  };

  // ── Focus / highlight sets ──────────────────────────────────────────────
  const neighbors = useMemo(() => {
    if (!focusId) return null;
    const set = new Set<string>([focusId]);
    for (const id of adj.get(focusId) ?? []) set.add(id);
    return set;
  }, [focusId, adj]);

  const focusNode = focusId ? nodeById.get(focusId) : null;
  const neighborNodes: GraphNode[] = useMemo(() => {
    if (!focusId) return [];
    return [...(adj.get(focusId) ?? [])]
      .map((id) => nodeById.get(id))
      .filter((n): n is GraphNode => !!n)
      .sort((a, b) => compareGroups(a.group ?? "", b.group ?? "") || a.name.localeCompare(b.name));
  }, [focusId, adj, nodeById]);

  return (
    <div className="relative flex min-h-0 flex-1">
        {/* ── Canvas ── */}
        <div
          ref={viewportRef}
          className="relative min-w-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_0)] [background-size:22px_22px]"
          style={{ cursor: drag.current ? "grabbing" : "grab", touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {/* Background hit layer (click to clear focus) */}
          <div data-bg="1" className="absolute inset-0" />

          {/* Focus banner */}
          {focusNode && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center p-3">
              <div className="pointer-events-auto flex items-center gap-2 border border-border bg-card px-3 py-1.5 text-xs">
                <span aria-hidden className="size-2 shrink-0" style={{ background: palette(focusNode.group) }} />
                <span className="text-muted-foreground">Focused on</span>
                <span className="max-w-[220px] truncate font-medium text-foreground">{focusNode.name}</span>
                <button
                  onClick={() => setFocusId(null)}
                  className="ms-1 inline-flex items-center gap-1 px-2 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3 w-3" /> Clear focus
                </button>
              </div>
            </div>
          )}

          {/* Transformed world */}
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.k})` }}
          >
            {/* Edges */}
            <svg
              width={worldW}
              height={worldH}
              className="pointer-events-none absolute left-0 top-0 overflow-visible"
            >
              {edges.map((e, i) => {
                const a = pos.get(e.source), b = pos.get(e.target);
                if (!a || !b) return null;
                const color = palette((a.node.group === "root" ? b.node.group : a.node.group) ?? undefined);
                const lit = focusId ? e.source === focusId || e.target === focusId : false;
                const opacity = focusId ? (lit ? 0.95 : 0.05) : 0.32;
                return (
                  <path
                    key={i}
                    d={edgePath(a, b)}
                    fill="none"
                    style={{ stroke: color }}
                    strokeWidth={lit ? 2 : 1.25}
                    strokeOpacity={opacity}
                  />
                );
              })}
            </svg>

            {/* Column headers */}
            {columns.map((c) => (
              <div
                key={`h-${c.group}`}
                className="absolute flex items-center gap-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.2em]"
                style={{ left: c.x, top: PAD - 6, width: CARD_W }}
              >
                <span aria-hidden className="size-2.5 shrink-0" style={{ background: palette(c.group) }} />
                <span className="truncate text-foreground">{c.group}</span>
                <span className="text-muted-foreground">{c.count}</span>
              </div>
            ))}

            {/* Cards */}
            {columns.map((c) =>
              c.nodes.map((n) => {
                const p = pos.get(n.id)!;
                const color = palette(n.group);
                const isFocus = n.id === focusId;
                const inFocus = !neighbors || neighbors.has(n.id);
                return (
                  <button
                    key={n.id}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setFocusId(n.id);
                    }}
                    title={n.name}
                    className="absolute flex items-center gap-2 border border-border bg-card px-2.5 text-start"
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
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{n.name}</span>
                  </button>
                );
              }),
            )}
          </div>

          {/* Zoom / fit controls */}
          <div className="absolute bottom-3 start-3 z-20 flex flex-col overflow-hidden border border-border bg-card">
            <button onClick={() => zoomBy(1.2)} className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground" title="Zoom in">
              <Plus className="h-4 w-4" />
            </button>
            <button onClick={() => zoomBy(1 / 1.2)} className="flex h-8 w-8 items-center justify-center border-t border-border text-muted-foreground hover:bg-muted hover:text-foreground" title="Zoom out">
              <Minus className="h-4 w-4" />
            </button>
            <button onClick={fit} className="flex h-8 w-8 items-center justify-center border-t border-border text-muted-foreground hover:bg-muted hover:text-foreground" title="Fit to view">
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
          <div className="num absolute bottom-3 start-14 z-20 border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground">
            {Math.round(view.k * 100)}%
          </div>
        </div>

        {/* ── Detail panel ── */}
        {focusNode && (
          <NodeDetail
            key={focusNode.id}
            node={focusNode}
            namespace={namespace}
            neighbors={neighborNodes}
            palette={palette}
            onFocus={setFocusId}
            onClose={() => setFocusId(null)}
          />
        )}
    </div>
  );
}

// ── Detail panel ────────────────────────────────────────────────────────────
export function NodeDetail({
  node,
  namespace,
  neighbors,
  palette = colorForGroup,
  onFocus,
  onClose,
}: {
  node: GraphNode;
  namespace: string;
  neighbors: GraphNode[];
  palette?: (group?: string | null) => string;
  onFocus: (id: string) => void;
  onClose: () => void;
}) {
  const uuid = node.id.startsWith("ent:") ? node.id.slice(4) : null;
  const mem = useQuery({
    queryKey: ["brain", "memory", namespace, uuid],
    queryFn: () => brainApi.getMemory(namespace, uuid!),
    enabled: !!uuid && !!namespace,
  });

  const color = palette(node.group);
  const content = mem.data && !mem.data.error ? mem.data.content : null;

  return (
    <aside className="flex w-80 shrink-0 flex-col border-s border-border bg-card">
      <div className="flex items-start justify-between gap-2 border-b border-border p-4">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 shrink-0" style={{ background: color }} />
            <Badge variant="outline" className="capitalize">{node.group ?? "node"}</Badge>
          </div>
          <h2 className="break-words text-sm font-medium leading-snug text-foreground">{node.name}</h2>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {/* Connections */}
        <div className="mb-5">
          <div className="micro mb-2 flex items-center gap-1.5 text-muted-foreground">
            <Link2 className="h-3.5 w-3.5" /> Connections
            <span>{neighbors.length}</span>
          </div>
          {neighbors.length === 0 ? (
            <p className="text-xs text-muted-foreground">No direct connections.</p>
          ) : (
            <ul className="divide-y divide-border border-y border-border">
              {neighbors.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => onFocus(n.id)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-start hover:bg-muted"
                  >
                    <span aria-hidden className="h-4 w-1 shrink-0" style={{ background: palette(n.group) }} />
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground">{n.name}</span>
                    <span className="shrink-0 text-[10px] capitalize text-muted-foreground">{n.group}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Memory content (entity nodes only) */}
        {uuid && (
          <div>
            <div className="micro mb-2 flex items-center gap-1.5 text-muted-foreground">
              <FileText className="h-3.5 w-3.5" /> Memory
            </div>
            {mem.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading memory…
              </div>
            ) : content ? (
              <>
                {(mem.data?.memoryType || mem.data?.sourceRef) && (
                  <div className="mb-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                    {mem.data?.memoryType && <Badge variant="secondary" className="font-normal">{mem.data.memoryType}</Badge>}
                    {mem.data?.network && <Badge variant="secondary" className="font-normal">{mem.data.network}</Badge>}
                    {mem.data?.sourceKind && <Badge variant="secondary" className="font-normal">{mem.data.sourceKind}</Badge>}
                  </div>
                )}
                <pre className="max-h-[46vh] overflow-auto whitespace-pre-wrap break-words border border-border bg-background p-3 font-mono text-xs leading-relaxed text-card-foreground">
                  {content}
                </pre>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {mem.data?.error ? mem.data.error.message : "No memory content."}
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
