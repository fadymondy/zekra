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

import { DEFAULT_BASE, getAccessToken } from "./oauth.js";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function getSettings() {
  const { apiBase, agentId, namespace } = await chrome.storage.local.get(["apiBase", "agentId", "namespace"]);
  return {
    apiBase: apiBase || DEFAULT_BASE,
    agentId: agentId || "extension",
    namespace: namespace || "",
  };
}

export async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}

let requestId = 0;

/** One MCP tools/call over Streamable HTTP. */
async function callTool(name, args) {
  const { apiBase, agentId } = await getSettings();
  const token = await getAccessToken();
  if (!token) throw new ApiError(401, "Not signed in. Open the popup and connect your Zekra account.");

  let res;
  try {
    res = await fetch(new URL("/api/mcp", apiBase), {
      method: "POST",
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
    });
  } catch (e) {
    throw new ApiError(0, `Could not reach ${apiBase} (${e.message}).`);
  }

  if (res.status === 401) throw new ApiError(401, "Your Zekra session expired. Sign in again.");
  const text = await res.text();
  if (!res.ok) throw new ApiError(res.status, text || res.statusText);

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ApiError(res.status, "Unexpected response from Zekra");
  }
  if (payload.error) throw new ApiError(res.status, payload.error.message || "Request failed");

  const result = payload.result;
  // MCP reports tool-level failures with isError, not an HTTP status.
  if (result?.isError) throw new ApiError(400, result.content?.[0]?.text || "Request failed");
  return result?.content?.[0]?.text ?? "";
}

/** brain_list -> {"brains":[{namespace,...}]} serialised as MCP text. */
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
  return { brains };
}

/** memory_retain — save the page/selection into a brain. The page URL goes in
 *  source_ref so the memory keeps its provenance, not just in the body. */
export function createNote({ namespace, title, body, tags, url }) {
  const parts = [];
  if (title) parts.push(`# ${title}`);
  if (body) parts.push(body);
  if (tags?.length) parts.push(`Tags: ${tags.join(", ")}`);
  return callTool("memory_retain", {
    namespace,
    content: parts.join("\n\n"),
    source_kind: "extension",
    source_ref: url || "",
  });
}

/** secret_store — fast vault add. The tool takes kind (not hint). */
export function putSecret({ namespace, name, value, kind }) {
  return callTool("secret_store", { namespace, name, value, kind: kind || "credential" });
}

export { DEFAULT_BASE };
