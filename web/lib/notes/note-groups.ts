/*
The notes list's sections, as the desktop app draws them
(desktop/src/renderer/features/notes/notes-sidebar.tsx) and mobile
(mobile/src/features/notes/notes-core.ts groupNotes):

  Pinned                      (the All view only)
  Today · Yesterday · Previous 7 Days · Previous 30 Days · <month> · <year>

Sorting by title is one unlabelled section. Pure — no React, no i18n — so it
runs under `node --test`; the page names each section in its own language.
*/

type Dated = { pinned: boolean; updatedAt: string; createdAt?: string }

export type NoteGroupKind = "all" | "pinned" | "today" | "yesterday" | "week" | "month" | "calendarMonth" | "year"

export type NoteGroup<N> = { key: string; kind: NoteGroupKind; notes: N[]; month?: number; year?: number }

const DAY_MS = 86_400_000

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

export function groupNotes<N extends Dated>(
  notes: readonly N[],
  opts: { pinnedFirst: boolean; sort: "updated" | "created" | "title"; now?: number },
): NoteGroup<N>[] {
  if (opts.sort === "title") return notes.length ? [{ key: "all", kind: "all", notes: [...notes] }] : []
  const out: NoteGroup<N>[] = []
  const pinned = opts.pinnedFirst ? notes.filter((n) => n.pinned) : []
  if (pinned.length) out.push({ key: "pinned", kind: "pinned", notes: pinned })
  const rest = pinned.length ? notes.filter((n) => !n.pinned) : notes
  const today = new Date(opts.now ?? Date.now())
  const day0 = dayStart(today)
  const by = new Map<string, NoteGroup<N>>()
  for (const n of rest) {
    const at = new Date(opts.sort === "created" && n.createdAt ? n.createdAt : n.updatedAt)
    const valid = !Number.isNaN(at.getTime())
    const days = valid ? Math.round((day0 - dayStart(at)) / DAY_MS) : Infinity
    let g: Omit<NoteGroup<N>, "notes">
    if (days <= 0) g = { key: "today", kind: "today" }
    else if (days === 1) g = { key: "yesterday", kind: "yesterday" }
    else if (days < 7) g = { key: "week", kind: "week" }
    else if (days < 30) g = { key: "month", kind: "month" }
    else if (valid && at.getFullYear() === today.getFullYear()) g = { key: `m${at.getMonth()}`, kind: "calendarMonth", month: at.getMonth(), year: at.getFullYear() }
    else g = { key: `y${valid ? at.getFullYear() : 0}`, kind: "year", year: valid ? at.getFullYear() : undefined }
    let group = by.get(g.key)
    if (!group) {
      group = { ...g, notes: [] }
      by.set(g.key, group)
      out.push(group)
    }
    group.notes.push(n)
  }
  return out
}

/**
 * The row's trailing date, the way Notes and Mail write it: the time today,
 * "Yesterday", the weekday this week, else a short date.
 */
export function listDate(iso: string, locale: string, yesterday: string, now: number = Date.now()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const diff = Math.round((dayStart(new Date(now)) - dayStart(d)) / DAY_MS)
  if (diff <= 0) return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
  if (diff === 1) return yesterday
  if (diff < 7) return d.toLocaleDateString(locale, { weekday: "long" })
  return d.toLocaleDateString(locale, { day: "numeric", month: "numeric", year: "2-digit" })
}

/** The row's second line: the description, else the body as plain text. */
export function rowSnippet(n: { description?: string; body?: string }, max = 140): string {
  const d = (n.description ?? "").trim()
  if (d) return d.slice(0, max)
  return (n.body ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    // Markdown escapes ("\[", "\_") read as their character.
    .replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*`~|]|\[\[|\]\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
}
