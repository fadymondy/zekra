import { useSyncExternalStore } from "react";

import { CLOUD_URL, normalizeServer, parseHealth, rememberServer, sameServer } from "./server-core";
import { getStored, setStored } from "./storage";

/*
The server the app is connected to — the runtime half of server-core.ts.

Every request, upload, download and authed image is built on apiBase() at the
moment it is made, so switching servers takes effect everywhere at once with
no hard-coded host left behind. The choice (and the servers used before) is
kept on the device; AuthProvider keeps one session per server and swaps it
with the server.

Tokens are pinned: AuthProvider binds each session token to the server that
issued it, and authHeader() refuses to put a token on a URL of any other
server — so a request that races a server switch fails instead of handing the
old server's token to the new one.
*/

const STORE_KEY = "zekra.mobile.server.v1";

/** A development build may point at http://localhost / a LAN address. */
export const ALLOW_LOCAL_HTTP = typeof __DEV__ !== "undefined" && __DEV__;

function initialServer(): string {
  const env = process.env.EXPO_PUBLIC_ZEKRA_API_URL;
  if (env) {
    // A build-time setting, trusted like the rest of the build config.
    const r = normalizeServer(env, { allowLocalHttp: true });
    if ("url" in r) return r.url;
  }
  return CLOUD_URL;
}

/** The server a fresh install starts on (Zekra Cloud in store builds). */
export const DEFAULT_SERVER = initialServer();

type State = { base: string; servers: string[]; loaded: boolean };
let state: State = { base: DEFAULT_SERVER, servers: [DEFAULT_SERVER], loaded: false };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function persist() {
  return setStored(STORE_KEY, JSON.stringify({ base: state.base, servers: state.servers }));
}

/** The active server's base URL, e.g. https://app.zekra.dev. */
export function apiBase(): string {
  return state.base;
}

/** `${apiBase()}${path}` for an API path, or the URL itself if already absolute. */
export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${state.base}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Restore the saved server choice (once, at start-up, before the session). */
export async function loadServer(): Promise<string> {
  if (state.loaded) return state.base;
  try {
    const raw = await getStored(STORE_KEY);
    const saved = raw ? (JSON.parse(raw) as { base?: string; servers?: string[] }) : null;
    const ok = (s: unknown): s is string => typeof s === "string" && "url" in normalizeServer(s, { allowLocalHttp: true });
    const base = ok(saved?.base) ? saved.base : DEFAULT_SERVER;
    const servers = rememberServer((saved?.servers ?? []).filter(ok), base);
    set({ base, servers, loaded: true });
  } catch {
    set({ loaded: true });
  }
  return state.base;
}

/** Make `base` (already normalised and checked) the active server. */
export async function activateServer(base: string): Promise<void> {
  set({ base, servers: rememberServer(state.servers, base) });
  await persist();
}

/** Drop a saved server from the list (never the active one). */
export async function forgetServer(base: string): Promise<void> {
  if (base === state.base) return;
  set({ servers: state.servers.filter((s) => s !== base) });
  await persist();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The active server and the saved ones, re-rendering on a switch. */
export function useServer(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

// --- token pinning ---------------------------------------------------------

const tokenServer = new Map<string, string>();

/** Record which server issued a session token. */
export function bindToken(token: string, base: string) {
  tokenServer.set(token, base);
}

export function unbindToken(token: string) {
  tokenServer.delete(token);
}

/** May this token be sent to this URL? Only to the server that issued it. */
export function tokenAllowed(token: string, url: string): boolean {
  const owner = tokenServer.get(token) ?? state.base;
  return sameServer(url, owner);
}

/** The Authorization header for `url`, or nothing when the token is not this server's. */
export function authHeader(token: string | null | undefined, url: string): Record<string, string> {
  return token && tokenAllowed(token, url) ? { Authorization: `Bearer ${token}` } : {};
}

// --- checking a server -----------------------------------------------------

export type ServerCheck = { ok: true; url: string; version?: string } | { ok: false; reason: "invalid" | "insecure" | "empty" | "unreachable" | "notZekra" };

/**
 * Validate what the user typed: a well-formed https URL (http only for a
 * local server in a development build) that answers GET /api/health as Zekra.
 * Nothing is saved and no token is sent.
 */
export async function checkServer(input: string, timeoutMs = 10_000): Promise<ServerCheck> {
  const r = normalizeServer(input, { allowLocalHttp: ALLOW_LOCAL_HTTP });
  if ("error" in r) return { ok: false, reason: r.error };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(`${r.url}/api/health`, {
      headers: { Accept: "application/json", "X-Agent-Id": "zekra-mobile" },
      signal: ctrl.signal,
    });
    const payload = await response.json().catch(() => undefined);
    const health = parseHealth(payload);
    return health.ok ? { ok: true, url: r.url, version: health.version } : { ok: false, reason: "notZekra" };
  } catch {
    return { ok: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
