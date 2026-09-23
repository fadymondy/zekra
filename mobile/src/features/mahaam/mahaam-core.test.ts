import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildEnvelope,
  buildFeedbackFields,
  capQueue,
  classifyResponse,
  composeBody,
  consoleSnapshot,
  createRing,
  crashTitle,
  failedCount,
  issueTypeFor,
  monitorOutcome,
  networkSnapshot,
  pageUrl,
  parseDsn,
  redact,
  screenshotTypeOk,
  stableStack,
  validEmail,
  type DeviceInfo,
  type FeedbackDraft,
} from "./mahaam-core.ts";

const device: DeviceInfo = {
  appVersion: "0.1.0",
  build: "42",
  platform: "ios",
  osVersion: "26.0",
  model: "iPhone17,1",
  locale: "ar-SA",
  viewport: "402x874@3",
};

const draft = (over: Partial<FeedbackDraft> = {}): FeedbackDraft => ({
  kind: "bug",
  title: "Search is empty",
  description: "Nothing comes back",
  route: "/note/[id]",
  ...over,
});

test("ring keeps the newest entries up to capacity", () => {
  const r = createRing<number>(3);
  for (let i = 1; i <= 5; i++) r.push(i);
  assert.deepEqual(r.items(), [3, 4, 5]);
  assert.equal(r.size, 3);
  r.items().push(99); // a copy, not the buffer
  assert.equal(r.size, 3);
  r.clear();
  assert.deepEqual(r.items(), []);
});

test("redact strips tokens, JWTs, secret-ish values and URL queries", () => {
  assert.doesNotMatch(redact("Authorization: Bearer abc.def-123"), /abc/);
  assert.equal(redact("sent Bearer abc.def-123"), "sent Bearer [redacted]");
  assert.equal(redact("got eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig_x"), "got [jwt]");
  assert.equal(redact('{"token":"s3cret","ok":1}'), '{"token":[redacted],"ok":1}');
  assert.equal(redact("password=hunter2&x=1"), "password=[redacted]&x=1");
  assert.equal(redact("GET https://app.zekra.dev/api/x?token=abc#frag done"), "GET https://app.zekra.dev/api/x done");
  assert.equal(redact("zekra://auth?code=123"), "zekra://auth");
  assert.equal(redact("plain text stays"), "plain text stays");
});

test("snapshots match the web SDK line formats", () => {
  assert.equal(
    consoleSnapshot([{ level: "error", message: "boom", at: "2026-01-01T00:00:00.000Z" }]),
    "[2026-01-01T00:00:00.000Z] ERROR boom",
  );
  const net = [
    { method: "GET", url: "/api/notes", status: 500, ms: 12, at: "T1" },
    { method: "POST", url: "/api/x", status: null, ms: 3, at: "T2", error: "Network request failed" },
    { method: "GET", url: "/api/ok", status: 200, ms: 5, at: "T3" },
  ];
  assert.equal(networkSnapshot(net, 2), "[T2] POST /api/x → FAILED (Network request failed) 3ms\n[T3] GET /api/ok → 200 5ms");
  assert.equal(failedCount(net), 2);
});

test("kinds map onto the intake's issue types", () => {
  assert.equal(issueTypeFor("bug"), "bug");
  assert.equal(issueTypeFor("idea"), "feature");
  assert.equal(issueTypeFor("question"), "task");
});

test("pageUrl is on the allowed origin and never carries a query", () => {
  assert.equal(pageUrl("https://app.zekra.dev/", "/settings/about?x=1"), "https://app.zekra.dev/settings/about");
  assert.equal(pageUrl("https://app.zekra.dev", ""), "https://app.zekra.dev/");
  assert.equal(pageUrl("https://app.zekra.dev", "note/[id]"), "https://app.zekra.dev/note/[id]");
});

test("buildFeedbackFields produces exactly the intake's fields", () => {
  const fields = buildFeedbackFields({
    key: "pfk_x",
    appUrl: "https://app.zekra.dev",
    draft: draft({ email: "a@b.co" }),
    device,
    crumbs: ["screen /brains"],
    consoleLog: "[t] ERROR x",
    networkLog: "[t] GET /api/a → 500 1ms",
  });
  const map = Object.fromEntries(fields);
  assert.deepEqual(fields.map(([k]) => k), [
    "public_key", "title", "body", "issue_type", "page_url", "route", "user_agent", "viewport", "console_log", "network_log",
  ]);
  assert.equal(map.public_key, "pfk_x");
  assert.equal(map.issue_type, "bug");
  assert.equal(map.page_url, "https://app.zekra.dev/note/[id]");
  assert.equal(map.user_agent, "ZekraMobile/0.1.0 (42; ios 26.0; iPhone17,1; ar-SA)");
  assert.match(map.body, /Nothing comes back/);
  assert.match(map.body, /Contact: a@b\.co/);
  assert.match(map.body, /Recent steps\*\*\n- screen \/brains/);
});

test("diagnostics off sends no logs, device or crumbs", () => {
  const map = Object.fromEntries(buildFeedbackFields({
    key: "k", appUrl: "https://app.zekra.dev", draft: draft(), device: null, crumbs: ["x"], consoleLog: "c", networkLog: "n",
  }));
  assert.equal(map.console_log, undefined);
  assert.equal(map.network_log, undefined);
  assert.equal(map.viewport, undefined);
  assert.equal(map.user_agent, "ZekraMobile");
  assert.doesNotMatch(map.body, /Device:|Recent steps/);
});

test("a crash report gets a title, high priority and a redacted stack", () => {
  const map = Object.fromEntries(buildFeedbackFields({
    key: "k",
    appUrl: "https://app.zekra.dev",
    draft: draft({ title: "", description: "", error: { message: "x is undefined\nmore", stack: "at f (https://h/a?token=1)" } }),
    device,
  }));
  assert.equal(map.title, "Crash: x is undefined");
  assert.equal(map.priority, "high");
  assert.match(map.body, /```\nat f \(https:\/\/h\/a\)\n```/);
  assert.equal(crashTitle({ message: "a".repeat(300) }).length, 200);
});

test("composeBody without a description still carries context", () => {
  const body = composeBody(draft({ description: " " }), device);
  assert.match(body, /^\*\*Reporter context\*\*/);
  assert.match(body, /Screen: \/note\/\[id\]/);
});

test("classifyResponse", () => {
  assert.deepEqual(classifyResponse(201, { key: "MG-7" }), { ok: true, key: "MG-7" });
  assert.deepEqual(classifyResponse(403, { error: "feedback is not available here" }), { ok: false, reason: "unavailable", message: "feedback is not available here" });
  assert.equal((classifyResponse(402, {}) as { reason: string }).reason, "unavailable");
  assert.equal((classifyResponse(422, {}) as { reason: string }).reason, "invalid");
  assert.equal((classifyResponse(413, {}) as { reason: string }).reason, "invalid");
  assert.equal((classifyResponse(429, {}) as { reason: string }).reason, "rate");
  assert.equal((classifyResponse(500, "oops") as { reason: string }).reason, "failed");
});

test("screenshot types and emails", () => {
  assert.ok(screenshotTypeOk("image/jpeg"));
  assert.ok(screenshotTypeOk("IMAGE/PNG"));
  assert.ok(!screenshotTypeOk("image/heic"));
  assert.ok(!screenshotTypeOk(undefined));
  assert.ok(validEmail("a@b.co"));
  assert.ok(!validEmail("a@b"));
});

test("parseDsn", () => {
  assert.deepEqual(parseDsn("https://mdsn_abc@console.mahaam.app/monitor/p-1"), {
    publicKey: "mdsn_abc", projectId: "p-1", url: "https://console.mahaam.app/api/monitor/p-1/envelope",
  });
  assert.equal(parseDsn("https://mdsn_abc@console.mahaam.app/p-1")?.url, "https://console.mahaam.app/api/monitor/p-1/envelope");
  assert.equal(parseDsn(""), null);
  assert.equal(parseDsn(undefined), null);
  assert.equal(parseDsn("not a dsn"), null);
  assert.equal(parseDsn("https://console.mahaam.app/monitor/p-1"), null);
});

test("stableStack drops the message line, install paths and addresses", () => {
  const stack = [
    "TypeError: undefined is not a function (id 1234)",
    "    at render (address at /private/var/containers/Bundle/Application/ABC-123/Zekra.app/main.jsbundle:1:5678)",
    "    at 0x1a2b3c4d",
    "",
  ].join("\n");
  assert.equal(stableStack(stack), "at render (address at main.jsbundle:1:5678)\nat 0x?");
  assert.equal(stableStack(undefined), "");
});

test("buildEnvelope follows the monitor contract", () => {
  const err = new TypeError("bad token=abc");
  err.stack = "TypeError: bad\n    at f (/data/app/x/index.android.bundle:1:2)";
  const env = buildEnvelope("mdsn_k", err, { level: "fatal", environment: "production", release: "0.1.0", device, context: "render", network: "wifi" });
  assert.equal(env.public_key, "mdsn_k");
  assert.equal(env.level, "fatal");
  assert.equal(env.exception_type, "TypeError");
  assert.equal(env.exception_value, "bad token=[redacted]");
  assert.equal(env.stacktrace, "at f (index.android.bundle:1:2)");
  assert.equal(env.server_name, "iPhone17,1");
  assert.deepEqual(env.tags, { os: "ios", os_version: "26.0", app_version: "0.1.0 (42)", device: "iPhone17,1", network: "wifi", context: "render" });
  const msg = buildEnvelope("k", "plain failure", { level: "error", environment: "development", release: "0.1.0", device });
  assert.equal(msg.message, "plain failure");
  assert.equal(msg.exception_type, undefined);
});

test("monitorOutcome and capQueue", () => {
  assert.equal(monitorOutcome(201), "sent");
  assert.equal(monitorOutcome(200), "sent");
  assert.equal(monitorOutcome(403), "disable");
  assert.equal(monitorOutcome(429), "retry");
  assert.equal(monitorOutcome(503), "retry");
  assert.equal(monitorOutcome(null), "retry");
  assert.equal(monitorOutcome(400), "drop");
  assert.deepEqual(capQueue([1, 2, 3, 4], 2), [3, 4]);
  assert.deepEqual(capQueue([1], 2), [1]);
});

test("shake detector: three strong jolts inside a second, then a cooldown", async () => {
  const { createShakeDetector, SHAKE } = await import("./mahaam-core.ts");
  const still = { x: 0, y: 0, z: -1 };
  const jolt = { x: 2.1, y: 0.4, z: -1 }; // ~2.36 g
  const d = createShakeDetector();
  assert.equal(d(still, 0), false);
  assert.equal(d(jolt, 100), false);
  assert.equal(d(jolt, 130), false); // same jolt (inside minGapMs)
  assert.equal(d(jolt, 300), false);
  assert.equal(d(jolt, 500), true);
  assert.equal(d(jolt, 700), false); // cooldown
  assert.equal(d(jolt, 900), false);
  assert.equal(d(jolt, 500 + SHAKE.cooldownMs + 1), false); // hits restart after cooldown
});

test("shake detector ignores slow bumps and ordinary movement", async () => {
  const { createShakeDetector } = await import("./mahaam-core.ts");
  const d = createShakeDetector();
  const jolt = { x: 2.5, y: 0, z: 0 };
  // Three jolts, but spread over more than a second.
  assert.equal(d(jolt, 0), false);
  assert.equal(d(jolt, 600), false);
  assert.equal(d(jolt, 1700), false);
  // Walking-level readings never count.
  for (let t = 2000; t < 4000; t += 60) assert.equal(d({ x: 0.6, y: 1.2, z: -1.1 }, t), false);
});

test("captureSize keeps the long side within 1600 px", async () => {
  const { captureSize } = await import("./mahaam-core.ts");
  // iPhone: 402x874 pt @3 = 2622 px long → points scaled so points*3 <= 1600.
  const ios = captureSize("ios", 402, 874, 3)!;
  assert.ok(ios.height * 3 <= 1600 && ios.height * 3 > 1595);
  assert.ok(Math.abs(ios.width / ios.height - 402 / 874) < 0.001);
  // Android: 411x914 dp @2.625 → pixels.
  const android = captureSize("android", 411, 914, 2.625)!;
  assert.ok(android.height <= 1600 && android.height > 1595);
  assert.ok(Number.isInteger(android.width) && Number.isInteger(android.height));
  assert.equal(captureSize("ios", 375, 667, 2), null); // 1334 px already fits
  assert.equal(captureSize("android", 0, 0, 2), null);
});

test("autoCaptureAllowed", async () => {
  const { autoCaptureAllowed } = await import("./mahaam-core.ts");
  assert.ok(autoCaptureAllowed("/brains", false));
  assert.ok(autoCaptureAllowed("/note/[id]", false));
  assert.ok(!autoCaptureAllowed("/note/[id]", true));
  assert.ok(!autoCaptureAllowed("/sign-in", false));
  assert.ok(!autoCaptureAllowed("/auth/github", false));
  assert.ok(!autoCaptureAllowed("/account/password", false));
  assert.ok(!autoCaptureAllowed("/settings/connect", false));
});
