// Pure logic for the Brains home (MH-365): no React, no RN, so `node --test`
// can run it (brains-core.test.ts). Ported from the web console:
// web/lib/brain-profile.ts (palette, resolveColor), web/lib/brains.ts
// (slugify) and web/app/[locale]/brains/page.tsx (search + sort).

export type Sort = "recent" | "name" | "memories";
export const SORTS: Sort[] = ["recent", "name", "memories"];

/** A brain as the Brains list shows it: GET /api/brain/mine (role, canWrite)
 *  merged with GET /api/brain/namespaces (lastAt, profile). */
export type BrainListItem = {
  namespace: string;
  memories: number;
  lastAt?: string;
  displayName?: string;
  description?: string;
  color?: string;
  colorHex?: string;
  icon?: string;
  imageUrl?: string;
  role?: string;
  canWrite?: boolean;
};

/** GET /api/brain/stats */
export type BrainStats = {
  ready: boolean;
  brains: number;
  memories: number;
  entities: number;
  edges: number;
  agents: number;
  sessions24h: number;
  recalls24h: number;
  openGaps: number;
};

/** GET /api/brain/brain?namespace= */
export type BrainDetail = {
  namespace: string;
  memories: number;
  types: Record<string, number>;
  sources: Record<string, number>;
  openGaps: number;
  recalls: number;
  firstAt: string;
  lastAt: string;
};

/** The server palette (kept in sync with profile.go and web/lib/brain-profile.ts). */
export const PALETTE: { key: string; hex: string }[] = [
  { key: "slate", hex: "#64748b" }, { key: "red", hex: "#ef4444" }, { key: "orange", hex: "#f97316" },
  { key: "amber", hex: "#f59e0b" }, { key: "lime", hex: "#84cc16" }, { key: "green", hex: "#22c55e" },
  { key: "teal", hex: "#14b8a6" }, { key: "cyan", hex: "#06b6d4" }, { key: "blue", hex: "#3b82f6" },
  { key: "indigo", hex: "#6366f1" }, { key: "violet", hex: "#8b5cf6" }, { key: "pink", hex: "#ec4899" },
];

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** A palette key or #hex to a hex ("" when neither). */
export function resolveColor(c: string | undefined | null): string {
  if (!c) return "";
  const p = PALETTE.find((x) => x.key === c);
  if (p) return p.hex;
  return HEX_RE.test(c) ? c.toLowerCase() : "";
}

/** The brain's colour: the server's resolved hex first, then its key. */
export const brainHex = (b: Pick<BrainListItem, "colorHex" | "color">) => resolveColor(b.colorHex) || resolveColor(b.color);

/** Same as web/lib/brains.ts `slugify`, capped at the namespace limit. */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}

/** What the server accepts as a namespace: 1–63 of a-z0-9_.- starting alnum. */
export const NAMESPACE_RE = /^[a-z0-9][a-z0-9_.-]{0,62}$/;
export const validNamespace = (s: string) => NAMESPACE_RE.test(s);

/** Two-letter mono monogram, as the web's BrainAvatar. */
export function monogram(namespace: string): string {
  return namespace.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "··";
}

/** The brain's shown name: its display name, else the namespace. */
export const brainName = (b: { namespace: string; displayName?: string }) => b.displayName?.trim() || b.namespace;

/** Only admins and owners may delete a brain (the server enforces it too). */
export const canDelete = (role?: string) => role === "admin" || role === "owner";

/** At most the first two user-perceived characters of an emoji icon. */
export function clampIcon(s: string): string {
  return Array.from(s.trim()).slice(0, 2).join("");
}

/**
 * Membership (/mine) is the base; /namespaces adds lastAt and fills any
 * profile field /mine left empty. Brains only /namespaces lists (an admin sees
 * every brain) are kept too, without a role.
 */
export function mergeBrains(
  mine: BrainListItem[],
  namespaces: BrainListItem[] | undefined,
): BrainListItem[] {
  const extra = new Map((namespaces ?? []).map((n) => [n.namespace, n]));
  const out: BrainListItem[] = mine.map((b) => {
    const n = extra.get(b.namespace);
    extra.delete(b.namespace);
    if (!n) return { ...b };
    return {
      ...n,
      ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined && v !== "")),
      lastAt: b.lastAt || n.lastAt,
      memories: Math.max(b.memories ?? 0, n.memories ?? 0),
    } as BrainListItem;
  });
  for (const n of extra.values()) out.push({ ...n });
  return out;
}

/** Client-side search over namespace, display name and description, then sort. */
export function filterSort(list: BrainListItem[], term: string, sort: Sort, locale: string): BrainListItem[] {
  const needle = term.trim().toLowerCase();
  const rows = needle
    ? list.filter((b) => [b.namespace, b.displayName ?? "", b.description ?? ""].some((s) => s.toLowerCase().includes(needle)))
    : list.slice();
  const time = (s?: string) => {
    const n = s ? Date.parse(s) : NaN;
    return Number.isFinite(n) ? n : 0;
  };
  return rows.sort((a, b) => {
    if (sort === "name") return brainName(a).localeCompare(brainName(b), locale);
    if (sort === "memories") return b.memories - a.memories || brainName(a).localeCompare(brainName(b), locale);
    return time(b.lastAt) - time(a.lastAt) || brainName(a).localeCompare(brainName(b), locale);
  });
}

/** The top `n` entity types by count, and how many more there are. */
export function topTypes(types: Record<string, number> | undefined, n = 3): { top: [string, number][]; rest: number } {
  const all = Object.entries(types ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { top: all.slice(0, n), rest: Math.max(0, all.length - n) };
}

// ─── Relative time ──────────────────────────────────────────────────────────
// Hermes ships no Intl.RelativeTimeFormat (nor PluralRules) on iOS, so this is
// done by hand. Arabic counted nouns follow the number: 1 alone, 2 in the
// dual, 3–10 plural, 11+ singular (accusative).

export type AgoUnit = "now" | "m" | "h" | "d" | "w" | "mo" | "y";

/** Go's zero time and the Unix epoch both mean "never". */
export function isNever(iso?: string | null): boolean {
  if (!iso) return true;
  const t = Date.parse(iso);
  return !Number.isFinite(t) || t <= 86_400_000;
}

export function agoParts(iso: string, now: number): { n: number; unit: AgoUnit } {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return { n: 0, unit: "now" };
  const m = Math.round(s / 60);
  if (m < 60) return { n: Math.max(1, m), unit: "m" };
  const h = Math.round(m / 60);
  if (h < 24) return { n: h, unit: "h" };
  const d = Math.round(h / 24);
  if (d < 7) return { n: d, unit: "d" };
  if (d < 30) return { n: Math.round(d / 7), unit: "w" };
  if (d < 365) return { n: Math.max(1, Math.round(d / 30)), unit: "mo" };
  return { n: Math.max(1, Math.round(d / 365)), unit: "y" };
}

const AR_UNITS: Record<Exclude<AgoUnit, "now">, [string, string, string, string]> = {
  m: ["دقيقة", "دقيقتين", "دقائق", "دقيقة"],
  h: ["ساعة", "ساعتين", "ساعات", "ساعة"],
  d: ["يوم", "يومين", "أيام", "يومًا"],
  w: ["أسبوع", "أسبوعين", "أسابيع", "أسبوعًا"],
  mo: ["شهر", "شهرين", "أشهر", "شهرًا"],
  y: ["سنة", "سنتين", "سنوات", "سنة"],
};

const EN_UNITS: Record<Exclude<AgoUnit, "now">, string> = { m: "m", h: "h", d: "d", w: "w", mo: "mo", y: "y" };

/** "3h ago" / "منذ 3 ساعات"; "just now" / "الآن"; "never" / "أبدًا". */
export function formatAgo(iso: string | null | undefined, locale: string, now: number = Date.now()): string {
  const ar = locale === "ar";
  if (isNever(iso)) return ar ? "أبدًا" : "never";
  const { n, unit } = agoParts(iso as string, now);
  if (unit === "now") return ar ? "الآن" : "just now";
  if (!ar) return `${n}${EN_UNITS[unit]} ago`;
  const [one, two, few, many] = AR_UNITS[unit];
  if (n === 1) return `منذ ${one}`;
  if (n === 2) return `منذ ${two}`;
  return `منذ ${n} ${n <= 10 ? few : many}`;
}

/** Thousands separators, Latin digits in both languages (the design never
 *  localises digits). */
const NF = new Intl.NumberFormat("en-US");
export const formatCount = (n: number | undefined | null) => (n === undefined || n === null ? "—" : NF.format(n));

/** A left-to-right isolate (U+2066 … U+2069) for a Latin run inside Arabic. */
export const ltr = (s: string) => "\u2066" + s + "\u2069";

/** File name for an export: `<ns>-YYYY-MM-DD.jsonl`, filesystem-safe. */
export function exportFileName(namespace: string, date: Date): string {
  const safe = namespace.replace(/[^a-z0-9_.-]/gi, "_") || "brain";
  return `${safe}-${date.toISOString().slice(0, 10)}.jsonl`;
}
