import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, CheckCheck, Loader2, X } from "lucide-react";

import {
  badgeLabel,
  dropFromPage,
  flattenPages,
  groupByDay,
  markPageRead,
  type AppNotification,
  type NotificationPage,
} from "@mobile/features/notify/notify-core";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { ApiError } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useRouter } from "../../shell/router";
import { useAuthed } from "../../shell/session";
import { toast } from "../../shell/toast";
import { notifyApi } from "./api";
import { KindTile } from "./kinds";
import { routeForNotification } from "./routes";
import { notifyStore, useNotifyState } from "./store";

/*
The title bar's bell and the notification center — a POPOVER anchored to the
bell (the native pattern: macOS Notification Centre-style list under a toolbar
button), not a page. Newest first, grouped by day (Today, Yesterday, dates),
unread rows tinted with a dot; a row opens what it is about and marks it read;
rows can be marked read / deleted on hover; "Mark all read" in the header;
older pages load at the bottom. A server without the center (404) says so.

Opened by the bell, Go ▸ Inbox (⇧⌘I), the tray's Notifications item and a
banner for the summary ("zn|…|notifications") — all through notifyStore.open.
The badge / polling / OS banners live in agent.tsx.
*/

export function NotificationBell() {
  const { t } = useI18n();
  const { unread, available, open } = useNotifyState();
  const badge = available === false ? null : badgeLabel(unread);
  return (
    <Popover open={open} onOpenChange={(v) => notifyStore.setOpen(v)}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            data-ctl="icon-sm"
            className="relative text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-selected aria-expanded:text-foreground [&_svg]:stroke-[1.75]"
            aria-label={badge ? t("notify.bellUnread", { count: badge }) : t("notify.bell")}
            title={t("notify.bell")}
          />
        }
      >
        <Bell className="size-4" />
        {badge ? (
          <span
            aria-hidden
            className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold leading-none text-primary-foreground ring-2 ring-background"
          >
            {badge}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="notify-popover w-[384px] gap-0 overflow-hidden p-0">
        {open ? <NotificationCenter onNavigate={() => notifyStore.setOpen(false)} /> : null}
      </PopoverContent>
    </Popover>
  );
}

type Status = "loading" | "ready" | "unavailable" | "error";

function NotificationCenter({ onNavigate }: { onNavigate: () => void }) {
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

  useEffect(() => {
    void loadFirst();
  }, [loadFirst, version]);

  useEffect(() => {
    if (available === false) setStatus("unavailable");
  }, [available]);

  const items = useMemo(() => flattenPages(pages ?? undefined), [pages]);
  const sections = useMemo(() => groupByDay(items), [items]);
  const nextCursor = pages?.[pages.length - 1]?.nextCursor;
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
      if (!n.readAt) notifyStore.refresh();
    } catch {
      setPages(before);
      toast.error(t("notify.failed"));
    }
  }

  function open(n: AppNotification) {
    if (!n.readAt) void markRead({ ids: [n.id] });
    const to = routeForNotification(n);
    if (to) {
      onNavigate();
      navigate(to);
    }
  }

  const fmtLocale = locale === "ar" ? "ar" : "en";
  const dayLabel = (day: "today" | "yesterday" | "earlier", date: Date) =>
    day === "today"
      ? t("notify.today")
      : day === "yesterday"
        ? t("notify.yesterday")
        : new Intl.DateTimeFormat(fmtLocale, { weekday: "long", day: "numeric", month: "long" }).format(date);
  const timeOf = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat(fmtLocale, { hour: "numeric", minute: "2-digit" }).format(d);
  };

  return (
    <div className="flex max-h-[min(520px,calc(100vh-96px))] flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 ps-4 pe-2">
        <h2 className="text-ui font-semibold text-foreground">{t("notify.title")}</h2>
        {status === "ready" && unread > 0 ? (
          <span className="rounded-full bg-primary/15 px-1.5 text-[12px] font-semibold text-primary">{badgeLabel(unread)}</span>
        ) : null}
        <div className="flex-1" />
        {status === "ready" && unread > 0 ? (
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[13px] text-muted-foreground hover:text-foreground" onClick={() => void markRead({ all: true })}>
            <CheckCheck className="size-3.5" />
            {t("notify.markAllRead")}
          </Button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {status === "loading" ? (
          <div className="flex flex-col gap-4 p-4">
            {[0, 1, 2].map((i) => (
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
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="text-ui-sm text-destructive">{t("notify.failed")}</p>
            <Button variant="outline" size="sm" onClick={() => void loadFirst()}>
              {t("action.retry")}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <Empty icon={Bell} title={t("notify.emptyTitle")} body={t("notify.emptyBody")} />
        ) : (
          <>
            {sections.map((section) => (
              <section key={section.key}>
                <h3 className="list-group-header sticky top-0 z-10 bg-popover/95 px-4 pt-2.5 pb-1 backdrop-blur">
                  {dayLabel(section.day, section.date)}
                </h3>
                <ul className="flex flex-col px-1.5 pb-1">
                  {section.items.map((n) => (
                    <li key={n.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => open(n)}
                        className={cn(
                          "flex w-full min-w-0 items-start gap-3 rounded-md px-2.5 py-2.5 text-start hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring",
                          !n.readAt && "bg-primary/[0.06]",
                        )}
                      >
                        <KindTile kind={n.kind} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span
                              className={cn("min-w-0 flex-1 truncate text-ui", n.readAt ? "text-foreground/80" : "font-semibold text-foreground")}
                              dir="auto"
                              style={{ unicodeBidi: "plaintext" }}
                            >
                              {n.title}
                            </span>
                            <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums group-hover:invisible group-focus-within:invisible">
                              {timeOf(n.createdAt)}
                            </span>
                          </span>
                          {n.body ? (
                            <span className="mt-0.5 line-clamp-2 block text-ui-sm text-muted-foreground" dir="auto" style={{ unicodeBidi: "plaintext" }}>
                              {n.body}
                            </span>
                          ) : null}
                        </span>
                        {!n.readAt ? <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" /> : <span className="w-2 shrink-0" />}
                      </button>
                      <div className="absolute end-3 top-2 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
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
              <div className="flex justify-center pb-3 pt-1">
                <Button variant="ghost" size="sm" className="text-[13px] text-muted-foreground" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? <Loader2 className="animate-spin" /> : null}
                  {t("notifyx.loadMore")}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function Empty({ icon: Icon, title, body }: { icon: typeof Bell; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-6 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-[18px]" />
      </span>
      <p className="text-ui font-medium text-foreground">{title}</p>
      <p className="max-w-64 text-ui-sm text-muted-foreground">{body}</p>
    </div>
  );
}
