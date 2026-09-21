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

const DEFAULT_BASE = "https://app.zekra.dev";
const SCOPES = "brains:read brains:write";

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

async function getStored(keys) {
  return chrome.storage.local.get(keys);
}

/** Authorization-server metadata (RFC 8414), cached per API base. */
async function discover(apiBase) {
  const { oauthMeta, oauthMetaBase } = await getStored(["oauthMeta", "oauthMetaBase"]);
  if (oauthMeta && oauthMetaBase === apiBase) return oauthMeta;
  const res = await fetch(new URL("/.well-known/oauth-authorization-server", apiBase));
  if (!res.ok) throw new Error(`Discovery failed (${res.status}) at ${apiBase}`);
  const meta = await res.json();
  await chrome.storage.local.set({ oauthMeta: meta, oauthMetaBase: apiBase });
  return meta;
}

/** Register this extension install as a public OAuth client (RFC 7591). */
async function registerClient(apiBase, meta) {
  const { clientId, clientBase } = await getStored(["clientId", "clientBase"]);
  if (clientId && clientBase === apiBase) return clientId;

  const redirectUri = chrome.identity.getRedirectURL();
  const res = await fetch(meta.registration_endpoint, {
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
  if (!res.ok) throw new Error(`Client registration failed (${res.status}): ${await res.text()}`);
  const client = await res.json();
  await chrome.storage.local.set({ clientId: client.client_id, clientBase: apiBase });
  return client.client_id;
}

/** Full sign-in: discover -> register -> authorize (PKCE) -> token. */
export async function signIn(apiBase = DEFAULT_BASE) {
  const meta = await discover(apiBase);
  const clientId = await registerClient(apiBase, meta);
  const redirectUri = chrome.identity.getRedirectURL();
  const { verifier, challenge } = await pkce();
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));

  const authUrl = new URL(meta.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  // RFC 8707: bind the token to the MCP resource it will be used against.
  authUrl.searchParams.set("resource", new URL("/api/mcp", apiBase).toString());

  const redirect = await chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true });
  if (!redirect) throw new Error("Sign-in was cancelled");

  const returned = new URL(redirect);
  const error = returned.searchParams.get("error");
  if (error) throw new Error(`${error}: ${returned.searchParams.get("error_description") || ""}`);
  if (returned.searchParams.get("state") !== state) throw new Error("State mismatch — sign-in rejected");
  const code = returned.searchParams.get("code");
  if (!code) throw new Error("No authorization code returned");

  const tokenRes = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource: new URL("/api/mcp", apiBase).toString(),
    }),
  });
  if (!tokenRes.ok) throw new Error(`Token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`);
  const tok = await tokenRes.json();

  await chrome.storage.local.set({
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token || "",
    tokenExpiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : 0,
    apiBase,
  });
  return tok.access_token;
}

/** Refresh when expired; returns a usable access token or "" if signed out. */
export async function getAccessToken() {
  const { accessToken, refreshToken, tokenExpiresAt, apiBase, clientId } = await getStored([
    "accessToken", "refreshToken", "tokenExpiresAt", "apiBase", "clientId",
  ]);
  if (!accessToken) return "";
  // 60s skew so a token cannot expire mid-request.
  if (!tokenExpiresAt || Date.now() < tokenExpiresAt - 60_000) return accessToken;
  if (!refreshToken) return accessToken; // no refresh available; let the API 401

  const meta = await discover(apiBase || DEFAULT_BASE);
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }),
  });
  if (!res.ok) return accessToken;
  const tok = await res.json();
  await chrome.storage.local.set({
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token || refreshToken,
    tokenExpiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : 0,
  });
  return tok.access_token;
}

export async function signOut() {
  const { accessToken, apiBase, clientId } = await getStored(["accessToken", "apiBase", "clientId"]);
  if (accessToken) {
    try {
      const meta = await discover(apiBase || DEFAULT_BASE);
      if (meta.revocation_endpoint) {
        await fetch(meta.revocation_endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: accessToken, client_id: clientId }),
        });
      }
    } catch {
      // Revocation is best-effort: the local token is dropped either way.
    }
  }
  await chrome.storage.local.remove(["accessToken", "refreshToken", "tokenExpiresAt"]);
}

export async function isSignedIn() {
  const { accessToken } = await getStored(["accessToken"]);
  return !!accessToken;
}

export { DEFAULT_BASE, SCOPES };
