export const API_URL = (process.env.EXPO_PUBLIC_ZEKRA_API_URL || "https://app.zekra.dev").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  token?: string | null;
  csrf?: boolean;
  json?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

async function issueCSRF(): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/auth/csrf`, {
      headers: { Accept: "application/json", "X-Agent-Id": "zekra-mobile" },
      credentials: "include",
    });
  } catch (error) {
    throw new ApiError(0, error instanceof Error ? error.message : "Could not reach Zekra");
  }
  const payload = await response.json().catch(() => undefined) as { csrf_token?: string; error?: string } | undefined;
  if (!response.ok || !payload?.csrf_token) {
    throw new ApiError(response.status, payload?.error || "Could not start a secure sign-in");
  }
  return payload.csrf_token;
}

function errorParts(data: unknown, fallback: string) {
  const value = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const nested = value.error && typeof value.error === "object" ? (value.error as Record<string, unknown>) : {};
  const raw = typeof value.error === "string" ? value.error : nested.message;
  return {
    message: String(raw || value.detail || value.message || fallback),
    code: typeof value.code === "string" ? value.code : typeof nested.code === "string" ? nested.code : undefined,
  };
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? (options.json === undefined ? "GET" : "POST");
  const headers: Record<string, string> = { Accept: "application/json", "X-Agent-Id": "zekra-mobile", ...options.headers };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.csrf) headers["X-CSRF-Token"] = await issueCSRF();
  if (options.json !== undefined) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: options.json === undefined ? undefined : JSON.stringify(options.json),
      signal: options.signal,
      credentials: "include",
    });
  } catch (error) {
    throw new ApiError(0, error instanceof Error ? error.message : "Could not reach Zekra");
  }
  const text = await response.text();
  let payload: unknown = undefined;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const parts = errorParts(payload, `${response.status} ${response.statusText}`);
    throw new ApiError(response.status, parts.message, parts.code, payload);
  }
  return payload as T;
}

export type User = { id: string; email: string; roles?: string[]; name?: string };
export type AuthAnswer = { token: string; user: User; extra?: { recovery_codes_left?: number } };

export type Brain = {
  namespace: string;
  role: "admin" | "owner" | "editor" | "viewer" | string;
  canWrite: boolean;
  memories: number;
  displayName?: string;
  description?: string;
  color?: string;
  colorHex?: string;
  icon?: string;
  imageUrl?: string;
};

export type Note = {
  id: string;
  namespace: string;
  title: string;
  body?: string;
  tags: string[];
  category?: string;
  entityId?: string;
  pinned: boolean;
  archived: boolean;
  source: string;
  version: number;
  chunks: number;
  indexed: boolean;
  indexError?: string;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
};

export type NotePage = { notes: Note[]; nextCursor?: string; serverTime: string };
export type NotePatch = Partial<Pick<Note, "title" | "body" | "tags" | "category" | "pinned" | "archived">>;
export type GraphNode = { id: string; name: string; group?: string; type?: string; noteId?: string };
export type GraphEdge = { source: string; target: string; relation?: string; fact?: string };
export type GraphTypeCount = { type: string; count: number };
export type GraphData = {
  ready: boolean;
  derived?: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
  typeCounts?: GraphTypeCount[];
  relationCounts?: GraphTypeCount[];
  totalNodes?: number;
  totalEdges?: number;
  sampled?: boolean;
};

function query(values: Record<string, string | number | boolean | undefined>) {
  const params = Object.entries(values).filter(([, value]) => value !== undefined && value !== "");
  return params.length ? `?${params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join("&")}` : "";
}

export const authApi = {
  login: (email: string, password: string) => request<AuthAnswer>("/api/auth/login", { csrf: true, json: { email, password, locale: "en" } }),
  challenge: (challenge: string, answer: { code?: string; recovery_code?: string }) =>
    request<AuthAnswer>("/api/auth/2fa/challenge", { csrf: true, json: { challenge, ...answer } }),
  me: (token: string) => request<{ user?: User } | User>("/api/auth/me", { token }),
  logout: (token: string) => request<{ status: string }>("/api/auth/logout", { token, json: {} }),
};

export const zekraApi = {
  brains: (token: string) => request<{ brains: Brain[] }>("/api/brain/mine", { token }),
  createBrain: (token: string, body: { namespace: string; displayName?: string; description?: string; color?: string }) =>
    request<{ namespace: string; role: string }>("/api/brain/brains", { token, json: body }),
  notes: (token: string, namespace: string, options: { q?: string; archived?: boolean; cursor?: string; limit?: number } = {}) =>
    request<NotePage>(`/api/notes${query({ namespace, q: options.q, archived: options.archived ? 1 : undefined, cursor: options.cursor, limit: options.limit ?? 50 })}`, { token }),
  note: (token: string, id: string) => request<Note>(`/api/notes/${encodeURIComponent(id)}`, { token }),
  createNote: (token: string, namespace: string, patch: NotePatch = {}) => request<Note>("/api/notes", {
    token,
    json: { namespace, title: patch.title ?? "", body: patch.body ?? "", tags: patch.tags ?? [], category: patch.category ?? "note", pinned: patch.pinned ?? false, source: "mobile" },
  }),
  updateNote: (token: string, note: Note, patch: NotePatch) => request<Note>(`/api/notes/${encodeURIComponent(note.id)}`, {
    method: "PUT",
    token,
    json: { ...patch, version: note.version, source: "mobile" },
  }),
  deleteNote: (token: string, note: Note) => request<Note>(`/api/notes/${encodeURIComponent(note.id)}`, {
    method: "DELETE",
    token,
    headers: { "If-Match": `"${note.version}"` },
  }),
  graph: (token: string, namespace: string, limit = 180) => request<GraphData>(`/api/brain/graph${query({ namespace, limit })}`, { token }),
};
