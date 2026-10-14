import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLOUD_URL,
  connectTarget,
  isCloud,
  isLocalHost,
  mcpUrlFor,
  normalizeServer,
  parseHealth,
  rememberServer,
  sameServer,
  serverLabel,
  sessionKey,
} from "./server-core.ts";

test("normalizeServer adds https and tidies the URL", () => {
  assert.deepEqual(normalizeServer("zekra.example.com"), { url: "https://zekra.example.com" });
  assert.deepEqual(normalizeServer("  HTTPS://Zekra.Example.com/ "), { url: "https://zekra.example.com" });
  assert.deepEqual(normalizeServer("https://x.io:443/zekra/?a=1#b"), { url: "https://x.io/zekra" });
  assert.deepEqual(normalizeServer("https://x.io:8443"), { url: "https://x.io:8443" });
  assert.deepEqual(normalizeServer("x.io:8443/z/"), { url: "https://x.io:8443/z" });
});

test("normalizeServer rejects what is not a server", () => {
  assert.deepEqual(normalizeServer(""), { error: "empty" });
  assert.deepEqual(normalizeServer("   "), { error: "empty" });
  assert.deepEqual(normalizeServer("ftp://x.io"), { error: "invalid" });
  assert.deepEqual(normalizeServer("javascript:alert(1)"), { error: "invalid" });
  assert.deepEqual(normalizeServer("https://user:pw@x.io"), { error: "invalid" });
  assert.deepEqual(normalizeServer("https://x..io"), { error: "invalid" });
  assert.deepEqual(normalizeServer("https://x.io:0"), { error: "invalid" });
  assert.deepEqual(normalizeServer("https://x.io:70000"), { error: "invalid" });
  assert.deepEqual(normalizeServer("https://"), { error: "invalid" });
});

test("plain http only for local hosts in a development build", () => {
  assert.deepEqual(normalizeServer("http://zekra.example.com"), { error: "insecure" });
  assert.deepEqual(normalizeServer("http://zekra.example.com", { allowLocalHttp: true }), { error: "insecure" });
  assert.deepEqual(normalizeServer("http://localhost:8080"), { error: "insecure" });
  assert.deepEqual(normalizeServer("http://localhost:8080", { allowLocalHttp: true }), { url: "http://localhost:8080" });
  assert.deepEqual(normalizeServer("http://192.168.1.20:8080/", { allowLocalHttp: true }), { url: "http://192.168.1.20:8080" });
  assert.deepEqual(normalizeServer("http://10.0.2.2:8080", { allowLocalHttp: true }), { url: "http://10.0.2.2:8080" });
});

test("isLocalHost", () => {
  for (const h of ["localhost", "api.localhost", "nas.local", "127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.0.1", "172.31.255.1", "169.254.1.1", "[::1]"]) {
    assert.equal(isLocalHost(h), true, h);
  }
  for (const h of ["172.32.0.1", "8.8.8.8", "app.zekra.dev", "localhost.evil.com", "192.169.0.1"]) {
    assert.equal(isLocalHost(h), false, h);
  }
});

test("sameServer only matches the server the token belongs to", () => {
  const base = "https://zekra.example.com";
  assert.equal(sameServer("https://zekra.example.com/api/me", base), true);
  assert.equal(sameServer("https://zekra.example.com", base), true);
  assert.equal(sameServer("https://zekra.example.com?x", base), true);
  assert.equal(sameServer("https://zekra.example.com.evil.io/api", base), false);
  assert.equal(sameServer("https://zekra.example.com:8443/api", base), false);
  assert.equal(sameServer("http://zekra.example.com/api", base), false);
  assert.equal(sameServer("https://other.io/api", base), false);
  assert.equal(sameServer("https://x.io/zekra/api/me", "https://x.io/zekra"), true);
  assert.equal(sameServer("https://x.io/zekra2/api", "https://x.io/zekra"), false);
  assert.equal(sameServer("", base), false);
});

test("sessionKey is secure-store safe and distinct per server", () => {
  const a = sessionKey("https://zekra.example.com");
  const b = sessionKey("https://zekra.example.com:8443/z");
  assert.match(a, /^[A-Za-z0-9._-]+$/);
  assert.match(b, /^[A-Za-z0-9._-]+$/);
  assert.notEqual(a, b);
  assert.notEqual(sessionKey("https://a_b.io"), sessionKey("https://a/5fb.io"));
});

test("parseHealth recognises a Zekra server", () => {
  assert.deepEqual(parseHealth({ status: "ok", service: "zekra", togo: "1.4.0" }), { ok: true, version: "1.4.0" });
  assert.deepEqual(parseHealth({ status: "ok", service: "zekra" }), { ok: true, version: undefined });
  assert.deepEqual(parseHealth({ status: "ok", service: "other" }), { ok: false });
  assert.deepEqual(parseHealth({ status: "down", service: "zekra" }), { ok: false });
  assert.deepEqual(parseHealth("<html>"), { ok: false });
  assert.deepEqual(parseHealth(null), { ok: false });
});

test("labels, cloud and MCP endpoints", () => {
  assert.equal(serverLabel("https://zekra.example.com/z"), "zekra.example.com/z");
  assert.equal(isCloud(CLOUD_URL), true);
  assert.equal(isCloud("https://zekra.example.com"), false);
  assert.equal(mcpUrlFor(CLOUD_URL), "https://mcp.zekra.dev");
  assert.equal(mcpUrlFor("https://zekra.example.com"), "https://zekra.example.com/api/mcp");
});

test("rememberServer keeps the newest first without duplicates", () => {
  assert.deepEqual(rememberServer(["a", "b"], "b"), ["b", "a"]);
  assert.deepEqual(rememberServer(["a", "b"], "c", 2), ["c", "a"]);
});

test("connectTarget takes only the server from a link", () => {
  assert.deepEqual(connectTarget({ server: "https://zekra.example.com/", token: "secret" }), { url: "https://zekra.example.com" });
  assert.deepEqual(connectTarget({ server: ["zekra.example.com"] }), { url: "https://zekra.example.com" });
  assert.deepEqual(connectTarget({}), { error: "empty" });
  assert.deepEqual(connectTarget({ server: "http://evil.io" }), { error: "insecure" });
});
