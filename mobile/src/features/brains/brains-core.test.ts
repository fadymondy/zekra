import assert from "node:assert/strict";
import { test } from "node:test";

import {
  agoParts,
  brainHex,
  canDelete,
  clampIcon,
  exportFileName,
  filterSort,
  formatAgo,
  formatCount,
  isNever,
  mergeBrains,
  monogram,
  resolveColor,
  slugify,
  topTypes,
  validNamespace,
  type BrainListItem,
} from "./brains-core.ts";

test("slugify matches the web console and yields valid namespaces", () => {
  assert.equal(slugify("  Product Research "), "product-research");
  assert.equal(slugify("FlowOS / Q3 — plan"), "flowos-q3-plan");
  assert.equal(slugify("--a__b--"), "a-b");
  assert.equal(slugify("ذكرة"), "");
  const long = slugify("x".repeat(80));
  assert.equal(long.length, 63);
  assert.ok(validNamespace(long));
  assert.ok(!slugify("a" + "-".repeat(62) + "b").endsWith("-"));
});

test("namespace validation", () => {
  assert.ok(validNamespace("a"));
  assert.ok(validNamespace("flowos.v2_x-1"));
  assert.ok(!validNamespace(""));
  assert.ok(!validNamespace("-lead"));
  assert.ok(!validNamespace("Upper"));
  assert.ok(!validNamespace("a".repeat(64)));
});

test("colours resolve from key or hex", () => {
  assert.equal(resolveColor("violet"), "#8b5cf6");
  assert.equal(resolveColor("#ABCDEF"), "#abcdef");
  assert.equal(resolveColor("nope"), "");
  assert.equal(resolveColor(undefined), "");
  assert.equal(brainHex({ colorHex: "#112233", color: "red" }), "#112233");
  assert.equal(brainHex({ color: "red" }), "#ef4444");
});

test("monogram and icon clamp", () => {
  assert.equal(monogram("flowos"), "FL");
  assert.equal(monogram("a.b"), "AB");
  assert.equal(monogram("--"), "··");
  assert.equal(clampIcon(" 🧠✨🚀 "), "🧠✨");
});

test("canDelete is admin/owner only", () => {
  assert.ok(canDelete("owner"));
  assert.ok(canDelete("admin"));
  assert.ok(!canDelete("editor"));
  assert.ok(!canDelete(undefined));
});

test("mergeBrains keeps membership and adds lastAt + namespace-only brains", () => {
  const mine: BrainListItem[] = [
    { namespace: "a", memories: 3, role: "owner", canWrite: true, displayName: "" },
    { namespace: "b", memories: 1, role: "viewer", canWrite: false },
  ];
  const ns: BrainListItem[] = [
    { namespace: "a", memories: 5, lastAt: "2026-09-01T00:00:00Z", displayName: "Alpha" },
    { namespace: "c", memories: 9, lastAt: "2026-09-02T00:00:00Z" },
  ];
  const out = mergeBrains(mine, ns);
  assert.deepEqual(out.map((b) => b.namespace), ["a", "b", "c"]);
  assert.equal(out[0].role, "owner");
  assert.equal(out[0].lastAt, "2026-09-01T00:00:00Z");
  assert.equal(out[0].displayName, "Alpha");
  assert.equal(out[0].memories, 5);
  assert.equal(out[2].role, undefined);
  assert.equal(mergeBrains(mine, undefined).length, 2);
});

test("filterSort searches and sorts", () => {
  const list: BrainListItem[] = [
    { namespace: "zeta", memories: 1, lastAt: "2026-09-03T00:00:00Z" },
    { namespace: "alpha", memories: 30, lastAt: "2026-09-01T00:00:00Z", description: "Research notes" },
    { namespace: "mid", memories: 10, displayName: "Beta", lastAt: "0001-01-01T00:00:00Z" },
  ];
  assert.deepEqual(filterSort(list, "", "recent", "en").map((b) => b.namespace), ["zeta", "alpha", "mid"]);
  assert.deepEqual(filterSort(list, "", "name", "en").map((b) => b.namespace), ["alpha", "mid", "zeta"]);
  assert.deepEqual(filterSort(list, "", "memories", "en").map((b) => b.namespace), ["alpha", "mid", "zeta"]);
  assert.deepEqual(filterSort(list, "RESEARCH", "recent", "en").map((b) => b.namespace), ["alpha"]);
  assert.deepEqual(filterSort(list, "beta", "recent", "en").map((b) => b.namespace), ["mid"]);
  assert.equal(list[0].namespace, "zeta", "input untouched");
});

test("topTypes", () => {
  assert.deepEqual(topTypes({ a: 1, b: 5, c: 3, d: 2 }), { top: [["b", 5], ["c", 3], ["d", 2]], rest: 1 });
  assert.deepEqual(topTypes(undefined), { top: [], rest: 0 });
});

test("relative time", () => {
  const now = Date.parse("2026-09-23T12:00:00Z");
  const at = (ms: number) => new Date(now - ms).toISOString();
  assert.deepEqual(agoParts(at(10_000), now), { n: 0, unit: "now" });
  assert.deepEqual(agoParts(at(5 * 60_000), now), { n: 5, unit: "m" });
  assert.deepEqual(agoParts(at(3 * 3_600_000), now), { n: 3, unit: "h" });
  assert.deepEqual(agoParts(at(2 * 86_400_000), now), { n: 2, unit: "d" });
  assert.deepEqual(agoParts(at(14 * 86_400_000), now), { n: 2, unit: "w" });
  assert.deepEqual(agoParts(at(90 * 86_400_000), now), { n: 3, unit: "mo" });
  assert.deepEqual(agoParts(at(800 * 86_400_000), now), { n: 2, unit: "y" });

  assert.equal(formatAgo(at(3 * 3_600_000), "en", now), "3h ago");
  assert.equal(formatAgo(at(10_000), "en", now), "just now");
  assert.equal(formatAgo("0001-01-01T00:00:00Z", "en", now), "never");
  assert.equal(formatAgo(undefined, "ar", now), "أبدًا");
  assert.equal(formatAgo(at(60 * 60_000), "ar", now), "منذ ساعة");
  assert.equal(formatAgo(at(2 * 3_600_000), "ar", now), "منذ ساعتين");
  assert.equal(formatAgo(at(5 * 86_400_000), "ar", now), "منذ 5 أيام");
  assert.equal(formatAgo(at(15 * 60_000), "ar", now), "منذ 15 دقيقة");
  assert.ok(isNever("1970-01-01T00:00:00Z"));
  assert.ok(!isNever("2026-01-01T00:00:00Z"));
});

test("formatting helpers", () => {
  assert.equal(formatCount(12345), "12,345");
  assert.equal(formatCount(undefined), "—");
  assert.equal(exportFileName("flowos", new Date("2026-09-23T10:00:00Z")), "flowos-2026-09-23.jsonl");
  assert.equal(exportFileName("a/b", new Date("2026-09-23T10:00:00Z")), "a_b-2026-09-23.jsonl");
});
