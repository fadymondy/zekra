import assert from "node:assert/strict";
import { test } from "node:test";

import {
  displayHint,
  filterSecrets,
  gateDecision,
  isDeniedStatus,
  isMultilineKind,
  kindIcon,
  kindLabelKey,
  maskValue,
  relativeAgo,
  sanitizeSecretName,
  SECRET_KINDS,
  SECURITY_LEVEL_NONE,
  shouldClearClipboard,
  validateSecretName,
} from "./vault-core.ts";

test("sanitizeSecretName mirrors the server", () => {
  assert.equal(sanitizeSecretName("OPENAI_API_KEY"), "OPENAI_API_KEY");
  assert.equal(sanitizeSecretName("  my key!! v2 "), "my_key_v2");
  assert.equal(sanitizeSecretName("__x__"), "x");
  assert.equal(sanitizeSecretName("!!!"), "secret");
  assert.equal(sanitizeSecretName(""), "secret");
  assert.equal(sanitizeSecretName("a.b-c_d"), "a.b-c_d");
  assert.equal(sanitizeSecretName("مفتاح"), "secret");
  assert.equal(sanitizeSecretName("x".repeat(120)).length, 96);
});

test("validateSecretName accepts clean names and explains the rest", () => {
  assert.deepEqual(validateSecretName(" DB_URL "), { ok: true, name: "DB_URL" });
  assert.deepEqual(validateSecretName("   "), { ok: false, reason: "empty" });
  assert.deepEqual(validateSecretName("my key"), { ok: false, reason: "invalid", suggestion: "my_key" });
  assert.deepEqual(validateSecretName("_lead"), { ok: false, reason: "invalid", suggestion: "lead" });
  const long = validateSecretName("k".repeat(97));
  assert.equal(long.ok, false);
  assert.equal(!long.ok && long.reason, "tooLong");
  assert.equal(!long.ok && long.suggestion?.length, 96);
  assert.equal(validateSecretName("k".repeat(96)).ok, true);
});

test("kind icon and label mapping", () => {
  assert.equal(kindIcon("api_key"), "key-round");
  assert.equal(kindIcon("password"), "lock");
  assert.equal(kindIcon("env"), "terminal");
  assert.equal(kindIcon("private_key"), "file-key");
  assert.equal(kindIcon("connection_string"), "database");
  assert.equal(kindIcon("credential"), "badge-check");
  assert.equal(kindIcon("token"), "ticket");
  assert.equal(kindIcon(""), "shield");
  assert.equal(kindIcon(undefined), "shield");
  // auto-captured kinds from the retain path
  assert.equal(kindIcon("openai_key"), "key-round");
  assert.equal(kindIcon("jwt"), "ticket");
  assert.equal(kindIcon("something_new"), "shield");

  for (const k of SECRET_KINDS) assert.equal(kindLabelKey(k), `vault.kind.${k}`);
  assert.equal(kindLabelKey(""), "vault.kind.generic");
  assert.equal(kindLabelKey("aws_key"), null);

  assert.equal(isMultilineKind("private_key"), true);
  assert.equal(isMultilineKind("env"), true);
  assert.equal(isMultilineKind("api_key"), false);
});

test("maskValue mirrors the server hint", () => {
  assert.equal(maskValue("sk-abcdefghijklmnop"), "sk-…mnop");
  assert.equal(maskValue("ghp_1234567890"), "ghp_…7890");
  assert.equal(maskValue("abcd"), "••••");
  assert.equal(maskValue("  abc  "), "••••");
  assert.equal(maskValue("plainpassword"), "…word");
  // a separator past position 6 is not a prefix
  assert.equal(maskValue("longprefix-value"), "…alue");
  // a separator at 0 is not a prefix either
  assert.equal(maskValue("-leading"), "…ding");
  assert.equal(displayHint(""), "••••");
  assert.equal(displayHint(undefined), "••••");
  assert.equal(displayHint("sk-…mnop"), "sk-…mnop");
});

test("relativeAgo buckets", () => {
  const now = Date.parse("2026-09-23T12:00:00Z");
  assert.deepEqual(relativeAgo("2026-09-23T11:59:30Z", now), { unit: "now", n: 0 });
  assert.deepEqual(relativeAgo("2026-09-23T11:55:00Z", now), { unit: "m", n: 5 });
  assert.deepEqual(relativeAgo("2026-09-23T09:00:00Z", now), { unit: "h", n: 3 });
  assert.deepEqual(relativeAgo("2026-09-21T12:00:00Z", now), { unit: "d", n: 2 });
  assert.deepEqual(relativeAgo("2026-09-09T12:00:00Z", now), { unit: "w", n: 2 });
  assert.deepEqual(relativeAgo("2026-06-23T12:00:00Z", now), { unit: "mo", n: 3 });
  assert.deepEqual(relativeAgo("2024-09-23T12:00:00Z", now), { unit: "y", n: 2 });
  // clock skew: a future timestamp reads as "now"
  assert.deepEqual(relativeAgo("2026-09-23T12:05:00Z", now), { unit: "now", n: 0 });
  assert.equal(relativeAgo("not a date", now), null);
  assert.equal(relativeAgo("", now), null);
});

test("filterSecrets matches name and kind", () => {
  const list = [
    { name: "OPENAI_API_KEY", kind: "api_key" },
    { name: "DB_URL", kind: "connection_string" },
    { name: "ssh", kind: "private_key" },
  ];
  assert.equal(filterSecrets(list, "").length, 3);
  assert.deepEqual(filterSecrets(list, "openai").map((s) => s.name), ["OPENAI_API_KEY"]);
  assert.deepEqual(filterSecrets(list, "PRIVATE").map((s) => s.name), ["ssh"]);
  assert.equal(filterSecrets(list, "nope").length, 0);
});

test("reveal denial statuses", () => {
  assert.equal(isDeniedStatus(401), true);
  assert.equal(isDeniedStatus(403), true);
  assert.equal(isDeniedStatus(404), false);
  assert.equal(isDeniedStatus(undefined), false);
});

test("gateDecision", () => {
  assert.equal(gateDecision(SECURITY_LEVEL_NONE, null), "proceed");
  assert.equal(gateDecision(3, { success: true }), "proceed");
  assert.equal(gateDecision(3, { success: false, error: "user_cancel" }), "cancel");
  assert.equal(gateDecision(3, { success: false, error: "system_cancel" }), "cancel");
  assert.equal(gateDecision(1, { success: false, error: "passcode_not_set" }), "proceed");
  assert.equal(gateDecision(3, { success: false, error: "not_enrolled" }), "proceed");
  assert.equal(gateDecision(3, { success: false, error: "lockout" }), "failed");
  assert.equal(gateDecision(3, { success: false, error: "authentication_failed" }), "failed");
});

test("shouldClearClipboard", () => {
  const base = { secret: "s3cret", leftApp: false, changedInApp: false };
  assert.equal(shouldClearClipboard({ ...base, platform: "android", current: "s3cret" }), true);
  assert.equal(shouldClearClipboard({ ...base, platform: "android", current: "other" }), false);
  assert.equal(shouldClearClipboard({ ...base, platform: "android", current: undefined }), false);
  assert.equal(shouldClearClipboard({ ...base, platform: "ios" }), true);
  assert.equal(shouldClearClipboard({ ...base, platform: "ios", leftApp: true }), false);
  assert.equal(shouldClearClipboard({ ...base, platform: "ios", changedInApp: true }), false);
});
