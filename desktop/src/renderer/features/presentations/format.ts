import { useEffect, useMemo, useState } from "react";

import { STYLES, ago, expiry, isKind } from "@mobile/features/presentations/presentations-core";
import type { PStyle } from "@mobile/features/presentations/types";

import { useI18n } from "../../lib/i18n";

/** Locale-aware labels and times for the feature (mobile parts.tsx useFormat). */
export function useFormat() {
  const { t, locale } = useI18n();
  return useMemo(() => {
    const tag = locale === "ar" ? "ar-EG" : "en-US";
    const date = (iso: string) => new Date(iso).toLocaleDateString(tag, { day: "numeric", month: "short", year: "numeric" });
    return {
      kind: (k: string) => (isKind(k) ? t(`presentations.kind.${k}`) : k),
      status: (s: string) => (s === "draft" || s === "ready" || s === "archived" ? t(`presentations.status.${s}`) : s),
      style: (s: string) => ((STYLES as string[]).includes(s) ? t(`presentations.style.${s as PStyle}`) : s),
      language: (l: string) => (l === "ar" || l === "en" ? t(`presentations.locale.${l}`) : l),
      short: (l: string) => t(`presentations.locale.short.${l === "ar" ? "ar" : "en"}`),
      date,
      /** "5m ago", "3h ago", or a date; "" for none. */
      ago: (iso: string | null | undefined) => {
        const a = ago(iso);
        if (!a || !iso) return "";
        if (a.unit === "now") return t("presentations.ago.now");
        if (a.unit === "date") return date(iso);
        return t(`presentations.ago.${a.unit}`, { n: a.n });
      },
      expiry: (iso: string | null | undefined) => {
        const e = expiry(iso);
        if (e.kind === "never") return t("presentations.share.neverExpires");
        if (e.kind === "past") return t("presentations.share.expired");
        if (e.kind === "today") return t("presentations.share.expiresToday");
        return t("presentations.share.expiresIn", { n: e.n });
      },
      days: (n: number) => (n === 0 ? t("presentations.share.never") : t("presentations.share.days", { n })),
    };
  }, [t, locale]);
}

export type Format = ReturnType<typeof useFormat>;

/** `value`, settled for `ms` (search fields). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}
