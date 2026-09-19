"use client"

// Hooks and calls for the admin control panel and the brain settings pages (secrets,
// permissions). Brain keys start with /api/brain/ so the realtime stream revalidates them.
//
// /api/admin/* is being built on the backend. The contract assumed here:
//   GET    /api/admin/stats                          → { [metric]: number }
//   GET    /api/admin/users?q=&page=                 → { users: AdminUser[], total, page, per_page }
//   GET    /api/admin/users/{id}                     → { user: AdminUser } (or the bare user)
//   PUT    /api/admin/users/{id}/roles  {roles}      → { user }
//   POST   /api/admin/users/{id}/disable             → { user }
//   POST   /api/admin/users/{id}/enable              → { user }
//   POST   /api/admin/users/{id}/resend-verification → 204
//   DELETE /api/admin/users/{id}                     → 204
import useSWR from "swr"

import { api, ApiError, brainApi, type ActivityItem, type Grant, type SecretMeta, type Token } from "@/lib/api"
import { noRetryOn4xx } from "@/lib/queries"

// ── Brain-side hooks ─────────────────────────────────────────────────────

export function useTokens() {
  return useSWR<Token[]>("/api/brain/tokens", () => brainApi.tokens().then((r) => r.tokens ?? []), noRetryOn4xx)
}

export function useSecrets(namespace: string | null) {
  return useSWR<SecretMeta[]>(
    namespace ? ["/api/brain/secrets", namespace] : null,
    ([, ns]: [string, string]) => brainApi.secrets(ns).then((r) => r.secrets ?? []),
    noRetryOn4xx,
  )
}

export function useActivity(limit = 200) {
  return useSWR<ActivityItem[]>(
    ["/api/brain/activity", limit],
    ([, n]: [string, number]) => brainApi.activity(n).then((r) => r.items ?? []),
    { ...noRetryOn4xx, refreshInterval: 15_000 },
  )
}

export function useStats() {
  return useSWR("/api/brain/stats", () => brainApi.stats(), noRetryOn4xx)
}

/** One row per agent (deduped across its tokens): admin flag and its grant on `namespace`. */
export type AgentAccess = { agentId: string; isAdmin: boolean; grant?: Grant }

export function agentsForBrain(tokens: Token[], namespace: string): AgentAccess[] {
  const m = new Map<string, AgentAccess>()
  for (const tok of tokens) {
    if (tok.revoked || !tok.agentId) continue
    const grant = (tok.grants ?? []).find((g) => g.namespace === namespace)
    const cur = m.get(tok.agentId)
    m.set(tok.agentId, {
      agentId: tok.agentId,
      isAdmin: (cur?.isAdmin ?? false) || tok.isAdmin,
      grant: cur?.grant ?? grant,
    })
  }
  return [...m.values()].sort((a, b) => a.agentId.localeCompare(b.agentId))
}

/** A 404/405/501 means the endpoint isn't deployed yet (the backend is still adding /api/admin/*). */
export function isNotLive(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 405 || err.status === 501)
}

// ── /api/admin/* ─────────────────────────────────────────────────────────

export const USER_ROLES = ["owner", "admin", "member"] as const
export type UserRole = (typeof USER_ROLES)[number]

export type AdminUser = {
  id: string | number
  email: string
  name?: string | null
  roles: string[]
  email_verified: boolean
  disabled: boolean
  two_factor?: boolean
  created_at?: string | null
  last_login_at?: string | null
}

export type AdminUserPage = { users: AdminUser[]; total: number; page: number; perPage: number }

type RawUser = Partial<AdminUser> & {
  id: string | number
  email: string
  disabled_at?: string | null
  status?: string
  two_factor_enabled?: boolean
  createdAt?: string
  lastLoginAt?: string
}

function normalizeUser(u: RawUser): AdminUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    roles: u.roles ?? [],
    email_verified: !!u.email_verified,
    disabled: !!(u.disabled ?? u.disabled_at ?? u.status === "disabled"),
    two_factor: u.two_factor ?? u.two_factor_enabled,
    created_at: u.created_at ?? u.createdAt ?? null,
    last_login_at: u.last_login_at ?? u.lastLoginAt ?? null,
  }
}

const unwrap = (r: RawUser | { user: RawUser }) => normalizeUser("user" in r ? r.user : r)

export function useAdminStats() {
  return useSWR<Record<string, number>>("/api/admin/stats", () => api<Record<string, number>>("/api/admin/stats"), noRetryOn4xx)
}

export function useAdminUsers(q: string, page: number) {
  return useSWR<AdminUserPage>(
    ["/api/admin/users", q, page],
    async ([, query, p]: [string, string, number]) => {
      const params = new URLSearchParams({ page: String(p) })
      if (query) params.set("q", query)
      const r = await api<{ users?: RawUser[]; data?: RawUser[]; total?: number; page?: number; per_page?: number }>(
        `/api/admin/users?${params}`,
      )
      const users = (r.users ?? r.data ?? []).map(normalizeUser)
      return { users, total: r.total ?? users.length, page: r.page ?? p, perPage: r.per_page ?? (users.length || 25) }
    },
    { ...noRetryOn4xx, keepPreviousData: true },
  )
}

export function useAdminUser(id: string | null) {
  return useSWR<AdminUser>(
    id ? ["/api/admin/users/", id] : null,
    ([, uid]: [string, string]) => api<RawUser | { user: RawUser }>(`/api/admin/users/${encodeURIComponent(uid)}`).then(unwrap),
    noRetryOn4xx,
  )
}

const userPath = (id: string | number) => `/api/admin/users/${encodeURIComponent(String(id))}`

export const adminApi = {
  setRoles: (id: string | number, roles: string[]) => api(`${userPath(id)}/roles`, { method: "PUT", json: { roles } }),
  disable: (id: string | number) => api(`${userPath(id)}/disable`, { method: "POST" }),
  enable: (id: string | number) => api(`${userPath(id)}/enable`, { method: "POST" }),
  resendVerification: (id: string | number) => api(`${userPath(id)}/resend-verification`, { method: "POST" }),
  deleteUser: (id: string | number) => api(userPath(id), { method: "DELETE" }),
}
