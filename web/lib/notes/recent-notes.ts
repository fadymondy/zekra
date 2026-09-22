/*
Recently opened notes, for the spotlight's RECENT section.

Local to the browser on purpose: "recent" means recent *here*, and a
server-side list would surface notes opened on another device, which is not
what the section promises. It is also not worth a write per note open.

Kept out of the component so it can be tested without a DOM.
*/

export interface RecentNote {
  id: string
  namespace: string
  title: string
  /** Drives the derived icon (MH-264); absent on entries stored before it. */
  category?: string
  /** Epoch ms, for ordering. */
  at: number
}

const KEY = "zekra.recent-notes"
/** Enough to fill the section without turning the spotlight into a history. */
export const MAX_RECENT = 8

export function coerceRecent(raw: unknown): RecentNote[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (r): r is RecentNote =>
        !!r &&
        typeof r === "object" &&
        typeof (r as RecentNote).id === "string" &&
        !!(r as RecentNote).id &&
        typeof (r as RecentNote).namespace === "string" &&
        Number.isFinite((r as RecentNote).at),
    )
    .map((r) => ({
      ...r,
      title: typeof r.title === "string" ? r.title : "",
      // Entries stored before categories were carried have none; noteIcon()
      // falls back for undefined, so drop anything that is not a real string
      // rather than letting a number or object reach the lookup.
      category: typeof r.category === "string" && r.category ? r.category : undefined,
    }))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_RECENT)
}

export function loadRecent(): RecentNote[] {
  if (typeof localStorage === "undefined") return []
  try {
    return coerceRecent(JSON.parse(localStorage.getItem(KEY) ?? "[]"))
  } catch {
    return []
  }
}

/**
 * Record an open. Re-opening a note moves it to the top rather than adding a
 * duplicate, and a renamed note takes its new title.
 */
export function pushRecent(note: { id: string; namespace: string; title: string; category?: string }): RecentNote[] {
  const next = coerceRecent([
    { ...note, at: Date.now() },
    ...loadRecent().filter((r) => r.id !== note.id),
  ])
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* quota or private mode — recents are not worth failing an open over */
    }
  }
  return next
}

/** Drop a note that no longer exists, so the list cannot rot. */
export function forgetRecent(id: string): RecentNote[] {
  const next = loadRecent().filter((r) => r.id !== id)
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* non-fatal */
    }
  }
  return next
}
