import type { NotificationPage } from "@mobile/features/notify/notify-core";

import { request } from "../../lib/api";

/*
The notification center's API (MH-360), re-implemented over the desktop client
(mobile's features/notify/api.ts imports React Native crash reporting):

  GET    /api/me/notifications?cursor=&limit=&locale=  → {items, nextCursor?, unread}
  GET    /api/me/notifications/unread                  → {unread}
  POST   /api/me/notifications/read {ids?, all?}       → {updated, unread}
  DELETE /api/me/notifications/{id}                    → {deleted}

A 404 on these means the server predates the notification center.
*/
export const PAGE_SIZE = 30;

export const notifyApi = {
  list: (token: string, locale: string, cursor?: string) => {
    const q = new URLSearchParams({ limit: String(PAGE_SIZE), locale });
    if (cursor) q.set("cursor", cursor);
    return request<NotificationPage>(`/api/me/notifications?${q.toString()}`, { token });
  },
  unread: (token: string) => request<{ unread: number }>("/api/me/notifications/unread", { token }),
  markRead: (token: string, change: { ids?: string[]; all?: boolean }) =>
    request<{ updated: number; unread: number }>("/api/me/notifications/read", { method: "POST", token, json: change }),
  remove: (token: string, id: string) =>
    request<{ deleted: boolean }>(`/api/me/notifications/${encodeURIComponent(id)}`, { method: "DELETE", token }),
};
