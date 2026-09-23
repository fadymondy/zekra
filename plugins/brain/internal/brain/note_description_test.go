package brain

import (
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

/*
The note description: a short plain-text summary under the title. Pure checks
first (chunking, validation, JSON shape, GitHub front matter), then the
database-backed round trip through the REST surface (create → get → list →
update → versions → restore).
*/

// --- pure --------------------------------------------------------------------------

func TestNoteChunksWithoutDescriptionAreUnchanged(t *testing.T) {
	// Existing notes have no description; their chunk hashes must not move, or
	// every note would be re-embedded on its next save.
	body := "Intro.\n\n## A\n\nalpha\n\n## B\n\nbeta"
	if !reflect.DeepEqual(noteChunksDescribed("Plan", "", body), noteChunks("Plan", body)) {
		t.Fatal("an empty description changed the chunks")
	}
	if !reflect.DeepEqual(noteChunksDescribed("Plan", "   ", body), noteChunks("Plan", body)) {
		t.Fatal("a whitespace-only description changed the chunks")
	}
}

func TestNoteChunksCarryTheDescriptionAfterTheTitle(t *testing.T) {
	got := noteChunksDescribed("Plan", "Q3 launch summary", "Intro.\n\n## A\n\nalpha")
	if len(got) != 2 {
		t.Fatalf("want 2 chunks, got %d: %q", len(got), got)
	}
	for _, c := range got {
		if !strings.HasPrefix(c, "Plan\n\nQ3 launch summary\n\n") {
			t.Errorf("chunk does not lead with title + description: %q", c)
		}
	}
	// A description alone (no title/body) still indexes.
	if got := noteChunksDescribed("", "just a summary", ""); len(got) != 1 || got[0] != "just a summary" {
		t.Errorf("description-only note: %q", got)
	}
	// The header counts against the chunk budget, so the cap still holds.
	long := strings.Repeat(strings.Repeat("word ", 150)+"\n\n", 6)
	desc := strings.Repeat("d", noteMaxDescription)
	for _, c := range noteChunksDescribed("T", desc, long) {
		if n := len([]rune(c)); n > noteChunkMax+10 {
			t.Errorf("chunk of %d runes exceeds the cap", n)
		}
	}
}

func TestValidateNoteDescriptionCountsRunes(t *testing.T) {
	if err := validateNoteDescription(""); err != nil {
		t.Errorf("empty description rejected: %v", err)
	}
	// 500 Arabic letters are 1000 bytes but 500 characters: accepted.
	if err := validateNoteDescription(strings.Repeat("ذ", noteMaxDescription)); err != nil {
		t.Errorf("500-rune description rejected: %v", err)
	}
	err := validateNoteDescription(strings.Repeat("a", noteMaxDescription+1))
	if !errors.Is(err, ErrInvalidInput) || !strings.Contains(err.Error(), "description is longer than 500 characters") {
		t.Errorf("501-rune description: %v", err)
	}
	if got := cleanNoteDescription("  spaced out \n"); got != "spaced out" {
		t.Errorf("trim: %q", got)
	}
}

func TestNoteDescriptionJSONIsOmittedWhenEmpty(t *testing.T) {
	raw, _ := json.Marshal(Note{ID: "x", Title: "t"})
	if strings.Contains(string(raw), `"description"`) {
		t.Errorf("empty description serialised: %s", raw)
	}
	raw, _ = json.Marshal(Note{ID: "x", Title: "t", Description: "d"})
	if !strings.Contains(string(raw), `"description":"d"`) {
		t.Errorf("description missing: %s", raw)
	}
	raw, _ = json.Marshal(NoteVersion{Version: 1, Description: "d"})
	if !strings.Contains(string(raw), `"description":"d"`) {
		t.Errorf("version description missing: %s", raw)
	}
}

func TestRenderNoteWritesDescriptionOnlyWhenSet(t *testing.T) {
	n := testNote("abc", "Launch plan", "Body.")
	if strings.Contains(RenderNote(n), "description:") {
		t.Error("description written for a note without one")
	}
	n.Description = "What we ship: \"v2\"\nand when"
	out := RenderNote(n)
	if !strings.Contains(out, "title: \"Launch plan\"\ndescription: \"What we ship: \\\"v2\\\"\\nand when\"\n") {
		t.Errorf("description front matter wrong:\n%s", out)
	}
}

// --- database ------------------------------------------------------------------------

func TestNoteDescriptionRoundTrip(t *testing.T) {
	f := newFix(t)
	ns := f.ns("desc")

	// Create: trimmed like the title.
	rec := f.do(req{method: "POST", path: "/api/notes", user: "u-alice",
		body: map[string]any{"namespace": ns, "title": "Doc", "description": "  A short summary.  ", "body": "text"}})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	n := noteOf(t, rec.Body.Bytes())
	if n.Description != "A short summary." || n.Version != 1 {
		t.Fatalf("created note description: %q (v%d)", n.Description, n.Version)
	}
	// The description is indexed with the note's text.
	if got := f.count(`SELECT count(*) FROM memories WHERE namespace=$1 AND source_ref=$2 AND invalid_at IS NULL
		AND content LIKE 'Doc' || E'\n\n' || 'A short summary.%'`, ns, noteRef(n.ID, 0)); got != 1 {
		t.Errorf("chunk 0 does not carry the description (%d rows)", got)
	}

	// Get.
	rec = f.do(req{method: "GET", path: "/api/notes/" + n.ID, user: "u-alice"})
	if got := noteOf(t, rec.Body.Bytes()).Description; got != "A short summary." {
		t.Fatalf("get: %q", got)
	}

	// List (browse) carries it, and q= matches it.
	listed := func(path string) []Note {
		t.Helper()
		rec := f.do(req{method: "GET", path: path, user: "u-alice"})
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s: %d %s", path, rec.Code, rec.Body)
		}
		var p NotePage
		_ = json.Unmarshal(rec.Body.Bytes(), &p)
		return p.Notes
	}
	if ns := listed("/api/notes?namespace=" + ns); len(ns) != 1 || ns[0].Description != "A short summary." {
		t.Fatalf("list: %+v", ns)
	}
	if got := listed("/api/notes?namespace=" + ns + "&q=short+summary"); len(got) != 1 {
		t.Fatalf("q did not match the description: %d", len(got))
	}
	// Sync (since=) carries it too.
	if got := listed("/api/notes?namespace=" + ns + "&since=" + url0()); len(got) != 1 || got[0].Description != "A short summary." {
		t.Fatalf("sync: %+v", got)
	}

	// A PUT that omits description keeps it (presence semantics, like icon/color).
	rec = f.do(req{method: "PUT", path: "/api/notes/" + n.ID, user: "u-alice", body: map[string]any{"title": "Doc 2"}})
	if rec.Code != http.StatusOK || noteOf(t, rec.Body.Bytes()).Description != "A short summary." {
		t.Fatalf("PUT without description wiped it: %d %s", rec.Code, rec.Body)
	}
	// So does an explicit null.
	rec = f.do(req{method: "PUT", path: "/api/notes/" + n.ID, user: "u-alice", body: `{"description":null,"pinned":true}`})
	if rec.Code != http.StatusOK || noteOf(t, rec.Body.Bytes()).Description != "A short summary." {
		t.Fatalf("PUT with null description wiped it: %d %s", rec.Code, rec.Body)
	}
	// Setting it replaces it (trimmed); "" clears it.
	rec = f.do(req{method: "PUT", path: "/api/notes/" + n.ID, user: "u-alice", body: map[string]any{"description": " Revised. "}})
	if rec.Code != http.StatusOK || noteOf(t, rec.Body.Bytes()).Description != "Revised." {
		t.Fatalf("PUT description: %d %s", rec.Code, rec.Body)
	}
	rec = f.do(req{method: "PUT", path: "/api/notes/" + n.ID, user: "u-alice", body: map[string]any{"description": ""}})
	cleared := noteOf(t, rec.Body.Bytes())
	if rec.Code != http.StatusOK || cleared.Description != "" || strings.Contains(rec.Body.String(), `"description"`) {
		t.Fatalf("PUT \"\" did not clear it: %d %s", rec.Code, rec.Body)
	}

	// Validation: > 500 characters is a 400 on create and on update, and a
	// rejected update leaves the note untouched.
	long := strings.Repeat("x", noteMaxDescription+1)
	rec = f.do(req{method: "POST", path: "/api/notes", user: "u-alice",
		body: map[string]any{"namespace": ns, "title": "Too long", "description": long}})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "description is longer than 500 characters") {
		t.Fatalf("create with a long description: %d %s", rec.Code, rec.Body)
	}
	rec = f.do(req{method: "PUT", path: "/api/notes/" + n.ID, user: "u-alice", body: map[string]any{"description": long}})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("update with a long description: %d %s", rec.Code, rec.Body)
	}
	rec = f.do(req{method: "GET", path: "/api/notes/" + n.ID, user: "u-alice"})
	if got := noteOf(t, rec.Body.Bytes()); got.Version != cleared.Version {
		t.Fatalf("a rejected update bumped the version: %d → %d", cleared.Version, got.Version)
	}
	// Exactly 500 is fine.
	if rec := f.do(req{method: "PUT", path: "/api/notes/" + n.ID, user: "u-alice",
		body: map[string]any{"description": strings.Repeat("y", noteMaxDescription)}}); rec.Code != http.StatusOK {
		t.Fatalf("500-character description rejected: %d %s", rec.Code, rec.Body)
	}

	// History records the description of every version.
	rec = f.do(req{method: "GET", path: "/api/notes/" + n.ID + "/versions", user: "u-alice"})
	var hist struct {
		Versions []NoteVersion `json:"versions"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &hist)
	byVersion := map[int]string{}
	for _, v := range hist.Versions {
		byVersion[v.Version] = v.Description
	}
	want := map[int]string{1: "A short summary.", 2: "A short summary.", 3: "A short summary.", 4: "Revised.", 5: "",
		6: strings.Repeat("y", noteMaxDescription)}
	if !reflect.DeepEqual(byVersion, want) {
		t.Fatalf("version descriptions: %v", byVersion)
	}

	// Restoring a version restores its description (including clearing one).
	rec = f.do(req{method: "POST", path: "/api/notes/" + n.ID + "/restore", user: "u-alice", body: map[string]any{"version": 4}})
	if rec.Code != http.StatusOK || noteOf(t, rec.Body.Bytes()).Description != "Revised." {
		t.Fatalf("restore v4: %d %s", rec.Code, rec.Body)
	}
	rec = f.do(req{method: "POST", path: "/api/notes/" + n.ID + "/restore", user: "u-alice", body: map[string]any{"version": 5}})
	if rec.Code != http.StatusOK || noteOf(t, rec.Body.Bytes()).Description != "" {
		t.Fatalf("restore v5 (no description): %d %s", rec.Code, rec.Body)
	}

	// Delete + undelete keeps it (the tombstone does not drop it).
	f.do(req{method: "PUT", path: "/api/notes/" + n.ID, user: "u-alice", body: map[string]any{"description": "kept"}})
	f.do(req{method: "DELETE", path: "/api/notes/" + n.ID, user: "u-alice"})
	rec = f.do(req{method: "POST", path: "/api/notes/" + n.ID + "/restore", user: "u-alice", body: map[string]any{}})
	if rec.Code != http.StatusOK || noteOf(t, rec.Body.Bytes()).Description != "kept" {
		t.Fatalf("undelete lost the description: %d %s", rec.Code, rec.Body)
	}
}

func TestNoteUnknownFieldsAreIgnored(t *testing.T) {
	// Newer clients may send fields this server does not know yet; the body
	// decoder must ignore them rather than fail the whole save.
	f := newFix(t)
	ns := f.ns("unk")
	rec := f.do(req{method: "POST", path: "/api/notes", user: "u-alice",
		body: map[string]any{"namespace": ns, "title": "t", "someFutureField": map[string]any{"x": 1}}})
	if rec.Code != http.StatusCreated {
		t.Fatalf("unknown field rejected: %d %s", rec.Code, rec.Body)
	}
}
