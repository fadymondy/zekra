import {
  BookOpen,
  Brain,
  Briefcase,
  Bug,
  Calendar,
  CircleCheck,
  FileText,
  Flag,
  GraduationCap,
  Lightbulb,
  Megaphone,
  Rocket,
  StickyNote,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react-native";

import { categoryIconSpec, categoryKey, FALLBACK_ICON } from "@shared/notes/note-icon-map";

/*
The React Native binding of the shared category map.

The MAPPING — which category means which icon and colour — lives in
web/lib/notes/note-icon-map.ts and is imported, not copied, so a venture looks
like a venture on every surface. Only the icon COMPONENTS differ: web binds
lucide-react, this binds lucide-react-native.

Two adjustments the map cannot make for us:
  - `var(--grid-muted)` is a CSS variable and means nothing to RN, so the
    default note colour resolves against the mobile palette instead.
  - uncurated categories get a hashed hue. Web borrows categoryColor(), which
    emits oklch(); RN's StyleSheet does not parse oklch, so the same hash is
    rendered as hsl() here.
*/

const COMPONENTS: Record<string, LucideIcon> = {
  StickyNote,
  FileText,
  Rocket,
  Briefcase,
  Users,
  Brain,
  Bug,
  CircleCheck,
  Target,
  Flag,
  GraduationCap,
  Lightbulb,
  BookOpen,
  Megaphone,
  Calendar,
};

export interface NoteIcon {
  Icon: LucideIcon;
  color: string;
}

/**
 * Same FNV-1a hash the web uses, so a category lands on the same hue — but
 * emitted as hsl(), which React Native can parse. oklch() cannot be used here.
 */
function hashedHue(name: string): string {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619) >>> 0;
  return `hsl(${h % 360}, 45%, 58%)`;
}

/**
 * @param mutedColor the caller's palette.muted — passed in rather than read
 *   from the theme module, whose light/dark tables are private and whose hook
 *   cannot be called outside a component.
 */
export function noteIcon(category: string | null | undefined, mutedColor: string): NoteIcon {
  const spec = categoryIconSpec(category);
  if (spec) {
    // The one CSS variable in the shared map; everything else is a literal.
    const color = spec.color.startsWith("var(") ? mutedColor : spec.color;
    return { Icon: COMPONENTS[spec.icon] ?? FileText, color };
  }
  return { Icon: COMPONENTS[FALLBACK_ICON], color: hashedHue(categoryKey(category)) };
}
