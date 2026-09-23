import assert from "node:assert/strict";
import { test } from "node:test";

import { badgeLabel, dropFromPage, flattenPages, groupByDay, kindVisual, markPageRead, notificationIdFrom, type AppNotification } from "./notify-core.ts";

const item = (id: string, createdAt: string, readAt: string | null = null): AppNotification => ({
  id, kind: "brain_access", title: id, body: "", route: "", data: {}, createdAt, readAt,
});

test("badgeLabel", () => {
  assert.equal(badgeLabel(0), null);
  assert.equal(badgeLabel(undefined), null);
  assert.equal(badgeLabel(-3), null);
  assert.equal(badgeLabel(7), "7");
  assert.equal(badgeLabel(99), "99");
  assert.equal(badgeLabel(100), "99+");
});

test("notificationIdFrom accepts ids and refuses anything else", () => {
  assert.equal(notificationIdFrom({ notificationId: "0b6c2f9e-1a2b-4c3d-8e9f-001122334455" }), "0b6c2f9e-1a2b-4c3d-8e9f-001122334455");
  assert.equal(notificationIdFrom({}), null);
  assert.equal(notificationIdFrom(null), null);
  assert.equal(notificationIdFrom({ notificationId: 42 }), null);
  assert.equal(notificationIdFrom({ notificationId: "../x" }), null);
  assert.equal(notificationIdFrom({ notificationId: "x".repeat(65) }), null);
});

test("kindVisual", () => {
  assert.equal(kindVisual("brain_access"), "brain");
  assert.equal(kindVisual("presentation_viewed"), "presentation");
  assert.equal(kindVisual("presentation_downloaded"), "download");
  assert.equal(kindVisual("something_new"), "info");
});

test("flattenPages keeps order and drops duplicates", () => {
  const a = item("a", "2026-09-23T10:00:00Z");
  const b = item("b", "2026-09-23T09:00:00Z");
  const c = item("c", "2026-09-22T09:00:00Z");
  const out = flattenPages([{ items: [a, b], unread: 3 }, { items: [b, c], unread: 3 }]);
  assert.deepEqual(out.map((n) => n.id), ["a", "b", "c"]);
  assert.deepEqual(flattenPages(undefined), []);
});

test("groupByDay: today, yesterday, then dates", () => {
  const now = new Date(2026, 8, 23, 15, 0);
  const at = (d: number, h: number) => new Date(2026, 8, d, h, 0).toISOString();
  const groups = groupByDay([item("1", at(23, 14)), item("2", at(23, 1)), item("3", at(22, 23)), item("4", at(20, 9)), item("5", at(20, 8)), item("6", at(1, 8))], now);
  assert.deepEqual(groups.map((g) => [g.day, g.items.map((n) => n.id).join("")]), [
    ["today", "12"],
    ["yesterday", "3"],
    ["earlier", "45"],
    ["earlier", "6"],
  ]);
  assert.deepEqual(groupByDay([], now), []);
});

test("markPageRead and dropFromPage", () => {
  const page = { items: [item("a", "x"), item("b", "x"), item("c", "x", "old")], unread: 2 };
  const one = markPageRead(page, { ids: ["a", "c"] }, "now");
  assert.deepEqual(one.items.map((n) => n.readAt), ["now", null, "old"]);
  const all = markPageRead(page, { all: true }, "now");
  assert.deepEqual(all.items.map((n) => n.readAt), ["now", "now", "old"]);
  assert.equal(markPageRead(page, { ids: ["zzz"] }, "now"), page); // untouched → same object
  assert.deepEqual(dropFromPage(page, "b").items.map((n) => n.id), ["a", "c"]);
  assert.equal(dropFromPage(page, "zzz"), page);
});
