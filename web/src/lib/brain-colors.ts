// Memory-graph colours, shared by the Schema and Spider views so a group reads the same in both.
//
// Categorical identity on an ALL-PAIRS form: in a node graph any two groups can sit side by
// side, and under that test a palette only holds three hues (dataviz method). So:
//   - the three most populous entity types (by the API's whole-graph typeCounts, so filtering
//     or sampling never repaints the survivors) take the three validated series slots;
//   - every other entity type folds into one neutral "other";
//   - the structural spine (root / portfolio / venture / type) is drawn in neutral inks and
//     told apart by its column label and position, not by a hue.
// Gold stays out: beside the orange it fails the normal-vision floor.
//
// Values live in styles/kit-bridge.css (--cb-series-*, --cb-node-*) so they follow light/dark.
// Validated with the dataviz skill's validate_palette.js, --pairs all, on the grid's card
// surfaces: light #6d4de6 · #e2661c · #0891a0 on #f7f4ec, dark #8f71f0 · #e06a2b · #1aa2b0 on
// #0e1a3c — every check PASS in both modes.

const SERIES = ["var(--cb-series-1)", "var(--cb-series-2)", "var(--cb-series-3)"] as const;
export const OTHER_COLOR = "var(--cb-series-other)";

const STRUCT: Record<string, string> = {
  root: "var(--cb-node-root)", // the brain core — ink
  portfolio: "var(--cb-node-structure)",
  venture: "var(--cb-node-structure)",
  type: "var(--cb-node-type)", // the type spine — muted
};

/** Resolves a node group to its colour; `isNamed` says whether it has its own legend entry. */
export interface GroupPalette {
  (group?: string | null): string;
  isNamed(group?: string | null): boolean;
}

/** Builds the palette for one graph from its group counts (use the whole-graph typeCounts). */
export function makeGroupPalette(counts: Iterable<readonly [string, number]>): GroupPalette {
  const top = [...counts]
    .filter(([g]) => !(g in STRUCT))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, SERIES.length);
  const slot = new Map(top.map(([g], i) => [g, SERIES[i]]));
  const palette = ((group?: string | null) => {
    const g = group ?? "entity";
    return STRUCT[g] ?? slot.get(g) ?? OTHER_COLOR;
  }) as GroupPalette;
  palette.isNamed = (group) => {
    const g = group ?? "entity";
    return g in STRUCT || slot.has(g);
  };
  return palette;
}

/** Context-free fallback (structural groups + neutral), for surfaces without counts. */
export function colorForGroup(group: string | undefined | null): string {
  return STRUCT[group ?? ""] ?? OTHER_COLOR;
}

// Human ordering for group columns / legend: structural spine first, then
// entity type groups alphabetically.
const GROUP_RANK: Record<string, number> = { root: 0, portfolio: 1, venture: 2, type: 3 };

/** Sort comparator for group keys (structural first, then alpha). */
export function compareGroups(a: string, b: string): number {
  const ra = GROUP_RANK[a] ?? 100;
  const rb = GROUP_RANK[b] ?? 100;
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b);
}
