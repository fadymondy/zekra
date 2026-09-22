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
  /** Appearance overrides (MH-308); "" or absent means derive from category. */
  icon?: string;
  color?: string;
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
export type NotePatch = Partial<Pick<Note, "title" | "body" | "tags" | "category" | "pinned" | "archived" | "icon" | "color">>;

// A hit from the hybrid (vector + BM25) recall engine — the same shape the web
// console reads (web/lib/api.ts Recalled).
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
  namespace?: string;
};

export type AccountProfile = { name?: string; email?: string; avatar?: string; timezone?: string };
export type DeleteState = { status: "none" | "scheduled" | "cancelled" | "purged"; scheduled_for?: string; requested_at?: string; cancelled_at?: string };

export type Secret = { name: string; namespace: string; kind?: string; hint?: string; updatedAt?: string };

function query(values: Record<string, string | number | boolean | undefined>) {
  const params = Object.entries(values).filter(([, value]) => value !== undefined && value !== "");
  return params.length ? `?${params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join("&")}` : "";
}

export const authApi = {
  login: (email: string, password: string, locale = "en") =>
    request<AuthAnswer>("/api/auth/login", { csrf: true, json: { email, password, locale } }),
  register: (email: string, password: string, name: string, locale = "en") =>
    request<AuthAnswer>("/api/auth/register", { csrf: true, json: { email, password, name, locale } }),
  forgotPassword: (email: string, locale = "en") =>
    request<{ status?: string }>("/api/auth/password/forgot", { csrf: true, json: { email, locale } }),
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
  // Cross-brain semantic search. Omitting `namespaces` searches every brain
  // the caller can read; each hit is tagged with the brain it came from.
  search: (token: string, query: string, namespaces?: string[], limit = 30) =>
    request<{ results?: Recalled[] }>("/api/brain/search", { token, json: { query, namespaces, limit } }),
  secrets: (token: string, namespace: string) =>
    request<{ secrets?: Secret[] }>(`/api/brain/secrets${query({ namespace })}`, { token }),
  putSecret: (token: string, namespace: string, name: string, value: string) =>
    request<{ status?: string }>("/api/brain/secrets", { token, json: { namespace, name, value } }),
  deleteSecret: (token: string, namespace: string, name: string) =>
    request<{ status?: string }>("/api/brain/secrets/delete", { token, json: { namespace, name } }),
  // --- account (internal/account/area_api.go) ---
  profile: (token: string) => request<AccountProfile>("/api/me/account/profile", { token }),
  updateProfile: (token: string, body: { name?: string; avatar?: string; timezone?: string }) =>
    request<AccountProfile>("/api/me/account/profile", { method: "PUT", token, json: body }),
  // Deletion is password-confirmed and scheduled, not immediate (a session
  // alone cannot delete an account).
  deleteAccount: (token: string, password: string) =>
    request<DeleteState>("/api/me/delete", { token, csrf: true, json: { password } }),
  deleteState: (token: string) => request<DeleteState>("/api/me/delete", { token }),
  cancelDelete: (token: string) => request<DeleteState>("/api/me/delete/cancel", { token, csrf: true, json: {} }),
};

/*
Image upload for notes (MH-319 item 3).

Not routed through request(): that helper JSON-encodes its body, and this is
multipart. Content-Type is deliberately NOT set — React Native's fetch writes
the boundary itself, and setting it by hand produces a body the server cannot
parse.

React Native's FormData takes a {uri, name, type} descriptor rather than a
Blob; the native layer streams the file from disk, so a large photo never has
to be read into JS memory.
*/
export type UploadedImage = { url: string };

export async function uploadNoteImage(
  token: string,
  namespace: string,
  file: { uri: string; name: string; type: string },
): Promise<UploadedImage> {
  const form = new FormData();
  form.append("namespace", namespace);
  // The cast is RN's: its FormData accepts this descriptor, the DOM lib's type
  // does not describe it.
  form.append("file", file as unknown as Blob);

  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/notes/image`, {
      method: "POST",
      headers: { Accept: "application/json", "X-Agent-Id": "zekra-mobile", Authorization: `Bearer ${token}` },
      body: form,
      credentials: "include",
    });
  } catch (error) {
    throw new ApiError(0, error instanceof Error ? error.message : "Could not reach Zekra");
  }
  const payload = (await response.json().catch(() => undefined)) as { url?: string; message?: string } | undefined;
  if (!response.ok || !payload?.url) {
    throw new ApiError(response.status, payload?.message || `Upload failed (${response.status})`);
  }
  return { url: payload.url };
}
