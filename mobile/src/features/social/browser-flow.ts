import { Linking } from "react-native";

import { API_URL, authApi, type AuthAnswer } from "@/lib/api";
import { breadcrumb, reportError } from "@/lib/crash";
import { getStored, removeStored, setStored } from "@/lib/storage";

import {
  appStartUrl,
  authReturn,
  base64ToBase64Url,
  BROWSER_SIGNIN_TTL_MS,
  bytesToBase64Url,
  parsePending,
  pendingMatches,
  readAuthReturn,
  type BrowserProvider,
  type PendingBrowserSignIn,
} from "./social-core";
import { loadCrypto } from "./native";

// Sign in with GitHub or Google through the API's own web flow, run in the
// system browser (see below). No native SDK and no
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
// only a real cancel resolves null.

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

/** The crypto module (PKCE) is in this binary; the system browser always is. */
export function browserFlowAvailable(): boolean {
  return !!loadCrypto();
}

// Sign-in always runs in the system browser (Safari / the default Android
// browser), never an in-app sheet: the user sees the real address bar and
// their saved passwords, and returns to Zekra via zekra://auth/<provider>.
// The verifier waits in secure storage (PENDING_KEY), so a return that finds
// the app closed by the OS still completes (completeBrowserReturn).
const PENDING_KEY = "zekra.auth.pending.v1";

type Waiter = {
  provider: BrowserProvider;
  verifier: string;
  resolve: (grant: { code: string; verifier: string } | null) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
let waiter: Waiter | null = null;

function settle(): Waiter | null {
  const w = waiter;
  waiter = null;
  if (w) clearTimeout(w.timer);
  void removeStored(PENDING_KEY);
  return w;
}

/** Stop waiting for the browser (the user pressed Cancel in the app). */
export function cancelBrowserSignIn(): void {
  settle()?.resolve(null);
}

/** The one-time code and the verifier it is bound to; null when cancelled. */
export async function browserGrant(provider: BrowserProvider): Promise<{ code: string; verifier: string } | null> {
  const Crypto = loadCrypto();
  if (!Crypto) throw new SocialSignInError(provider, "unavailable", "missing ExpoCrypto");
  cancelBrowserSignIn(); // one sign-in at a time
  const verifier = bytesToBase64Url(Crypto.getRandomBytes(32)); // 43 chars
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  const pending: PendingBrowserSignIn = { provider, verifier, startedAt: Date.now() };
  await setStored(PENDING_KEY, JSON.stringify(pending));
  breadcrumb(`browser sign-in ${provider} open`);

  return new Promise((resolve, reject) => {
    waiter = {
      provider,
      verifier,
      resolve,
      reject,
      // Abandoned in the browser: give the button back.
      timer: setTimeout(() => settle()?.resolve(null), BROWSER_SIGNIN_TTL_MS),
    };
    Linking.openURL(appStartUrl(API_URL, provider, base64ToBase64Url(digest))).catch((caught) => {
      const error = new SocialSignInError(provider, "nosheet", caught instanceof Error ? caught.message : String(caught));
      reportError(error, `browser sign-in ${provider}`);
      settle()?.reject(error);
    });
  });
}

export type ReturnResult =
  | { kind: "waiting" } // handed to the sign-in that is waiting in this process
  | { kind: "signedIn"; answer: AuthAnswer } // finished here after a cold start
  | { kind: "cancelled" }
  | { kind: "error"; error: SocialSignInError }
  | { kind: "ignored" }; // no sign-in of ours was pending

/**
 * A zekra://auth/<provider> link came back (app/auth/<provider>.tsx). Hands
 * the code to the waiting sign-in, or — when the OS closed the app while the
 * user was in the browser — redeems it here with the stored verifier. A link
 * with no fresh pending sign-in for that provider is ignored: without the
 * verifier its code can't be redeemed anyway.
 */
export async function completeBrowserReturn(provider: BrowserProvider, url: string): Promise<ReturnResult> {
  const answer = readAuthReturn(url, authReturn(provider));
  if (waiter && waiter.provider === provider) {
    const w = settle()!;
    if (answer.kind === "code") w.resolve({ code: answer.code, verifier: w.verifier });
    else if (answer.kind === "cancelled") w.resolve(null);
    else w.reject(new SocialSignInError(provider, answer.reason));
    return { kind: "waiting" };
  }
  const pending = parsePending(await getStored(PENDING_KEY));
  if (!pendingMatches(pending, provider, Date.now())) return { kind: "ignored" };
  settle();
  if (answer.kind === "cancelled") return { kind: "cancelled" };
  if (answer.kind === "error") return { kind: "error", error: new SocialSignInError(provider, answer.reason) };
  try {
    return { kind: "signedIn", answer: await authApi.socialExchange(provider, answer.code, pending.verifier) };
  } catch (caught) {
    return { kind: "error", error: new SocialSignInError(provider, "failed", caught instanceof Error ? caught.message : String(caught)) };
  }
}
