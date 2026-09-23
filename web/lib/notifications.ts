"use client"

// The signed-in account's notification center (MH-360), shared with the mobile app:
//
//   GET    /api/me/notifications?cursor=&limit=&locale=  → {items, nextCursor?, unread}
//   GET    /api/me/notifications/unread                  → {unread}
//   POST   /api/me/notifications/read {ids?, all?}       → {updated, unread}
//   DELETE /api/me/notifications/{id}                    → {deleted}
//
// Live: the brain events stream (lib/realtime.tsx) carries a user-scoped "notification" event
// that revalidates the unread key; the open inbox list follows the count.
import useSWR from "swr"
import useSWRInfinite from "swr/infinite"

import { api } from "@/lib/api"
import { noRetryOn4xx } from "@/lib/queries"

export type AppNotification = {
  id: string
  /** brain_access · presentation_viewed · presentation_downloaded · test · … */
  kind: string
  title: string
  body: string
  /** The app route: /brain/<ns> · /presentation/<id> · /note/<id>. */
  route: string
  data: Record<string, string>
  createdAt: string
  readAt: string | null
}
export type NotificationPage = { items: AppNotification[]; nextCursor?: string; unread: number }

export const UNREAD_KEY = "/api/me/notifications/unread"
const PAGE = 20

/** The unread count. Revalidated by the realtime stream; polled slowly as a fallback. */
export function useUnreadNotifications(enabled = true) {
  return useSWR<number>(enabled ? UNREAD_KEY : null, () => api<{ unread: number }>(UNREAD_KEY).then((r) => r.unread), {
    ...noRetryOn4xx,
    refreshInterval: 120_000,
  })
}

/** The inbox, a page at a time, fetched only while `open`. */
export function useNotificationList(locale: string, open: boolean) {
  return useSWRInfinite<NotificationPage>(
    (i, prev: NotificationPage | null) => {
      if (!open || (i > 0 && !prev?.nextCursor)) return null
      const q = new URLSearchParams({ limit: String(PAGE), locale })
      if (i > 0 && prev?.nextCursor) q.set("cursor", prev.nextCursor)
      return `/api/me/notifications?${q}`
    },
    (key: string) => api<NotificationPage>(key),
    { revalidateOnFocus: false, revalidateFirstPage: true },
  )
}

export const notificationsApi = {
  markRead: (change: { ids?: string[]; all?: boolean }) =>
    api<{ updated: number; unread: number }>("/api/me/notifications/read", { json: change }),
  remove: (id: string) => api<{ deleted: boolean }>(`/api/me/notifications/${encodeURIComponent(id)}`, { method: "DELETE" }),
}

const SEG = /^[A-Za-z0-9_.:~-]{1,200}$/

/** The console path for an item's app route, or null when it has none here. Remote input: checked. */
export function consoleHref(n: Pick<AppNotification, "route" | "data">, locale: string): string | null {
  const m = /^\/(brain|presentation|note)\/([^/?#]+)$/.exec(n.route ?? "")
  if (!m) return null
  let seg: string
  try {
    seg = decodeURIComponent(m[2])
  } catch {
    return null
  }
  const ns = n.data?.namespace ?? ""
  const nsOk = SEG.test(ns)
  if (!SEG.test(seg) || seg === "." || seg === "..") return null
  const enc = encodeURIComponent
  switch (m[1]) {
    case "brain":
      return `/${locale}/b/${enc(seg)}`
    case "presentation":
      return nsOk ? `/${locale}/b/${enc(ns)}/presentations/${enc(seg)}` : null
    case "note":
      return nsOk ? `/${locale}/b/${enc(ns)}/notes?note=${enc(seg)}` : null
  }
  return null
}
