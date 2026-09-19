// The signed-in account's self-service API, ported from fadymondy.com-v2 (lib/api/account-area.ts,
// lib/api/account.ts, lib/api/identities.ts). Every call acts on the session's account; nothing
// takes an account id. Errors are AuthError (lib/auth.ts), so pages translate them with authMessage.
import { authRequest, type Provider } from "@/lib/auth"

// ── Profile ───────────────────────────────────────────────────────────────

export type AccountProfile = {
  email: string
  name: string
  avatar: string
  timezone: string
  verified: boolean
  has_password: boolean
}

export const getProfile = () => authRequest<AccountProfile>("/api/me/account/profile")
export const saveProfile = (p: Pick<AccountProfile, "name" | "avatar" | "timezone">) =>
  authRequest<AccountProfile>("/api/me/account/profile", "PUT", p)

// ── Notification preferences ──────────────────────────────────────────────

/** A flat map of boolean switches; the page renders whatever the API returns. */
export type AccountPrefs = Record<string, boolean>

export const getPrefs = () => authRequest<AccountPrefs>("/api/me/account/notifications")
export const savePrefs = (p: AccountPrefs) => authRequest<AccountPrefs>("/api/me/account/notifications", "PUT", p)

// ── Data export ───────────────────────────────────────────────────────────

export type ExportState = {
  status: "none" | "queued" | "ready" | "failed" | "downloaded" | "expired"
  requested_at?: string
  expires_at?: string
  next_allowed_at?: string
  downloaded_at?: string
}

export const getExport = () => authRequest<ExportState>("/api/me/account/export")
export const requestExport = (locale: string) => authRequest<ExportState>("/api/me/account/export", "POST", { locale })
/** The one-time link from the export email; the session cookie goes along. */
export const exportDownloadURL = (token: string) => `/api/me/account/export/download?token=${encodeURIComponent(token)}`

// ── Deletion ──────────────────────────────────────────────────────────────

/** Schedules deletion (grace period) and signs the account out everywhere. */
export const requestDeletion = (password: string) =>
  authRequest<{ status: string; scheduled_for: string }>("/api/me/delete", "POST", { password })
/** Works signed out: the account proves itself with its password. */
export const cancelDeletion = (email: string, password: string) =>
  authRequest<{ status: string }>("/api/me/delete/cancel", "POST", { email, password })

// ── Connected accounts ────────────────────────────────────────────────────

export type ConnectedIdentity = {
  provider: Provider
  email: string
  created_at: string
  last_used_at: string | null
  /** false when this is the account's only way to sign in */
  can_unlink: boolean
}

export const listIdentities = async (): Promise<ConnectedIdentity[]> => {
  const body = await authRequest<ConnectedIdentity[] | { identities?: ConnectedIdentity[] }>("/api/me/identities")
  return Array.isArray(body) ? body : (body?.identities ?? [])
}
export const disconnectIdentity = (provider: Provider) =>
  authRequest<void>(`/api/me/identities/${provider}`, "DELETE")
