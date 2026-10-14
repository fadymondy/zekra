// Before the app is pointed at a server (Settings ▸ General, zekra://connect),
// make sure it is one: https (or a local server in a development build) and
// answering GET /api/health as Zekra. Runs in main: the renderer's API proxy
// only ever talks to the configured server, so it can't probe a new one.
"use strict";

import { app, net } from "electron";

import { isZekraHealth, normalizeServerUrl, type ServerUrlError } from "../shared/server-url";

export type ServerCheck = { ok: true; url: string } | { ok: false; reason: ServerUrlError | "unreachable" | "notZekra" };

export async function checkServer(input: string, timeoutMs = 8000): Promise<ServerCheck> {
  const n = normalizeServerUrl(input, !app.isPackaged);
  if ("error" in n) return { ok: false, reason: n.error };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    // No credentials: the server is not trusted yet.
    const res = await net.fetch(`${n.url}/api/health`, { signal: ctl.signal, credentials: "omit", redirect: "error" });
    if (!res.ok) return { ok: false, reason: "notZekra" };
    const body: unknown = await res.json().catch(() => null);
    return isZekraHealth(body) ? { ok: true, url: n.url } : { ok: false, reason: "notZekra" };
  } catch {
    return { ok: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
