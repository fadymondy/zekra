import type { AppNotification } from "@mobile/features/notify/notify-core";

/*
Which inbox items the OS has already been told about, persisted per account so
a relaunch does not re-announce old items. The baseline is the newest
createdAt seen plus the ids at or near it (items sharing a timestamp).

The first check for an account only records the baseline: existing unread
items are not re-announced as banners on the first launch.
*/
type Seen = { at: number; ids: string[] };

const MAX_IDS = 60;
const key = (userId: string) => `zekra.notify.seen.${userId}`;

function load(userId: string): Seen | null {
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Seen>;
    if (typeof v.at !== "number" || !Array.isArray(v.ids)) return null;
    return { at: v.at, ids: v.ids.filter((x): x is string => typeof x === "string").slice(0, MAX_IDS) };
  } catch {
    return null;
  }
}

function save(userId: string, seen: Seen) {
  try {
    localStorage.setItem(key(userId), JSON.stringify(seen));
  } catch {
    // best effort
  }
}

const time = (n: AppNotification) => {
  const t = Date.parse(n.createdAt);
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Items (newest first, from page 1) that are unread and newer than the stored
 * baseline — the ones to announce — and advance the baseline past all of them.
 */
export function takeUnseen(userId: string, items: readonly AppNotification[]): AppNotification[] {
  const prev = load(userId);
  const newest = items.reduce((m, n) => Math.max(m, time(n)), prev?.at ?? 0);
  const ids = new Set(prev?.ids ?? []);
  const fresh = prev ? items.filter((n) => !n.readAt && !ids.has(n.id) && time(n) >= prev.at) : [];
  const nextIds = [...items.map((n) => n.id), ...(prev?.ids ?? [])];
  save(userId, { at: newest, ids: [...new Set(nextIds)].slice(0, MAX_IDS) });
  return fresh;
}
