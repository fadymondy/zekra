// Pure logic for the zekra://auth/<provider> return screen
// (auth-return.tsx): no React Native imports, so `node --test` covers it
// (auth-return-core.test.ts).

import type { BrowserProvider } from "./social-core.ts";

/** Same as social-core's authReturn (kept import-free so node can run the tests). */
const authReturn = (provider: BrowserProvider) => `zekra://auth/${provider}`;

/** The return screen never waits longer than this before offering "Try again". */
export const RETURN_WATCHDOG_MS = 15_000;

/** expo-router search params: a value can repeat (?a=1&a=2). */
export type ReturnParams = Record<string, string | string[] | undefined>;

/** The query keys the API puts on the return URL (readAuthReturn). */
const RETURN_KEYS = ["code", "error"] as const;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * Rebuild zekra://auth/<provider>?code=… (or ?error=…) from the route's
 * search params. expo-router has already consumed the link's url event by the
 * time the screen mounts, so the params are where the code reliably is.
 * Null when they carry neither a code nor an error.
 */
export function returnUrlFromParams(provider: BrowserProvider, params: ReturnParams | null | undefined): string | null {
  if (!params) return null;
  const pairs: string[] = [];
  for (const key of RETURN_KEYS) {
    const value = first(params[key]);
    if (value) pairs.push(`${key}=${encodeURIComponent(value)}`);
  }
  return pairs.length ? `${authReturn(provider)}?${pairs.join("&")}` : null;
}

/**
 * The URL to complete the sign-in with: the route params first, then the last
 * URL the OS handed the app (expo-linking getLinkingURL) if it is this
 * provider's return. Null when neither has one.
 */
export function pickReturnUrl(provider: BrowserProvider, params: ReturnParams | null | undefined, linkingUrl: string | null | undefined): string | null {
  const fromParams = returnUrlFromParams(provider, params);
  if (fromParams) return fromParams;
  if (linkingUrl && linkingUrl.startsWith(authReturn(provider))) {
    const rest = linkingUrl.slice(authReturn(provider).length);
    if (rest.startsWith("?") || rest.startsWith("/?")) return linkingUrl;
  }
  return null;
}

/** What completeBrowserReturn answered (browser-flow.ts ReturnResult kinds). */
export type ReturnKind = "waiting" | "signedIn" | "cancelled" | "error" | "ignored";

/**
 * Where the return screen goes next:
 * - home: signed in here (cold start) → /brains
 * - back: handed to the sign-in waiting in this process, which finishes and navigates itself
 * - root: nothing of ours was pending, or the user cancelled → "/" routes by session
 * - error: show the error state with Try again / Back
 */
export type ReturnStep = "home" | "back" | "root" | "error";

export function returnStep(kind: ReturnKind): ReturnStep {
  switch (kind) {
    case "signedIn":
      return "home";
    case "waiting":
      return "back";
    case "error":
      return "error";
    case "cancelled":
    case "ignored":
      return "root";
  }
}
