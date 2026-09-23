import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  appStartUrl,
  authReturn,
  base64ToBase64Url,
  browserModulesPresent,
  BROWSER_SIGNIN_TTL_MS,
  bytesToBase64Url,
  GITHUB_RETURN,
  GOOGLE_RETURN,
  isFresh,
  joinName,
  NO_SERVER_SUPPORT,
  parsePending,
  pendingMatches,
  planSocial,
  PROVIDERS_TTL_MS,
  queryOf,
  readAuthReturn,
  serverSupport,
  sessionOutcome,
  SHEET_MIN_MS,
  socialErrorKey,
  supportFromMethods,
} from "./social-core.ts";

test("serverSupport reads {providers:[{name, web, app, native}]}", () => {
  const got = serverSupport({
    providers: [
      { name: "google", web: true, app: true, native: true },
      { name: "apple", web: true, app: false, native: true },
      { name: "github", web: true, app: true, native: true },
      { name: "facebook", app: true, native: true },
      null,
      "apple",
    ],
  });
  assert.deepEqual(got, { github: true, googleApp: true, googleNative: true, apple: true });
});

test("serverSupport: only a literal true counts; GitHub's native means its app flow", () => {
  assert.deepEqual(
    serverSupport({ providers: [{ name: "google", app: "yes", native: 1 }, { name: "apple", web: true }, { name: "github", native: true }] }),
    { github: true, googleApp: false, googleNative: false, apple: false },
  );
  // Google web-only (no app flow reported) is not an app button.
  assert.deepEqual(serverSupport({ providers: [{ name: "google", web: true, native: false }] }), NO_SERVER_SUPPORT);
  assert.deepEqual(serverSupport({ providers: [] }), NO_SERVER_SUPPORT);
});

test("serverSupport is null for anything that is not a providers answer", () => {
  for (const payload of [undefined, null, "<html>404</html>", { error: { code: "not_found" } }, { providers: "all" }]) {
    assert.equal(serverSupport(payload), null, JSON.stringify(payload));
  }
});

test("supportFromMethods (older server): GitHub only, never Google or Apple", () => {
  // What app.zekra.dev answers before this branch is deployed.
  const prod = { methods: [{ name: "google", type: "oauth", url: "/api/auth/google" }, { name: "github", type: "oauth", url: "/api/auth/github" }] };
  assert.deepEqual(supportFromMethods(prod), { ...NO_SERVER_SUPPORT, github: true });
  assert.deepEqual(supportFromMethods({ methods: [{ name: "google" }, { name: "apple" }] }), NO_SERVER_SUPPORT);
  assert.deepEqual(supportFromMethods({}), NO_SERVER_SUPPORT);
  assert.deepEqual(supportFromMethods("<html>"), NO_SERVER_SUPPORT);
});

const fullBuild = { browser: true, googleSdk: false, apple: true };

test("planSocial: an older server shows GitHub only", () => {
  const plan = planSocial(supportFromMethods({ methods: [{ name: "google" }, { name: "github" }] }), fullBuild);
  assert.deepEqual(plan, { providers: ["github"], google: null });
});

test("planSocial: Google runs the browser flow by default, the SDK only when configured", () => {
  const server = { github: true, googleApp: true, googleNative: true, apple: false };
  assert.deepEqual(planSocial(server, fullBuild), { providers: ["google", "github"], google: "browser" });
  assert.deepEqual(planSocial(server, { ...fullBuild, googleSdk: true }), { providers: ["google", "github"], google: "native" });
  // SDK configured but the server has no app flow and no native audience: hidden.
  assert.deepEqual(planSocial({ ...server, googleApp: false, googleNative: false }, { ...fullBuild, googleSdk: true }), {
    providers: ["github"],
    google: null,
  });
  // SDK configured, server only native: native.
  assert.deepEqual(planSocial({ ...server, googleApp: false }, { ...fullBuild, googleSdk: true }).google, "native");
});

test("planSocial: Apple needs the server's bundle id AND the device; order is Apple, Google, GitHub", () => {
  const all = { github: true, googleApp: true, googleNative: false, apple: true };
  assert.deepEqual(planSocial(all, fullBuild).providers, ["apple", "google", "github"]);
  assert.deepEqual(planSocial(all, { ...fullBuild, apple: false }).providers, ["google", "github"]);
  assert.deepEqual(planSocial({ ...all, apple: false }, fullBuild).providers, ["google", "github"]);
});

test("planSocial: a build without the auth-session modules hides GitHub and browser Google", () => {
  const all = { github: true, googleApp: true, googleNative: true, apple: false };
  assert.deepEqual(planSocial(all, { browser: false, googleSdk: false, apple: false }), { providers: [], google: null });
  assert.deepEqual(planSocial(all, { browser: false, googleSdk: true, apple: false }), { providers: ["google"], google: "native" });
});

test("browserModulesPresent needs expo-web-browser and expo-crypto by their native names", () => {
  assert.deepEqual(browserModulesPresent(() => true), { ok: true, missing: [] });
  assert.deepEqual(browserModulesPresent((n) => n === "ExpoCrypto"), { ok: false, missing: ["ExpoWebBrowser"] });
  assert.deepEqual(browserModulesPresent(() => false), { ok: false, missing: ["ExpoWebBrowser", "ExpoCrypto"] });
  // The probe is asked for the Swift/Kotlin Name(...) of each module.
  const asked: string[] = [];
  browserModulesPresent((n) => (asked.push(n), true));
  assert.deepEqual(asked, ["ExpoWebBrowser", "ExpoCrypto"]);
});

test("sessionOutcome: success, a person's cancel, and a sheet that never showed", () => {
  assert.deepEqual(sessionOutcome({ type: "success", url: `${GITHUB_RETURN}?code=a` }, 5000), { kind: "url", url: `${GITHUB_RETURN}?code=a` });
  // The user tapped Cancel (ASWebAuthenticationSession error 1) after reading the prompt.
  const cancelled = "The operation couldn’t be completed. (com.apple.AuthenticationServices.WebAuthenticationSession error 1.)";
  assert.deepEqual(sessionOutcome({ type: "cancel", error: cancelled }, 4000), { kind: "cancelled" });
  assert.deepEqual(sessionOutcome({ type: "dismiss" }, 4000), { kind: "cancelled" });
  // No presentation anchor (errors 2 / 3): a failure, however long it took.
  const noAnchor = "The operation couldn’t be completed. (com.apple.AuthenticationServices.WebAuthenticationSession error 3.)";
  assert.equal(sessionOutcome({ type: "cancel", error: noAnchor }, 4000).kind, "failed");
  // Back faster than a person can read the prompt: the sheet never showed.
  const fast = sessionOutcome({ type: "cancel", error: null }, 40);
  assert.equal(fast.kind, "failed");
  assert.equal(fast.kind === "failed" && fast.reason, "nosheet");
  assert.equal(sessionOutcome({ type: "cancel", error: cancelled }, SHEET_MIN_MS - 1).kind, "failed");
  assert.equal(sessionOutcome({ type: "cancel" }, SHEET_MIN_MS).kind, "cancelled");
  // Success without a URL is not a code.
  assert.equal(sessionOutcome({ type: "success", url: null }, 5000).kind, "cancelled");
  const locked = sessionOutcome({ type: "locked" }, 5000);
  assert.equal(locked.kind === "failed" && locked.reason, "busy");
});

test("isFresh honours the providers TTL", () => {
  assert.equal(isFresh(1000, 1000), true);
  assert.equal(isFresh(1000, 1000 + PROVIDERS_TTL_MS - 1), true);
  assert.equal(isFresh(1000, 1000 + PROVIDERS_TTL_MS), false);
  assert.equal(isFresh(5000, 1000), false); // clock went backwards
});

test("queryOf decodes pairs and survives malformed ones", () => {
  assert.deepEqual(queryOf("zekra://auth/github?code=a%2Bb&x=1+2#frag"), { code: "a+b", x: "1 2" });
  assert.deepEqual(queryOf("zekra://auth/github"), {});
  assert.deepEqual(queryOf("zekra://auth/github?bad=%E0%A4%A&ok=1"), { ok: "1" });
  assert.deepEqual(queryOf("zekra://x?flag&v=a=b"), { flag: "", v: "a=b" });
});

test("readAuthReturn: code, cancel, reasons — for both providers", () => {
  for (const back of [GITHUB_RETURN, GOOGLE_RETURN]) {
    assert.deepEqual(readAuthReturn(`${back}?code=abc`, back), { kind: "code", code: "abc" });
    assert.deepEqual(readAuthReturn(`${back}/?code=abc`, back), { kind: "code", code: "abc" });
    assert.deepEqual(readAuthReturn(`${back}?error=cancelled`, back), { kind: "cancelled" });
    assert.deepEqual(readAuthReturn(`${back}?error=email`, back), { kind: "error", reason: "email" });
    assert.deepEqual(readAuthReturn(`${back}?error=state&code=abc`, back), { kind: "error", reason: "state" });
    assert.deepEqual(readAuthReturn(back, back), { kind: "error", reason: "failed" });
  }
  assert.equal(authReturn("google"), "zekra://auth/google");
});

test("readAuthReturn never takes a code from another URL", () => {
  for (const url of [
    "https://evil.example/auth/github?code=abc",
    "zekra://auth/githubx?code=abc",
    "zekra://auth/github-evil?code=abc",
    "evil://auth/github?code=abc",
    `${GOOGLE_RETURN}?code=abc`, // Google's return is not GitHub's
  ]) {
    assert.deepEqual(readAuthReturn(url, GITHUB_RETURN), { kind: "error", reason: "failed" }, url);
  }
  assert.deepEqual(readAuthReturn(`${GITHUB_RETURN}?code=abc`, GOOGLE_RETURN), { kind: "error", reason: "failed" });
  assert.deepEqual(readAuthReturn("zekra://auth/googlex?code=abc", GOOGLE_RETURN), { kind: "error", reason: "failed" });
});

test("appStartUrl is the app-mode start with an S256 challenge", () => {
  assert.equal(
    appStartUrl("https://app.zekra.dev/", "github", "CHAL-_"),
    "https://app.zekra.dev/api/auth/github?app=1&return=zekra%3A%2F%2Fauth%2Fgithub&code_challenge=CHAL-_&code_challenge_method=S256",
  );
  assert.equal(
    appStartUrl("https://app.zekra.dev", "google", "CHAL-_"),
    "https://app.zekra.dev/api/auth/google?app=1&return=zekra%3A%2F%2Fauth%2Fgoogle&code_challenge=CHAL-_&code_challenge_method=S256",
  );
});

test("bytesToBase64Url matches Node's base64url for every tail length", () => {
  for (let len = 0; len < 70; len++) {
    const bytes = new Uint8Array(len).map((_, i) => (i * 37 + len * 11) & 255);
    assert.equal(bytesToBase64Url(bytes), Buffer.from(bytes).toString("base64url"), `len ${len}`);
  }
});

test("a PKCE challenge built from base64 digest equals RFC 7636 S256", () => {
  // RFC 7636 appendix B.
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const b64 = createHash("sha256").update(verifier).digest("base64");
  assert.equal(base64ToBase64Url(b64), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("joinName skips blanks", () => {
  assert.equal(joinName({ givenName: " Fady ", middleName: null, familyName: "Mondy" }), "Fady Mondy");
  assert.equal(joinName({ givenName: "", familyName: null }), "");
  assert.equal(joinName(null), "");
});

test("socialErrorKey maps server answers and auth-session reasons", () => {
  assert.equal(socialErrorKey("google", { status: 0 }), "social.offline");
  assert.equal(socialErrorKey("apple", { status: 403, code: "account_disabled" }), "social.disabled");
  assert.equal(socialErrorKey("github", { reason: "disabled" }), "social.disabled");
  assert.equal(socialErrorKey("google", { reason: "disabled" }), "social.disabled");
  assert.equal(socialErrorKey("google", { status: 403, message: "registration is closed on this site" }), "social.closed");
  assert.equal(socialErrorKey("github", { reason: "closed" }), "social.closed");
  assert.equal(socialErrorKey("google", { reason: "closed" }), "social.closed");
  assert.equal(socialErrorKey("github", { reason: "email" }), "social.githubEmail");
  assert.equal(socialErrorKey("google", { reason: "email" }), "social.email");
  assert.equal(socialErrorKey("github", { reason: "state" }), "social.expired");
  assert.equal(socialErrorKey("google", { reason: "state" }), "social.expired");
  assert.equal(socialErrorKey("github", { status: 401, message: "invalid or expired code" }), "social.expired");
  assert.equal(socialErrorKey("google", { status: 401, message: "invalid or expired code" }), "social.expired");
  assert.equal(socialErrorKey("google", { status: 429, message: "too many requests" }), "social.tooMany");
  assert.equal(socialErrorKey("github", { reason: "busy" }), "social.busy");
  assert.equal(socialErrorKey("github", { reason: "unavailable" }), "social.unavailable");
  assert.equal(socialErrorKey("github", { reason: "nosheet" }), "social.noSheet");
  assert.equal(socialErrorKey("apple", { status: 401, message: "invalid apple token" }), "social.failed");
  assert.equal(socialErrorKey("google", { reason: "failed" }), "social.failed");
  assert.equal(socialErrorKey("google", { status: 500 }), "social.failed");
  assert.equal(socialErrorKey("google", {}), "social.failed");
});

test("pending browser sign-in: parse and match", () => {
  const verifier = "v".repeat(43);
  const raw = JSON.stringify({ provider: "github", verifier, startedAt: 1_000 });
  const p = parsePending(raw);
  assert.deepEqual(p, { provider: "github", verifier, startedAt: 1_000 });
  assert.equal(parsePending("nope"), null);
  assert.equal(parsePending(JSON.stringify({ provider: "apple", verifier, startedAt: 1 })), null);
  assert.equal(parsePending(JSON.stringify({ provider: "github", verifier: "short", startedAt: 1 })), null);
  assert.equal(pendingMatches(p, "github", 2_000), true);
  assert.equal(pendingMatches(p, "google", 2_000), false);
  assert.equal(pendingMatches(p, "github", 1_000 + BROWSER_SIGNIN_TTL_MS), false);
  assert.equal(pendingMatches(null, "github", 2_000), false);
});
