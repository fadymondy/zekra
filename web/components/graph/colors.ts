// Memory-graph colours, shared by the Schema and Spider views so a group reads the same in both.
// Three categorical slots (the most an all-pairs node graph holds) go to the three most populous
// entity types by whole-graph count; every other type folds into a neutral "other"; the
// structural spine (root / portfolio / venture / type) is drawn in neutral inks. The values are
// CSS variables set by <GraphPaletteStyle/> so they follow light and dark.

const SERIES = ["var(--zk-series-1)", "var(--zk-series-2)", "var(--zk-series-3)"] as const
export const OTHER_COLOR = "var(--zk-series-other)"

const STRUCT: Record<string, string> = {
  root: "var(--zk-node-root)",
  portfolio: "var(--zk-node-structure)",
  venture: "var(--zk-node-structure)",
  type: "var(--zk-node-type)",
}

export interface GroupPalette {
  (group?: string | null): string
  isNamed(group?: string | null): boolean
}

export function makeGroupPalette(counts: Iterable<readonly [string, number]>): GroupPalette {
  const top = [...counts]
    .filter(([g]) => !(g in STRUCT))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, SERIES.length)
  const slot = new Map(top.map(([g], i) => [g, SERIES[i]]))
  const palette = ((group?: string | null) => {
    const g = group ?? "entity"
    return STRUCT[g] ?? slot.get(g) ?? OTHER_COLOR
  }) as GroupPalette
  palette.isNamed = (group) => {
    const g = group ?? "entity"
    return g in STRUCT || slot.has(g)
  }
  return palette
}

export function colorForGroup(group: string | undefined | null): string {
  return STRUCT[group ?? ""] ?? OTHER_COLOR
}

const GROUP_RANK: Record<string, number> = { root: 0, portfolio: 1, venture: 2, type: 3 }

/** Structural spine first, then entity types alphabetically. */
export function compareGroups(a: string, b: string): number {
  const ra = GROUP_RANK[a] ?? 100
  const rb = GROUP_RANK[b] ?? 100
  if (ra !== rb) return ra - rb
  return a.localeCompare(b)
}

/** Validated series values (dataviz validator, --pairs all, on the grid card surfaces). */
export const GRAPH_PALETTE_CSS = `
.zk-graph {
  --zk-series-1: #6d4de6;
  --zk-series-2: #e2661c;
  --zk-series-3: #0891a0;
  --zk-series-other: color-mix(in oklab, var(--grid-muted) 72%, var(--grid-card));
  --zk-node-root: var(--grid-fg);
  --zk-node-structure: var(--grid-body);
  --zk-node-type: var(--grid-muted);
}
.dark .zk-graph, [data-theme="dark"] .zk-graph {
  --zk-series-1: #8f71f0;
  --zk-series-2: #e06a2b;
  --zk-series-3: #1aa2b0;
}
.zk-node:hover .zk-node-core { stroke: var(--grid-fg); stroke-width: 1.5px; }
`
