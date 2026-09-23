import { request } from "@/lib/api";
import { reportError } from "@/lib/crash";

import { emitNotify } from "./bus";
import { notificationIdFrom, type NotificationPage } from "./notify-core";

/*
The notification center's API (MH-360) — the signed-in account's inbox:

  GET    /api/me/notifications?cursor=&limit=&locale=  → {items, nextCursor?, unread}
  GET    /api/me/notifications/unread                  → {unread}
  POST   /api/me/notifications/read {ids?, all?}       → {updated, unread}
  DELETE /api/me/notifications/{id}                    → {deleted}

React-query keys all start with "notifications", so invalidating
["notifications"] refreshes the list and the badge together:

  ["notifications", "list", userId, locale]   the infinite list (text per locale)
  ["notifications", "unread", userId]         the badge count

The user id keeps one account's inbox from flashing on another's screen after
a sign-out/sign-in (the cache is not cleared on sign-out).
*/
export const notifyKeys = {
  all: ["notifications"] as const,
  lists: ["notifications", "list"] as const,
  list: (userId: string, locale: string) => ["notifications", "list", userId, locale] as const,
  unreadAll: ["notifications", "unread"] as const,
  unread: (userId: string) => ["notifications", "unread", userId] as const,
};

export const PAGE_SIZE = 30;

export const notifyApi = {
  list: (token: string, locale: string, cursor?: string, signal?: AbortSignal) => {
    const q = new URLSearchParams({ limit: String(PAGE_SIZE), locale });
    if (cursor) q.set("cursor", cursor);
    return request<NotificationPage>(`/api/me/notifications?${q.toString()}`, { token, signal });
  },
  unread: (token: string, signal?: AbortSignal) => request<{ unread: number }>("/api/me/notifications/unread", { token, signal }),
  markRead: (token: string, change: { ids?: string[]; all?: boolean }) =>
    request<{ updated: number; unread: number }>("/api/me/notifications/read", { method: "POST", token, json: change }),
  remove: (token: string, id: string) =>
    request<{ deleted: boolean }>(`/api/me/notifications/${encodeURIComponent(id)}`, { method: "DELETE", token }),
};

/**
 * A notification was opened from outside the center (a tapped push, the
 * foreground banner): mark its inbox item read, then refresh. Best effort —
 * never throws; a push without data.notificationId (an older server) is a no-op.
 */
export async function markReadFromPush(token: string | null | undefined, data: Record<string, unknown> | null | undefined): Promise<void> {
  const id = notificationIdFrom(data);
  if (!id || !token) return;
  try {
    await notifyApi.markRead(token, { ids: [id] });
  } catch (e) {
    reportError(e, "notify: mark read from push");
  } finally {
    emitNotify({ type: "received" });
  }
}
