import { FileText, Globe, Presentation } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";

import { Chip, Tile } from "@/components/kit";
import { useI18n } from "@/lib/i18n";
import { usePalette } from "@/theme";

import { STYLES, ago, expiry, isKind, orderedLocales, statusTone } from "./presentations-core";
import type { PStyle } from "./types";

/** deck = Presentation, report = FileText, page = Globe. */
export function KindIcon({ kind, size = 18, color }: { kind: string; size?: number; color?: string }) {
  const p = usePalette();
  const Icon = kind === "report" ? FileText : kind === "page" ? Globe : Presentation;
  return <Icon size={size} color={color ?? p.body} strokeWidth={1.6} />;
}

export function KindTile({ kind, size = 38 }: { kind: string; size?: number }) {
  return (
    <Tile size={size}>
      <KindIcon kind={kind} size={Math.round(size * 0.47)} />
    </Tile>
  );
}

export function StatusChip({ status }: { status: string }) {
  const f = useFormat();
  return <Chip label={f.status(status).toUpperCase()} tone={statusTone(status)} />;
}

/** "EN · AR" — the languages a document has. */
export function LocaleChips({ locales }: { locales: string[] | null | undefined }) {
  const { t } = useI18n();
  const list = orderedLocales(locales);
  if (!list.length) return null;
  return <Chip label={list.map((l) => t(`presentations.locale.short.${l}`)).join(" · ")} tone="muted" />;
}

/** Locale-aware labels and times for the feature. */
export function useFormat() {
  const { t, locale } = useI18n();
  return useMemo(() => {
    const tag = locale === "ar" ? "ar-EG" : "en-US";
    const date = (iso: string) => new Date(iso).toLocaleDateString(tag, { day: "numeric", month: "short", year: "numeric" });
    return {
      kind: (k: string) => (isKind(k) ? t(`presentations.kind.${k}`) : k),
      status: (s: string) =>
        s === "draft" || s === "ready" || s === "archived" ? t(`presentations.status.${s}`) : s,
      style: (s: string) => ((STYLES as string[]).includes(s) ? t(`presentations.style.${s as PStyle}`) : s),
      language: (l: string) => (l === "ar" || l === "en" ? t(`presentations.locale.${l}`) : l),
      date,
      /** "5m", "3h", "2d", or a date; "" for none. */
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

/** `value`, settled for `ms` (search fields). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}
