import assert from "node:assert/strict";
import { test } from "node:test";

import * as brains from "../brains/brains-core.ts";
import type { BrainListItem } from "../brains/brains-core.ts";
import {
  MAX_BRAINS,
  TIMELINE_OFFSETS_MIN,
  brainUrl,
  brainsUrl,
  buildSnapshot,
  buildTimeline,
  buildWidgetProps,
  dirOrder,
  moreLabel,
  parseSnapshot,
  snapshotFingerprint,
  widgetCount,
  type WidgetLabels,
} from "./widgets-core.ts";

const NOW = Date.parse("2026-09-23T12:00:00Z");
const h = brains;

const EN: WidgetLabels = {
  title: "Brains",
  memories: "Memories",
  recalls: "Recalls",
  openGaps: "Open gaps",
  statBrains: "Brains",
  statMemories: "Memories",
  statNodes: "Graph nodes",
  statRecalls24h: "Recalls · 24h",
  statOpenGaps: "Open gaps",
  total: "{count} memories",
  updated: "Updated {when}",
  signedOutTitle: "Zekra",
  signedOutBody: "Sign in to see your brains here.",
  emptyTitle: "No brains yet",
  emptyBody: "Open Zekra to create your first brain.",
  more: "+{count} more",
};
const AR: WidgetLabels = { ...EN, title: "الأدمغة", total: "{count} ذكرى", updated: "آخر تحديث {when}", more: "+{count} أخرى" };

const hoursAgo = (n: number) => new Date(NOW - n * 3_600_000).toISOString();

function fleet(n: number): { mine: BrainListItem[]; namespaces: BrainListItem[] } {
  const mine = Array.from({ length: n }, (_, i) => ({ namespace: `b${i}`, memories: 100 * (i + 1), role: "owner" }));
  // b0 is the stalest, b(n-1) the most recent.
  const namespaces = mine.map((b, i) => ({ namespace: b.namespace, memories: b.memories, lastAt: hoursAgo(n - i) }));
  return { mine, namespaces };
}

const STATS = { ready: true, brains: 3, memories: 600, entities: 250_000, edges: 9, agents: 2, sessions24h: 1, recalls24h: 12, openGaps: 0 };

test("signed out: no personal data at all", () => {
  const s = buildSnapshot({ signedIn: false, locale: "ar", mine: fleet(2).mine, now: NOW }, h);
  assert.equal(s.signedIn, false);
  assert.deepEqual(s.brains, []);
  assert.equal(s.stats, null);
  assert.equal(s.pinned, null);
  assert.equal(s.locale, "ar");
});

test("brains are merged with /namespaces and ordered most recent first", () => {
  const { mine, namespaces } = fleet(3);
  const s = buildSnapshot({ signedIn: true, locale: "en", mine, namespaces, now: NOW }, h);
  assert.deepEqual(s.brains.map((b) => b.namespace), ["b2", "b1", "b0"]);
  assert.equal(s.brains[0].lastAt, hoursAgo(1));
  assert.equal(s.brainCount, 3);
});

test("profile fields: colour resolved to hex, icon clamped, zero time dropped", () => {
  const s = buildSnapshot(
    {
      signedIn: true,
      locale: "en",
      mine: [{ namespace: "x", memories: 1, color: "violet", icon: "🧠🧠🧠", displayName: "  X brain " }],
      namespaces: [{ namespace: "x", memories: 1, lastAt: "0001-01-01T00:00:00Z" }],
      now: NOW,
    },
    h,
  );
  assert.equal(s.brains[0].colorHex, "#8b5cf6");
  assert.equal(s.brains[0].icon, "🧠🧠");
  assert.equal(s.brains[0].displayName, "X brain");
  assert.equal(s.brains[0].lastAt, undefined);
});

test("pinned: the last brain opened, else the most recent; detail only for that brain", () => {
  const { mine, namespaces } = fleet(3);
  const opened = buildSnapshot(
    { signedIn: true, locale: "en", mine, namespaces, pinnedNamespace: "b0", pinnedDetail: { namespace: "b0", recalls: 7, openGaps: 2 }, now: NOW },
    h,
  );
  assert.deepEqual(opened.pinned, { namespace: "b0", recalls: 7, openGaps: 2 });

  const gone = buildSnapshot(
    { signedIn: true, locale: "en", mine, namespaces, pinnedNamespace: "deleted", pinnedDetail: { namespace: "deleted", recalls: 1, openGaps: 1 }, now: NOW },
    h,
  );
  assert.deepEqual(gone.pinned, { namespace: "b2" });
});

test("the list is capped, but the pinned brain always stays in it", () => {
  const { mine, namespaces } = fleet(MAX_BRAINS + 4);
  const s = buildSnapshot({ signedIn: true, locale: "en", mine, namespaces, pinnedNamespace: "b0", now: NOW }, h);
  assert.equal(s.brains.length, MAX_BRAINS);
  assert.equal(s.brainCount, MAX_BRAINS + 4);
  assert.ok(s.brains.some((b) => b.namespace === "b0"));
});

test("stats kept only when the brain is ready", () => {
  const { mine } = fleet(1);
  assert.equal(buildSnapshot({ signedIn: true, locale: "en", mine, stats: { ...STATS, ready: false } }, h).stats, null);
  assert.deepEqual(buildSnapshot({ signedIn: true, locale: "en", mine, stats: STATS }, h).stats, {
    brains: 3,
    memories: 600,
    entities: 250_000,
    recalls24h: 12,
    openGaps: 0,
  });
});

test("parseSnapshot round-trips and rejects anything else", () => {
  const { mine, namespaces } = fleet(2);
  const s = buildSnapshot({ signedIn: true, locale: "ar", mine, namespaces, stats: STATS, now: NOW }, h);
  assert.deepEqual(parseSnapshot(JSON.stringify(s)), s);
  assert.equal(parseSnapshot(null), null);
  assert.equal(parseSnapshot("{"), null);
  assert.equal(parseSnapshot(JSON.stringify({ ...s, v: 2 })), null);
  assert.equal(parseSnapshot(JSON.stringify({ ...s, locale: "fr" })), null);
});

test("the fingerprint ignores when the data was fetched", () => {
  const { mine } = fleet(2);
  const a = buildSnapshot({ signedIn: true, locale: "en", mine, now: NOW }, h);
  const b = buildSnapshot({ signedIn: true, locale: "en", mine, now: NOW + 60_000 }, h);
  assert.equal(snapshotFingerprint(a), snapshotFingerprint(b));
  const c = buildSnapshot({ signedIn: true, locale: "en", mine: [{ ...mine[0], memories: 1 }, mine[1]], now: NOW }, h);
  assert.notEqual(snapshotFingerprint(a), snapshotFingerprint(c));
});

test("deep links point at app/brain/[ns].tsx and the Brains tab", () => {
  assert.equal(brainUrl("flowos"), "zekra://brain/flowos");
  assert.equal(brainUrl("my.brain_1-x"), "zekra://brain/my.brain_1-x");
  assert.equal(brainUrl("a b/c"), "zekra://brain/a%20b%2Fc");
  assert.equal(brainsUrl(), "zekra://brains");
});

test("counts: separators, then compact; Latin digits", () => {
  assert.equal(widgetCount(0, h), "0");
  assert.equal(widgetCount(12_345, h), "12,345");
  assert.equal(widgetCount(99_999, h), "99,999");
  assert.equal(widgetCount(250_000, h), "250k");
  assert.equal(widgetCount(1_234_567, h), "1.2M");
  assert.equal(widgetCount(undefined, h), "—");
});

test("props: signed out and empty show a message, not data", () => {
  const out = buildWidgetProps(buildSnapshot({ signedIn: false, locale: "en", now: NOW }, h), EN, h, NOW);
  assert.equal(out.state, "signedOut");
  assert.deepEqual(out.message, { title: EN.signedOutTitle, body: EN.signedOutBody });
  assert.equal(out.pinned, null);
  const empty = buildWidgetProps(buildSnapshot({ signedIn: true, locale: "en", mine: [], now: NOW }, h), EN, h, NOW);
  assert.equal(empty.state, "empty");
  assert.equal(empty.message?.title, EN.emptyTitle);
});

test("props: pinned brain with its stats, list, totals and the stats strip", () => {
  const { mine, namespaces } = fleet(3);
  const s = buildSnapshot(
    { signedIn: true, locale: "en", mine, namespaces, stats: STATS, pinnedNamespace: "b1", pinnedDetail: { namespace: "b1", recalls: 4, openGaps: 2 }, now: NOW },
    h,
  );
  const p = buildWidgetProps(s, EN, h, NOW);
  assert.equal(p.state, "ok");
  assert.equal(p.rtl, false);
  assert.equal(p.pinned?.namespace, "b1");
  assert.equal(p.pinned?.url, "zekra://brain/b1");
  assert.equal(p.pinned?.glyph, "B1");
  assert.equal(p.pinned?.mono, true);
  assert.deepEqual(
    p.pinned?.stats.map((x) => [x.label, x.value, x.tone]),
    [
      ["Memories", "200", "plain"],
      ["Recalls", "4", "ok"],
      ["Open gaps", "2", "warn"],
    ],
  );
  assert.deepEqual(p.rows.map((r) => [r.name, r.ago]), [["b2", "1h ago"], ["b1", "2h ago"], ["b0", "3h ago"]]);
  assert.equal(p.total, "600 memories");
  assert.equal(p.updated, "Updated just now");
  assert.deepEqual(p.stats.map((x) => x.value), ["3", "600", "250k", "12", "0"]);
  assert.deepEqual(p.stats.map((x) => x.tone), ["plain", "plain", "plain", "ok", "plain"]);
  assert.equal(p.rows[0].color, "#6d4de6"); // no colour → brand violet
});

test("props: without the pinned brain's detail its recalls/gaps show a dash", () => {
  const { mine, namespaces } = fleet(2);
  const p = buildWidgetProps(buildSnapshot({ signedIn: true, locale: "en", mine, namespaces, now: NOW }, h), EN, h, NOW);
  assert.deepEqual(p.pinned?.stats.map((x) => x.value), ["200", "—", "—"]);
});

test("props: Arabic is RTL with Arabic relative times", () => {
  const { mine, namespaces } = fleet(2);
  const p = buildWidgetProps(buildSnapshot({ signedIn: true, locale: "ar", mine, namespaces, now: NOW }, h), AR, h, NOW + 30 * 60_000);
  assert.equal(p.rtl, true);
  assert.equal(p.title, "الأدمغة");
  assert.equal(p.rows[0].ago, "منذ ساعتين");
  assert.equal(p.updated, "آخر تحديث منذ 30 دقيقة");
  assert.equal(p.total, "300 ذكرى");
});

test("moreLabel counts the brains a widget could not list", () => {
  const { mine, namespaces } = fleet(MAX_BRAINS + 2);
  const p = buildWidgetProps(buildSnapshot({ signedIn: true, locale: "en", mine, namespaces, now: NOW }, h), EN, h, NOW);
  assert.equal(p.brainCount, MAX_BRAINS + 2);
  assert.equal(moreLabel(p, 5), "+5 more");
  assert.equal(moreLabel(p, MAX_BRAINS + 2), "");
});

test("timeline: relative times advance across the entries", () => {
  const { mine, namespaces } = fleet(1);
  const s = buildSnapshot({ signedIn: true, locale: "en", mine, namespaces, now: NOW }, h);
  const tl = buildTimeline(s, EN, h, NOW);
  assert.equal(tl.length, TIMELINE_OFFSETS_MIN.length);
  assert.equal(tl[0].date.getTime(), NOW);
  assert.equal(tl[0].props.rows[0].ago, "1h ago");
  assert.equal(tl[0].props.updated, "Updated just now");
  const last = tl[tl.length - 1];
  assert.equal(last.date.getTime(), NOW + 360 * 60_000);
  assert.equal(last.props.rows[0].ago, "7h ago");
  assert.equal(last.props.updated, "Updated 6h ago");
  for (let i = 1; i < tl.length; i++) assert.ok(tl[i].date > tl[i - 1].date);
});

test("timeline: a signed-out widget needs one entry", () => {
  assert.equal(buildTimeline(buildSnapshot({ signedIn: false, locale: "en", now: NOW }, h), EN, h, NOW).length, 1);
});

test("dirOrder mirrors rows for RTL only", () => {
  assert.deepEqual(dirOrder([1, 2, 3], false), [1, 2, 3]);
  assert.deepEqual(dirOrder([1, 2, 3], true), [3, 2, 1]);
  const a = [1, 2];
  dirOrder(a, true);
  assert.deepEqual(a, [1, 2]);
});
