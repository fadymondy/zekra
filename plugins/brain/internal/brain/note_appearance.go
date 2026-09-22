package brain

import "strings"

/*
Per-note icon and colour overrides (MH-308).

Both are optional: "" means "derive from the note's category", which is what
every note did before these existed and still the default. Storing an override
only records a deliberate choice, so nothing needed backfilling.

VALIDATED HERE RATHER THAN BY A CHECK CONSTRAINT, for two reasons: the
vocabulary should be able to grow without a migration, and a rejected value
deserves a message naming what was wrong rather than a constraint violation.

Why a fixed colour set instead of a free hex: the reading themes (25 of them,
light and dark) repaint the whole app, and a user-picked colour that looks
right in GitHub Dark can be invisible in Solarized Light. These are the same
values the derived map uses, so an override can only ever land on a colour the
product already trusts in both modes.
*/

// noteIconNames must stay in step with web/lib/notes/note-icon-map.ts. An icon
// the renderers cannot resolve would silently fall back to the generic mark,
// so an unknown name is rejected at the door instead.
var noteIconNames = map[string]bool{
	"StickyNote": true, "FileText": true, "Rocket": true, "Briefcase": true,
	"Users": true, "Brain": true, "Bug": true, "CircleCheck": true,
	"Target": true, "Flag": true, "GraduationCap": true, "Lightbulb": true,
	"BookOpen": true, "Megaphone": true, "Calendar": true,
}

// noteColors are the curated values from the same map, plus the neutral.
var noteColors = map[string]bool{
	"#519aba": true, "#e2661c": true, "#b0742a": true, "#3d7cae": true,
	"#6d4de6": true, "#d9455f": true, "#4e9a3e": true, "#c9a227": true,
	"#8250df": true, "#0891a0": true, "#2f9e8f": true, "#7e63c4": true,
	"#6e7781": true,
}

// ValidNoteIcon reports whether an icon override is one the renderers know.
// The empty string is valid and means "derive".
func ValidNoteIcon(icon string) bool {
	if icon == "" {
		return true
	}
	return noteIconNames[icon]
}

// ValidNoteColor reports whether a colour override is in the curated set.
// The empty string is valid and means "derive". Comparison is
// case-insensitive so "#6D4DE6" from a colour input is accepted.
func ValidNoteColor(color string) bool {
	if color == "" {
		return true
	}
	return noteColors[strings.ToLower(color)]
}

// NoteIconNames lists the icons a client may offer, for building a picker.
func NoteIconNames() []string {
	out := make([]string, 0, len(noteIconNames))
	for name := range noteIconNames {
		out = append(out, name)
	}
	return out
}

// NoteColors lists the colours a client may offer.
func NoteColors() []string {
	out := make([]string, 0, len(noteColors))
	for c := range noteColors {
		out = append(out, c)
	}
	return out
}
