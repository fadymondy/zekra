// Pure search logic shared by the classic and the native (iOS 26+) search
// screens. No react-native imports — covered by search-core.test.ts.

/** Live search waits this long after the last keystroke before asking. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Live (as-you-type) search starts at this many characters; an explicit
 *  submit searches any non-empty query. */
export const LIVE_MIN_CHARS = 2;

/** How many hits to ask the recall engine for. */
export const SEARCH_LIMIT = 30;

/** Collapse whitespace so "  a   b " and "a b" are the same question (and the
 *  same cache entry). */
export function normalizeQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Whether a query typed so far is worth a live search. */
export function isLiveQuery(raw: string): boolean {
  return normalizeQuery(raw).length >= LIVE_MIN_CHARS;
}

/** The note id behind a hit's `sourceRef` ("note:<id>" or "note:<id>#chunk"),
 *  or undefined when the hit isn't a note. */
export function noteIdOf(ref?: string): string | undefined {
  if (!ref?.startsWith("note:")) return undefined;
  const id = ref.slice(5).split("#")[0];
  return id || undefined;
}

/** "memory · note" — the meta line under a hit. */
export function hitMeta(hit: { memoryType?: string; sourceKind?: string }): string {
  return [hit.memoryType, hit.sourceKind].filter(Boolean).join("  ·  ");
}

// ─── Recent searches ────────────────────────────────────────────────────────

/** How many recent searches are kept. */
export const RECENT_MAX = 8;

/** `query` moved to the front of `list`: normalised, de-duplicated
 *  case-insensitively (the newest spelling wins), capped at `max`. */
export function pushRecent(list: readonly string[], query: string, max = RECENT_MAX): string[] {
  const q = normalizeQuery(query);
  if (!q) return list.slice(0, max);
  const key = q.toLocaleLowerCase();
  return [q, ...list.filter((x) => x.toLocaleLowerCase() !== key)].slice(0, max);
}

/** The stored list back from JSON; anything malformed is an empty list. */
export function parseRecent(raw: string | null | undefined, max = RECENT_MAX): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
      const q = typeof item === "string" ? normalizeQuery(item) : "";
      if (q && !out.some((x) => x.toLocaleLowerCase() === q.toLocaleLowerCase())) out.push(q);
      if (out.length >= max) break;
    }
    return out;
  } catch {
    return [];
  }
}

// ─── Grouping ───────────────────────────────────────────────────────────────

export type HitGroup<H> = { namespace: string; hits: H[] };

/**
 * Hits grouped into one section per brain. Sections come in the order of each
 * brain's best (first) hit — the engine returns hits best-first — and hits keep
 * their order inside a section. Hits without a namespace share one "" group.
 */
export function groupByBrain<H extends { namespace?: string }>(hits: readonly H[]): HitGroup<H>[] {
  const groups = new Map<string, H[]>();
  for (const hit of hits) {
    const ns = hit.namespace ?? "";
    const list = groups.get(ns);
    if (list) list.push(hit);
    else groups.set(ns, [hit]);
  }
  return [...groups].map(([namespace, list]) => ({ namespace, hits: list }));
}
