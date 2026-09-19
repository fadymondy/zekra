// The auth client, ported from fadymondy.com-v2 (web/lib/auth.ts) onto Zekra's API. Sessions are
// the HttpOnly `togo_session` cookie; this client only calls the endpoints and lets the cookie do
// the rest. Unlike lib/api.ts's ApiError, AuthError keeps the machine-readable `code` (and the
// `email` / `challenge` that come with some codes), which the forms branch on.
import { ApiError, resetCsrf } from "@/lib/api"

export type Identity = {
  id: string | number
  email: string
  roles?: string[]
  permissions?: string[]
  guard?: string
}

/** An API refusal. Extends ApiError so the shared ErrorState can render it too. */
export class AuthError extends ApiError {
  constructor(
    message: string,
    status: number,
    readonly code?: string,
    readonly email?: string,
    /** Set with code "2fa_required": finish the sign-in with auth.challenge. */
    readonly challenge?: string,
  ) {
    super(status, message)
    this.name = "AuthError"
  }
}

// Unsafe methods are CSRF-guarded server-side (togo-framework/auth security.go). A fresh token is
// read for every call so a sign-in (which rotates the session) never sends a stale one.
async function csrfToken(): Promise<string> {
  const res = await fetch("/api/auth/csrf", { credentials: "same-origin", cache: "no-store" })
  const data = (await res.json().catch(() => ({}))) as { csrf_token?: string }
  return data.csrf_token ?? ""
}

type Method = "GET" | "POST" | "PUT" | "DELETE"

export async function authRequest<T>(path: string, method: Method = "GET", body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" }
  if (body !== undefined) headers["Content-Type"] = "application/json"
  if (method !== "GET") headers["X-CSRF-Token"] = await csrfToken()
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      error?: string | { message?: string; code?: string }
      message?: string
      detail?: string
      code?: string
      email?: string
      challenge?: string
    }
    const err = typeof data.error === "object" ? data.error : undefined
    const message =
      (typeof data.error === "string" ? data.error : err?.message) || data.detail || data.message || `${res.status} ${res.statusText}`
    throw new AuthError(message, res.status, data.code ?? err?.code, data.email, data.challenge)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** After anything that creates or ends a session: the cached CSRF token belongs to the old one. */
function sessionChanged<T>(v: T): T {
  resetCsrf()
  return v
}

type SignedIn = { token?: string; user?: Identity }

export type TwoFactorStatus = { enabled: boolean; recovery_codes_left: number; available: boolean }

export const auth = {
  /**
   * Creates the account. It cannot be used yet: the server answers with an AuthError whose code
   * is "email_unverified" and mails a 6-digit code; the caller goes to the verify page.
   */
  register: (email: string, password: string, locale?: string, name?: string) =>
    authRequest<SignedIn>("/api/auth/register", "POST", { email, password, locale, name }).then(sessionChanged),
  login: (email: string, password: string, locale?: string) =>
    authRequest<SignedIn>("/api/auth/login", "POST", { email, password, locale }).then(sessionChanged),
  logout: () => authRequest<{ status: string }>("/api/auth/logout", "POST").then(sessionChanged),
  /** Verifies the address with the mailed code, and signs in. */
  verifyEmail: (email: string, code: string) =>
    authRequest<{ status: string } & SignedIn>("/api/auth/verify-email", "POST", { email, code }).then(sessionChanged),
  resendVerification: (email: string, locale?: string) =>
    authRequest<{ status: string }>("/api/auth/verify-email/resend", "POST", { email, locale }),
  /** Mails a reset code; the answer is the same whether or not the address has an account. */
  forgotPassword: (email: string, locale?: string) =>
    authRequest<{ status: string }>("/api/auth/password/forgot", "POST", { email, locale }),
  /** Sets a new password with the mailed code; every other session is signed out. */
  resetPassword: (email: string, code: string, password: string) =>
    authRequest<{ status: string }>("/api/auth/password/reset", "POST", { email, code, password }),
  /** Mails a sign-in code; same answer for any address. */
  requestCode: (email: string, locale?: string) =>
    authRequest<{ status: string }>("/api/auth/code/request", "POST", { email, locale }),
  /** Signs in with the mailed code, or throws AuthError "2fa_required". */
  signInWithCode: (email: string, code: string) =>
    authRequest<SignedIn>("/api/auth/code/verify", "POST", { email, code }).then(sessionChanged),
  /** The second step of a sign-in: an authenticator code or a recovery code. */
  challenge: (challenge: string, answer: { code?: string; recovery_code?: string }) =>
    authRequest<SignedIn & { extra?: { recovery_codes_left?: number } }>("/api/auth/2fa/challenge", "POST", {
      challenge,
      ...answer,
    }).then(sessionChanged),
  changePassword: (oldPassword: string, newPassword: string) =>
    authRequest<{ status: string }>("/api/auth/change-password", "POST", {
      old_password: oldPassword,
      new_password: newPassword,
    }),
  twoFactor: {
    status: () => authRequest<TwoFactorStatus>("/api/me/2fa"),
    enroll: () => authRequest<{ secret: string; otpauth_url: string; qr: string }>("/api/me/2fa/enroll", "POST", {}),
    confirm: (code: string) =>
      authRequest<{ enabled: boolean; recovery_codes: string[] }>("/api/me/2fa/confirm", "POST", { code }),
    disable: (answer: { code?: string; recovery_code?: string }) =>
      authRequest<{ enabled: boolean }>("/api/me/2fa/disable", "POST", answer),
    newRecoveryCodes: (code: string) =>
      authRequest<{ recovery_codes: string[] }>("/api/me/2fa/recovery", "POST", { code }),
  },
}

// ── Login methods ─────────────────────────────────────────────────────────

export type Provider = "google" | "github" | "apple"
export const PROVIDERS: Provider[] = ["google", "github", "apple"]
/** Brand names are not translated. */
export const PROVIDER_NAMES: Record<Provider, string> = { google: "Google", github: "GitHub", apple: "Apple" }

export type LoginMethods = { password: boolean; code: boolean; providers: Partial<Record<Provider, string>> }

/**
 * GET /api/auth/methods, read defensively: fadymondy returns `{ methods: [{ name, type, url }] }`;
 * plain strings ("password", "oauth:google") are accepted too. Only listed providers render. When
 * the endpoint is missing or lists no first-party method, password and emailed-code sign-in are
 * both assumed (the server still decides); when it does list them, only those show.
 */
export function parseMethods(data: unknown): LoginMethods {
  const raw = Array.isArray(data)
    ? data
    : data && typeof data === "object"
      ? ((data as Record<string, unknown>).methods ?? [])
      : []
  const list = Array.isArray(raw) ? raw : []
  const out: LoginMethods = { password: false, code: false, providers: {} }
  let firstParty = false
  for (const item of list) {
    let name = ""
    let url = ""
    if (typeof item === "string") {
      name = item.replace(/^oauth[:/]/i, "").toLowerCase()
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>
      name = String(o.name ?? o.provider ?? o.id ?? "").toLowerCase()
      url = typeof o.url === "string" ? o.url : ""
    }
    if (name === "password") {
      out.password = true
      firstParty = true
    } else if (name === "code" || name === "email_code" || name === "otp" || name === "magic_code") {
      out.code = true
      firstParty = true
    } else if ((PROVIDERS as string[]).includes(name)) {
      out.providers[name as Provider] = url || `/api/auth/${name}`
    }
  }
  // Like fadymondy: an API that lists only providers still takes a password and an emailed code.
  if (!firstParty) {
    out.password = true
    out.code = true
  }
  return out
}

// ── Redirects ─────────────────────────────────────────────────────────────

/**
 * The post-sign-in destination from `?next=`. Same-origin paths only: never `//host` or `/\host`
 * (browsers treat both as another origin), and no control characters.
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null
  for (let i = 0; i < next.length; i++) {
    const c = next.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return null
  }
  return next
}

/** Carries the return path through an OAuth start URL as its `redirect` parameter. */
export function withRedirect(href: string, path: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}redirect=${encodeURIComponent(path)}`
}

/** Link mode: the provider flow returns to `returnTo` with ?connected= or ?connect_error=. */
export function connectURL(provider: Provider, returnTo: string) {
  return `/api/auth/${provider}?link=1&redirect=${encodeURIComponent(returnTo)}`
}

// ── Messages ──────────────────────────────────────────────────────────────

/**
 * Turns any refusal into a sentence in the page's language. The server's own sentence is only a
 * last resort for 4xx answers the UI does not name; a missing endpoint (404/405/501) reads as
 * "not available yet", and a 5xx or network failure uses the shared messages.
 */
export function authMessage(err: unknown, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (err instanceof ApiError) {
    const code = err instanceof AuthError ? err.code : undefined
    if (code === "2fa_invalid") return t("auth.codeWrong")
    if (code === "challenge_expired") return t("auth.challengeExpired")
    if (code === "email_unverified") return t("auth.emailUnverified")
    if (code === "last_method") return t("account.connections.lastMethod")
    if (code === "invalid_credentials") return t("auth.invalidCredentials")
    if (err.status === 429) return t("auth.tooMany")
    if (err.status === 404 || err.status === 405 || err.status === 501) return t("auth.unavailable")
    if (err.status >= 500) return t("common.apiUnavailable")
    if (err.status === 422 && /code/i.test(err.message)) return t("auth.codeInvalid")
    if (err.status === 401) return t("auth.invalidCredentials")
    if (/csrf/i.test(err.message)) return t("auth.sessionExpired")
    return err.message
  }
  return t("common.networkError")
}
