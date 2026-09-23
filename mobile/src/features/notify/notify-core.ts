// Pure notification-center logic (MH-360): no React Native imports, so
// `node --test` can exercise it directly (notify-core.test.ts).

/** One inbox item — GET /api/me/notifications `items[]`. */
export type AppNotification = {
  id: string;
  /** brain_access · presentation_viewed · presentation_downloaded · test · … */
  kind: string;
  title: string;
  body: string;
  /** In-app route ("/brain/<ns>", "/presentation/<id>", "/note/<id>"), or "". */
  route: string;
  data: Record<string, string>;
  createdAt: string;
  readAt: string | null;
};

/** One page of GET /api/me/notifications. */
export type NotificationPage = { items: AppNotification[]; nextCursor?: string; unread: number };

/** The bell's badge: nothing at 0, the count up to 99, then "99+". */
export function badgeLabel(unread: number | null | undefined): string | null {
  if (!unread || unread < 0 || !Number.isFinite(unread)) return null;
  return unread > 99 ? "99+" : String(Math.floor(unread));
}

/** The inbox id a push carries (data.notificationId), or null. Remote input: checked. */
export function notificationIdFrom(data: Record<string, unknown> | null | undefined): string | null {
  const id = data?.notificationId;
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

/** How a kind is drawn: which icon tile. Unknown kinds get the generic bell. */
export type KindVisual = "brain" | "presentation" | "download" | "test" | "info";

export function kindVisual(kind: string): KindVisual {
  switch (kind) {
    case "brain_access":
      return "brain";
    case "presentation_viewed":
      return "presentation";
    case "presentation_downloaded":
      return "download";
    case "test":
      return "test";
    default:
      return "info";
  }
}

/** Every item of an infinite query's pages, in order, each id once. */
export function flattenPages(pages: readonly NotificationPage[] | undefined): AppNotification[] {
  const seen = new Set<string>();
  const out: AppNotification[] = [];
  for (const p of pages ?? []) {
    for (const n of p.items ?? []) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push(n);
    }
  }
  return out;
}

export type DayKey = "today" | "yesterday" | "earlier";

/** A run of items from one local calendar day, newest day first. */
export type DaySection = { key: string; day: DayKey; date: Date; items: AppNotification[] };

function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Groups items (already newest first) by local calendar day: Today, Yesterday,
 * then one section per earlier date. Unparseable dates join the last section.
 */
export function groupByDay(items: readonly AppNotification[], now: Date = new Date()): DaySection[] {
  const today = dayStart(now);
  const yesterday = dayStart(new Date(today - 12 * 3600_000));
  const out: DaySection[] = [];
  for (const n of items) {
    const at = new Date(n.createdAt);
    const start = Number.isNaN(at.getTime()) ? (out.length ? out[out.length - 1].date.getTime() : today) : dayStart(at);
    const key = String(start);
    const last = out[out.length - 1];
    if (last && last.key === key) {
      last.items.push(n);
      continue;
    }
    const day: DayKey = start >= today ? "today" : start === yesterday ? "yesterday" : "earlier";
    out.push({ key, day, date: new Date(start), items: [n] });
  }
  return out;
}

/** A page with some items marked read (ids) or all of them (all), as the server will. */
export function markPageRead(page: NotificationPage, change: { ids?: readonly string[]; all?: boolean }, at: string): NotificationPage {
  const ids = new Set(change.ids ?? []);
  let flipped = 0;
  const items = page.items.map((n) => {
    if (n.readAt || !(change.all || ids.has(n.id))) return n;
    flipped++;
    return { ...n, readAt: at };
  });
  return flipped ? { ...page, items } : page;
}

/** A page without one item. */
export function dropFromPage(page: NotificationPage, id: string): NotificationPage {
  const items = page.items.filter((n) => n.id !== id);
  return items.length === page.items.length ? page : { ...page, items };
}
