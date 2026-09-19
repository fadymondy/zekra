/*
Presentations API: the brain plugin's /api/presentations* surface, scoped per brain
(`namespace`). Owner calls go same-origin (next.config.mjs proxies /api to Go) with the
session cookie and the CSRF token from lib/api.ts; the public read goes through the share
token only, fetched on the server. Unlike lib/api.ts's api(), this keeps the validator's
field errors ({location, message}) so the editor can list them by path.
*/
import type {
  Catalog,
  Customer,
  Detail,
  FieldError,
  FromBrainSource,
  Kind,
  PLocale,
  PublicPresentation,
  Share,
  Status,
  Summary,
} from "./types.ts"
import { getCsrfToken } from "@/lib/api"

export class ApiError extends Error {
  status: number
  errors: FieldError[]
  constructor(message: string, status: number, errors: FieldError[] = []) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.errors = errors
  }
}

async function failure(res: Response): Promise<ApiError> {
  let message = res.statusText || `${res.status}`
  let errors: FieldError[] = []
  try {
    const body = (await res.json()) as {
      detail?: string
      title?: string
      message?: string
      error?: string | { message?: string }
      errors?: { location?: string; path?: string; message?: string }[]
    }
    const err = typeof body.error === "object" ? body.error?.message : body.error
    message = body.detail || err || body.message || body.title || message
    errors = (body.errors ?? []).map((e) => ({ path: e.location ?? e.path ?? "", message: e.message ?? "" }))
  } catch {
    /* no body */
  }
  return new ApiError(message, res.status, errors)
}

async function call<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const method = init.method ?? (init.json !== undefined ? "POST" : "GET")
  const send = async (force: boolean) => {
    const headers: Record<string, string> = { Accept: "application/json" }
    if (init.json !== undefined) headers["Content-Type"] = "application/json"
    if (method !== "GET") headers["X-CSRF-Token"] = await getCsrfToken(force)
    return fetch(path, {
      method,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    })
  }
  let res = await send(false)
  // A stale CSRF token (new session, server restart): refresh once and retry.
  if (res.status === 403 && method !== "GET") {
    const text = await res
      .clone()
      .text()
      .catch(() => "")
    if (/csrf/i.test(text)) res = await send(true)
  }
  if (!res.ok) throw await failure(res)
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

const enc = encodeURIComponent

export type ListFilter = { namespace?: string; q?: string; kind?: Kind | ""; customer?: string; status?: Status | "" }

/** One brain's documents (`namespace`), or every brain the caller may see when omitted (admin). */
export async function listPresentations(f: ListFilter = {}): Promise<Summary[]> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) if (v) qs.set(k, String(v))
  const out = await call<{ items: Summary[] | null }>(`/api/presentations?${qs}`)
  return out.items ?? []
}

export const getPresentation = (id: string) => call<Detail>(`/api/presentations/${enc(id)}`)

export const getCatalog = () => call<Catalog>(`/api/presentations/catalog`)

export type Input = {
  kind?: Kind
  title?: string
  customer?: Customer
  locale?: PLocale
  status?: Status
  style?: string
  content?: Record<string, unknown>
}

export const createPresentation = (input: Input & { namespace: string }) => call<Detail>(`/api/presentations`, { json: input })

export const updatePresentation = (id: string, input: Input) =>
  call<Detail>(`/api/presentations/${enc(id)}`, { method: "PATCH", json: input })

export const deletePresentation = (id: string) => call<void>(`/api/presentations/${enc(id)}`, { method: "DELETE" })

export const translatePresentation = (id: string, to?: PLocale) =>
  call<Detail>(`/api/presentations/${enc(id)}/translate`, { json: to ? { to } : {} })

export const validateContent = (kind: Kind, content: Record<string, unknown>) =>
  call<{ valid: boolean; errors: FieldError[] | null; content?: Record<string, unknown> }>(`/api/presentations/validate`, {
    json: { kind, content },
  })

export type FromBrainInput = {
  namespace: string
  source: FromBrainSource
  kind: Kind
  locale: PLocale
  customer: Customer
  style?: string
  title?: string
}

/** Draft a document (status draft) from a brain's notes, a recall query, a graph entity or the whole brain. */
export const createFromBrain = (input: FromBrainInput) => call<Detail>(`/api/presentations/from-brain`, { json: input })

export type ShareCreated = { share: Share; token: string; url: string; recoverable: boolean }

export const createShare = (id: string, input: { label?: string; locale?: PLocale; expires_in_days?: number }) =>
  call<ShareCreated>(`/api/presentations/${enc(id)}/share`, { json: input })

export const revokeShare = (id: string, shareId: string) =>
  call<{ revoked: number }>(`/api/presentations/${enc(id)}/shares/${enc(shareId)}`, { method: "DELETE" })

// ---- server side -----------------------------------------------------------

// The same variable next.config.mjs proxies /api to.
const SERVER_API = process.env.API_ORIGIN ?? "http://localhost:8080"

/** A token can only be 43 base64url characters; anything else never reaches the API. */
export function isTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token)
}

/**
 * The shared view, fetched on the server. The visitor's address is forwarded so the API's
 * per-address rate limit applies to them, not to this server.
 */
export async function fetchShared(
  token: string,
  opts: { locale?: string; event?: "view" | "download" | ""; forwardedFor?: string | null },
): Promise<{ status: number; data: PublicPresentation | null }> {
  if (!isTokenShape(token)) return { status: 404, data: null }
  const qs = new URLSearchParams()
  if (opts.locale) qs.set("locale", opts.locale)
  if (opts.event) qs.set("event", opts.event)
  try {
    const res = await fetch(`${SERVER_API}/api/p/${token}?${qs}`, {
      cache: "no-store",
      headers: opts.forwardedFor ? { "X-Forwarded-For": opts.forwardedFor } : {},
    })
    if (!res.ok) return { status: res.status, data: null }
    return { status: 200, data: (await res.json()) as PublicPresentation }
  } catch {
    return { status: 503, data: null }
  }
}

/** The owner's copy, fetched on the server with the caller's credentials (exports). */
export async function fetchOwned(id: string, req: Request): Promise<Detail | null> {
  const authorization = req.headers.get("authorization")
  const cookie = req.headers.get("cookie")
  try {
    const res = await fetch(`${SERVER_API}/api/presentations/${enc(id)}`, {
      cache: "no-store",
      headers: { ...(authorization ? { authorization } : {}), ...(cookie ? { cookie } : {}) },
    })
    if (!res.ok) return null
    return (await res.json()) as Detail
  } catch {
    return null
  }
}

/** A page preview embedded in a shared deck, through the deck's token. */
export async function fetchSharedEmbed(
  token: string,
  id: string,
  opts: { locale?: string; forwardedFor?: string | null },
): Promise<{ status: number; data: PublicPresentation | null }> {
  if (!isTokenShape(token) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { status: 404, data: null }
  const qs = new URLSearchParams()
  if (opts.locale) qs.set("locale", opts.locale)
  try {
    const res = await fetch(`${SERVER_API}/api/p/${token}/embed/${enc(id)}?${qs}`, {
      cache: "no-store",
      headers: opts.forwardedFor ? { "X-Forwarded-For": opts.forwardedFor } : {},
    })
    if (!res.ok) return { status: res.status, data: null }
    return { status: 200, data: (await res.json()) as PublicPresentation }
  } catch {
    return { status: 503, data: null }
  }
}
