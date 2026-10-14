/*
Which Zekra server the app talks to — the pure half (no RN, runs under
`node --test`, server-core.test.ts). One app in the stores; each user points it
at Zekra Cloud or at their own self-hosted Zekra.

A server is a base URL: scheme + host[:port] + an optional path prefix (a
Zekra behind a reverse proxy at /zekra), lower-cased, no trailing slash, no
query, no credentials. Everything the app requests is `${base}${path}`, and a
session token is only ever attached to a URL on the server it was issued by
(sameServer).

Hand-parsed rather than `new URL()`: React Native's URL is partial and the
host checks below must not depend on it.
*/

/** Zekra Cloud. The only place the cloud host is written down for the API. */
export const CLOUD_URL = "https://app.zekra.dev";
/** Cloud's MCP endpoint (a self-hosted server serves MCP at {base}/api/mcp). */
export const CLOUD_MCP_URL = "https://mcp.zekra.dev";

export type ServerError = "empty" | "invalid" | "insecure";

const URL_RE = /^(https?):\/\/(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:\d{1,5})?(\/[^?#\s]*)?(?:[?#].*)?$/i;

/** localhost, loopback, RFC 1918 / link-local LAN addresses, mDNS (.local)
 *  and the Android emulator's host alias — where plain http is tolerated in a
 *  development build. */
export function isLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h === "::1") return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

/**
 * What the user typed (or a link carried) as a server base URL, or why not.
 * No scheme means https. Plain http is refused unless `allowLocalHttp` (a
 * development build) and the host is local/LAN.
 */
export function normalizeServer(input: string, opts: { allowLocalHttp?: boolean } = {}): { url: string } | { error: ServerError } {
  let raw = (input ?? "").trim();
  if (!raw) return { error: "empty" };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^:/]+:\d/.test(raw)) return { error: "invalid" };
    raw = `https://${raw}`;
  }
  const m = URL_RE.exec(raw);
  if (!m) return { error: "invalid" };
  const scheme = m[1].toLowerCase();
  const host = m[2].toLowerCase();
  if (host.startsWith(".") || host.endsWith(".") || host.includes("..")) return { error: "invalid" };
  const port = m[3] ?? "";
  if (port && (Number(port.slice(1)) < 1 || Number(port.slice(1)) > 65535)) return { error: "invalid" };
  if (scheme === "http" && !(opts.allowLocalHttp && isLocalHost(host))) return { error: "insecure" };
  const defaultPort = (scheme === "https" && port === ":443") || (scheme === "http" && port === ":80");
  const path = (m[4] ?? "").replace(/\/+$/, "");
  return { url: `${scheme}://${host}${defaultPort ? "" : port}${path}` };
}

/** True when `url` is on the server `base` — same scheme, host, port and under
 *  its path prefix. The only test that decides whether a token may be sent. */
export function sameServer(url: string, base: string): boolean {
  if (!url || !base) return false;
  const b = base.replace(/\/+$/, "");
  if (!url.toLowerCase().startsWith(b.toLowerCase())) return false;
  const next = url.charAt(b.length);
  return next === "" || next === "/" || next === "?" || next === "#";
}

/** "app.zekra.dev", "zekra.example.com/zekra" — for display. */
export function serverLabel(base: string): string {
  return base.replace(/^https?:\/\//i, "");
}

export function isCloud(base: string): boolean {
  return base.replace(/\/+$/, "").toLowerCase() === CLOUD_URL;
}

/** The MCP endpoint other clients connect to for this server. */
export function mcpUrlFor(base: string): string {
  return isCloud(base) ? CLOUD_MCP_URL : `${base}/api/mcp`;
}

/**
 * The secure-store key for a server's session. expo-secure-store keys allow
 * only [A-Za-z0-9._-], so everything else (and "_" itself, the escape) is
 * written as _xx hex — reversible, so two servers never share a key.
 */
export function sessionKey(base: string): string {
  const safe = base.replace(/[^A-Za-z0-9.-]/g, (c) => `_${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
  return `zekra.mobile.session.v2.${safe}`;
}

/** GET {base}/api/health answers {"status":"ok","service":"zekra","togo":"…"}. */
export function parseHealth(payload: unknown): { ok: true; version?: string } | { ok: false } {
  if (!payload || typeof payload !== "object") return { ok: false };
  const p = payload as Record<string, unknown>;
  if (p.service !== "zekra" || p.status !== "ok") return { ok: false };
  return { ok: true, version: typeof p.togo === "string" && p.togo ? p.togo : undefined };
}

/** Saved servers, most recent first, the active one included, no duplicates. */
export function rememberServer(list: string[], base: string, max = 8): string[] {
  return [base, ...list.filter((s) => s !== base)].slice(0, max);
}

/**
 * zekra://connect?server=https%3A%2F%2Fzekra.example.com — a link (QR code,
 * another device, the web console) that points this app at a server. Only the
 * server is taken: a link never carries a session token, so a `token` in it is
 * ignored — the user signs in on that server here.
 */
export function connectTarget(params: Record<string, string | string[] | undefined>, opts: { allowLocalHttp?: boolean } = {}) {
  const raw = params.server;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return { error: "empty" as const };
  return normalizeServer(value, opts);
}
