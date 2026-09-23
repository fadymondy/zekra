import { useCallback, useEffect, useMemo, useRef } from "react";

import { ApiError } from "../../lib/api";
import { bridge } from "../../lib/bridge";
import { useI18n } from "../../lib/i18n";
import { useOsEvent } from "../../shell/os-events";
import { routeFromString, useRouter } from "../../shell/router";
import { useSession } from "../../shell/session";
import { useSlot } from "../../shell/slots";
import { notifyApi } from "./api";
import { NotificationBell } from "./bell";
import { getNotifyPrefs, useNotifyPrefs } from "./prefs";
import { nativeRouteFor, parseNativeRoute } from "./routes";
import { takeUnseen } from "./seen";
import { notifyStore, useNotifyState } from "./store";

/*
The notifications agent: mounted once while signed in (shell/app-shell.tsx).

- Publishes the bell into the "titlebar.bell" slot.
- Polls GET /api/me/notifications/unread — every 30 s while the window is
  focused, every 60 s in the background (so banners can still arrive), and at
  once on focus. A 404 = the server has no notification center: the badge
  hides and the center shows "Not available yet".
- When the count goes UP, reads page 1 and raises a macOS notification for
  each item not announced before (seen.ts), only while the window is in the
  background and Settings ▸ Notifications allows it. More than three new
  items collapse into one summary banner.
- Clicking a banner focuses the window (main) and lands here: mark the item
  read, then navigate to what it is about.
- Mirrors the unread count onto the Dock icon (if enabled).
*/

const FOCUSED_MS = 30_000;
const BACKGROUND_MS = 60_000;
const MAX_BANNERS = 3;

export function NotifyAgent() {
  const { token, user } = useSession();
  const { t, locale } = useI18n();
  const { navigate } = useRouter();
  const prefs = useNotifyPrefs();
  const { unread } = useNotifyState();
  const last = useRef<number | null>(null);
  const inflight = useRef(false);
  const alive = useRef(true);

  // The bell is a stable element; it reads the store itself.
  const bell = useMemo(() => <NotificationBell />, []);
  useSlot("titlebar.bell", bell);

  const announce = useCallback(
    async (tok: string, userId: string) => {
      let page;
      try {
        page = await notifyApi.list(tok, locale);
      } catch {
        return;
      }
      if (!alive.current) return;
      const fresh = takeUnseen(userId, page.items ?? []);
      notifyStore.bump();
      const p = getNotifyPrefs();
      if (!fresh.length || !p.os || document.hasFocus()) return;
      const silent = !p.sound;
      if (fresh.length > MAX_BANNERS) {
        void bridge().notify({ title: t("notifyx.newMany", { count: fresh.length }), body: fresh[0].title, route: "notifications", silent });
        return;
      }
      // Oldest first, so the newest ends on top of Notification Centre.
      for (const n of [...fresh].reverse()) {
        void bridge().notify({ title: n.title, body: n.body, route: nativeRouteFor(n), silent });
      }
    },
    [locale, t],
  );

  const poll = useCallback(async () => {
    if (!token || !user || inflight.current) return;
    inflight.current = true;
    try {
      const { unread: count } = await notifyApi.unread(token);
      if (!alive.current) return;
      const prev = last.current;
      last.current = count;
      notifyStore.setUnread(count);
      // First answer: record the baseline only. Afterwards: a rise = new items.
      if (prev === null || count > prev) await announce(token, user.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) notifyStore.setUnavailable();
      // Anything else (offline, 5xx): keep the last known count.
    } finally {
      inflight.current = false;
    }
  }, [token, user, announce]);

  // Poll loop + focus refresh.
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(tick, document.hasFocus() ? FOCUSED_MS : BACKGROUND_MS);
    };
    const tick = () => {
      void poll().finally(schedule);
    };
    const onFocus = () => tick();
    tick();
    window.addEventListener("focus", onFocus);
    notifyStore.setRefresher(() => {
      void poll();
    });
    return () => {
      alive.current = false;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      notifyStore.setRefresher(null);
    };
  }, [poll]);

  // Signed out / switched account: forget the count and clear the Dock.
  useEffect(
    () => () => {
      notifyStore.reset();
      void bridge().setBadgeCount(0);
    },
    [],
  );

  // The center (or a banner click) changed the count: poll against that.
  useEffect(() => {
    if (unread !== null) last.current = unread;
  }, [unread]);

  // Dock badge.
  useEffect(() => {
    void bridge().setBadgeCount(prefs.badge ? unread ?? 0 : 0);
  }, [prefs.badge, unread]);

  // A banner we raised was clicked.
  useOsEvent("notification-click", (e) => {
    const parsed = parseNativeRoute(e.route);
    if (!parsed) return false; // someone else's banner: let the shell route it
    if (parsed.id && token) {
      void notifyApi
        .markRead(token, { ids: [parsed.id] })
        .then((r) => {
          notifyStore.setUnread(r.unread);
          last.current = r.unread;
          notifyStore.bump();
        })
        .catch(() => undefined);
    }
    navigate(routeFromString(parsed.compact) ?? { name: "notifications" });
  });

  return null;
}
