import assert from "node:assert/strict";
import { test } from "node:test";

import { consentBodyKey, consentKey, UNKNOWN_PROVIDER } from "./ai-consent-core.ts";

test("consent keys are SecureStore-safe and differ per provider", () => {
  const a = consentKey({ available: true, provider: "anthropic", name: "Anthropic (Claude)", third_party: true });
  const b = consentKey({ available: true, provider: "self-hosted", name: "", third_party: false });
  assert.match(a, /^[A-Za-z0-9._-]+$/);
  assert.match(b, /^[A-Za-z0-9._-]+$/);
  assert.notEqual(a, b);
});

test("the consent text names the provider it will use", () => {
  assert.equal(consentBodyKey({ available: true, provider: "anthropic", name: "Anthropic (Claude)", third_party: true }), "presentations.translate.consentThirdParty");
  assert.equal(consentBodyKey({ available: true, provider: "self-hosted", name: "", third_party: false }), "presentations.translate.consentSelfHosted");
  assert.equal(consentBodyKey(UNKNOWN_PROVIDER), "presentations.translate.consentUnknown");
});
