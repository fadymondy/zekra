/*
Icon and colour for a note, derived from its category.

MIRRORS mark-it-down's model (packages/ui-tokens/src/file-icons.ts), which the
user asked for explicitly: a curated lookup keyed on a type, plus a generic
fallback for anything unknown. mark-it-down keys on file extension; Zekra has
no files, and Note.Category IS the type key — it holds the entity type of the
note's graph node, with "" meaning "note".

Nothing is stored per note, so there is no migration and no way for the icon to
drift from the note's actual type. A per-note override could be layered on top
later without changing any of this.

Colour falls through to categoryColor()'s hashed hue for uncurated categories,
which is what the app already used and is stable per name. Curated entries
exist so the types people actually see every day are recognisable rather than
arbitrary.
*/

import {
  BookOpenIcon,
  BrainIcon,
  BriefcaseIcon,
  BugIcon,
  CalendarIcon,
  CircleCheckIcon,
  FileTextIcon,
  FlagIcon,
  GraduationCapIcon,
  LightbulbIcon,
  MegaphoneIcon,
  RocketIcon,
  StickyNoteIcon,
  TargetIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"

import { categoryColor } from "../../components/graph/colors.ts"

export interface NoteIcon {
  Icon: LucideIcon
  /** A CSS colour: a curated hex, or the hashed hue for unknown categories. */
  color: string
}

/**
 * Curated types, chosen from the entity vocabulary the brains actually use
 * (ventures, people, agents, issues, posts, roadmaps, releases, goals,
 * learnings). Colours are picked to stay legible on both the light parchment
 * and the dark navy card — mid-lightness, moderate chroma.
 */
const BY_CATEGORY: Record<string, NoteIcon> = {
  note: { Icon: StickyNoteIcon, color: "var(--grid-muted)" },
  doc: { Icon: FileTextIcon, color: "#519aba" },
  document: { Icon: FileTextIcon, color: "#519aba" },

  venture: { Icon: RocketIcon, color: "#e2661c" },
  portfolio: { Icon: BriefcaseIcon, color: "#b0742a" },
  person: { Icon: UsersIcon, color: "#3d7cae" },
  people: { Icon: UsersIcon, color: "#3d7cae" },
  agent: { Icon: BrainIcon, color: "#6d4de6" },

  issue: { Icon: BugIcon, color: "#d9455f" },
  bug: { Icon: BugIcon, color: "#d9455f" },
  task: { Icon: CircleCheckIcon, color: "#4e9a3e" },
  goal: { Icon: TargetIcon, color: "#c9a227" },
  roadmap: { Icon: FlagIcon, color: "#8250df" },
  release: { Icon: RocketIcon, color: "#0891a0" },

  learning: { Icon: GraduationCapIcon, color: "#2f9e8f" },
  decision: { Icon: LightbulbIcon, color: "#c9a227" },
  research: { Icon: BookOpenIcon, color: "#7e63c4" },
  post: { Icon: MegaphoneIcon, color: "#d9455f" },
  meeting: { Icon: CalendarIcon, color: "#6e7781" },
}

/** Normalise so "Venture", "ventures" and "venture" agree. */
function key(category: string | null | undefined): string {
  const c = (category ?? "").trim().toLowerCase()
  if (!c) return "note"
  // Naive de-pluralisation: the vocabulary is open, and "issues" vs "issue"
  // showing two different icons looks like a bug rather than a distinction.
  if (c.endsWith("s") && BY_CATEGORY[c.slice(0, -1)]) return c.slice(0, -1)
  return c
}

export function noteIcon(category: string | null | undefined): NoteIcon {
  const k = key(category)
  const hit = BY_CATEGORY[k]
  if (hit) return hit
  // Unknown type: generic mark, but keep the hashed colour so distinct
  // categories still read as distinct.
  return { Icon: FileTextIcon, color: categoryColor(k) }
}

/** True when the category has a curated entry rather than a hashed fallback. */
export function isCuratedCategory(category: string | null | undefined): boolean {
  return key(category) in BY_CATEGORY
}
