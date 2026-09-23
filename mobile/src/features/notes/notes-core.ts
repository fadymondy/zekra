import type { Note, NotePage } from "@/lib/api";

/*
Pure logic for the notes list (MH-362/363/364). No React Native imports, so it
runs under `node --test` (notes-core.test.ts) as well as in the app. The only
import is a type, which type-stripping erases.
*/

// ─── Views ──────────────────────────────────────────────────────────────────

export type NoteFilter = "all" | "pinned" | "archived";
export type NoteSort = "updated" | "created" | "title";
export type NoteView = { filter: NoteFilter; sort: NoteSort; q: string };

/**
 * Query-string values for one list view (GET /api/notes).
 *
 * The server's `archived=1` means "browse mode: INCLUDE archived notes", not
 * "only archived" — so the Archived view asks for everything and keeps the
 * archived ones client-side (see visibleNotes). `pinned=1` really is
 * pinned-only, and the server excludes archived notes from it by default.
 */
export function listParams(namespace: string, view: NoteView, cursor?: string): Record<string, string> {
  // The Archived view discards the active notes it is sent, so it reads in the
  // server's largest pages (200) to reach the archived ones in fewer requests.
  const limit = view.filter === "archived" ? 200 : 40;
  const out: Record<string, string> = { namespace, limit: String(limit) };
  if (view.q) out.q = view.q;
  if (view.filter === "pinned") out.pinned = "1";
  if (view.filter === "archived") out.archived = "1";
  // "updated" is the server default (pinned first, then newest).
  if (view.sort !== "updated") out.sort = view.sort;
  if (cursor) out.cursor = cursor;
  return out;
}

export function queryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

/** Whether a note belongs in a view — the server's rules, applied locally so an
 *  optimistic pin/archive moves the row before the refetch lands. */
export function matchesFilter(note: Pick<Note, "pinned" | "archived" | "deleted">, filter: NoteFilter): boolean {
  if (note.deleted) return false;
  if (filter === "archived") return note.archived;
  if (note.archived) return false;
  return filter === "pinned" ? note.pinned : true;
}

/** Flatten loaded pages into rows: de-duplicated by id (an optimistic insert can
 *  briefly meet its refetched copy) and filtered to the view. */
export function visibleNotes(pages: readonly NotePage[], filter: NoteFilter): Note[] {
  const seen = new Set<string>();
  const out: Note[] = [];
  for (const page of pages) {
    for (const note of page.notes ?? []) {
      if (seen.has(note.id)) continue;
      seen.add(note.id);
      if (matchesFilter(note, filter)) out.push(note);
    }
  }
  return out;
}

/** Put a changed note into loaded pages: replaced in place when it still
 *  belongs to the view, dropped when it no longer does. */
export function applyNote(pages: readonly NotePage[], note: Note, filter: NoteFilter): NotePage[] {
  const keep = matchesFilter(note, filter);
  return pages.map((page) => {
    if (!page.notes?.some((n) => n.id === note.id)) return page;
    return {
      ...page,
      notes: keep ? page.notes.map((n) => (n.id === note.id ? note : n)) : page.notes.filter((n) => n.id !== note.id),
    };
  });
}

export function removeNote(pages: readonly NotePage[], id: string): NotePage[] {
  return pages.map((page) => (page.notes?.some((n) => n.id === id) ? { ...page, notes: page.notes.filter((n) => n.id !== id) } : page));
}

export function findNote(pages: readonly NotePage[], id: string): Note | undefined {
  for (const page of pages) {
    const hit = page.notes?.find((n) => n.id === id);
    if (hit) return hit;
  }
  return undefined;
}

// ─── Text ───────────────────────────────────────────────────────────────────

/**
 * Markdown to one line of readable text, for the row snippet. Deliberately a
 * light regex pass rather than a parser: it only has to read well in two
 * lines, and it runs once per visible row.
 */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[^\n]*\n?/g, " ") // fence markers (keep the code itself)
    .replace(/<[^>]+>/g, " ") // inline HTML
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images -> alt text
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) => label || target) // wiki links
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links -> text
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "") // headings
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "") // blockquotes
    .replace(/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+/gm, "") // task items
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, "") // list markers
    .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, " ") // horizontal rules
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/gm, " ") // table separators
    .replace(/\|/g, " ")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/[*`]+/g, "")
    // A lone underscore is emphasis only at a word edge; snake_case survives.
    .replace(/(^|[\s(])_+(?=\S)/g, "$1")
    .replace(/(\S)_+(?=[\s).,!?:;]|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** The two-line row preview. Bodies can be large, so only the head is read. */
export function snippet(body: string | undefined, max = 220): string {
  if (!body) return "";
  const text = stripMarkdown(body.slice(0, 1600));
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** What Copy and Share hand over: the note as a markdown document. */
export function noteMarkdown(note: Pick<Note, "title" | "body">): string {
  const body = (note.body ?? "").trimEnd();
  const title = note.title.trim();
  if (!title) return body;
  return body ? `# ${title}\n\n${body}` : `# ${title}`;
}

// ─── Time ───────────────────────────────────────────────────────────────────

export type Ago = { unit: "now" | "m" | "h" | "d"; n: number } | { unit: "date"; n: 0 };

/** Compact age of a timestamp; a week or older reads as a date instead. */
export function ago(iso: string, now: number = Date.now()): Ago {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return { unit: "date", n: 0 };
  // Clock skew can put a fresh write slightly in the future; that is "now".
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return { unit: "now", n: 0 };
  if (s < 3600) return { unit: "m", n: Math.floor(s / 60) };
  if (s < 86400) return { unit: "h", n: Math.floor(s / 3600) };
  if (s < 7 * 86400) return { unit: "d", n: Math.floor(s / 86400) };
  return { unit: "date", n: 0 };
}

// ─── Swipe geometry ─────────────────────────────────────────────────────────

/*
ReanimatedSwipeable speaks in PHYSICAL sides (renderLeftActions /
renderRightActions, and an open "direction" that names where the row
travelled). The product speaks in logical edges: the start edge pins, the end
edge archives and deletes. Our layout direction comes from the root view's
`direction` style, while I18nManager.isRTL only catches up on the next launch —
so the mapping is done here from the app's own isRtl, never from I18nManager.
*/

export type Edge = "start" | "end";
export type Physical = "left" | "right";

export function physicalOf(edge: Edge, isRtl: boolean): Physical {
  return (edge === "start") !== isRtl ? "left" : "right";
}

export function edgeOf(physical: Physical, isRtl: boolean): Edge {
  return (physical === "left") !== isRtl ? "start" : "end";
}

/** The library reports the direction the row TRAVELLED: travelling right
 *  uncovers the left panel. */
export function edgeFromTravel(direction: "left" | "right", isRtl: boolean): Edge {
  return edgeOf(direction === "right" ? "left" : "right", isRtl);
}

/**
 * Order a panel's buttons left-to-right. Buttons are declared inner-to-outer
 * (the inner one touches the row; the outer one sits at the screen edge and is
 * the full-swipe action). Panels are rendered with an explicit LTR direction,
 * so the order is set here and never mirrored a second time by layout.
 */
export function physicalOrder<T>(innerToOuter: readonly T[], physical: Physical): T[] {
  return physical === "left" ? [...innerToOuter].reverse() : [...innerToOuter];
}

/** Past this travel a release fires the panel's outer action instead of just
 *  leaving the buttons open. Runs on the UI thread. */
export function fullSwipeArmed(travel: number, panelWidth: number, rowWidth: number): boolean {
  "worklet";
  if (panelWidth <= 0 || travel <= 0) return false;
  return travel >= Math.max(panelWidth + 64, rowWidth * 0.6);
}

// ─── Appearance ─────────────────────────────────────────────────────────────

/*
The icon and colour overrides the server accepts (MH-308,
plugins/brain/internal/brain/note_appearance.go). They are the values of the
shared category map (web/lib/notes/note-icon-map.ts), listed explicitly so the
picker has a stable, deliberate order; notes-core.test.ts pins them to the map.
*/
export const NOTE_ICON_NAMES = [
  "StickyNote",
  "FileText",
  "Rocket",
  "Briefcase",
  "Users",
  "Brain",
  "Bug",
  "CircleCheck",
  "Target",
  "Flag",
  "GraduationCap",
  "Lightbulb",
  "BookOpen",
  "Megaphone",
  "Calendar",
] as const;

export const NOTE_COLORS = [
  "#519aba",
  "#e2661c",
  "#b0742a",
  "#3d7cae",
  "#6d4de6",
  "#d9455f",
  "#4e9a3e",
  "#c9a227",
  "#8250df",
  "#0891a0",
  "#2f9e8f",
  "#7e63c4",
  "#6e7781",
] as const;
