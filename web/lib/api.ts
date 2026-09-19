// The one fetch wrapper for the Zekra API. Same origin (next.config.mjs proxies /api), session
// cookie `togo_session`, CSRF token on every mutating request.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

let csrfToken: string | null = null
let csrfPending: Promise<string> | null = null

async function getCsrf(force = false): Promise<string> {
  if (csrfToken && !force) return csrfToken
  if (!csrfPending || force) {
    csrfPending = fetch("/api/auth/csrf", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
        const data = (await res.json()) as { csrf_token?: string }
        if (!data.csrf_token) throw new ApiError(500, "The API did not return a CSRF token")
        csrfToken = data.csrf_token
        return csrfToken
      })
      .finally(() => {
        csrfPending = null
      })
  }
  return csrfPending
}

/** Forget the cached token, e.g. after sign-out (a new session gets a new token). */
export function resetCsrf() {
  csrfToken = null
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const text = await res.text()
    try {
      const data = JSON.parse(text) as { error?: string | { message?: string }; message?: string; detail?: string }
      const err = typeof data.error === "object" ? data.error?.message : data.error
      return err || data.message || data.detail || text || res.statusText
    } catch {
      return text || res.statusText || `Request failed (${res.status})`
    }
  } catch {
    return res.statusText || `Request failed (${res.status})`
  }
}

export type ApiOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  /** JSON body. */
  json?: unknown
  /** Multipart body (the browser sets the boundary). */
  form?: FormData
  signal?: AbortSignal
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.json !== undefined || opts.form ? "POST" : "GET")
  const mutating = method !== "GET"

  const send = async (forceCsrf: boolean) => {
    const headers: Record<string, string> = { Accept: "application/json" }
    if (opts.json !== undefined) headers["Content-Type"] = "application/json"
    if (mutating) headers["X-CSRF-Token"] = await getCsrf(forceCsrf)
    return fetch(path, {
      method,
      headers,
      body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
      credentials: "same-origin",
      cache: "no-store",
      signal: opts.signal,
    })
  }

  let res = await send(false)
  if (!res.ok && mutating && res.status === 403) {
    const msg = await errorMessage(res.clone())
    // A stale token (new session, server restart): fetch a fresh one and retry exactly once.
    if (/csrf/i.test(msg)) res = await send(true)
  }

  if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
  if (res.status === 204) return undefined as T
  const type = res.headers.get("content-type") ?? ""
  return (type.includes("json") ? await res.json() : await res.text()) as T
}


// ── Brain contract types ─────────────────────────────────────────────────

// Client for the brain plugin's console API (/api/brain/*).

export type Stats = {
  ready: boolean;
  brains: number;
  memories: number;
  entities: number;
  edges: number;
  agents: number;
  sessions24h: number;
  recalls24h: number;
  openGaps: number;
};

export type ActivityItem = {
  id: number;
  ts: string;
  op: string;
  namespace: string;
  agentId: string;
  outcome: "hit" | "empty" | "error" | "running" | string;
  latencyMs: number;
};

// Brain list items carry the brain's profile summary (display name, colour, icon, avatar).
export type NamespaceInfo = {
  namespace: string;
  memories: number;
  lastAt: string;
  displayName?: string;
  description?: string;
  color?: string;
  colorHex?: string;
  icon?: string;
  imageUrl?: string;
};

// Derived hierarchy graph: root -> type nodes -> entity nodes.
// `group` is "root" | "type" | "<typename>" (used to color nodes).
// `type` is the entity type (on a derived memory node, its note's category); `noteId` is set
// when the node is a note's.
export type GraphNode = { id: string; name: string; group?: string; type?: string; noteId?: string };
export type GraphEdge = { source: string; target: string };
export type GraphTypeCount = { type: string; count: number };
export type GraphData = {
  ready: boolean;
  derived?: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
  // TRUE populations over the whole graph. `nodes`/`edges` are a capped sample
  // (each type gets a quota of limit/#types), so never count them for display.
  typeCounts?: GraphTypeCount[];
  relationCounts?: GraphTypeCount[];
  totalNodes?: number;
  totalEdges?: number;
  sampled?: boolean;
};

// A full memory row, as returned by GET /api/brain/memory?namespace&id.
export type Memory = {
  id: string;
  namespace: string;
  content: string;
  network?: string;
  memoryType?: string;
  sourceKind?: string;
  sourceRef?: string;
  importance?: number;
  visibility?: string;
  validAt?: string;
  metadata?: Record<string, unknown>;
};

export type Recalled = {
  id: string;
  content: string;
  score: number;
  network: string;
  memoryType: string;
  sourceKind: string;
  sourceRef: string;
  importance: number;
  validAt: string;
  viaEntity?: string;
  // Present on cross-brain /search results (which brain the hit came from).
  namespace?: string;
};

export type Gap = {
  id: number;
  namespace: string;
  query: string;
  hits: number;
  status: "open" | "indexed" | "dismissed" | string;
  resolution?: string;
  firstSeen: string;
  lastSeen: string;
};

export type GapStatus = "indexed" | "dismissed" | "open";

// Per-brain access grant attached to an access token's agent.
export type Grant = {
  agentId: string;
  namespace: string;
  canRead: boolean;
  canWrite: boolean;
};

// Access token — the secret an agent puts in ZEKRA_TOKEN. `token` is the raw
// secret and is only fully returned once (on create); the list may mask it.
export type Token = {
  token: string;
  agentId: string;
  label: string;
  isAdmin: boolean;
  createdAt: string;
  lastUsedAt: string;
  revoked: boolean;
  grants: Grant[];
};

// Per-brain secret metadata. The list NEVER carries the decrypted value — `hint`
// is a masked preview (e.g. "sk-…mnop"); the value is fetched lazily via reveal.
export type SecretMeta = {
  namespace: string;
  name: string;
  hint: string;
  kind: string;
  sourceRef?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type BrainDetail = {
  namespace: string;
  memories: number;
  types: Record<string, number>;
  sources: Record<string, number>;
  openGaps: number;
  recalls: number;
  firstAt: string;
  lastAt: string;
};

// A configured data-source connector bound to a brain. Connects external
// knowledge (GitHub, a website, a SQL DB, a webhook push) into the namespace.
export type DatasourceKind =
  | "webhook" | "text" | "crawler" | "github" | "sql"
  | "pdf" | "image" | "mcp" | string;

export type Datasource = {
  id: string;
  namespace: string;
  kind: DatasourceKind;
  name: string;
  config: Record<string, unknown>;
  status: "idle" | "syncing" | "ok" | "error" | string;
  cursor?: string;
  lastError?: string;
  docCount: number;
  lastSyncAt?: string;
  createdAt: string;
};

// Result of POST /api/brain/datasources/sync — how many docs were ingested.
export type SyncResult = { ingested: number; status: string; error?: string };

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const brainApi = {
  // `authRequired` reflects the backend ZEKRA_REQUIRE_AUTH flag — the SPA uses
  // it to decide whether to show the login gate before hitting a gated endpoint.
  ping: () => api<{ plugin: string; status: string; authRequired?: boolean }>("/api/brain/ping"),
  stats: () => api<Stats>("/api/brain/stats"),
  activity: (limit = 50) => api<{ items: ActivityItem[] }>(`/api/brain/activity?limit=${limit}`),
  namespaces: () => api<{ brains: NamespaceInfo[] }>("/api/brain/namespaces"),
  graph: (namespace = "", limit = 3000) =>
    api<GraphData>(`/api/brain/graph${qs({ namespace, limit })}`),
  // Full memory row for a graph entity node (strip the `ent:` prefix off the
  // node id to get the bare UUID before calling this).
  getMemory: (namespace: string, id: string) =>
    api<Memory>(`/api/brain/memory${qs({ namespace, id })}`),
  recall: (body: { namespace: string; query: string; limit?: number }) =>
    api<{ results?: Recalled[] }>("/api/brain/recall", { json: body }),

  // Cross-brain search engine. Empty/omitted `namespaces` searches ALL brains;
  // each result carries the `namespace` it came from.
  search: (body: { query: string; namespaces?: string[]; limit?: number }) =>
    api<{ results?: Recalled[] }>("/api/brain/search", { json: body }),
  retain: (body: { namespace: string; content: string; sourceKind?: string; sourceRef?: string }) =>
    api<Record<string, unknown>>("/api/brain/retain", { json: body }),

  // --- Knowledge gaps ---
  // Default (no status) returns open+indexed, not dismissed.
  gaps: (opts: { namespace?: string; status?: string; limit?: number } = {}) =>
    api<{ gaps: Gap[] }>(`/api/brain/gaps${qs(opts)}`),
  resolveGap: (body: { id: number; status: GapStatus; resolution?: string }) =>
    api<{ id: number; status: string }>("/api/brain/gaps/resolve", { json: body }),

  // --- Brain details + admin ---
  brainDetail: (namespace: string) =>
    api<BrainDetail>(`/api/brain/brain${qs({ namespace })}`),
  deleteBrain: (body: { namespace: string; confirm: string }) =>
    api<{ namespace: string; deleted: number }>("/api/brain/brain/delete", { json: body }),
  editMemory: (body: {
    namespace: string;
    id: string;
    content?: string;
    importance?: number;
    metadata?: Record<string, unknown>;
  }) => api<{ id: string; updated: boolean }>("/api/brain/memory/edit", { json: body }),

  // Streamed NDJSON download (Content-Disposition attachment) — use as a plain <a href>.
  exportUrl: (namespace: string) => `/api/brain/export${qs({ namespace })}`,

  // --- Access tokens + per-brain grants (admin) ---
  tokens: () => api<{ tokens: Token[] }>("/api/brain/tokens"),
  // Returns the freshly-minted token (raw secret shown ONCE).
  createToken: (body: { agentId: string; label: string; isAdmin: boolean }) =>
    api<Token>("/api/brain/tokens", { json: body }),
  revokeToken: (body: { token: string }) =>
    api<{ revoked: boolean }>("/api/brain/tokens/revoke", { json: body }),
  // Upsert a per-brain grant for an agent.
  grant: (body: { agentId: string; namespace: string; canRead: boolean; canWrite: boolean }) =>
    api<Grant>("/api/brain/grant", { json: body }),
  revokeGrant: (body: { agentId: string; namespace: string }) =>
    api<{ revoked: boolean }>("/api/brain/grant/revoke", { json: body }),

  // --- Session launcher: mint a scoped token + Claude Code MCP config for a brain ---
  launchSession: (body: { namespace: string; write: boolean; label?: string }) =>
    api<SessionResult>("/api/brain/session", { json: body }),

  // --- Per-brain secrets vault (namespace-scoped) ---
  // The list is metadata-only (masked `hint`, never values).
  secrets: (namespace: string) =>
    api<{ secrets: SecretMeta[] }>(`/api/brain/secrets${qs({ namespace })}`),
  // Store/update a secret (write/admin).
  putSecret: (body: { namespace: string; name: string; value: string; kind?: string }) =>
    api<{ stored: boolean }>("/api/brain/secrets", { json: body }),
  // Decrypt a single secret — requires write/admin (stricter than read).
  revealSecret: (body: { namespace: string; name: string }) =>
    api<{ value: string }>("/api/brain/secrets/reveal", { json: body }),
  deleteSecret: (body: { namespace: string; name: string }) =>
    api<{ deleted: boolean }>("/api/brain/secrets/delete", { json: body }),

  // --- Live agent: chat with a selected brain (RAG grounded in its memories) ---
  chat: (body: { namespace: string; message: string; history?: ChatTurn[]; topK?: number }) =>
    api<ChatAnswer>("/api/brain/chat", { json: body }),

  // --- Data sources: connectors that ingest external knowledge into a brain ---
  // List every source configured for a brain.
  datasources: (namespace: string) =>
    api<{ datasources: Datasource[] }>(`/api/brain/datasources${qs({ namespace })}`),
  // Create a new source (webhook auto-generates config.secret on the backend).
  createDatasource: (body: { namespace: string; kind: string; name: string; config: Record<string, unknown> }) =>
    api<Datasource>("/api/brain/datasources", { json: body }),
  // Pull/sync a source now — returns how many documents were ingested.
  syncDatasource: (body: { id: string }) =>
    api<SyncResult>("/api/brain/datasources/sync", { json: body }),
  deleteDatasource: (body: { id: string }) =>
    api<{ deleted: boolean }>("/api/brain/datasources/delete", { json: body }),
  // Push (webhook) ingest endpoint for a source — the URL to hand out. Callers
  // POST documents here with header `X-Webhook-Secret: <config.secret>`.
  ingestUrl: (id: string) => `${(typeof window !== "undefined" && window.location.origin) || ""}/api/brain/ingest/${id}`,
};

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type ChatFootprint = {
  namespace: string;
  query: string;
  recalled: number;
  model: string;
  grounded: boolean;
  latencyMs: number;
};
export type ChatAnswer = {
  answer: string;
  citations: Recalled[];
  footprint: ChatFootprint;
};

export type SessionResult = {
  agentId: string;
  namespace: string;
  write: boolean;
  token: string;
  mcpConfig: { mcpServers: Record<string, { command: string; env: Record<string, string> }> };
  howto: string;
};

// --- Realtime -------------------------------------------------------------
// Server-Sent Events from the brain plugin. Named events (name -> data):
//   retain {namespace,decision} · recall {namespace,count} · search {count}
//   gap {namespace,query} | {resolved,status} · grant {agentId,namespace}
//   brain {deleted} · secret {namespace,name,op}
export type BrainEventName = "retain" | "recall" | "search" | "gap" | "grant" | "brain" | "secret";

/**
 * Open the brain SSE stream and dispatch parsed events to `onEvent`. Returns a
 * cleanup fn that closes the stream. `onOpen`/`onError` track connection state
 * for the "live" indicator.
 */
export function subscribeBrainEvents(opts: {
  onEvent: (name: BrainEventName, data: any) => void;
  onOpen?: () => void;
  onError?: () => void;
}): () => void {
  const names: BrainEventName[] = ["retain", "recall", "search", "gap", "grant", "brain", "secret"];
  const es = new EventSource(`/api/brain/events`);
  es.onopen = () => opts.onOpen?.();
  es.onerror = () => opts.onError?.();
  const handlers = names.map((name) => {
    const h = (ev: MessageEvent) => {
      let data: any = null;
      try { data = ev.data ? JSON.parse(ev.data) : null; } catch { data = ev.data; }
      opts.onEvent(name, data);
    };
    es.addEventListener(name, h as EventListener);
    return { name, h };
  });
  return () => {
    for (const { name, h } of handlers) es.removeEventListener(name, h as EventListener);
    es.close();
  };
}
