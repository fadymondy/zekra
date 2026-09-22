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

The MAPPING lives in note-icon-map.ts (data only, no imports) so mobile can
share it; this file is only the web binding of icon names to lucide-react
components. React Native needs lucide-react-native, which is why the split
exists.
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
import { categoryIconSpec, categoryKey, FALLBACK_ICON, isCuratedCategory } from "./note-icon-map.ts"

export { isCuratedCategory }

export interface NoteIcon {
  Icon: LucideIcon
  /** A CSS colour: a curated hex, or the hashed hue for unknown categories. */
  color: string
}

/** Icon name (as used in note-icon-map) -> the lucide-react component. */
const COMPONENTS: Record<string, LucideIcon> = {
  StickyNote: StickyNoteIcon,
  FileText: FileTextIcon,
  Rocket: RocketIcon,
  Briefcase: BriefcaseIcon,
  Users: UsersIcon,
  Brain: BrainIcon,
  Bug: BugIcon,
  CircleCheck: CircleCheckIcon,
  Target: TargetIcon,
  Flag: FlagIcon,
  GraduationCap: GraduationCapIcon,
  Lightbulb: LightbulbIcon,
  BookOpen: BookOpenIcon,
  Megaphone: MegaphoneIcon,
  Calendar: CalendarIcon,
}

export function noteIcon(category: string | null | undefined): NoteIcon {
  const spec = categoryIconSpec(category)
  if (spec) return { Icon: COMPONENTS[spec.icon] ?? FileTextIcon, color: spec.color }
  // Unknown type: generic mark, but keep the hashed colour so distinct
  // categories still read as distinct.
  return { Icon: COMPONENTS[FALLBACK_ICON], color: categoryColor(categoryKey(category)) }
}
