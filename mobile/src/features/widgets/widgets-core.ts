// Pure logic for the home-screen widgets (MH-360): no React, no RN, so
// `node --test` can run it (widgets-core.test.ts).
//
// Data flow: the app (or a headless refresh) turns what it fetched into a
// compact WidgetSnapshot, persists it, and hands each platform's widget a
// fully resolved WidgetProps — every string already translated and formatted —
// because neither widget can do that itself: the iOS one is evaluated in
// expo-widgets' isolated JavaScriptCore runtime (no imports, no module scope)
// and the Android one renders headless.
//
// The brains helpers (mergeBrains, formatAgo, …) are passed in rather than
// imported, so this file only has type imports (a value import would need a
// `.ts` specifier for node and tsc rejects those); the app passes the real
// module (labels.ts `helpers`) and so does the test.

import type * as BrainsCore from "../brains/brains-core";
import type { BrainDetail, BrainListItem, BrainStats } from "../brains/brains-core";

export type BrainsHelpers = Pick<
  typeof BrainsCore,
  "mergeBrains" | "brainHex" | "brainName" | "monogram" | "clampIcon" | "formatAgo" | "formatCount" | "isNever"
>;

export type WidgetLocale = "en" | "ar";

/** One brain as the widget snapshot keeps it. */
export type SnapshotBrain = {
  namespace: string;
  displayName?: string;
  /** Resolved #rrggbb ("" when the brain has no colour). */
  colorHex: string;
  icon?: string;
  memories: number;
  lastAt?: string;
  role?: string;
};

export type SnapshotStats = Pick<BrainStats, "brains" | "memories" | "entities" | "recalls24h" | "openGaps">;

/** The compact state the app writes whenever it has fresh data. */
export type WidgetSnapshot = {
  v: 1;
  signedIn: boolean;
  locale: WidgetLocale;
  /** ms since epoch — when the data was fetched. */
  updatedAt: number;
  /** Most recent first, at most MAX_BRAINS. */
  brains: SnapshotBrain[];
  /** How many brains the user has in all (brains may be capped). */
  brainCount: number;
  stats: SnapshotStats | null;
  /** The small widget's brain: the last one opened in the app, else the most recent. */
  pinned: { namespace: string; recalls?: number; openGaps?: number } | null;
};

export const MAX_BRAINS = 8;
export const SNAPSHOT_VERSION = 1 as const;

/** What the app hands syncWidgets(): raw API answers, any of which may be missing. */
export type WidgetSourceData = {
  signedIn: boolean;
  locale: WidgetLocale;
  /** GET /api/brain/mine → brains */
  mine?: BrainListItem[];
  /** GET /api/brain/namespaces → brains (adds lastAt) */
  namespaces?: BrainListItem[];
  /** GET /api/brain/stats */
  stats?: BrainStats | null;
  /** The last brain opened in the app (BrainProvider's `namespace`). */
  pinnedNamespace?: string | null;
  /** GET /api/brain/brain?namespace=<pinned> */
  pinnedDetail?: Pick<BrainDetail, "namespace" | "recalls" | "openGaps"> | null;
  now?: number;
};

const time = (iso?: string) => {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** Build the snapshot from whatever the app has fetched. */
export function buildSnapshot(input: WidgetSourceData, h: BrainsHelpers): WidgetSnapshot {
  const now = input.now ?? Date.now();
  if (!input.signedIn) {
    return { v: SNAPSHOT_VERSION, signedIn: false, locale: input.locale, updatedAt: now, brains: [], brainCount: 0, stats: null, pinned: null };
  }
  const merged = h.mergeBrains(input.mine ?? [], input.namespaces);
  const sorted = merged
    .slice()
    .sort((a, b) => time(b.lastAt) - time(a.lastAt) || (b.memories ?? 0) - (a.memories ?? 0) || h.brainName(a).localeCompare(h.brainName(b)));
  const all: SnapshotBrain[] = sorted.map((b) => {
    const out: SnapshotBrain = { namespace: b.namespace, colorHex: h.brainHex(b), memories: b.memories ?? 0 };
    if (b.displayName?.trim()) out.displayName = b.displayName.trim();
    if (b.icon?.trim()) out.icon = h.clampIcon(b.icon);
    if (b.lastAt && !h.isNever(b.lastAt)) out.lastAt = b.lastAt;
    if (b.role) out.role = b.role;
    return out;
  });

  const wanted = input.pinnedNamespace && all.some((b) => b.namespace === input.pinnedNamespace) ? input.pinnedNamespace : all[0]?.namespace;
  const detail = input.pinnedDetail && input.pinnedDetail.namespace === wanted ? input.pinnedDetail : null;
  // The pinned brain is always kept in the list, even past the cap.
  const brains = all.slice(0, MAX_BRAINS);
  if (wanted && !brains.some((b) => b.namespace === wanted)) {
    const p = all.find((b) => b.namespace === wanted);
    if (p) brains[brains.length - 1] = p;
  }

  const s = input.stats;
  return {
    v: SNAPSHOT_VERSION,
    signedIn: true,
    locale: input.locale,
    updatedAt: now,
    brains,
    brainCount: all.length,
    stats: s && s.ready !== false
      ? { brains: s.brains, memories: s.memories, entities: s.entities, recalls24h: s.recalls24h, openGaps: s.openGaps }
      : null,
    pinned: wanted
      ? { namespace: wanted, ...(detail ? { recalls: detail.recalls, openGaps: detail.openGaps } : {}) }
      : null,
  };
}

/** A snapshot read back from storage, or null when it is missing / not ours. */
export function parseSnapshot(raw: string | null | undefined): WidgetSnapshot | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<WidgetSnapshot>;
    if (!v || v.v !== SNAPSHOT_VERSION || typeof v.signedIn !== "boolean" || !Array.isArray(v.brains)) return null;
    if (v.locale !== "en" && v.locale !== "ar") return null;
    if (typeof v.updatedAt !== "number") return null;
    const brains = v.brains.filter(
      (b): b is SnapshotBrain => !!b && typeof b.namespace === "string" && typeof b.memories === "number" && typeof b.colorHex === "string",
    );
    return {
      v: SNAPSHOT_VERSION,
      signedIn: v.signedIn,
      locale: v.locale,
      updatedAt: v.updatedAt,
      brains,
      brainCount: typeof v.brainCount === "number" ? v.brainCount : brains.length,
      stats: v.stats ?? null,
      pinned: v.pinned && typeof v.pinned.namespace === "string" ? v.pinned : null,
    };
  } catch {
    return null;
  }
}

/** The snapshot minus its timestamp, to skip pushing identical data twice. */
export function snapshotFingerprint(s: WidgetSnapshot): string {
  return JSON.stringify({ ...s, updatedAt: 0 });
}

// ─── Deep links ─────────────────────────────────────────────────────────────

export const APP_SCHEME = "zekra";

/** zekra://brain/<ns> — expo-router resolves it to app/brain/[ns].tsx. */
export const brainUrl = (namespace: string) => `${APP_SCHEME}://brain/${encodeURIComponent(namespace)}`;
/** zekra://brains — the Brains tab (the widget background / header tap). */
export const brainsUrl = () => `${APP_SCHEME}://brains`;

// ─── Labels ─────────────────────────────────────────────────────────────────

/** Every translated string a widget shows; resolved by labels.ts. */
export type WidgetLabels = {
  title: string;
  memories: string;
  recalls: string;
  openGaps: string;
  statBrains: string;
  statMemories: string;
  statNodes: string;
  statRecalls24h: string;
  statOpenGaps: string;
  /** "{count} memories" */
  total: string;
  /** "Updated {when}" */
  updated: string;
  signedOutTitle: string;
  signedOutBody: string;
  emptyTitle: string;
  emptyBody: string;
  /** "+{count} more" */
  more: string;
};

const fill = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));

// ─── Numbers ────────────────────────────────────────────────────────────────

/** Latin digits in both languages (the design never localises digits);
 *  separators below 100k, then compact (123k, 1.2M) — widgets are narrow. */
export function widgetCount(n: number | undefined | null, h: Pick<BrainsHelpers, "formatCount">): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 100_000) return h.formatCount(n);
  if (abs < 1_000_000) return `${Math.round(n / 1000)}k`;
  const m = n / 1_000_000;
  return `${m >= 100 ? Math.round(m) : Math.round(m * 10) / 10}M`;
}

// ─── Props the widgets render ───────────────────────────────────────────────

export type WidgetRow = {
  namespace: string;
  name: string;
  /** Emoji icon, else a two-letter monogram. */
  glyph: string;
  /** The glyph is a monogram (drawn in mono type) rather than an emoji. */
  mono: boolean;
  /** Tile colour; the brand violet when the brain has none. */
  color: string;
  memories: string;
  ago: string;
  url: string;
};

export type WidgetStat = { label: string; value: string; tone: "plain" | "ok" | "warn" };

export type WidgetProps = {
  state: "ok" | "empty" | "signedOut";
  rtl: boolean;
  title: string;
  /** "Updated 3m ago" */
  updated: string;
  /** Tap target for the widget as a whole. */
  url: string;
  pinned: (WidgetRow & { stats: WidgetStat[] }) | null;
  /** Most recent first (max MAX_BRAINS). */
  rows: WidgetRow[];
  /** How many brains the user has in all; a widget listing fewer shows moreLabel(). */
  brainCount: number;
  /** "+{count} more" — filled by moreLabel() (inlined in the iOS widget). */
  moreTemplate: string;
  /** "12,345 memories" across the user's brains. */
  total: string;
  /** The Brains-home strip: brains, memories, graph nodes, recalls 24h, open gaps. */
  stats: WidgetStat[];
  message: { title: string; body: string } | null;
};

/** "+5 more" when a widget lists `shown` of the user's brains ("" when it lists them all). */
export function moreLabel(props: Pick<WidgetProps, "brainCount" | "moreTemplate">, shown: number): string {
  const hidden = props.brainCount - shown;
  return hidden > 0 ? fill(props.moreTemplate, { count: String(hidden) }) : "";
}

export const BRAND_VIOLET = "#6d4de6";

function row(b: SnapshotBrain, locale: WidgetLocale, now: number, h: BrainsHelpers): WidgetRow {
  const icon = b.icon?.trim();
  return {
    namespace: b.namespace,
    name: h.brainName(b),
    glyph: icon || h.monogram(b.namespace),
    mono: !icon,
    color: b.colorHex || BRAND_VIOLET,
    memories: widgetCount(b.memories, h),
    ago: h.formatAgo(b.lastAt, locale, now),
    url: brainUrl(b.namespace),
  };
}

/** Everything a widget shows, for the moment `now`. */
export function buildWidgetProps(s: WidgetSnapshot, labels: WidgetLabels, h: BrainsHelpers, now: number = Date.now()): WidgetProps {
  const rtl = s.locale === "ar";
  const base = {
    rtl,
    title: labels.title,
    updated: fill(labels.updated, { when: h.formatAgo(new Date(s.updatedAt).toISOString(), s.locale, now) }),
    url: brainsUrl(),
    pinned: null,
    rows: [],
    brainCount: 0,
    moreTemplate: labels.more,
    total: "",
    stats: [],
  };
  if (!s.signedIn) {
    return { ...base, state: "signedOut", updated: "", message: { title: labels.signedOutTitle, body: labels.signedOutBody } };
  }
  if (!s.brains.length) {
    return { ...base, state: "empty", message: { title: labels.emptyTitle, body: labels.emptyBody } };
  }

  const rows = s.brains.map((b) => row(b, s.locale, now, h));
  const pinnedBrain = s.brains.find((b) => b.namespace === s.pinned?.namespace) ?? s.brains[0];
  const pinnedRow = row(pinnedBrain, s.locale, now, h);
  const hasDetail = s.pinned?.namespace === pinnedBrain.namespace;
  const recalls = hasDetail ? s.pinned?.recalls : undefined;
  const gaps = hasDetail ? s.pinned?.openGaps : undefined;
  const memoriesTotal = s.stats?.memories ?? s.brains.reduce((n, b) => n + b.memories, 0);
  const st = s.stats;

  return {
    ...base,
    state: "ok",
    pinned: {
      ...pinnedRow,
      stats: [
        { label: labels.memories, value: pinnedRow.memories, tone: "plain" },
        { label: labels.recalls, value: widgetCount(recalls, h), tone: recalls ? "ok" : "plain" },
        { label: labels.openGaps, value: widgetCount(gaps, h), tone: gaps ? "warn" : "plain" },
      ],
    },
    rows,
    brainCount: Math.max(s.brainCount, s.brains.length),
    total: fill(labels.total, { count: widgetCount(memoriesTotal, h) }),
    stats: [
      { label: labels.statBrains, value: widgetCount(st?.brains ?? s.brainCount, h), tone: "plain" },
      { label: labels.statMemories, value: widgetCount(st?.memories ?? memoriesTotal, h), tone: "plain" },
      { label: labels.statNodes, value: widgetCount(st?.entities, h), tone: "plain" },
      { label: labels.statRecalls24h, value: widgetCount(st?.recalls24h, h), tone: st?.recalls24h ? "ok" : "plain" },
      { label: labels.statOpenGaps, value: widgetCount(st?.openGaps, h), tone: st?.openGaps ? "warn" : "plain" },
    ],
    message: null,
  };
}

/**
 * Offsets (minutes from the snapshot) of the iOS timeline entries. WidgetKit
 * only re-renders an expo-widgets widget from entries the app wrote — the
 * extension cannot fetch — so the relative times ("5m ago") are pre-rendered
 * for the next six hours: every 10 minutes for the first hour, then every 30.
 */
export const TIMELINE_OFFSETS_MIN = [0, 10, 20, 30, 40, 50, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360];

export function buildTimeline(
  s: WidgetSnapshot,
  labels: WidgetLabels,
  h: BrainsHelpers,
  now: number = Date.now(),
): { date: Date; props: WidgetProps }[] {
  // Signed out / empty never change with time: one entry is enough.
  const offsets = s.signedIn && s.brains.length ? TIMELINE_OFFSETS_MIN : [0];
  return offsets.map((m) => {
    const at = now + m * 60_000;
    return { date: new Date(at), props: buildWidgetProps(s, labels, h, at) };
  });
}

// ─── Brand palette ──────────────────────────────────────────────────────────
// src/theme.ts's light/dark tokens the widgets use. The iOS widget function
// cannot import (it is serialised into the widget runtime), so it inlines the
// same values — keep ios-widget.ios.tsx in step with this.

export type WidgetPalette = Record<"bg" | "card" | "line" | "ink" | "body" | "muted" | "action" | "gold" | "ok" | "warn", string>;

export const WIDGET_PALETTE: { light: WidgetPalette; dark: WidgetPalette } = {
  light: { bg: "#f0ebe1", card: "#f7f4ea", line: "#c7bea9", ink: "#0e1a3c", body: "#4a4438", muted: "#6e6551", action: "#6d4de6", gold: "#c9a227", ok: "#4e9a3e", warn: "#c9a227" },
  dark: { bg: "#0b1429", card: "#0e1a3c", line: "#25355c", ink: "#f0ebe1", body: "#c8d0e4", muted: "#8a97b8", action: "#6d4de6", gold: "#c9a227", ok: "#4e9a3e", warn: "#c9a227" },
};

/** Order a row's children for the reading direction. Neither widget renderer
 *  mirrors on its own (the iOS extension has no Arabic localisation, Android
 *  draws off-screen views that resolve to LTR), so RTL is laid out by hand. */
export function dirOrder<T>(items: T[], rtl: boolean): T[] {
  return rtl ? items.slice().reverse() : items;
}
