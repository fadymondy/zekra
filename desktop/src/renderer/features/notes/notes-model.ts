import type { Note, NotePage } from "../../lib/api";

/*
Pure notes-list logic for the desktop workspace. Ported from
mobile/src/features/notes/notes-core.ts (MH-362/363/364) rather than imported:
that file imports its Note type from "@/lib/api", which in the desktop's
tsconfig resolves to the WEB api module (no Note export), so importing it here
would fail the typecheck. The rules are identical — keep the two in step.
*/

export type NoteFilter = "all" | "pinned" | "archived";
export type NoteSort = "updated" | "created" | "title";
export type NoteView = { filter: NoteFilter; sort: NoteSort; q: string };

export const NOTE_FILTERS: NoteFilter[] = ["all", "pinned", "archived"];
export const NOTE_SORTS: NoteSort[] = ["updated", "created", "title"];

/** A note as the list may carry it (the server adds `deleted` on some routes). */
type Listed = Note & { deleted?: boolean };

/**
 * Query-string values for one list view (GET /api/notes).
 *
 * The server's `archived=1` means "INCLUDE archived notes", not "only
 * archived" — so the Archived view asks for everything and keeps the archived
 * ones client-side (see matchesFilter). `pinned=1` really is pinned-only.
 */
export function listParams(namespace: string, view: NoteView, cursor?: string): Record<string, string> {
  const limit = view.filter === "archived" ? 200 : 50;
  const out: Record<string, string> = { namespace, limit: String(limit) };
  if (view.q) out.q = view.q;
  if (view.filter === "pinned") out.pinned = "1";
  if (view.filter === "archived") out.archived = "1";
  if (view.sort !== "updated") out.sort = view.sort;
  if (cursor) out.cursor = cursor;
  return out;
}

export function queryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

/** Whether a note belongs in a view — applied locally so an optimistic
 *  pin/archive moves the row before the refetch lands. */
export function matchesFilter(note: Pick<Listed, "pinned" | "archived" | "deleted">, filter: NoteFilter): boolean {
  if (note.deleted) return false;
  if (filter === "archived") return note.archived;
  if (note.archived) return false;
  return filter === "pinned" ? note.pinned : true;
}

/** Loaded pages -> rows: de-duplicated, filtered to the view, pinned first
 *  (the server already orders that way for "updated"; the other sorts are
 *  re-stated here so an optimistic pin moves the row immediately). */
export function visibleNotes(pages: readonly NotePage[], filter: NoteFilter): Note[] {
  const seen = new Set<string>();
  const out: Note[] = [];
  for (const page of pages) {
    for (const note of page.notes ?? []) {
      if (seen.has(note.id)) continue;
      seen.add(note.id);
      if (matchesFilter(note as Listed, filter)) out.push(note);
    }
  }
  // Stable partition: pinned first, server order otherwise.
  return [...out.filter((n) => n.pinned), ...out.filter((n) => !n.pinned)];
}

/** Replace a changed note in loaded pages (drop it if it left the view). */
export function applyNote(pages: readonly NotePage[], note: Note, filter: NoteFilter): NotePage[] {
  const keep = matchesFilter(note as Listed, filter);
  return pages.map((page) => {
    if (!page.notes?.some((n) => n.id === note.id)) return page;
    return {
      ...page,
      notes: keep ? page.notes.map((n) => (n.id === note.id ? note : n)) : page.notes.filter((n) => n.id !== note.id),
    };
  });
}

/** Put a brand-new note at the top of the first page. */
export function prependNote(pages: readonly NotePage[], note: Note, filter: NoteFilter): NotePage[] {
  if (!matchesFilter(note as Listed, filter)) return pages.slice();
  if (!pages.length) return [{ notes: [note] }];
  const [first, ...rest] = pages;
  return [{ ...first, notes: [note, ...(first.notes ?? []).filter((n) => n.id !== note.id)] }, ...rest];
}

export function removeNote(pages: readonly NotePage[], id: string): NotePage[] {
  return pages.map((page) => (page.notes?.some((n) => n.id === id) ? { ...page, notes: page.notes.filter((n) => n.id !== id) } : page));
}

// ─── Text ───────────────────────────────────────────────────────────────────

/** Markdown to one line of readable text, for the row snippet. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[^\n]*\n?/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) => label || target)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
    .replace(/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+/gm, "")
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, "")
    .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, " ")
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/gm, " ")
    .replace(/\|/g, " ")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/[*`]+/g, "")
    .replace(/(^|[\s(])_+(?=\S)/g, "$1")
    .replace(/(\S)_+(?=[\s).,!?:;]|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** The row preview. Bodies can be large, so only the head is read. */
export function snippet(body: string | undefined, max = 180): string {
  if (!body) return "";
  const text = stripMarkdown(body.slice(0, 1600));
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** What Copy hands over: the note as a markdown document. */
export function noteMarkdown(note: Pick<Note, "title" | "body">): string {
  const body = (note.body ?? "").trimEnd();
  const title = note.title.trim();
  if (!title) return body;
  return body ? `# ${title}\n\n${body}` : `# ${title}`;
}

/** Words and characters, as the status bar shows them. */
export function textStats(body: string): { words: number; chars: number } {
  return { words: body.trim().match(/\S+/g)?.length ?? 0, chars: body.length };
}

// ─── Time ───────────────────────────────────────────────────────────────────

export type Ago = { unit: "now" | "m" | "h" | "d"; n: number } | { unit: "date"; n: 0 };

/** Compact age of a timestamp; a week or older reads as a date instead. */
export function ago(iso: string, now: number = Date.now()): Ago {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return { unit: "date", n: 0 };
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return { unit: "now", n: 0 };
  if (s < 3600) return { unit: "m", n: Math.floor(s / 60) };
  if (s < 86400) return { unit: "h", n: Math.floor(s / 3600) };
  if (s < 7 * 86400) return { unit: "d", n: Math.floor(s / 86400) };
  return { unit: "date", n: 0 };
}
