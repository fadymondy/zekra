import assert from "node:assert/strict";
import { test } from "node:test";

import { bannerFrom, derivePushState, pushLocale, pushUserAgent, routeFromData } from "./push-core.ts";

test("routeFromData accepts the three routes the server sends", () => {
  assert.equal(routeFromData({ route: "/note/abc-123" }), "/note/abc-123");
  assert.equal(routeFromData({ route: "/presentation/p_1" }), "/presentation/p_1");
  assert.equal(routeFromData({ route: "/brain/team%20x" }), "/brain/team%20x");
  assert.equal(routeFromData({ route: "/brain/flowos" }), "/brain/flowos");
});

test("routeFromData refuses anything else", () => {
  for (const route of [
    "https://evil.example/note/1",
    "/note/../account/delete",
    "/note/..",
    "/brain/.",
    "/presentation/..",
    "/account/delete",
    "/note/",
    "/note/a/b",
    "//evil.example",
    "/brain/a/b",
    "/brain/x?y=1",
    "javascript:alert(1)",
  ]) {
    assert.equal(routeFromData({ route }), null, route);
  }
  assert.equal(routeFromData(undefined), null);
  assert.equal(routeFromData({ route: 42 }), null);
});

test("routeFromData falls back to typed ids", () => {
  assert.equal(routeFromData({ type: "brain_access", namespace: "my brain" }), "/brain/my%20brain");
  assert.equal(routeFromData({ presentation_id: "p9" }), "/presentation/p9");
  assert.equal(routeFromData({ note_id: "n/../x" }), null);
});

test("derivePushState", () => {
  const base = { available: true, permission: "granted" as const, optedOut: false, registered: true };
  assert.equal(derivePushState(base), "on");
  assert.equal(derivePushState({ ...base, available: false }), "unavailable");
  assert.equal(derivePushState({ ...base, permission: "denied" }), "denied");
  assert.equal(derivePushState({ ...base, permission: "undetermined" }), "off");
  assert.equal(derivePushState({ ...base, optedOut: true }), "off");
  assert.equal(derivePushState({ ...base, registered: false }), "off");
});

test("bannerFrom uses the notification, then data, then the app name", () => {
  const a = bannerFrom({ notification: { title: "Hi", body: "There" }, data: { route: "/note/1" } });
  assert.equal(a.title, "Hi");
  assert.equal(a.body, "There");
  assert.equal(a.route, "/note/1");
  const b = bannerFrom({ data: { title: "T", body: "B" } });
  assert.deepEqual([b.title, b.body, b.route], ["T", "B", null]);
  assert.equal(bannerFrom({}).title, "Zekra");
  // The inbox id rides along (MH-360); anything malformed is dropped.
  assert.equal(a.notificationId, null);
  assert.equal(bannerFrom({ data: { notificationId: "n-1_A" } }).notificationId, "n-1_A");
  assert.equal(bannerFrom({ data: { notificationId: "../../x" } }).notificationId, null);
  assert.notEqual(a.id, b.id);
});

test("pushUserAgent and pushLocale", () => {
  assert.equal(pushUserAgent("ios", "18.2", "0.1.0", "7"), "zekra-mobile/0.1.0 (7) ios 18.2");
  assert.equal(pushLocale("ar-EG"), "ar");
  assert.equal(pushLocale("en"), "en");
  assert.equal(pushLocale(undefined), "en");
});
