import { useEffect, useState } from "react";

import {
  appStartUrl,
  authReturn,
  bytesToBase64Url,
  isFresh,
  planSocial,
  readAuthReturn,
  serverSupport,
  supportFromMethods,
  type AuthReturn,
  type BrowserProvider,
  type ServerSupport,
  type SocialPlan,
  type SocialProvider,
} from "@mobile/features/social/social-core";

import { getApiBaseUrl, request, type AuthAnswer } from "../../lib/api";
import { bridge } from "../../lib/bridge";

/*
Social sign-in on the desktop (MH-450), the same server app flow as mobile
(mobile/src/features/social/browser-flow.ts), minus the in-app auth session:

  1. PKCE: a random verifier, its S256 challenge (WebCrypto).
  2. Open ${API}/api/auth/<provider>?app=1&return=zekra://auth/<provider>
     &code_challenge=…&code_challenge_method=S256 in the SYSTEM browser.
  3. The API redirects to zekra://auth/<provider>?code=… (or ?error=…); macOS
     hands that to the app (src/main/deep-links.ts) and it arrives as a
     "deep-link" OS event (the sign-in screen listens).
  4. POST /api/auth/<provider>/exchange {code, code_verifier} → {token, user},
     or a 2FA challenge exactly like the password login.

Apple has no desktop flow (it is a native identity token on iOS), so it is
never offered here. Google needs the server's app flow (`app: true`); GitHub's
app flow exists on older servers too (GET /api/auth/methods fallback).
*/

export const PROVIDER_NAME: Record<SocialProvider, string> = { apple: "Apple", google: "Google", github: "GitHub" };

/* ------------------------------------------------------------ providers */

const cache = new Map<string, { at: number; plan: SocialPlan }>();
const inflight = new Map<string, Promise<SocialPlan | null>>();

async function loadServer(): Promise<ServerSupport | null> {
  const payload = await request<unknown>("/api/auth/providers").catch(() => undefined);
  const direct = serverSupport(payload);
  if (direct) return direct;
  const methods = await request<unknown>("/api/auth/methods").catch(() => undefined);
  return methods === undefined ? null : supportFromMethods(methods);
}

async function loadPlan(base: string): Promise<SocialPlan | null> {
  const server = await loadServer();
  if (!server) return null;
  // The desktop runs the browser flow only: no Google SDK, no Apple sheet.
  const plan = planSocial(server, { browser: true, googleSdk: false, apple: false });
  cache.set(base, { at: Date.now(), plan });
  return plan;
}

/** Which provider buttons to show for the current API origin; null while finding out (never blocks the form). */
export function useSocialProviders(): SocialPlan | null {
  const base = getApiBaseUrl();
  const fresh = () => {
    const hit = cache.get(base);
    return hit && isFresh(hit.at, Date.now()) ? hit.plan : null;
  };
  const [plan, setPlan] = useState<SocialPlan | null>(fresh);
  useEffect(() => {
    const hit = fresh();
    if (hit) {
      setPlan(hit);
      return;
    }
    let alive = true;
    let p = inflight.get(base);
    if (!p) {
      p = loadPlan(base).finally(() => inflight.delete(base));
      inflight.set(base, p);
    }
    void p.then((next) => {
      if (alive && next) setPlan(next);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  return plan;
}

/* ----------------------------------------------------------------- flow */

/** A started flow: which provider, its verifier, when. Survives a renderer reload (sessionStorage). */
export type PendingFlow = { provider: BrowserProvider; verifier: string; startedAt: number; base: string };

const PENDING_KEY = "zekra.social.pending";
/** The server's one-time code lives two minutes; a browser sign-in can take longer to start. */
export const PENDING_TTL_MS = 10 * 60 * 1000;

export function loadPending(): PendingFlow | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as PendingFlow;
    if ((v.provider !== "github" && v.provider !== "google") || typeof v.verifier !== "string") return null;
    if (Date.now() - v.startedAt > PENDING_TTL_MS) return null;
    return v;
  } catch {
    return null;
  }
}

export function clearPending(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

/** Start a provider's sign-in in the system browser; resolves with the pending flow to wait on. */
export async function startSocial(provider: BrowserProvider): Promise<PendingFlow> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = bytesToBase64Url(bytes); // 43 chars
  const base = getApiBaseUrl();
  const flow: PendingFlow = { provider, verifier, startedAt: Date.now(), base };
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(flow));
  } catch {
    // the flow still works for this renderer's lifetime
  }
  await bridge().openExternal(appStartUrl(base, provider, await s256(verifier)));
  return flow;
}

/** Re-open the browser for an already-pending flow (same verifier / challenge). */
export async function reopenSocial(flow: PendingFlow): Promise<void> {
  await bridge().openExternal(appStartUrl(flow.base, flow.provider, await s256(flow.verifier)));
}

/** The provider a zekra://auth/<provider>… link is for, or null. */
export function providerOfLink(path: string): BrowserProvider | null {
  const p = path.split(/[/?#]/)[0];
  return p === "github" || p === "google" ? p : null;
}

export function readReturn(url: string, provider: BrowserProvider): AuthReturn {
  return readAuthReturn(url, authReturn(provider));
}

export function exchangeCode(provider: BrowserProvider, code: string, verifier: string): Promise<AuthAnswer> {
  return request<AuthAnswer>(`/api/auth/${provider}/exchange`, { json: { code, code_verifier: verifier } });
}
