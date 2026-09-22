package brain

import "testing"

/*
These guard a contract that spans two languages: the icon names here must match
web/lib/notes/note-icon-map.ts, because a name the renderers cannot resolve
falls back to the generic mark and the user's choice silently disappears.
*/

func TestValidNoteIconAcceptsEmptyMeaningDerive(t *testing.T) {
	if !ValidNoteIcon("") {
		t.Error(`"" must be valid — it means "derive from category"`)
	}
	if !ValidNoteColor("") {
		t.Error(`"" must be valid for colour too`)
	}
}

func TestValidNoteIconRejectsUnknownNames(t *testing.T) {
	for _, icon := range []string{"NotAnIcon", "stickynote", "<script>", "Rocket "} {
		if ValidNoteIcon(icon) {
			t.Errorf("icon %q was accepted", icon)
		}
	}
}

func TestValidNoteIconAcceptsEveryNameItAdvertises(t *testing.T) {
	// A picker built from NoteIconNames must not offer something the validator
	// then refuses.
	for _, icon := range NoteIconNames() {
		if !ValidNoteIcon(icon) {
			t.Errorf("advertised icon %q is rejected by the validator", icon)
		}
	}
}

func TestValidNoteColorIsCaseInsensitive(t *testing.T) {
	// A browser colour input reports uppercase hex.
	if !ValidNoteColor("#6D4DE6") {
		t.Error("uppercase hex rejected; a colour input would fail")
	}
	if !ValidNoteColor("#6d4de6") {
		t.Error("lowercase hex rejected")
	}
}

func TestValidNoteColorRejectsArbitraryValues(t *testing.T) {
	// The point of the fixed set: a free colour can be unreadable in one of
	// the 25 reading themes.
	for _, c := range []string{"#123456", "red", "rgb(1,2,3)", "#fff", ""} {
		if c == "" {
			continue
		}
		if ValidNoteColor(c) {
			t.Errorf("colour %q was accepted", c)
		}
	}
}

func TestNoteColorsAreAllAccepted(t *testing.T) {
	for _, c := range NoteColors() {
		if !ValidNoteColor(c) {
			t.Errorf("advertised colour %q is rejected by the validator", c)
		}
	}
}
