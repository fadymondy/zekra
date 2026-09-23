import type { BrainSource, Customer, FromBrainRequest, PKind, PLocale, PStatus, PStyle, Share } from "./types";

/*
Pure logic for the presentations feature (MH-369): no React, no RN, so it runs
under `node --test` (presentations-core.test.ts). Only type imports above —
node erases them, so the file needs no path aliases at runtime.
*/

export const KINDS: PKind[] = ["deck", "report", "page"];
export const STATUSES: PStatus[] = ["draft", "ready", "archived"];
export const LOCALES: PLocale[] = ["en", "ar"];
export const STYLES: PStyle[] = ["minimal", "bold", "editorial", "tech-dark"];
/** Link lifetimes offered when sharing: 0 = never (the API's own meaning). */
export const EXPIRY_PRESETS = [0, 7, 30, 90] as const;
/** CheckBrainSource: 1–50 note ids. */
export const MAX_SOURCE_NOTES = 50;
/** The label of the link the app opens previews through, so owner previews
 *  never count as views on a link that was sent to the customer. */
export const PREVIEW_LABEL = "Mobile preview";
export const PREVIEW_DAYS = 7;

export function isKind(v: string): v is PKind {
  return (KINDS as string[]).includes(v);
}
export function isLocale(v: string): v is PLocale {
  return v === "en" || v === "ar";
}

// ─── URLs ───────────────────────────────────────────────────────────────────

/**
 * The web console's origin, from the API base. The console and the API are
 * served from one origin in production (https://app.zekra.dev); an API base
 * that carries a path (…/api) or an `api.` host is mapped back to the console.
 */
export function webOriginFrom(apiUrl: string): string {
  const m = /^(https?:\/\/[^/?#]+)/i.exec(apiUrl.trim());
  if (!m) return "https://app.zekra.dev";
  const origin = m[1].replace(/\/$/, "");
  return origin.replace(/^(https?:\/\/)api\./i, "$1app.");
}

/** The web editor for a document (slide content is edited there, not here). */
export function editUrl(webOrigin: string, locale: string, namespace: string, id: string): string {
  const loc = isLocale(locale) ? locale : "en";
  return `${webOrigin}/${loc}/b/${encodeURIComponent(namespace)}/presentations/${encodeURIComponent(id)}`;
}

/**
 * A share URL shown in another language. A link is {origin}/{locale}/p/{token}
 * and the public API serves any locale the document has through any of its
 * tokens (share.go pickLocale), so switching language is a path swap.
 */
export function shareUrlForLocale(url: string, locale: PLocale): string {
  return url.replace(/\/(en|ar)\/p\//, `/${locale}/p/`);
}

/** The file export through a link: {share url}/download/{format} (downloadsFor). */
export function downloadUrl(shareUrl: string, format: string): string {
  return `${shareUrl.replace(/\/$/, "")}/download/${format}`;
}

// ─── Shares ─────────────────────────────────────────────────────────────────

export type ShareState = "active" | "revoked" | "expired";

export function shareState(s: Pick<Share, "active" | "revoked_at">): ShareState {
  if (s.revoked_at) return "revoked";
  return s.active ? "active" : "expired";
}

/** The URL we can show for a link: the API's (recoverable) or one this
 *  session created (a non-recoverable token is only ever shown once). */
export function knownUrl(s: Pick<Share, "id" | "url" | "active">, session: Record<string, string> = {}): string {
  if (!s.active) return "";
  return s.url || session[s.id] || "";
}

/** Active links first; otherwise the API's order (newest first) is kept. */
export function sortShares<S extends Pick<Share, "active" | "revoked_at">>(shares: S[]): S[] {
  const rank = (s: S) => (shareState(s) === "active" ? 0 : 1);
  return shares.map((s, i) => [s, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([s]) => s);
}

/**
 * The link a preview opens: the app's own preview link when one is usable
 * (so the customer's link stats stay clean), else — only if the caller may
 * not create one — any active link whose URL is known. "" = none; a writer
 * should then create a preview link.
 */
export function previewUrl(
  shares: Share[],
  session: Record<string, string>,
  locale: PLocale,
  canWrite: boolean,
): string {
  const usable = shares.filter((s) => knownUrl(s, session));
  const own = usable.find((s) => s.label === PREVIEW_LABEL);
  const pick = own ?? (canWrite ? undefined : usable.find((s) => s.locale === locale) ?? usable[0]);
  return pick ? shareUrlForLocale(knownUrl(pick, session), locale) : "";
}

/** A download URL through an active, known link in that language ("" = none). */
export function downloadVia(shares: Share[], session: Record<string, string>, locale: PLocale, format: string): string {
  const s = shares.find((x) => x.locale === locale && knownUrl(x, session) && x.label !== PREVIEW_LABEL)
    ?? shares.find((x) => knownUrl(x, session));
  return s ? downloadUrl(shareUrlForLocale(knownUrl(s, session), locale), format) : "";
}

// ─── Status, locales, time ─────────────────────────────────────────────────

export type Tone = "muted" | "ok" | "warn";

export function statusTone(status: string): Tone {
  if (status === "ready") return "ok";
  if (status === "archived") return "warn";
  return "muted";
}

/** The language a document still lacks (translate target), or null. */
export function missingLocale(locales: string[] | null | undefined): PLocale | null {
  const have = locales ?? [];
  if (!have.length) return null;
  return LOCALES.find((l) => !have.includes(l)) ?? null;
}

/** Locales in fixed EN, AR order (the API returns them that way too). */
export function orderedLocales(locales: string[] | null | undefined): PLocale[] {
  const have = locales ?? [];
  return LOCALES.filter((l) => have.includes(l));
}

export type Ago = { unit: "now" } | { unit: "m" | "h" | "d"; n: number } | { unit: "date" };

/** Compact relative time: now · 5m · 3h · 2d, then a date. */
export function ago(iso: string | null | undefined, now = Date.now()): Ago | null {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return { unit: "now" };
  if (s < 3600) return { unit: "m", n: Math.floor(s / 60) };
  if (s < 86400) return { unit: "h", n: Math.floor(s / 3600) };
  if (s < 30 * 86400) return { unit: "d", n: Math.floor(s / 86400) };
  return { unit: "date" };
}

export type Expiry = { kind: "never" } | { kind: "past" } | { kind: "today" } | { kind: "days"; n: number };

/** Link expiry: never (null), already past, within a day, or N whole days left. */
export function expiry(expiresAt: string | null | undefined, now = Date.now()): Expiry {
  if (!expiresAt) return { kind: "never" };
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return { kind: "never" };
  const left = at - now;
  if (left <= 0) return { kind: "past" };
  if (left < 86400_000) return { kind: "today" };
  return { kind: "days", n: Math.floor(left / 86400_000) };
}

// ─── List ───────────────────────────────────────────────────────────────────

export type ListFilter = { namespace: string; q?: string; kind?: PKind | "all"; status?: PStatus | "all"; limit?: number };

/** GET /api/presentations query string (empty and "all" values dropped). */
export function listQuery(f: ListFilter): string {
  const params: [string, string][] = [["namespace", f.namespace]];
  const q = f.q?.trim();
  if (q) params.push(["q", q]);
  if (f.kind && f.kind !== "all") params.push(["kind", f.kind]);
  if (f.status && f.status !== "all") params.push(["status", f.status]);
  if (f.limit) params.push(["limit", String(f.limit)]);
  return "?" + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

export function customerLine(c: Customer | null | undefined): string {
  if (!c) return "";
  return [c.company, c.name].map((x) => (x ?? "").trim()).filter(Boolean).join(" · ");
}

// ─── Create from brain ─────────────────────────────────────────────────────

export type SourceMode = "namespace" | "query" | "notes";

export type FromBrainForm = {
  mode: SourceMode;
  q: string;
  noteIds: string[];
  kinds: PKind[];
  locale: PLocale;
  name: string;
  company: string;
  email: string;
  title: string;
  style: PStyle;
};

export type FormProblem = "notes" | "query" | "kinds" | "customer" | "email";

/** Client-side checks mirroring CheckBrainSource + the web's customer rule. */
export function formProblems(f: FromBrainForm): FormProblem[] {
  const out: FormProblem[] = [];
  if (f.mode === "notes" && (f.noteIds.length === 0 || f.noteIds.length > MAX_SOURCE_NOTES)) out.push("notes");
  if (f.mode === "query" && !f.q.trim()) out.push("query");
  if (!f.kinds.length) out.push("kinds");
  if (!f.name.trim() && !f.company.trim()) out.push("customer");
  if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) out.push("email");
  return out;
}

/** The POST /api/presentations/from-brain body. `style` rides only with a page. */
export function fromBrainBody(namespace: string, f: FromBrainForm): FromBrainRequest {
  const source: BrainSource =
    f.mode === "notes" ? { kind: "notes", ids: f.noteIds.slice(0, MAX_SOURCE_NOTES) }
    : f.mode === "query" ? { kind: "query", q: f.q.trim() }
    : { kind: "namespace" };
  const customer: Customer = { name: f.name.trim(), company: f.company.trim() };
  if (f.email.trim()) customer.email = f.email.trim();
  const body: FromBrainRequest = {
    namespace,
    source,
    kinds: KINDS.filter((k) => f.kinds.includes(k)),
    locale: f.locale,
    customer,
  };
  if (f.title.trim()) body.title = f.title.trim();
  if (f.kinds.includes("page")) body.style = f.style;
  return body;
}

/** Add or remove an id, never past the cap. */
export function toggleId(list: string[], id: string, cap = MAX_SOURCE_NOTES): string[] {
  if (list.includes(id)) return list.filter((x) => x !== id);
  return list.length >= cap ? list : [...list, id];
}

export function toggleKind(list: PKind[], kind: PKind): PKind[] {
  return list.includes(kind) ? list.filter((k) => k !== kind) : KINDS.filter((k) => k === kind || list.includes(k));
}

// ─── Errors ─────────────────────────────────────────────────────────────────

/**
 * Messages from an error payload: writePresErr's 422 shapes —
 * {error:{code,message}, detail, errors:[{path,message,hint}]} — and the
 * plain apiErr {error:{code,message}}. Field errors come as "path: message".
 */
export function errorMessages(payload: unknown, fallback: string): string[] {
  const v = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const out: string[] = [];
  const err = v.error;
  if (typeof err === "string") out.push(err);
  else if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") out.push((err as { message: string }).message);
  else if (typeof v.detail === "string") out.push(v.detail);
  if (Array.isArray(v.errors)) {
    for (const fe of v.errors) {
      if (!fe || typeof fe !== "object") continue;
      const { path, message } = fe as { path?: unknown; message?: unknown };
      if (typeof message !== "string") continue;
      out.push(typeof path === "string" && path ? `${path}: ${message}` : message);
    }
  }
  return out.length ? out : [fallback];
}

/** A file name for a downloaded export. */
export function exportFileName(title: string, locale: string, format: string): string {
  const base = title
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "presentation";
  return `${base}-${locale}.${format}`;
}
