// Wire types for the presentations API, modelled on the Go structs' JSON tags
// (plugins/brain/presentations/{store.go,share.go,api.go,frombrain.go}).
// Types only (no values), so presentations-core.ts can `import type` it and
// still run under node --test, where type-only imports are erased.

export type PKind = "deck" | "report" | "page";
export type PStatus = "draft" | "ready" | "archived";
export type PLocale = "en" | "ar";
export type PStyle = "minimal" | "bold" | "editorial" | "tech-dark";

/** presentations.PresentationCustomer */
export type Customer = { name: string; company: string; email?: string };

/** presentations.PresentationSummary — a list row (no content). */
export type Summary = {
  id: string;
  namespace: string;
  owner_user_id: string;
  kind: PKind | string;
  title: string;
  customer: Customer;
  locale: PLocale | string;
  /** Locales that have content; null when none (Go nil slice). */
  locales: (PLocale | string)[] | null;
  status: PStatus | string;
  /** "" for deck/report; a page style otherwise. */
  style: string;
  view_count: number;
  download_count: number;
  last_viewed_at: string | null;
  active_shares: number;
  updated_at: string;
};

/** presentations.PresentationShare — one link as the owner sees it. */
export type Share = {
  id: string;
  presentation_id: string;
  label: string;
  locale: PLocale | string;
  /** First 4 characters of the token. */
  hint: string;
  /** Set only when the link is active AND recoverable. */
  url: string;
  recoverable: boolean;
  domain_id: string;
  domain: string;
  /** null = never expires. */
  expires_at: string | null;
  /** null = not revoked. */
  revoked_at: string | null;
  active: boolean;
  view_count: number;
  download_count: number;
  last_viewed_at: string | null;
  created_at: string;
};

/** presentations.PresentationDetail (Presentation + shares + formats). */
export type Detail = Omit<Summary, "updated_at"> & {
  created_by: string;
  content: Record<string, Record<string, unknown>>;
  translations: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  shares: Share[] | null;
  /** "pdf" for decks, "pdf"+"docx" for reports, null for pages. */
  formats: string[] | null;
};

/** POST /{id}/share and /shares/{share}/reissue (201). */
export type ShareCreated = {
  share: Share;
  token: string;
  url: string;
  recoverable: boolean;
  downloads: Record<string, string>;
  /** reissue only: the id of the link it replaced. */
  revoked?: string;
};

/** POST /{id}/export. */
export type ExportAnswer = {
  ok: boolean;
  share_url: string;
  created_link: boolean;
  customer_downloads: Record<string, string>;
  owner_downloads: Record<string, string>;
};

/** presentations.BrainSource */
export type BrainSource =
  | { kind: "notes"; ids: string[] }
  | { kind: "query"; q: string; limit?: number }
  | { kind: "entity"; id: string }
  | { kind: "namespace" };

/** presentations.FromBrainRequest */
export type FromBrainRequest = {
  namespace: string;
  source: BrainSource;
  customer?: Customer;
  title?: string;
  locale?: PLocale;
  kinds?: PKind[];
  style?: PStyle;
};

export type FromBrainAnswer = {
  ok: boolean;
  documents: { id: string; kind: PKind; title: string; status: PStatus }[];
  status: string;
  sources: { kind: string; ref: string; title: string; text?: string; group?: string }[] | null;
  enrich_next: string[];
};

/** PATCH /api/presentations/{id} — presentations.PresentationInput (partial). */
export type PresentationPatch = {
  title?: string;
  status?: PStatus;
  style?: PStyle;
  customer?: Customer;
};
