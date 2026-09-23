import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { AppState } from "react-native";

import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";

import { notifyApi, notifyKeys } from "./api";
import { onNotify } from "./bus";
import { dropFromPage, flattenPages, markPageRead, type AppNotification, type NotificationPage } from "./notify-core";

/*
Live updates on the phone (MH-360). The server also streams a user-scoped
"notification" event over GET /api/brain/events (SSE), but React Native has no
EventSource and its fetch cannot stream a body; an XHR-based reader would hold a
socket (and a growing responseText) open all day and needs its own reconnect
logic. What keeps the badge right here instead, all cheap:

  - a push arriving in the foreground (bus "received" from the push module)
    refetches at once — with FCM on, that is effectively realtime;
  - coming back to the foreground refetches;
  - while the app is in the foreground, the unread count is polled every 30s
    (a tiny indexed count). The interval stops in the background.
*/
const POLL_MS = 30_000;

type Pages = InfiniteData<NotificationPage, string | undefined>;

/** Refetch the inbox and badge when a push lands and when the app comes back. */
function useNotifyLive(enabled: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => void client.invalidateQueries({ queryKey: notifyKeys.all });
    const offBus = onNotify((s) => {
      if (s.type === "received") refresh();
    });
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      offBus();
      sub.remove();
    };
  }, [client, enabled]);
}

/** A server without the inbox endpoints (an API not yet deployed with them)
 *  answers 404 "no such API route" — nothing to retry or poll for. */
export function inboxUnavailable(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 404;
}

/** The signed-in account's unread count, kept current (see above). */
export function useUnreadCount() {
  const { token, user } = useAuth();
  const uid = user?.id ?? "";
  const enabled = !!token && !!uid;
  const q = useQuery({
    queryKey: notifyKeys.unread(uid),
    queryFn: ({ signal }) => notifyApi.unread(token!, signal).then((r) => r.unread),
    enabled,
    staleTime: 10_000,
    retry: (count, error) => !inboxUnavailable(error) && count < 1,
    refetchInterval: (query) => (AppState.currentState === "active" && !inboxUnavailable(query.state.error) ? POLL_MS : false),
  });
  useNotifyLive(enabled);
  return { unread: q.data ?? 0, query: q };
}

/** The inbox, newest first, a cursor page at a time (in the app's language). */
export function useNotifications() {
  const { token, user } = useAuth();
  const { locale } = useI18n();
  const client = useQueryClient();
  const uid = user?.id ?? "";
  const enabled = !!token && !!uid;
  const q = useInfiniteQuery({
    queryKey: notifyKeys.list(uid, locale),
    retry: (count, error) => !inboxUnavailable(error) && count < 1,
    queryFn: async ({ pageParam, signal }) => {
      const page = await notifyApi.list(token!, locale, pageParam, signal);
      // The first page carries the unread count: keep the badge in step.
      if (!pageParam) client.setQueryData(notifyKeys.unread(uid), page.unread);
      return page;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled,
  });
  useNotifyLive(enabled);
  const items = useMemo(() => flattenPages(q.data?.pages), [q.data]);
  return { ...q, items };
}

/** Edit every cached page of uid's inbox (every locale). */
function editLists(client: QueryClient, uid: string, edit: (page: NotificationPage) => NotificationPage) {
  client.setQueriesData<Pages>({ queryKey: [...notifyKeys.lists, uid] }, (data) =>
    data ? { ...data, pages: data.pages.map(edit) } : data,
  );
}

/** Set the badge count, and the count the cached list pages carry, together. */
function setUnread(client: QueryClient, uid: string, next: (n: number) => number) {
  const value = Math.max(0, next(client.getQueryData<number>(notifyKeys.unread(uid)) ?? 0));
  client.setQueryData<number>(notifyKeys.unread(uid), value);
  editLists(client, uid, (p) => (p.unread === value ? p : { ...p, unread: value }));
}

/** Mark read / mark all read / delete — optimistic, then reconciled with the server. */
export function useNotificationActions() {
  const { token, user } = useAuth();
  const client = useQueryClient();
  const uid = user?.id ?? "";

  const settle = useCallback(() => void client.invalidateQueries({ queryKey: notifyKeys.all }), [client]);

  const markRead = useCallback(
    async (items: AppNotification[]) => {
      const unread = items.filter((n) => !n.readAt).map((n) => n.id);
      if (!token || !unread.length) return;
      editLists(client, uid, (p) => markPageRead(p, { ids: unread }, new Date().toISOString()));
      setUnread(client, uid, (n) => n - unread.length);
      try {
        const res = await notifyApi.markRead(token, { ids: unread });
        setUnread(client, uid, () => res.unread);
      } catch {
        settle();
      }
    },
    [client, settle, token, uid],
  );

  const markAllRead = useCallback(async () => {
    if (!token) return;
    editLists(client, uid, (p) => markPageRead(p, { all: true }, new Date().toISOString()));
    setUnread(client, uid, () => 0);
    try {
      await notifyApi.markRead(token, { all: true });
    } finally {
      settle();
    }
  }, [client, settle, token, uid]);

  const remove = useCallback(
    async (item: AppNotification) => {
      if (!token) return;
      editLists(client, uid, (p) => dropFromPage(p, item.id));
      if (!item.readAt) setUnread(client, uid, (n) => n - 1);
      try {
        await notifyApi.remove(token, item.id);
      } finally {
        settle();
      }
    },
    [client, settle, token, uid],
  );

  return { markRead, markAllRead, remove };
}
