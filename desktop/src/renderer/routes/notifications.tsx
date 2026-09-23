import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, CheckCheck, Loader2, RefreshCw, X } from "lucide-react";

import {
  dropFromPage,
  flattenPages,
  groupByDay,
  markPageRead,
  type AppNotification,
  type NotificationPage,
} from "@mobile/features/notify/notify-core";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { notifyApi } from "../features/notify/api";
import { KindTile } from "../features/notify/kinds";
import { routeForNotification } from "../features/notify/routes";
import { notifyStore, useNotifyState } from "../features/notify/store";
import { ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useRouter } from "../shell/router";
import { useAuthed } from "../shell/session";
import { toast } from "../shell/toast";

/*
The notification center (MH-360 parity): the account's inbox, grouped by day
(Today, Yesterday, then dates), newest first. A row opens what it is about and
marks it read; rows can be marked read or deleted on their own; "Mark all read"
clears the badge. Older pages load on demand. A server without the center
(404) shows "Not available yet", like mobile.

The badge / polling live in features/notify/agent.tsx; this screen tells the
store after every change so the bell and the Dock follow at once.
*/

type Status = "loading" | "ready" | "unavailable" | "error";

export function NotificationsRoute() {
  const { t, locale } = useI18n();
  const { token } = useAuthed();
  const { navigate } = useRouter();
  const { version, available, unread: storeUnread } = useNotifyState();
  const [pages, setPages] = useState<NotificationPage[] | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);

  const loadFirst = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const page = await notifyApi.list(token, locale);
      if (mine !== seq.current) return;
      // Keep older pages already loaded; page 1 replaces the head.
      setPages((prev) => (prev && prev.length > 1 ? [page, ...prev.slice(1)] : [page]));
      setStatus("ready");
      notifyStore.setUnread(page.unread);
    } catch (e) {
      if (mine !== seq.current) return;
      if (e instanceof ApiError && e.status === 404) {
        notifyStore.setUnavailable();
        setStatus("unavailable");
      } else setStatus((s) => (s === "ready" ? s : "error"));
    }
  }, [token, locale]);

  // First load, a locale switch (texts are per-locale), and whenever the agent
  // saw the inbox change.
  useEffect(() => {
    void loadFirst();
  }, [loadFirst, version]);

  useEffect(() => {
    if (available === false) setStatus("unavailable");
  }, [available]);

  const items = useMemo(() => flattenPages(pages ?? undefined), [pages]);
  const sections = useMemo(() => groupByDay(items), [items]);
  const nextCursor = pages?.[pages.length - 1]?.nextCursor;
  // The store follows every change (polls, mark read, deletes); page 1 is the fallback.
  const unread = storeUnread ?? pages?.[0]?.unread ?? 0;

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await notifyApi.list(token, locale, nextCursor);
      setPages((prev) => [...(prev ?? []), page]);
    } catch {
      toast.error(t("notify.loadMoreFailed"));
    } finally {
      setLoadingMore(false);
    }
  }

  async function markRead(change: { ids?: string[]; all?: boolean }) {
    const at = new Date().toISOString();
    const before = pages;
    setPages((prev) => prev?.map((p) => markPageRead(p, change, at)) ?? prev);
    try {
      const res = await notifyApi.markRead(token, change);
      notifyStore.setUnread(res.unread);
    } catch {
      setPages(before);
      toast.error(t("notify.failed"));
    }
  }

  async function remove(n: AppNotification) {
    const before = pages;
    setPages((prev) => prev?.map((p) => dropFromPage(p, n.id)) ?? prev);
    try {
      await notifyApi.remove(token, n.id);
      toast(t("notify.deleted"));
      // Deleting an unread item changes the count: let the agent re-poll.
      if (!n.readAt) notifyStore.refresh();
    } catch {
      setPages(before);
      toast.error(t("notify.failed"));
    }
  }

  function open(n: AppNotification) {
    if (!n.readAt) void markRead({ ids: [n.id] });
    const to = routeForNotification(n);
    if (to) navigate(to);
  }

  const dayLabel = (day: "today" | "yesterday" | "earlier", date: Date) =>
    day === "today"
      ? t("notify.today")
      : day === "yesterday"
        ? t("notify.yesterday")
        : new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", { weekday: "long", day: "numeric", month: "long" }).format(date);

  const timeOf = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", { hour: "numeric", minute: "2-digit" }).format(d);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-6">
        <h1 className="text-sm font-medium text-grid-fg">{t("notify.title")}</h1>
        {status === "ready" && unread > 0 ? (
          <span className="grid-micro rounded-sm bg-grid-gold/15 px-1.5 py-0.5 text-grid-gold">
            {t("notify.unreadCount", { count: unread })}
          </span>
        ) : null}
        <div className="ms-auto flex items-center gap-1">
          {status === "ready" && unread > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => void markRead({ all: true })}>
              <CheckCheck />
              {t("notify.markAllRead")}
            </Button>
          ) : null}
          {status !== "unavailable" ? (
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label={t("action.refresh")} onClick={() => void loadFirst()} />}
              >
                <RefreshCw />
              </TooltipTrigger>
              <TooltipContent>{t("action.refresh")}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-3xl px-6 py-4">
          {status === "loading" ? (
            <div className="flex flex-col gap-4 py-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="size-8" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : status === "unavailable" ? (
            <Empty icon={BellOff} title={t("notify.unavailableTitle")} body={t("notify.unavailableBody")} />
          ) : status === "error" ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-sm text-grid-danger">{t("notify.failed")}</p>
              <Button variant="outline" size="sm" onClick={() => void loadFirst()}>
                {t("action.retry")}
              </Button>
            </div>
          ) : items.length === 0 ? (
            <Empty icon={Bell} title={t("notify.emptyTitle")} body={t("notify.emptyBody")} />
          ) : (
            <>
              {sections.map((section) => (
                <section key={section.key} className="mb-6">
                  <h2 className="grid-micro mb-2 text-grid-muted">{dayLabel(section.day, section.date)}</h2>
                  <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-md border border-line bg-grid-card">
                    {section.items.map((n) => (
                      <li key={n.id} className={cn("group relative flex items-start", !n.readAt && "bg-grid-gold/[0.04]")}>
                        <button
                          type="button"
                          onClick={() => open(n)}
                          className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3 text-start hover:bg-grid-soft focus-visible:outline-2 focus-visible:outline-grid-action"
                        >
                          <KindTile kind={n.kind} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              {!n.readAt ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-grid-gold" /> : null}
                              <span
                                className={cn("truncate text-sm", n.readAt ? "text-grid-body" : "font-medium text-grid-fg")}
                                style={{ unicodeBidi: "plaintext" }}
                              >
                                {n.title}
                              </span>
                              <span className="ms-auto shrink-0 font-grid-mono text-[11px] text-grid-muted">{timeOf(n.createdAt)}</span>
                            </span>
                            {n.body ? (
                              <span className="mt-0.5 line-clamp-2 block text-xs text-grid-muted" style={{ unicodeBidi: "plaintext" }}>
                                {n.body}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        <div className="flex shrink-0 items-center gap-0.5 self-center pe-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                          {!n.readAt ? (
                            <Button variant="ghost" size="icon-xs" aria-label={t("notify.markRead")} title={t("notify.markRead")} onClick={() => void markRead({ ids: [n.id] })}>
                              <CheckCheck />
                            </Button>
                          ) : null}
                          <Button variant="ghost" size="icon-xs" aria-label={t("notify.delete")} title={t("notify.delete")} onClick={() => void remove(n)}>
                            <X />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {nextCursor ? (
                <div className="flex justify-center pb-4">
                  <Button variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>
                    {loadingMore ? <Loader2 className="animate-spin" /> : null}
                    {t("notifyx.loadMore")}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function Empty({ icon: Icon, title, body }: { icon: typeof Bell; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-md border border-grid-gold/60 bg-grid-gold/10 text-grid-gold">
        <Icon className="size-5" />
      </span>
      <p className="text-sm font-medium text-grid-fg">{title}</p>
      <p className="max-w-sm text-sm text-grid-muted">{body}</p>
    </div>
  );
}
