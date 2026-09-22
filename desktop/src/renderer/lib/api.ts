// Zekra REST client for the desktop app. Mirrors mobile/src/lib/api.ts: a
// bearer session from password login (plus TOTP/recovery 2FA), then plain
// JSON over HTTPS. The desktop is an external client, so it never relies on
// the web console's same-origin session cookie.

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

export type User = { id: string; email: string; name?: string; roles?: string[] };
export type AuthAnswer = { token: string; user: User };

export type Brain = {
  namespace: string;
  role: string;
  canWrite: boolean;
  memories: number;
  displayName?: string;
  description?: string;
  colorHex?: string;
  /** An emoji the owner picked, shown in place of the generic glyph. */
  icon?: string;
  /** Relative path to the uploaded profile image, if there is one. */
  imageUrl?: string;
};

export type Note = {
  id: string;
  namespace: string;
  title: string;
  body?: string;
  tags: string[];
  category?: string;
  /** Appearance overrides (MH-308); "" means derive from category. */
  icon?: string;
  color?: string;
  pinned: boolean;
  archived: boolean;
  indexed: boolean;
  indexError?: string;
  chunks: number;
  version: number;
  updatedAt: string;
};

export type NotePage = { notes: Note[]; nextCursor?: string };
export type NotePatch = Partial<Pick<Note, "title" | "body" | "tags" | "category" | "pinned" | "archived" | "icon" | "color">>;

export type Recalled = {
  id: string;
  content: string;
  score: number;
  memoryType: string;
  sourceKind: string;
  sourceRef: string;
  namespace?: string;
};

let apiBase = "https://app.zekra.dev";
export function setApiBaseUrl(url: string) {
  apiBase = (url || "https://app.zekra.dev").replace(/\/$/, "");
}
export function getApiBaseUrl() {
  return apiBase;
}

type Options = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  token?: string | null;
  json?: unknown;
  csrf?: boolean;
  headers?: Record<string, string>;
};

async function issueCsrf(): Promise<string> {
  const res = await fetch(`${apiBase}/api/auth/csrf`, {
    headers: { Accept: "application/json", "X-Agent-Id": "zekra-desktop" },
    credentials: "include",
  });
  const body = (await res.json().catch(() => undefined)) as { csrf_token?: string } | undefined;
  if (!res.ok || !body?.csrf_token) throw new ApiError(res.status, "Could not start a secure sign-in");
  return body.csrf_token;
}

export async function request<T>(path: string, options: Options = {}): Promise<T> {
  const method = options.method ?? (options.json === undefined ? "GET" : "POST");
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Agent-Id": "zekra-desktop",
    ...options.headers,
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.csrf) headers["X-CSRF-Token"] = await issueCsrf();
  if (options.json !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      body: options.json === undefined ? undefined : JSON.stringify(options.json),
      credentials: "include",
    });
  } catch (e) {
    throw new ApiError(0, e instanceof Error ? e.message : "Could not reach Zekra");
  }

  const text = await res.text();
  let payload: unknown;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!res.ok) {
    const v = (payload ?? {}) as Record<string, unknown>;
    const nested = (v.error ?? {}) as Record<string, unknown>;
    const message = String(
      (typeof v.error === "string" ? v.error : nested.message) || v.detail || v.message || `${res.status}`,
    );
    const code = typeof v.code === "string" ? v.code : typeof nested.code === "string" ? nested.code : undefined;
    throw new ApiError(res.status, message, code, payload);
  }
  return payload as T;
}

export const authApi = {
  login: (email: string, password: string, locale = "en") =>
    request<AuthAnswer>("/api/auth/login", { csrf: true, json: { email, password, locale } }),
  challenge: (challenge: string, answer: { code?: string; recovery_code?: string }) =>
    request<AuthAnswer>("/api/auth/2fa/challenge", { csrf: true, json: { challenge, ...answer } }),
  forgotPassword: (email: string, locale = "en") =>
    request<{ status?: string }>("/api/auth/password/forgot", { csrf: true, json: { email, locale } }),
  me: (token: string) => request<{ user?: User } | User>("/api/auth/me", { token }),
  logout: (token: string) => request<{ status: string }>("/api/auth/logout", { token, json: {} }),
};

const query = (values: Record<string, string | number | boolean | undefined>) => {
  const parts = Object.entries(values).filter(([, v]) => v !== undefined && v !== "");
  return parts.length
    ? `?${parts.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")}`
    : "";
};

export const zekraApi = {
  brains: (token: string) => request<{ brains: Brain[] }>("/api/brain/mine", { token }),
  notes: (
    token: string,
    namespace: string,
    o: { q?: string; archived?: boolean; limit?: number; cursor?: string } = {},
  ) =>
    request<NotePage>(
      // The response has always carried nextCursor; until now nothing sent one
      // back, so a brain with more notes than the page size showed a silently
      // truncated list.
      `/api/notes${query({
        namespace,
        q: o.q,
        archived: o.archived ? 1 : undefined,
        limit: o.limit ?? 50,
        cursor: o.cursor,
      })}`,
      { token },
    ),
  note: (token: string, id: string) => request<Note>(`/api/notes/${encodeURIComponent(id)}`, { token }),
  createNote: (token: string, namespace: string, patch: NotePatch = {}) =>
    request<Note>("/api/notes", {
      token,
      json: {
        namespace,
        title: patch.title ?? "",
        body: patch.body ?? "",
        tags: patch.tags ?? [],
        category: patch.category ?? "note",
        pinned: patch.pinned ?? false,
        source: "desktop",
      },
    }),
  updateNote: (token: string, note: Note, patch: NotePatch) =>
    request<Note>(`/api/notes/${encodeURIComponent(note.id)}`, {
      method: "PUT",
      token,
      json: { ...patch, version: note.version, source: "desktop" },
    }),
  deleteNote: (token: string, note: Note) =>
    request<Note>(`/api/notes/${encodeURIComponent(note.id)}`, {
      method: "DELETE",
      token,
      headers: { "If-Match": `"${note.version}"` },
    }),
  search: (token: string, q: string, namespaces?: string[], limit = 30) =>
    request<{ results?: Recalled[] }>("/api/brain/search", { token, json: { query: q, namespaces, limit } }),

  /** The tree view's top level: the brain's spine hubs, most-connected first. */
  graphRoots: (token: string, namespace: string) =>
    request<{ roots: GraphRoot[]; fallback: boolean }>("/api/brain/graph/roots", { token, json: { namespace } }),
  /** One node's edges, fetched lazily as the tree is disclosed. */
  graphNeighbors: (token: string, namespace: string, entity: string) =>
    request<{ edges: GraphEdgeDto[] }>("/api/brain/graph/neighbors", { token, json: { namespace, entity } }),

  /*
  Image upload for the visual editor.

  Not routed through request(): that helper JSON-encodes its body, and this is
  multipart — the boundary must be set by the browser, so Content-Type is
  deliberately NOT set here. Everything else (Bearer, agent id) matches.
  */
  async uploadImage(token: string, file: File | Blob, namespace: string): Promise<{ url: string }> {
    const form = new FormData();
    form.append("namespace", namespace);
    // A pasted Blob has no filename; the server ignores it but multipart wants one.
    form.append("file", file, file instanceof File ? file.name : "pasted.png");
    let res: Response;
    try {
      res = await fetch(`${apiBase}/api/notes/image`, {
        method: "POST",
        headers: { Accept: "application/json", "X-Agent-Id": "zekra-desktop", Authorization: `Bearer ${token}` },
        body: form,
        credentials: "include",
      });
    } catch (e) {
      throw new ApiError(0, e instanceof Error ? e.message : "Could not reach Zekra");
    }
    const payload = (await res.json().catch(() => undefined)) as { url?: string; message?: string } | undefined;
    if (!res.ok || !payload?.url) {
      throw new ApiError(res.status, payload?.message || `Upload failed (${res.status})`);
    }
    return { url: payload.url };
  },
};

/** One entry in the tree's top level (plugins/brain graph_roots.go). */
export type GraphRoot = { name: string; type: string; degree: number };

/** The edge shape the shared tree projects (web/lib/graph/tree.ts GraphEdge). */
export type GraphEdgeDto = { id: string; src: string; dst: string; relation: string };
