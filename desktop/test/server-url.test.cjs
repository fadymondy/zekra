// shared/server-url: which servers the app may be pointed at, and when a
// session (token) still belongs to the configured server.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeServerUrl, sameServer, isLocalHost, isZekraHealth } = require("../out/shared/server-url.js");

test("normalizeServerUrl: https by default, trailing slash and query dropped", () => {
  assert.deepEqual(normalizeServerUrl("zekra.example.com/", false), { url: "https://zekra.example.com" });
  assert.deepEqual(normalizeServerUrl(" https://z.example.com:8443/zekra/?x=1#y ", false), { url: "https://z.example.com:8443/zekra" });
  assert.deepEqual(normalizeServerUrl("", false), { error: "empty" });
  assert.deepEqual(normalizeServerUrl("ftp://x.com", false), { error: "invalid" });
  assert.deepEqual(normalizeServerUrl("https://user:pw@x.com", false), { error: "invalid" });
});

test("normalizeServerUrl: plain http only for a local server in a dev build", () => {
  assert.deepEqual(normalizeServerUrl("http://zekra.example.com", true), { error: "insecure" });
  assert.deepEqual(normalizeServerUrl("http://192.168.1.20:8080", false), { error: "insecure" });
  assert.deepEqual(normalizeServerUrl("http://192.168.1.20:8080", true), { url: "http://192.168.1.20:8080" });
  assert.deepEqual(normalizeServerUrl("http://localhost:8080", true), { url: "http://localhost:8080" });
});

test("isLocalHost", () => {
  for (const h of ["localhost", "127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.0.9", "box.local", "[::1]"]) assert.ok(isLocalHost(h), h);
  for (const h of ["8.8.8.8", "172.32.0.1", "app.zekra.dev", "localhost.evil.com"]) assert.ok(!isLocalHost(h), h);
});

test("sameServer: a session belongs to exactly one server", () => {
  assert.ok(sameServer("https://app.zekra.dev/", "https://APP.zekra.dev"));
  assert.ok(!sameServer("https://app.zekra.dev", "https://app.zekra.dev.evil.com"));
  assert.ok(!sameServer("https://a.com", "http://a.com"));
  assert.ok(!sameServer("https://a.com/x", "https://a.com"));
});

test("isZekraHealth", () => {
  assert.ok(isZekraHealth({ status: "ok", service: "zekra", togo: "1" }));
  assert.ok(!isZekraHealth({ status: "ok" }));
  assert.ok(!isZekraHealth(null));
});
