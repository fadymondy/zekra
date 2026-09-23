// OAuth 2.1 for the Zekra extension.
//
// Zekra already runs a full authorization server for its MCP endpoint
// (plugins/brain/internal/brain/oauth.go): RFC 7591 dynamic client
// registration, authorization code + PKCE (S256), and public clients
// (`token_endpoint_auth_methods_supported` includes "none"). A browser
// extension is exactly that kind of public client, so it registers itself once
// and then runs the normal code flow through chrome.identity.launchWebAuthFlow.
//
// Why the token is an OAuth token and not a hand-pasted X-Zekra-Token: the
// OAuth principal is attached in mcp_http.go, so an OAuth access token
// authenticates the MCP endpoint (/api/mcp). The plain REST routes only accept
// X-Zekra-Token / a session cookie. The extension therefore talks MCP.
//
// Notes that shape this file (all verified against production):
//  - The issuer is https://mcp.zekra.dev, so register/token/revoke live on a
//    DIFFERENT host than the API base. That host must be in host_permissions:
//    its CORS preflight answers 204 with no Access-Control-* headers, so a
//    JSON POST (registration) from an extension page without the permission
//    fails with "Failed to fetch".
//  - Refresh tokens rotate with reuse detection: presenting a spent refresh
//    token revokes the whole connection. The popup and the service worker can
//    both hold an expired token at the same moment, so refresh is single-flight
//    across every extension context (Web Locks are shared per origin).
//  - signIn() must run in the service worker (see background.js): the popup
//    closes the moment the sign-in window takes focus, which would kill the
//    code exchange half-way.

const DEFAULT_BASE = "https://app.zekra.dev";
const SCOPES = "brains:read brains:write";
const TOKEN_KEYS = ["accessToken", "refreshToken", "tokenExpiresAt", "tokenBase"];
const NET_TIMEOUT_MS = 15_000;

export class AuthError extends Error {
  constructor(message, { signedOut = false } = {}) {
    super(message);
    this.signedOut = signedOut;
  }
}

/** fetch with a hard timeout, so nothing in the UI can wait forever.
 *  credentials:"omit" — the extension authenticates with bearer tokens / as a
 *  public client and never needs cookies. With host permissions granted, a
 *  credentialed fetch from an extension page to /api/oauth/token was observed
 *  to stall indefinitely (Chrome 143), while the same request with
 *  credentials omitted answers in ~100ms. */
export async function fetchWithTimeout(url, init = {}, ms = NET_TIMEOUT_MS) {
  try {
    return await fetch(url, { credentials: "omit", cache: "no-store", ...init, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return String(url);
      }
    })();
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new AuthError(`${host} did not answer within ${Math.round(ms / 1000)}s.`);
    }
    throw new AuthError(`Could not reach ${host} (${e?.message || e}).`);
  }
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function pkce() {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64url(verifierBytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(digest) };
}

function normBase(apiBase) {
  return (apiBase || DEFAULT_BASE).replace(/\/+$/, "");
}

/** Authorization-server metadata (RFC 8414), cached per API base. */
async function discover(apiBase, { fresh = false } = {}) {
  apiBase = normBase(apiBase);
  if (!fresh) {
    const { oauthMeta, oauthMetaBase } = await chrome.storage.local.get(["oauthMeta", "oauthMetaBase"]);
    if (oauthMeta && oauthMetaBase === apiBase) return oauthMeta;
  }
  const res = await fetchWithTimeout(new URL("/.well-known/oauth-authorization-server", apiBase));
  if (!res.ok) throw new AuthError(`Sign-in discovery failed (${res.status}) at ${apiBase}.`);
  const meta = await res.json();
  if (!meta.authorization_endpoint || !meta.token_endpoint) {
    throw new AuthError(`${apiBase} did not publish OAuth endpoints.`);
  }
  await chrome.storage.local.set({ oauthMeta: meta, oauthMetaBase: apiBase });
  return meta;
}

async function errorText(res) {
  try {
    const t = await res.text();
    try {
      const j = JSON.parse(t);
      return j.error_description || j.error || t;
    } catch {
      return t;
    }
  } catch {
    return res.statusText;
  }
}

/** Register this extension install as a public OAuth client (RFC 7591). */
async function registerClient(apiBase, meta, { fresh = false } = {}) {
  const redirectUri = chrome.identity.getRedirectURL();
  if (!fresh) {
    const { clientId, clientBase, clientRedirect } = await chrome.storage.local.get([
      "clientId", "clientBase", "clientRedirect",
    ]);
    if (clientId && clientBase === apiBase && (!clientRedirect || clientRedirect === redirectUri)) return clientId;
  }
  if (!meta.registration_endpoint) throw new AuthError("This Zekra server does not accept new app registrations.");

  const res = await fetchWithTimeout(meta.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Zekra browser extension",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // public client — no secret to hide in an extension
      scope: SCOPES,
    }),
  });
  if (!res.ok) throw new AuthError(`App registration failed (${res.status}): ${await errorText(res)}`);
  const client = await res.json();
  await chrome.storage.local.set({ clientId: client.client_id, clientBase: apiBase, clientRedirect: redirectUri });
  return client.client_id;
}

async function storeTokens(tok, apiBase, previousRefresh = "") {
  await chrome.storage.local.set({
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token || previousRefresh || "",
    tokenExpiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : 0,
    tokenBase: apiBase,
  });
}

/** Full sign-in: discover -> register -> authorize (PKCE) -> token.
 *  Call from the service worker (background.js), never from the popup. */
export async function signIn(apiBase = DEFAULT_BASE) {
  apiBase = normBase(apiBase);
  const meta = await discover(apiBase, { fresh: true });
  const clientId = await registerClient(apiBase, meta);
  const redirectUri = chrome.identity.getRedirectURL();
  const { verifier, challenge } = await pkce();
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const resource = new URL("/api/mcp", apiBase).toString();

  const authUrl = new URL(meta.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  // RFC 8707: bind the token to the MCP resource it will be used against.
  authUrl.searchParams.set("resource", resource);

  let redirect;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true });
  } catch (e) {
    const msg = e?.message || String(e);
    if (/did not approve|closed|cancel/i.test(msg)) throw new AuthError("Sign-in was cancelled.");
    // The consent page could not continue (for example a client the server no
    // longer knows). Forget the registration so the next attempt starts clean
    // instead of failing the same way again.
    await chrome.storage.local.remove(["clientId", "clientBase", "clientRedirect"]);
    throw new AuthError(`Sign-in did not finish: ${msg}`);
  }
  if (!redirect) throw new AuthError("Sign-in was cancelled.");

  const returned = new URL(redirect);
  const error = returned.searchParams.get("error");
  if (error) {
    if (error === "invalid_client") await chrome.storage.local.remove(["clientId", "clientBase", "clientRedirect"]);
    throw new AuthError(error === "access_denied" ? "Access was not approved." : `${error}: ${returned.searchParams.get("error_description") || ""}`);
  }
  if (returned.searchParams.get("state") !== state) throw new AuthError("State mismatch — sign-in rejected.");
  const code = returned.searchParams.get("code");
  if (!code) throw new AuthError("No authorization code returned.");

  const tokenRes = await fetchWithTimeout(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    }),
  });
  if (!tokenRes.ok) throw new AuthError(`Token exchange failed (${tokenRes.status}): ${await errorText(tokenRes)}`);
  const tok = await tokenRes.json();
  await storeTokens(tok, apiBase);
  // Brains from a previous account must not flash in the picker.
  await chrome.storage.local.remove(["brainsCache"]);
  await chrome.storage.local.set({ apiBase });
  return tok.access_token;
}

/** Drop the local session (no network). */
export async function clearSession() {
  await chrome.storage.local.remove([...TOKEN_KEYS, "brainsCache"]);
}

async function withRefreshLock(fn) {
  // Web Locks are shared by the popup, options page and service worker (same
  // extension origin), so two contexts can never spend one refresh token twice.
  if (globalThis.navigator?.locks?.request) return navigator.locks.request("zekra-token-refresh", fn);
  return fn();
}

async function refreshNow(stored, apiBase) {
  const meta = await discover(apiBase);
  const res = await fetchWithTimeout(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: stored.refreshToken,
      client_id: stored.clientId || "",
    }),
  });
  if (res.status === 400 || res.status === 401) {
    // invalid_grant / invalid_client: the connection is gone (revoked, expired,
    // or the refresh token was already used). Retrying cannot help.
    const why = await errorText(res);
    await clearSession();
    throw new AuthError(`Your Zekra connection ended (${why}). Connect again.`, { signedOut: true });
  }
  if (!res.ok) throw new AuthError(`Could not refresh your Zekra session (${res.status}).`);
  const tok = await res.json();
  await storeTokens(tok, apiBase, stored.refreshToken);
  return tok.access_token;
}

/**
 * A usable access token, refreshing when it is (about to be) expired.
 * Returns "" when signed out. Throws AuthError{signedOut} when the refresh
 * token is dead (the session is cleared first, so the UI can show sign-in).
 * `force` refreshes even if the token looks valid (after a 401).
 */
export async function getAccessToken({ force = false } = {}) {
  const first = await chrome.storage.local.get([...TOKEN_KEYS, "apiBase", "clientId"]);
  if (!first.accessToken) return "";
  // 60s skew so a token cannot expire mid-request.
  const fresh = (s) => !s.tokenExpiresAt || Date.now() < s.tokenExpiresAt - 60_000;
  if (!force && fresh(first)) return first.accessToken;
  if (!first.refreshToken) {
    if (force || (first.tokenExpiresAt && Date.now() >= first.tokenExpiresAt)) {
      await clearSession();
      throw new AuthError("Your Zekra session expired. Connect again.", { signedOut: true });
    }
    return first.accessToken;
  }

  return withRefreshLock(async () => {
    // Re-read inside the lock: another context may have refreshed already.
    const s = await chrome.storage.local.get([...TOKEN_KEYS, "apiBase", "clientId"]);
    if (!s.accessToken) throw new AuthError("Signed out. Connect again.", { signedOut: true });
    if (s.accessToken !== first.accessToken && fresh(s)) return s.accessToken;
    if (!force && fresh(s)) return s.accessToken;
    return refreshNow(s, normBase(s.tokenBase || s.apiBase));
  });
}

export async function signOut() {
  const { accessToken, refreshToken, apiBase, tokenBase, clientId } = await chrome.storage.local.get([
    "accessToken", "refreshToken", "apiBase", "tokenBase", "clientId",
  ]);
  await clearSession();
  // Revocation is best-effort and must not hold up the UI.
  (async () => {
    try {
      const meta = await discover(normBase(tokenBase || apiBase));
      if (!meta.revocation_endpoint) return;
      for (const token of [refreshToken, accessToken].filter(Boolean)) {
        await fetchWithTimeout(meta.revocation_endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token, client_id: clientId || "" }),
        }, 8_000);
      }
    } catch {
      // The local token is already gone.
    }
  })();
}

export async function isSignedIn() {
  const { accessToken } = await chrome.storage.local.get(["accessToken"]);
  return !!accessToken;
}

export { DEFAULT_BASE, SCOPES, normBase };
