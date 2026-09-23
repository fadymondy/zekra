import { API_URL } from "@/lib/api";
import { breadcrumb, reportError } from "@/lib/crash";

import {
  appStartUrl,
  authReturn,
  base64ToBase64Url,
  browserModulesPresent,
  bytesToBase64Url,
  readAuthReturn,
  sessionOutcome,
  type BrowserProvider,
} from "./social-core";
import { hasExpoModule, loadCrypto } from "./native";

// Sign in with GitHub or Google through the API's own web flow, run in an auth
// session (ASWebAuthenticationSession / Custom Tabs). No native SDK and no
// per-platform OAuth client: the server uses its web client, as on the website.
// The API never puts a bearer token in a URL: it redirects to
// zekra://auth/<provider>?code=… with a single-use code that lives two minutes,
// and the app trades it at POST /api/auth/<provider>/exchange —
// internal/account/oauth_github.go, oauth_google.go.
//
// The code rides a custom-scheme redirect another app could also claim
// (Android), so it is bound to this app with PKCE: the challenge goes on the
// start URL, the verifier only to the exchange. A server that predates app
// PKCE ignores both, harmlessly.
//
// Every failure throws SocialSignInError (shown on the sign-in error line);
// only a real cancel resolves null. A sheet that never opened is NOT a cancel
// (sessionOutcome) — see scripts/patch-expo-web-browser.mjs for the iOS case.

export class SocialSignInError extends Error {
  constructor(
    readonly provider: BrowserProvider,
    readonly reason: string,
    detail?: string,
  ) {
    super(`${provider} sign-in failed: ${reason}${detail ? ` (${detail})` : ""}`);
    this.name = "SocialSignInError";
  }
}

type WebBrowserLib = typeof import("expo-web-browser");

/** The auth-session and crypto modules are in this binary. */
export function browserFlowAvailable(): boolean {
  return browserModulesPresent(hasExpoModule).ok;
}

/** The one-time code and the verifier it is bound to; null when the user closed the sheet. */
export async function browserGrant(provider: BrowserProvider): Promise<{ code: string; verifier: string } | null> {
  const modules = browserModulesPresent(hasExpoModule);
  const Crypto = loadCrypto();
  if (!modules.ok || !Crypto) throw new SocialSignInError(provider, "unavailable", `missing ${modules.missing.join(", ") || "ExpoCrypto"}`);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const WebBrowser = require("expo-web-browser") as WebBrowserLib;
  const verifier = bytesToBase64Url(Crypto.getRandomBytes(32)); // 43 chars
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  const back = authReturn(provider);
  breadcrumb(`auth session ${provider} open`);
  const opened = Date.now();
  let res: Awaited<ReturnType<WebBrowserLib["openAuthSessionAsync"]>>;
  try {
    res = await WebBrowser.openAuthSessionAsync(appStartUrl(API_URL, provider, base64ToBase64Url(digest)), back);
  } catch (caught) {
    // Failed to start, or one is already open (WebBrowserAlreadyOpenException).
    const detail = caught instanceof Error ? caught.message : String(caught);
    const error = new SocialSignInError(provider, /already open/i.test(detail) ? "busy" : "nosheet", detail);
    reportError(error, `auth session ${provider}`);
    throw error;
  }
  const outcome = sessionOutcome(res as { type: string; url?: string; error?: string | null }, Date.now() - opened);
  breadcrumb(`auth session ${provider} ${outcome.kind}`);
  if (outcome.kind === "cancelled") return null;
  if (outcome.kind === "failed") {
    const error = new SocialSignInError(provider, outcome.reason, outcome.detail);
    reportError(error, `auth session ${provider}`);
    throw error;
  }
  const answer = readAuthReturn(outcome.url, back);
  if (answer.kind === "cancelled") return null;
  if (answer.kind === "error") throw new SocialSignInError(provider, answer.reason);
  return { code: answer.code, verifier };
}
