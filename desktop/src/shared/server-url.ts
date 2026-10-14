// Which Zekra server the desktop app talks to: Zekra Cloud or a self-hosted
// Zekra. Shared by main (the authority: settings patch, zekra://connect) and
// the renderer (Settings ▸ General). Mirrors mobile/src/lib/server-core.ts.
"use strict";

export type ServerUrlError = "empty" | "invalid" | "insecure";

/** localhost, loopback, RFC 1918 / link-local LAN addresses and mDNS (.local). */
export function isLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h === "::1") return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

/**
 * A server base URL as typed or linked → `https://host[:port][/prefix]`, or why
 * not. No scheme means https; plain http only for a local host and only when
 * `allowLocalHttp` (a development build). No credentials, query or fragment.
 */
export function normalizeServerUrl(input: string, allowLocalHttp: boolean): { url: string } | { error: ServerUrlError } {
  let raw = (input ?? "").trim();
  if (!raw) return { error: "empty" };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { error: "invalid" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "invalid" };
  if (u.username || u.password || !u.hostname) return { error: "invalid" };
  if (u.protocol === "http:" && !(allowLocalHttp && isLocalHost(u.hostname))) return { error: "insecure" };
  const path = u.pathname.replace(/\/+$/, "");
  return { url: `${u.protocol}//${u.host}${path}` };
}

/** Same server: scheme + host + port + path prefix. A session belongs to one. */
export function sameServer(a: string, b: string): boolean {
  const norm = (s: string) => (s ?? "").trim().replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/** GET {base}/api/health answers {"status":"ok","service":"zekra",…}. */
export function isZekraHealth(payload: unknown): boolean {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  return !!p && p.service === "zekra" && p.status === "ok";
}
