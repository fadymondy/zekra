import assert from "node:assert/strict";
import { test } from "node:test";

import { pickReturnUrl, RETURN_WATCHDOG_MS, returnStep, returnUrlFromParams } from "./auth-return-core.ts";
import { authReturn, GITHUB_RETURN, GOOGLE_RETURN, readAuthReturn } from "./social-core.ts";

test("returnUrlFromParams rebuilds the provider's return URL with the code", () => {
  assert.equal(returnUrlFromParams("google", { code: "abc" }), "zekra://auth/google?code=abc");
  assert.equal(returnUrlFromParams("github", { code: ["one", "two"] }), "zekra://auth/github?code=one");
  assert.deepEqual(readAuthReturn(returnUrlFromParams("google", { code: "a b/+=&c" })!, GOOGLE_RETURN), { kind: "code", code: "a b/+=&c" });
});

test("returnUrlFromParams keeps the API's error", () => {
  assert.equal(returnUrlFromParams("github", { error: "cancelled" }), "zekra://auth/github?error=cancelled");
  assert.deepEqual(readAuthReturn(returnUrlFromParams("github", { error: "email" })!, GITHUB_RETURN), { kind: "error", reason: "email" });
});

test("returnUrlFromParams ignores other params and empty values", () => {
  assert.equal(returnUrlFromParams("google", {}), null);
  assert.equal(returnUrlFromParams("google", null), null);
  assert.equal(returnUrlFromParams("google", { code: "", foo: "bar" }), null);
  assert.equal(returnUrlFromParams("google", { code: "x", foo: "bar" }), "zekra://auth/google?code=x");
});

test("pickReturnUrl prefers the route params over the linking URL", () => {
  assert.equal(pickReturnUrl("google", { code: "fresh" }, "zekra://auth/google?code=stale"), "zekra://auth/google?code=fresh");
});

test("pickReturnUrl falls back to this provider's linking URL only", () => {
  assert.equal(pickReturnUrl("google", {}, "zekra://auth/google?code=x"), "zekra://auth/google?code=x");
  assert.equal(pickReturnUrl("google", {}, "zekra://auth/google/?code=x"), "zekra://auth/google/?code=x");
  assert.equal(pickReturnUrl("google", {}, "zekra://auth/github?code=x"), null);
  assert.equal(pickReturnUrl("google", {}, "zekra://auth/googlex?code=x"), null);
  assert.equal(pickReturnUrl("google", {}, "zekra://auth/google"), null);
  assert.equal(pickReturnUrl("google", {}, null), null);
  assert.equal(pickReturnUrl("google", undefined, undefined), null);
});

test("returnStep: every outcome leads somewhere — never a blank screen", () => {
  assert.equal(returnStep("signedIn"), "home");
  assert.equal(returnStep("waiting"), "back");
  assert.equal(returnStep("error"), "error");
  assert.equal(returnStep("cancelled"), "root");
  assert.equal(returnStep("ignored"), "root");
});

test("the watchdog is short enough to never feel stuck", () => {
  assert.ok(RETURN_WATCHDOG_MS > 0 && RETURN_WATCHDOG_MS <= 20_000);
});

test("the return base matches social-core's authReturn", () => {
  assert.equal(returnUrlFromParams("google", { code: "x" }), `${authReturn("google")}?code=x`);
  assert.equal(returnUrlFromParams("github", { code: "x" }), `${authReturn("github")}?code=x`);
});

test("Apple's browser return (Android) works the same way", () => {
  assert.equal(returnUrlFromParams("apple", { code: "x" }), "zekra://auth/apple?code=x");
  assert.equal(pickReturnUrl("apple", {}, "zekra://auth/apple?error=cancelled"), "zekra://auth/apple?error=cancelled");
  assert.equal(pickReturnUrl("apple", {}, "zekra://auth/google?code=x"), null);
});
