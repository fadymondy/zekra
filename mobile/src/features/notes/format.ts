import type { Locale, TKey, TVars } from "@/lib/i18n";

import { ago } from "./notes-core";

type T = (key: TKey, vars?: TVars) => string;

/** "now", "5m", "3h", "2d", then a short date — the row's updated stamp. */
export function formatAgo(iso: string, t: T, locale: Locale, now: number = Date.now()): string {
  const a = ago(iso, now);
  switch (a.unit) {
    case "now":
      return t("notes.x.now");
    case "m":
      return t("notes.x.minutes", { n: a.n });
    case "h":
      return t("notes.x.hours", { n: a.n });
    case "d":
      return t("notes.x.days", { n: a.n });
    default: {
      const at = new Date(iso);
      if (Number.isNaN(at.getTime())) return "";
      const sameYear = at.getFullYear() === new Date(now).getFullYear();
      return at.toLocaleDateString(locale, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
    }
  }
}

/** A full timestamp for sheets and version history. */
export function formatStamp(iso: string, locale: Locale): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString(locale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
