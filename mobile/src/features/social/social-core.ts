// Pure social sign-in logic (MH-360): no React Native imports, so `node --test`
// can exercise it directly (social-core.test.ts). The server side is
// internal/account/oauth_{google,apple,github}.go and providers.go.

export type SocialProvider = "apple" | "google" | "github";

export const SOCIAL_PROVIDERS: readonly SocialProvider[] = ["apple", "google", "github"];

/** Providers the app signs in with through the server's browser flow (an auth session). */
export type BrowserProvider = "github" | "google";

/** Where a provider's auth session returns; the API only redirects to zekra://… */
export function authReturn(provider: BrowserProvider): string {
  return `zekra://auth/${provider}`;
}

export const GITHUB_RETURN = authReturn("github");
export const GOOGLE_RETURN = authReturn("google");

/** How long a server's providers answer is trusted (the API caches it 5 minutes too). */
export const PROVIDERS_TTL_MS = 5 * 60 * 1000;

/** A cached answer taken at `at` is still good at `now`. */
export function isFresh(at: number, now: number, ttl = PROVIDERS_TTL_MS): boolean {
  return now >= at && now - at < ttl;
}

/** What the SERVER can sign the app in with. */
export type ServerSupport = {
  /** GitHub's app flow: auth session + POST /api/auth/github/exchange. */
  github: boolean;
  /** Google's app flow: auth session + POST /api/auth/google/exchange. */
  googleApp: boolean;
  /** Google's native ID token: POST /api/auth/google/token. */
  googleNative: boolean;
  /** Apple's native identity token: POST /api/auth/apple/token (APPLE_BUNDLE_IDS set). */
  apple: boolean;
};

export const NO_SERVER_SUPPORT: ServerSupport = { github: false, googleApp: false, googleNative: false, apple: false };

/**
 * GET /api/auth/providers ({providers: [{name, web, app, native}]}) → what the
 * app can use. null when the payload is not such an answer (a 404 from a server
 * that predates the endpoint, HTML, garbage) — then use supportFromMethods.
 * Only a literal `true` counts. GitHub's "native" is its app flow on servers
 * that reported it before "app" existed.
 */
export function serverSupport(payload: unknown): ServerSupport | null {
  const list = payload && typeof payload === "object" ? (payload as { providers?: unknown }).providers : undefined;
  if (!Array.isArray(list)) return null;
  const out: ServerSupport = { ...NO_SERVER_SUPPORT };
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { name, app, native } = item as { name?: unknown; app?: unknown; native?: unknown };
    if (name === "github") out.github = out.github || app === true || native === true;
    else if (name === "google") {
      out.googleApp = out.googleApp || app === true;
      out.googleNative = out.googleNative || native === true;
    } else if (name === "apple") out.apple = out.apple || native === true;
  }
  return out;
}

/**
 * Fallback for a server without /api/auth/providers: GET /api/auth/methods
 * lists the WEB flows that are on. Such a server has GitHub's app flow (it is
 * the web flow with ?app=1) but not Google's — its /api/auth/google ignores
 * ?app=1 and would finish the sign-in on the website, inside the app's auth
 * session. Its Apple audience (the bundle id) cannot be told from here either.
 * So: GitHub only, and only when the methods list has it.
 */
export function supportFromMethods(payload: unknown): ServerSupport {
  const list = payload && typeof payload === "object" ? (payload as { methods?: unknown }).methods : undefined;
  const out: ServerSupport = { ...NO_SERVER_SUPPORT };
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (item && typeof item === "object" && (item as { name?: unknown }).name === "github") out.github = true;
  }
  return out;
}

/** What THIS build (and device) can do. */
export type BuildSupport = {
  /** expo-web-browser + expo-crypto are in the binary: the auth-session flows. */
  browser: boolean;
  /** The native Google SDK is in the binary AND configured (client ids in the build env). */
  googleSdk: boolean;
  /** iOS, the Apple module is in the binary and the device supports the sheet. */
  apple: boolean;
};

export type GoogleVia = "browser" | "native";

export type SocialPlan = {
  /** Buttons to show, in order. */
  providers: SocialProvider[];
  /** How Google signs in, when it is shown. */
  google: GoogleVia | null;
};

/**
 * Which buttons to show: what both the server and the build support. Google
 * runs the browser flow by default; the native SDK is an upgrade used only when
 * the build is configured for it and the server accepts its ID tokens.
 */
export function planSocial(server: ServerSupport, build: BuildSupport): SocialPlan {
  const providers: SocialProvider[] = [];
  if (server.apple && build.apple) providers.push("apple");
  let google: GoogleVia | null = null;
  if (server.googleNative && build.googleSdk) google = "native";
  else if (server.googleApp && build.browser) google = "browser";
  if (google) providers.push("google");
  if (server.github && build.browser) providers.push("github");
  return { providers, google };
}

/** React Native's URL has no dependable searchParams, so the query is read by hand. */
export function queryOf(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const q = url.split("#")[0].split("?")[1] ?? "";
  for (const pair of q.split("&")) {
    if (!pair) continue;
    const i = pair.indexOf("=");
    const k = i < 0 ? pair : pair.slice(0, i);
    const v = i < 0 ? "" : pair.slice(i + 1);
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, " "));
    } catch {
      // A malformed escape: skip the pair rather than fail the whole read.
    }
  }
  return out;
}

export type AuthReturn =
  | { kind: "code"; code: string }
  | { kind: "cancelled" }
  | { kind: "error"; reason: string };

/**
 * Read the redirect the API sent the auth session to:
 * zekra://auth/<provider>?code=… or ?error=<cancelled|state|email|closed|disabled|failed>.
 * Anything not on the expected return URL is an error, never a code.
 */
export function readAuthReturn(url: string, expected: string): AuthReturn {
  if (!url.startsWith(expected)) return { kind: "error", reason: "failed" };
  const rest = url.slice(expected.length);
  if (rest !== "" && !rest.startsWith("?") && !rest.startsWith("/?") && !rest.startsWith("#")) return { kind: "error", reason: "failed" };
  const q = queryOf(url);
  if (q.error === "cancelled") return { kind: "cancelled" };
  if (q.error) return { kind: "error", reason: q.error };
  if (!q.code) return { kind: "error", reason: "failed" };
  return { kind: "code", code: q.code };
}

/** The native modules the auth-session flows need (expo-web-browser, expo-crypto). */
export const BROWSER_MODULES = ["ExpoWebBrowser", "ExpoCrypto"] as const;

/**
 * Whether this binary can run the auth-session flows, given a native-module
 * probe (`hasExpoModule`). The names are the modules' Swift/Kotlin Name(...)
 * — what requireOptionalNativeModule looks up. `missing` is for diagnostics.
 */
export function browserModulesPresent(has: (name: string) => boolean): { ok: boolean; missing: string[] } {
  const missing = BROWSER_MODULES.filter((name) => !has(name));
  return { ok: missing.length === 0, missing };
}

/** Faster than this, a "cancel" is not a person: the sheet never showed. */
export const SHEET_MIN_MS = 1000;

/** What expo-web-browser's openAuthSessionAsync resolves with (iOS adds `error`). */
export type SessionResult = { type: string; url?: string | null; error?: string | null };

export type SessionOutcome = { kind: "url"; url: string } | { kind: "cancelled" } | { kind: "failed"; reason: "nosheet" | "busy"; detail: string };

/**
 * Tell a real cancel from a sheet that failed to open. On iOS a session that
 * could not be presented (no key window: presentationContextNotProvided /
 * Invalid, codes 2 and 3) resolves {type: "cancel"} exactly like the user's
 * Cancel (code 1) — so it would look like "tapping the button does nothing".
 * A cancel carrying another error code, or one that came back faster than a
 * person can read the consent prompt, is a failure to report.
 */
export function sessionOutcome(res: SessionResult, elapsedMs: number): SessionOutcome {
  if (res.type === "success" && res.url) return { kind: "url", url: res.url };
  if (res.type === "locked") return { kind: "failed", reason: "busy", detail: "another browser session is open" };
  const code = /WebAuthenticationSession(?:Error)? error (\d+)/i.exec(res.error ?? "")?.[1];
  if (code && code !== "1") return { kind: "failed", reason: "nosheet", detail: res.error ?? "" };
  if (elapsedMs < SHEET_MIN_MS) return { kind: "failed", reason: "nosheet", detail: res.error || `${res.type} after ${Math.round(elapsedMs)}ms` };
  return { kind: "cancelled" };
}

/** GET /api/auth/<provider>?app=1… — the app-mode start, PKCE-bound (S256). */
export function appStartUrl(apiUrl: string, provider: BrowserProvider, challenge: string): string {
  return `${apiUrl.replace(/\/$/, "")}/api/auth/${provider}?app=1&return=${encodeURIComponent(authReturn(provider))}` +
    `&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`;
}

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Unpadded base64url of raw bytes (RFC 4648 §5) — for the PKCE verifier. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63] + B64URL[n & 63];
  }
  const left = bytes.length - i;
  if (left === 1) {
    const n = bytes[i] << 16;
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63];
  } else if (left === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63];
  }
  return out;
}

/** Standard base64 (as expo-crypto's digest returns it) to unpadded base64url. */
export function base64ToBase64Url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Apple's name parts, joined; Apple sends them on the first authorization only. */
export function joinName(parts: { givenName?: string | null; middleName?: string | null; familyName?: string | null } | null | undefined): string {
  if (!parts) return "";
  return [parts.givenName, parts.middleName, parts.familyName].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
}

export type SocialErrorKey =
  | "social.offline"
  | "social.closed"
  | "social.disabled"
  | "social.githubEmail"
  | "social.email"
  | "social.expired"
  | "social.busy"
  | "social.tooMany"
  | "social.unavailable"
  | "social.noSheet"
  | "social.failed";

/**
 * The dictionary key for a failed provider sign-in. `status`/`code`/`message`
 * come from the API's answer; `reason` from an auth session's ?error= redirect
 * (or "unavailable" when the build lacks the modules). A cancel never gets
 * here: it is not an error.
 */
export function socialErrorKey(provider: SocialProvider, failure: { status?: number; code?: string; reason?: string; message?: string }): SocialErrorKey {
  if (failure.status === 0) return "social.offline";
  if (failure.code === "account_disabled" || failure.reason === "disabled") return "social.disabled";
  if (failure.status === 403 && /registration/i.test(failure.message ?? "")) return "social.closed";
  if (failure.reason === "closed") return "social.closed";
  if (failure.reason === "email") return provider === "github" ? "social.githubEmail" : "social.email";
  if (failure.reason === "state" || (failure.status === 401 && /expired/i.test(failure.message ?? ""))) return "social.expired";
  if (failure.status === 429) return "social.tooMany";
  if (failure.reason === "busy") return "social.busy";
  if (failure.reason === "nosheet") return "social.noSheet";
  if (failure.reason === "unavailable") return "social.unavailable";
  return "social.failed";
}

// ─── External-browser sign-in (always the system browser) ───────────────────

/** A sign-in handed to the system browser: which provider, and the PKCE
 *  verifier the returning code is bound to. Kept in secure storage so the
 *  sign-in can finish even if the OS closed the app while the user was away. */
export type PendingBrowserSignIn = { provider: BrowserProvider; verifier: string; startedAt: number };

/** How long a browser sign-in may take before its verifier is thrown away. */
export const BROWSER_SIGNIN_TTL_MS = 10 * 60 * 1000;

export function parsePending(raw: string | null | undefined): PendingBrowserSignIn | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PendingBrowserSignIn>;
    if ((v.provider === "github" || v.provider === "google") && typeof v.verifier === "string" && v.verifier.length >= 43 && typeof v.startedAt === "number") {
      return { provider: v.provider, verifier: v.verifier, startedAt: v.startedAt };
    }
  } catch {}
  return null;
}

/** A returning code may only be redeemed against a fresh pending sign-in for
 *  the same provider — so an outside zekra://auth link can do nothing. */
export function pendingMatches(pending: PendingBrowserSignIn | null, provider: string, now: number): pending is PendingBrowserSignIn {
  return !!pending && pending.provider === provider && now >= pending.startedAt && now - pending.startedAt < BROWSER_SIGNIN_TTL_MS;
}
