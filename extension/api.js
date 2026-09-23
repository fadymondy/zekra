// Zekra MCP client for the extension.
//
// The extension authenticates with OAuth (see oauth.js) and therefore talks to
// the MCP endpoint, not the plain REST routes: the OAuth principal is attached
// in plugins/brain/internal/brain/mcp_http.go, so an OAuth access token
// authenticates /api/mcp. The REST routes (/api/notes, /api/brain/secrets)
// only accept an X-Zekra-Token header or a first-party session cookie, neither
// of which an extension should hold.
//
// Tools used (plugins/brain/mcptools/dispatch.go):
//   brain_list    (read)  -> the brains this grant can reach
//   memory_retain (write) -> the bookmark / fast note
//   secret_store  (write) -> the fast vault add
//
// Every call has a hard timeout and every failure becomes an ApiError with a
// human message; `signedOut` tells the UI to show "Connect" instead of an error.

import { DEFAULT_BASE, getAccessToken, clearSession, normBase, AuthError } from "./oauth.js";

// brain_list is a read (server does a GROUP BY over every memory, so give it
// room); memory_retain embeds + runs the write decision synchronously.
const READ_TIMEOUT_MS = 20_000;
const WRITE_TIMEOUT_MS = 45_000;

export class ApiError extends Error {
  constructor(status, message, { signedOut = false } = {}) {
    super(message);
    this.status = status;
    this.signedOut = signedOut;
  }
}

function toApiError(e) {
  if (e instanceof ApiError) return e;
  if (e instanceof AuthError) return new ApiError(e.signedOut ? 401 : 0, e.message, { signedOut: e.signedOut });
  return new ApiError(0, e?.message || String(e));
}

export async function getSettings() {
  const { apiBase, agentId, namespace } = await chrome.storage.local.get(["apiBase", "agentId", "namespace"]);
  return {
    apiBase: normBase(apiBase || DEFAULT_BASE),
    agentId: agentId || "extension",
    namespace: namespace || "",
  };
}

export async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}

let requestId = 0;

async function post(apiBase, agentId, token, name, args, timeoutMs) {
  try {
    return await fetch(new URL("/api/mcp", apiBase), {
      method: "POST",
      credentials: "omit", // bearer auth only; see fetchWithTimeout in oauth.js
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "X-Agent-Id": agentId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++requestId,
        method: "tools/call",
        params: { name, arguments: args },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const host = new URL(apiBase).host;
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new ApiError(0, `${host} did not answer within ${Math.round(timeoutMs / 1000)}s. Try again.`);
    }
    throw new ApiError(0, `Could not reach ${host}. Check your connection.`);
  }
}

/** Parse a JSON body, or the first `data:` frame if the server chose SSE. */
function parseRpc(text) {
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) return JSON.parse(t);
  const data = t.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
  return JSON.parse(data);
}

/** One MCP tools/call over Streamable HTTP. */
async function callTool(name, args, { timeoutMs = READ_TIMEOUT_MS } = {}) {
  try {
    const { apiBase, agentId } = await getSettings();
    let token = await getAccessToken();
    if (!token) throw new ApiError(401, "Not connected. Connect your Zekra account.", { signedOut: true });

    let res = await post(apiBase, agentId, token, name, args, timeoutMs);
    if (res.status === 401) {
      // The token may have been revoked/rotated elsewhere: refresh once, then
      // give up cleanly (no loop, no stale "signed in" state).
      try {
        token = await getAccessToken({ force: true });
      } catch (e) {
        throw toApiError(e);
      }
      if (token) res = await post(apiBase, agentId, token, name, args, timeoutMs);
      if (!token || res.status === 401) {
        await clearSession();
        throw new ApiError(401, "Your Zekra session expired. Connect again.", { signedOut: true });
      }
    }

    const text = await res.text();
    if (res.status === 404) throw new ApiError(404, `${new URL(apiBase).host} has no MCP endpoint at /api/mcp. Check the API base in Options.`);
    if (res.status === 429) throw new ApiError(429, "Zekra is rate-limiting requests. Wait a moment and try again.");
    if (res.status >= 500) throw new ApiError(res.status, `Zekra had a problem (${res.status}). Try again shortly.`);

    let payload;
    try {
      payload = parseRpc(text);
    } catch {
      throw new ApiError(res.status, res.ok ? "Unexpected response from Zekra." : `Request failed (${res.status}).`);
    }
    if (payload.error) throw new ApiError(res.status, payload.error.message || "Request failed");
    if (!res.ok) throw new ApiError(res.status, `Request failed (${res.status}).`);

    const result = payload.result;
    // MCP reports tool-level failures with isError, not an HTTP status.
    if (result?.isError) throw new ApiError(400, result.content?.[0]?.text || "Request failed");
    return result?.content?.[0]?.text ?? "";
  } catch (e) {
    throw toApiError(e);
  }
}

/** brain_list -> {"brains":[{namespace,...}]} serialised as MCP text.
 *  The result is cached so the popup can render instantly next time. */
export async function listMyBrains() {
  const text = await callTool("brain_list", {});
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(0, "Could not read the brain list from Zekra");
  }
  const brains = (parsed.brains || []).map((b) => ({
    namespace: b.namespace,
    canWrite: b.canWrite !== false,
    role: b.role,
  }));
  const { apiBase } = await getSettings();
  await chrome.storage.local.set({ brainsCache: { brains, at: Date.now(), base: apiBase } });
  return { brains };
}

/** memory_retain — save the page/selection into a brain. The page URL goes in
 *  source_ref so the memory keeps its provenance, not just in the body. */
export function createNote({ namespace, title, body, tags, url }) {
  const parts = [];
  if (title) parts.push(`# ${title}`);
  if (body) parts.push(body);
  if (tags?.length) parts.push(`Tags: ${tags.join(", ")}`);
  return callTool(
    "memory_retain",
    {
      namespace,
      content: parts.join("\n\n"),
      source_kind: "extension",
      source_ref: url || "",
    },
    { timeoutMs: WRITE_TIMEOUT_MS },
  );
}

/** secret_store — fast vault add. The tool takes kind (not hint). */
export function putSecret({ namespace, name, value, kind }) {
  return callTool("secret_store", { namespace, name, value, kind: kind || "credential" }, { timeoutMs: WRITE_TIMEOUT_MS });
}

export { DEFAULT_BASE };
