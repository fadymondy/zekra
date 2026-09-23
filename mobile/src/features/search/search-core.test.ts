import assert from "node:assert/strict";
import { test } from "node:test";

import { groupByBrain, hitMeta, isLiveQuery, noteIdOf, normalizeQuery, parseRecent, pushRecent, RECENT_MAX } from "./search-core.ts";

test("normalizeQuery trims and collapses whitespace", () => {
  assert.equal(normalizeQuery("  hybrid   recall \n"), "hybrid recall");
  assert.equal(normalizeQuery("   "), "");
  assert.equal(normalizeQuery("ذاكرة  الوكيل"), "ذاكرة الوكيل");
});

test("live search waits for two characters", () => {
  assert.equal(isLiveQuery(""), false);
  assert.equal(isLiveQuery(" a "), false);
  assert.equal(isLiveQuery("ab"), true);
  assert.equal(isLiveQuery("ذك"), true);
});

test("noteIdOf reads note refs only", () => {
  assert.equal(noteIdOf("note:abc"), "abc");
  assert.equal(noteIdOf("note:abc#chunk-3"), "abc");
  assert.equal(noteIdOf("note:"), undefined);
  assert.equal(noteIdOf("repo:zekra/README.md"), undefined);
  assert.equal(noteIdOf(undefined), undefined);
});

test("hitMeta joins what is present", () => {
  assert.equal(hitMeta({ memoryType: "fact", sourceKind: "note" }), "fact  ·  note");
  assert.equal(hitMeta({ memoryType: "fact", sourceKind: "" }), "fact");
  assert.equal(hitMeta({}), "");
});

test("pushRecent puts the newest first, de-duplicated", () => {
  assert.deepEqual(pushRecent([], "  hybrid   recall "), ["hybrid recall"]);
  assert.deepEqual(pushRecent(["a b", "cd"], "cd"), ["cd", "a b"]);
  assert.deepEqual(pushRecent(["Redis L1", "cd"], "redis l1"), ["redis l1", "cd"]);
  assert.deepEqual(pushRecent(["x"], "   "), ["x"]);
});

test("pushRecent keeps at most eight", () => {
  let list: string[] = [];
  for (let i = 0; i < 12; i++) list = pushRecent(list, `q${i}`);
  assert.equal(list.length, RECENT_MAX);
  assert.equal(list[0], "q11");
  assert.equal(list[RECENT_MAX - 1], "q4");
});

test("parseRecent survives bad storage", () => {
  assert.deepEqual(parseRecent(null), []);
  assert.deepEqual(parseRecent("not json"), []);
  assert.deepEqual(parseRecent('{"a":1}'), []);
  assert.deepEqual(parseRecent('["a b", 3, "", "  ", "A B", "ذاكرة"]'), ["a b", "ذاكرة"]);
  assert.equal(parseRecent(JSON.stringify(Array.from({ length: 20 }, (_, i) => `q${i}`))).length, RECENT_MAX);
});

test("groupByBrain orders sections by each brain's best hit", () => {
  const hits = [
    { id: 1, namespace: "flowos" },
    { id: 2, namespace: "avo" },
    { id: 3, namespace: "flowos" },
    { id: 4 },
    { id: 5, namespace: "avo" },
  ];
  const groups = groupByBrain(hits);
  assert.deepEqual(groups.map((g) => g.namespace), ["flowos", "avo", ""]);
  assert.deepEqual(groups[0].hits.map((h) => h.id), [1, 3]);
  assert.deepEqual(groups[1].hits.map((h) => h.id), [2, 5]);
  assert.deepEqual(groups[2].hits.map((h) => h.id), [4]);
  assert.deepEqual(groupByBrain([]), []);
});
