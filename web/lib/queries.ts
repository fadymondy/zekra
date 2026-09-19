"use client"

import useSWR from "swr"

import { api, ApiError, brainApi, type BrainDetail, type NamespaceInfo } from "@/lib/api"

export const noRetryOn4xx = {
  shouldRetryOnError: (err: unknown) => !(err instanceof ApiError && err.status < 500),
  revalidateOnFocus: false,
}

export type User = {
  id: string | number
  email: string
  name?: string | null
  roles?: string[] | null
  email_verified?: boolean
}

/** The signed-in user, `null` when signed out (401), undefined while loading. */
export function useMe() {
  return useSWR<User | null>(
    "/api/auth/me",
    async () => {
      try {
        const r = await api<User | { user: User }>("/api/auth/me")
        return "user" in r ? r.user : r
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    noRetryOn4xx,
  )
}

/** Admin and owner roles see the admin control panel (the API enforces it too). */
export function isAdmin(user: User | null | undefined): boolean {
  return !!user?.roles?.some((r) => r === "admin" || r === "owner")
}

export function useBrains(enabled = true) {
  return useSWR<NamespaceInfo[]>(
    enabled ? "/api/brain/namespaces" : null,
    () => brainApi.namespaces().then((r) => r.brains ?? []),
    noRetryOn4xx,
  )
}

export function useBrain(namespace: string | null | undefined) {
  return useSWR<BrainDetail>(
    namespace ? ["/api/brain/brain", namespace] : null,
    ([, ns]: [string, string]) => brainApi.brainDetail(ns),
    noRetryOn4xx,
  )
}
