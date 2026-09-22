/*
Category -> icon NAME and colour. Data only, no imports.

Split out of note-icon.ts so mobile can share it. That file binds icon names to
lucide-react components, which is a web package; React Native needs
lucide-react-native. The mapping itself — which category means which icon and
what colour — is the part worth having in one place, and it is just data.

Icon names are lucide's, in PascalCase minus the "Icon" suffix, so each
platform can look them up in its own package.
*/

export interface CategoryIconSpec {
  /** A lucide icon name, e.g. "Rocket" for RocketIcon / Rocket. */
  icon: string
  /** A literal colour for curated types; unknown ones get a hashed hue. */
  color: string
}

/**
 * The entity vocabulary the brains actually use. Colours are mid-lightness and
 * moderate chroma so they stay legible on both the light parchment and the
 * dark navy card.
 */
export const CATEGORY_ICONS: Record<string, CategoryIconSpec> = {
  note: { icon: "StickyNote", color: "var(--grid-muted)" },
  doc: { icon: "FileText", color: "#519aba" },
  document: { icon: "FileText", color: "#519aba" },

  venture: { icon: "Rocket", color: "#e2661c" },
  portfolio: { icon: "Briefcase", color: "#b0742a" },
  person: { icon: "Users", color: "#3d7cae" },
  people: { icon: "Users", color: "#3d7cae" },
  agent: { icon: "Brain", color: "#6d4de6" },

  issue: { icon: "Bug", color: "#d9455f" },
  bug: { icon: "Bug", color: "#d9455f" },
  task: { icon: "CircleCheck", color: "#4e9a3e" },
  goal: { icon: "Target", color: "#c9a227" },
  roadmap: { icon: "Flag", color: "#8250df" },
  release: { icon: "Rocket", color: "#0891a0" },

  learning: { icon: "GraduationCap", color: "#2f9e8f" },
  decision: { icon: "Lightbulb", color: "#c9a227" },
  research: { icon: "BookOpen", color: "#7e63c4" },
  post: { icon: "Megaphone", color: "#d9455f" },
  meeting: { icon: "Calendar", color: "#6e7781" },
}

/** The mark for a category with no curated entry. */
export const FALLBACK_ICON = "FileText"

/**
 * Normalise so "Venture", "ventures" and "venture" agree.
 *
 * De-pluralisation is deliberately naive and only applies when the singular is
 * curated — "issue" and "issues" showing different icons reads as a bug, but
 * "status" must not become "statu".
 */
export function categoryKey(category: string | null | undefined): string {
  const c = (category ?? "").trim().toLowerCase()
  if (!c) return "note"
  if (c.endsWith("s") && CATEGORY_ICONS[c.slice(0, -1)]) return c.slice(0, -1)
  return c
}

export function categoryIconSpec(category: string | null | undefined): CategoryIconSpec | undefined {
  return CATEGORY_ICONS[categoryKey(category)]
}

export function isCuratedCategory(category: string | null | undefined): boolean {
  return categoryKey(category) in CATEGORY_ICONS
}

/*
Resolve a note's appearance, override first.

The server stores icon/color as "" when there is no override (MH-308), so an
empty string must fall through to the derived value rather than being treated
as a choice — a note whose override was cleared has to go back to looking like
its category, not lose its icon entirely.
*/
export interface NoteAppearance {
  /** Icon override, or "" to derive. */
  icon?: string
  /** Colour override, or "" to derive. */
  color?: string
  category?: string | null
}

/** The icon name to render: the override when set and known, else derived. */
export function resolveIconName(note: NoteAppearance): string {
  const override = (note.icon ?? "").trim()
  // An unknown override is ignored rather than rendered as a blank: the server
  // validates, but a note written by an older client or a direct API call can
  // still carry something this build does not know.
  if (override && CATEGORY_ICON_NAMES.has(override)) return override
  return categoryIconSpec(note.category)?.icon ?? FALLBACK_ICON
}

/** The colour override, if any. Callers supply their own derived fallback. */
export function resolveColorOverride(note: NoteAppearance): string | undefined {
  const override = (note.color ?? "").trim()
  return override || undefined
}

/** Every icon name this build can render, for validating an override. */
export const CATEGORY_ICON_NAMES: ReadonlySet<string> = new Set([
  ...Object.values(CATEGORY_ICONS).map((s) => s.icon),
  FALLBACK_ICON,
])
