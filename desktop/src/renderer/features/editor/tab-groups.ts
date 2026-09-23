/*
Open-note tabs in one or two side-by-side groups (the split view) — a pure
model, so every rule lives in one place and the workspace only dispatches.

Ported ideas:
  - web/lib/notes/open-tabs.ts   per-brain, window-local persistence; evict the
                                 oldest inactive tab past MAX_TABS; closing
                                 selects the left neighbour, then the right
  - Mark It Down enableSplit     a second editor group beside the first, a
                                 draggable divider (ratio 0.15–0.85)

Rules:
  - A tab has a stable `key` (what React keys its editor by) and a note `id`.
    A new, not-yet-saved note is a DRAFT: id null, key "draft:…". When the
    server creates it the id is filled in and the key kept, so the editor is
    not remounted mid-typing.
  - A note is open in at most one group: two live editors on one note would
    race each other into 409s. Opening a note that is open elsewhere focuses it.
  - "open" replaces the group's active tab (a preview tab, as in editors);
    "open in new tab" appends. A draft is never replaced.
  - The last tab closed in the second group collapses the split.
*/

export type DeskTab = {
  key: string;
  /** null while the note is a draft that has not reached the server. */
  id: string | null;
  title: string;
  category?: string;
  icon?: string;
  color?: string;
};

export type TabGroup = { tabs: DeskTab[]; active: string | null };

export type Layout = {
  groups: TabGroup[]; // 1 or 2
  focus: number;
  /** Width share of the first group when split. */
  ratio: number;
};

export const MAX_TABS = 12;
export const EMPTY_LAYOUT: Layout = { groups: [{ tabs: [], active: null }], focus: 0, ratio: 0.5 };

let seq = 0;
export const draftKey = () => `draft:${Date.now().toString(36)}${(seq++).toString(36)}`;
export const isDraft = (t: DeskTab) => t.id === null;

export function activeTab(layout: Layout, group = layout.focus): DeskTab | null {
  const g = layout.groups[group];
  return g?.tabs.find((t) => t.key === g.active) ?? null;
}

/** Where a note is open: [group, tab] or null. */
export function locate(layout: Layout, id: string): { group: number; tab: DeskTab } | null {
  for (let g = 0; g < layout.groups.length; g++) {
    const tab = layout.groups[g].tabs.find((t) => t.id === id);
    if (tab) return { group: g, tab };
  }
  return null;
}

function setGroup(layout: Layout, i: number, group: TabGroup): Layout {
  const groups = layout.groups.slice();
  groups[i] = group;
  return { ...layout, groups };
}

function evict(tabs: DeskTab[], keep: string): DeskTab[] {
  const next = tabs.slice();
  while (next.length > MAX_TABS) {
    const victim = next.findIndex((x) => x.key !== keep && !isDraft(x));
    if (victim === -1) break;
    next.splice(victim, 1);
  }
  return next;
}

/** Open a tab (a note or a draft) in a group. */
export function openTab(
  layout: Layout,
  tab: DeskTab,
  opts: { newTab?: boolean; group?: number } = {},
): Layout {
  if (tab.id) {
    const at = locate(layout, tab.id);
    if (at) {
      const g = layout.groups[at.group];
      const tabs = g.tabs.map((x) => (x.key === at.tab.key ? { ...x, ...tab, key: x.key } : x));
      return { ...setGroup(layout, at.group, { tabs, active: at.tab.key }), focus: at.group };
    }
  }
  const gi = Math.min(opts.group ?? layout.focus, layout.groups.length - 1);
  const g = layout.groups[gi];
  const current = g.tabs.findIndex((x) => x.key === g.active);
  let tabs: DeskTab[];
  if (!opts.newTab && current >= 0 && !isDraft(g.tabs[current])) {
    tabs = g.tabs.slice();
    tabs[current] = tab;
  } else {
    tabs = g.tabs.slice();
    tabs.splice(current >= 0 ? current + 1 : tabs.length, 0, tab);
  }
  return { ...setGroup(layout, gi, { tabs: evict(tabs, tab.key), active: tab.key }), focus: gi };
}

/** Close a tab; returns the new layout and the tab that closed (for reopen). */
export function closeTab(layout: Layout, key: string): { layout: Layout; closed: DeskTab | null } {
  for (let gi = 0; gi < layout.groups.length; gi++) {
    const g = layout.groups[gi];
    const i = g.tabs.findIndex((t) => t.key === key);
    if (i === -1) continue;
    const closed = g.tabs[i];
    const tabs = g.tabs.filter((t) => t.key !== key);
    const active = g.active !== key ? g.active : (g.tabs[i - 1]?.key ?? g.tabs[i + 1]?.key ?? null);
    let next = setGroup(layout, gi, { tabs, active });
    if (!tabs.length && next.groups.length > 1) next = unsplit(next, gi);
    return { layout: next, closed };
  }
  return { layout, closed: null };
}

export function selectTab(layout: Layout, key: string): Layout {
  for (let gi = 0; gi < layout.groups.length; gi++) {
    if (layout.groups[gi].tabs.some((t) => t.key === key)) {
      return { ...setGroup(layout, gi, { ...layout.groups[gi], active: key }), focus: gi };
    }
  }
  return layout;
}

/** Next / previous tab in the focused group, wrapping. */
export function cycleTab(layout: Layout, delta: 1 | -1): Layout {
  const g = layout.groups[layout.focus];
  if (!g || g.tabs.length < 2) return layout;
  const i = Math.max(0, g.tabs.findIndex((t) => t.key === g.active));
  const next = g.tabs[(i + delta + g.tabs.length) % g.tabs.length];
  return setGroup(layout, layout.focus, { ...g, active: next.key });
}

/** Drag-and-drop: move `key` before `beforeKey` (or to the end) of `toGroup`. */
export function moveTab(layout: Layout, key: string, toGroup: number, beforeKey: string | null): Layout {
  let moving: DeskTab | null = null;
  let from = -1;
  for (let gi = 0; gi < layout.groups.length; gi++) {
    const t = layout.groups[gi].tabs.find((x) => x.key === key);
    if (t) { moving = t; from = gi; break; }
  }
  if (!moving || toGroup >= layout.groups.length) return layout;
  let next = layout;
  // Remove from the source group.
  const src = next.groups[from];
  const srcTabs = src.tabs.filter((t) => t.key !== key);
  const srcActive = src.active === key ? (from === toGroup ? key : (srcTabs[0]?.key ?? null)) : src.active;
  next = setGroup(next, from, { tabs: srcTabs, active: srcActive });
  // Insert into the target group.
  const dst = next.groups[toGroup];
  const tabs = dst.tabs.slice();
  const at = beforeKey ? tabs.findIndex((t) => t.key === beforeKey) : -1;
  tabs.splice(at === -1 ? tabs.length : at, 0, moving);
  next = { ...setGroup(next, toGroup, { tabs, active: key }), focus: toGroup };
  if (from !== toGroup && !next.groups[from].tabs.length && next.groups.length > 1) next = unsplit(next, from);
  return next;
}

/** Split: open a second group, moving `key` (default: the focused tab) into it. */
export function split(layout: Layout, key?: string): Layout {
  if (layout.groups.length > 1) {
    return key ? moveTab(layout, key, layout.focus === 0 ? 1 : 0, null) : layout;
  }
  const first = layout.groups[0];
  const k = key ?? first.active;
  const tab = first.tabs.find((t) => t.key === k);
  if (!tab || first.tabs.length < 2) {
    // Nothing to move: the second group starts empty and focused.
    return { ...layout, groups: [first, { tabs: [], active: null }], focus: 1 };
  }
  const rest = first.tabs.filter((t) => t.key !== k);
  const active = first.active === k ? (rest[0]?.key ?? null) : first.active;
  return { ...layout, groups: [{ tabs: rest, active }, { tabs: [tab], active: tab.key }], focus: 1 };
}

/** Collapse to one group; `emptied` (if given) is the group that went away. */
export function unsplit(layout: Layout, emptied?: number): Layout {
  if (layout.groups.length < 2) return layout;
  const keep = emptied === 0 ? 1 : 0;
  const other = keep === 0 ? 1 : 0;
  const a = layout.groups[keep];
  const b = layout.groups[other];
  const tabs = evict([...a.tabs, ...b.tabs.filter((t) => !a.tabs.some((x) => x.key === t.key))], a.active ?? "");
  const active = a.active ?? b.active ?? tabs[0]?.key ?? null;
  return { ...layout, groups: [{ tabs, active }], focus: 0 };
}

/** Update the tab(s) showing a note (title/appearance after a save). */
export function patchTab(layout: Layout, match: { key?: string; id?: string }, patch: Partial<DeskTab>): Layout {
  let changed = false;
  const groups = layout.groups.map((g) => {
    const tabs = g.tabs.map((t) => {
      if ((match.key && t.key === match.key) || (match.id && t.id === match.id)) {
        changed = true;
        return { ...t, ...patch, key: t.key };
      }
      return t;
    });
    return { ...g, tabs };
  });
  return changed ? { ...layout, groups } : layout;
}

/** Remove every tab showing a note (deleted / archived elsewhere). */
export function dropNote(layout: Layout, id: string): Layout {
  let next = layout;
  for (;;) {
    const at = locate(next, id);
    if (!at) return next;
    next = closeTab(next, at.tab.key).layout;
  }
}

// ─── Persistence ────────────────────────────────────────────────────────────

const KEY = (ns: string) => `zekra.desktop.tabs:${ns}`;

function coerceTab(raw: unknown): DeskTab | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  return {
    key: r.id,
    id: r.id,
    title: typeof r.title === "string" ? r.title : "",
    ...(typeof r.category === "string" && r.category ? { category: r.category } : {}),
    ...(typeof r.icon === "string" && r.icon ? { icon: r.icon } : {}),
    ...(typeof r.color === "string" && r.color ? { color: r.color } : {}),
  };
}

export function loadLayout(ns: string): Layout {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(ns)) ?? "null") as {
      groups?: { tabs?: unknown[]; active?: string | null }[];
      focus?: number;
      ratio?: number;
    } | null;
    if (!raw?.groups?.length) return EMPTY_LAYOUT;
    const seen = new Set<string>();
    const groups: TabGroup[] = raw.groups.slice(0, 2).map((g) => {
      const tabs = (g.tabs ?? [])
        .map(coerceTab)
        .filter((t): t is DeskTab => !!t && !seen.has(t.key) && (seen.add(t.key), true))
        .slice(0, MAX_TABS);
      const active = tabs.some((t) => t.key === g.active) ? (g.active as string) : (tabs[0]?.key ?? null);
      return { tabs, active };
    });
    const nonEmpty = groups.filter((g) => g.tabs.length);
    const final = nonEmpty.length ? nonEmpty : [{ tabs: [], active: null }];
    const ratio = typeof raw.ratio === "number" && raw.ratio >= 0.15 && raw.ratio <= 0.85 ? raw.ratio : 0.5;
    return { groups: final, focus: Math.min(raw.focus ?? 0, final.length - 1), ratio };
  } catch {
    return EMPTY_LAYOUT;
  }
}

export function saveLayout(ns: string, layout: Layout): void {
  try {
    const groups = layout.groups.map((g) => ({
      tabs: g.tabs.filter((t) => !isDraft(t)).map(({ id, title, category, icon, color }) => ({ id, title, category, icon, color })),
      active: g.tabs.find((t) => t.key === g.active)?.id ?? null,
    }));
    localStorage.setItem(KEY(ns), JSON.stringify({ groups, focus: layout.focus, ratio: layout.ratio }));
  } catch {
    /* quota / private mode — tabs are a convenience */
  }
}
