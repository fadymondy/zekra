// Unit tests for the offline sync engine's pure parts (src/main/offline/
// sync-core.ts) and the small pure helpers of the desktop services (badge
// bitmap, browser-tab parsing, shortcut validation). Run against the tsc
// output: `npm test` builds main first.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const out = path.join(__dirname, "..", "out");
const core = require(path.join(out, "main/offline/sync-core.js"));
const { badgeBitmap, badgeLabel, BADGE_SIZE } = require(path.join(out, "main/badge-bitmap.js"));
const { parseLsappinfoBundleId, tabScript, isScriptableBrowser } = require(path.join(out, "main/browser-tab.js"));

function note(id, version, extra = {}) {
  return {
    id,
    namespace: "ns",
    title: `t${id}`,
    body: `b${id}`,
    tags: [],
    pinned: false,
    archived: false,
    indexed: true,
    chunks: 1,
    version,
    updatedAt: `2026-01-01T00:00:${String(version).padStart(2, "0")}Z`,
    ...extra,
  };
}

function op(kind, noteId, extra = {}) {
  return {
    opId: `${kind}-${noteId}-${Math.random()}`,
    kind,
    namespace: "ns",
    noteId,
    baseVersion: 1,
    patch: {},
    base: {},
    source: "desktop",
    createdAt: "2026-01-01T00:00:00Z",
    attempts: 0,
    nextAttemptAt: 0,
    ...extra,
  };
}

/* --------------------------------------------------------------- merge */

test("mergeIncoming: new notes are added, older/same versions ignored (at-least-once)", () => {
  const cache = { notes: { a: note("a", 3) }, shadows: {} };
  const res = core.mergeIncoming(cache, [note("a", 2), note("a", 3), note("b", 1)], new Set());
  assert.deepEqual(res.upserted.map((n) => n.id), ["b"]);
  assert.equal(cache.notes.a.version, 3);
  assert.equal(cache.notes.b.version, 1);
});

test("mergeIncoming: a newer version replaces; a tombstone removes", () => {
  const cache = { notes: { a: note("a", 1), b: note("b", 1) }, shadows: {} };
  const res = core.mergeIncoming(cache, [note("a", 2, { title: "new" }), note("b", 2, { deleted: true })], new Set());
  assert.equal(cache.notes.a.title, "new");
  assert.equal(cache.notes.b, undefined);
  assert.deepEqual(res.removed, ["b"]);
});

test("mergeIncoming: a note with queued edits only moves its shadow", () => {
  const local = { ...note("a", 1), title: "mine", pending: true };
  const cache = { notes: { a: local }, shadows: { a: note("a", 1) } };
  const res = core.mergeIncoming(cache, [note("a", 2, { title: "theirs" })], new Set(["a"]));
  assert.equal(res.upserted.length, 0);
  assert.equal(cache.notes.a.title, "mine");
  assert.equal(cache.shadows.a.version, 2);
});

test("normaliseRemote: drops junk, keeps tombstones without body", () => {
  assert.equal(core.normaliseRemote(null), null);
  assert.equal(core.normaliseRemote({ id: 1 }), null);
  const t = core.normaliseRemote({ id: "x", namespace: "ns", body: "secret", deleted: true, version: 4 });
  assert.equal(t.deleted, true);
  assert.equal(t.body, "");
  assert.equal(t.version, 4);
});

/* --------------------------------------------------------------- queue */

test("coalesce: update + update merges patches; base keeps the first value", () => {
  let q = core.coalesce([], op("update", "a", { patch: { title: "x" }, base: { title: "orig" } })).queue;
  q = core.coalesce(q, op("update", "a", { patch: { title: "y", body: "B" }, base: { title: "x", body: "old" } })).queue;
  assert.equal(q.length, 1);
  assert.deepEqual(q[0].patch, { title: "y", body: "B" });
  assert.deepEqual(q[0].base, { title: "orig", body: "old" });
});

test("coalesce: create + update folds into the create; create + delete cancels both", () => {
  let q = core.coalesce([], op("create", "local:1", { patch: { title: "a" } })).queue;
  q = core.coalesce(q, op("update", "local:1", { patch: { body: "b" } })).queue;
  assert.equal(q.length, 1);
  assert.deepEqual(q[0].patch, { title: "a", body: "b" });
  const res = core.coalesce(q, op("delete", "local:1"));
  assert.equal(res.queue.length, 0);
  assert.equal(res.dropped.length, 1);
});

test("coalesce: update + delete becomes one delete at the first base version", () => {
  let q = core.coalesce([], op("update", "a", { baseVersion: 4, patch: { title: "x" } })).queue;
  q = core.coalesce(q, op("delete", "a", { baseVersion: 4 })).queue;
  assert.equal(q.length, 1);
  assert.equal(q[0].kind, "delete");
  assert.equal(q[0].baseVersion, 4);
});

test("coalesce: an update after a queued delete is ignored", () => {
  const q = core.coalesce([], op("delete", "a")).queue;
  const res = core.coalesce(q, op("update", "a", { patch: { title: "late" } }));
  assert.equal(res.ignored, true);
  assert.equal(res.queue.length, 1);
});

test("coalesce: never merges into an in-flight op", () => {
  const q = [op("update", "a", { inflight: true, patch: { title: "x" } })];
  const res = core.coalesce(q, op("update", "a", { patch: { title: "y" } }));
  assert.equal(res.queue.length, 2);
  assert.equal(res.queue[0].patch.title, "x");
});

test("nextReady skips in-flight and backed-off ops", () => {
  const q = [op("update", "a", { inflight: true }), op("update", "b", { nextAttemptAt: 5000 }), op("update", "c")];
  assert.equal(core.nextReady(q, 1000).noteId, "c");
  assert.equal(core.nextReady(q.slice(0, 2), 1000), undefined);
  assert.equal(core.nextReady(q.slice(0, 2), 6000).noteId, "b");
});

/* ------------------------------------------------------------- backoff */

test("backoffDelay: exponential, capped, jittered within bounds", () => {
  const mid = () => 0.5; // no jitter offset
  assert.equal(core.backoffDelay(1, { baseMs: 1000, rand: mid }), 1000);
  assert.equal(core.backoffDelay(2, { baseMs: 1000, rand: mid }), 2000);
  assert.equal(core.backoffDelay(4, { baseMs: 1000, rand: mid }), 8000);
  assert.equal(core.backoffDelay(30, { baseMs: 1000, maxMs: 60000, rand: mid }), 60000);
  const lo = core.backoffDelay(3, { baseMs: 1000, jitter: 0.2, rand: () => 0 });
  const hi = core.backoffDelay(3, { baseMs: 1000, jitter: 0.2, rand: () => 0.999999 });
  assert.equal(lo, 3200);
  assert.ok(hi <= 4800 && hi > 4700);
});

test("classifyStatus maps HTTP outcomes", () => {
  assert.equal(core.classifyStatus(200), "ok");
  assert.equal(core.classifyStatus(201), "ok");
  assert.equal(core.classifyStatus(409), "conflict");
  assert.equal(core.classifyStatus(404), "gone");
  assert.equal(core.classifyStatus(401), "auth");
  assert.equal(core.classifyStatus(0), "retry");
  assert.equal(core.classifyStatus(503), "retry");
  assert.equal(core.classifyStatus(429), "retry");
  assert.equal(core.classifyStatus(403), "reject");
  assert.equal(core.classifyStatus(400), "reject");
});

/* ----------------------------------------------------------- conflicts */

test("resolveConflict: disjoint fields rebase (server pinned, we edited the body)", () => {
  const current = note("a", 5, { pinned: true, body: "orig" });
  const r = core.resolveConflict({ body: "orig" }, { body: "mine" }, current);
  assert.equal(r.kind, "rebase");
  assert.deepEqual(r.patch, { body: "mine" });
});

test("resolveConflict: both changed the body -> fork, server text kept, ours as a copy", () => {
  const current = note("a", 5, { title: "T", body: "theirs" });
  const r = core.resolveConflict({ body: "orig", pinned: false }, { body: "mine", pinned: true }, current);
  assert.equal(r.kind, "fork");
  assert.deepEqual(r.fields, ["body"]);
  assert.deepEqual(r.patch, { pinned: true }); // metadata: ours still applies
  assert.equal(r.copy.body, "mine");
  assert.equal(r.copy.title, "T");
});

test("resolveConflict: same value on both sides is not a conflict", () => {
  const r = core.resolveConflict({ title: "a" }, { title: "b" }, note("a", 3, { title: "b" }));
  assert.equal(r.kind, "rebase");
  assert.deepEqual(r.patch, {});
});

test("resolveConflict: metadata changed on both sides -> ours wins", () => {
  const r = core.resolveConflict({ tags: ["x"] }, { tags: ["mine"] }, note("a", 3, { tags: ["theirs"] }));
  assert.equal(r.kind, "rebase");
  assert.deepEqual(r.patch, { tags: ["mine"] });
});

test("conflictCopyTitle", () => {
  const at = new Date(2026, 8, 23, 14, 5);
  assert.equal(core.conflictCopyTitle("Plan", at), "Plan (conflicted copy 2026-09-23 14:05)");
  assert.equal(core.conflictCopyTitle("", at, "نسخة متعارضة"), "Untitled (نسخة متعارضة 2026-09-23 14:05)");
});

test("resolveBaseVersion follows this app's own pushes", () => {
  const chain = {};
  core.recordSelfWrite(chain, "a", 3, 4);
  core.recordSelfWrite(chain, "a", 4, 6);
  assert.equal(core.resolveBaseVersion(chain, "a", 3), 6);
  assert.equal(core.resolveBaseVersion(chain, "a", 5), 5);
  assert.equal(core.resolveBaseVersion(chain, "b", 3), 3);
});

test("localView: server copy + queued edits; a delete hides it; a create makes a local note", () => {
  const v = core.localView(note("a", 2), [op("update", "a", { patch: { title: "X", pinned: true } })], "2026-02-02T00:00:00Z");
  assert.equal(v.title, "X");
  assert.equal(v.pinned, true);
  assert.equal(v.pending, true);
  assert.equal(v.version, 2);
  assert.equal(core.localView(note("a", 2), [op("delete", "a")], "x"), null);
  const c = core.localView(undefined, [op("create", "local:9", { patch: { title: "new", tags: ["t"] } })], "x");
  assert.equal(c.id, "local:9");
  assert.equal(c.localOnly, true);
  assert.deepEqual(c.tags, ["t"]);
});

/* -------------------------------------------------------------- query */

test("queryNotes: filters, search, pinned-first order and paging", () => {
  const all = [
    note("1", 1, { updatedAt: "2026-01-01T00:00:01Z" }),
    note("2", 1, { updatedAt: "2026-01-01T00:00:03Z", archived: true }),
    note("3", 1, { updatedAt: "2026-01-01T00:00:02Z", pinned: true, title: "Alpha" }),
    note("4", 1, { updatedAt: "2026-01-01T00:00:04Z", body: "hello WORLD", tags: ["x"] }),
  ];
  assert.deepEqual(core.queryNotes(all).notes.map((n) => n.id), ["3", "4", "1"]);
  assert.deepEqual(core.queryNotes(all, { filter: "archived" }).notes.map((n) => n.id), ["2"]);
  assert.deepEqual(core.queryNotes(all, { filter: "pinned" }).notes.map((n) => n.id), ["3"]);
  assert.deepEqual(core.queryNotes(all, { q: "world" }).notes.map((n) => n.id), ["4"]);
  assert.deepEqual(core.queryNotes(all, { tag: "x" }).notes.map((n) => n.id), ["4"]);
  assert.deepEqual(core.queryNotes(all, { sort: "title" }).notes.map((n) => n.title), ["Alpha", "t1", "t4"]);
  const p1 = core.queryNotes(all, { limit: 2 });
  assert.equal(p1.total, 3);
  assert.equal(p1.nextOffset, 2);
  assert.deepEqual(core.queryNotes(all, { limit: 2, offset: 2 }).notes.map((n) => n.id), ["1"]);
});

/* -------------------------------------------------------- small helpers */

test("badge bitmap: empty for 0, 9+ above nine, 32x32 BGRA with a white glyph", () => {
  assert.equal(badgeBitmap(0), null);
  assert.equal(badgeLabel(12), "9+");
  assert.equal(badgeLabel(3), "3");
  const b = badgeBitmap(3);
  assert.equal(b.length, BADGE_SIZE * BADGE_SIZE * 4);
  const at = (x, y) => Array.from(b.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4));
  assert.deepEqual(at(0, 0).slice(3), [0]); // outside the disc: transparent
  assert.equal(at(16, 16)[3], 255); // centre opaque
  const white = [];
  for (let i = 0; i < b.length; i += 4) if (b[i] === 255 && b[i + 1] === 255 && b[i + 2] === 255) white.push(i);
  assert.ok(white.length > 50);
});

test("lsappinfo parsing and browser scripts", () => {
  const out = '[ NULL ]  ASN:0x0-0x187a879: (in front)\n    bundleID="com.google.Chrome"\n    bundle path=[ NULL ]';
  assert.equal(parseLsappinfoBundleId(out), "com.google.Chrome");
  assert.equal(parseLsappinfoBundleId('"CFBundleIdentifier"="com.apple.Safari"'), "com.apple.Safari");
  assert.equal(parseLsappinfoBundleId("nothing"), null);
  assert.ok(isScriptableBrowser("com.apple.Safari"));
  assert.ok(!isScriptableBrowser("org.mozilla.firefox"));
  assert.match(tabScript("com.apple.Safari"), /current tab of front window/);
  assert.match(tabScript("company.thebrowser.Browser"), /active tab of front window/);
  assert.equal(tabScript("org.mozilla.firefox"), null);
});

test("quick capture shortcuts: defaults, validation, display", () => {
  // quick-capture.js imports electron, which under plain node is only the
  // binary path — nothing runs at load, so the pure helpers are testable.
  const qc = require(path.join(out, "main/quick-capture.js"));
  assert.equal(qc.defaultCaptureShortcut("darwin"), "Alt+Command+N");
  assert.equal(qc.defaultCaptureShortcut("win32"), "Control+Alt+N");
  assert.equal(qc.defaultCaptureShortcut("linux"), "Control+Alt+N");
  assert.ok(qc.validAccelerator("Alt+Command+N", "darwin"));
  assert.ok(qc.validAccelerator("Control+Alt+Space", "linux"));
  assert.ok(!qc.validAccelerator("N", "darwin"));
  assert.ok(!qc.validAccelerator("Shift+N", "darwin"));
  assert.ok(!qc.validAccelerator("Alt+Shift", "darwin"));
  assert.ok(!qc.validAccelerator("Super+N", "win32")); // Win+ belongs to the shell
  assert.equal(qc.displayAccelerator("Alt+Command+N", "darwin"), "⌥⌘N");
  assert.equal(qc.displayAccelerator("Command+Control+Shift+K", "darwin"), "⌃⇧⌘K");
  assert.equal(qc.displayAccelerator("Control+Alt+N", "win32"), "Ctrl+Alt+N");
});
