package brain

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"testing"
)

// --- pure ------------------------------------------------------------------------

func TestParseWikilinks(t *testing.T) {
	got := parseWikilinks("See [[Acme Cloud]] and [[acme cloud]] and [[Ada|person]], [[ Bad |not a type!]] [[]] [[x\ny]]")
	want := []wikiLink{{"Acme Cloud", ""}, {"Ada", "person"}, {"Bad", ""}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v", got)
	}
}

func TestNoteSummaryAndTypeNames(t *testing.T) {
	if s := noteSummary("# Heading\n\nbody [[Link|x]] text"); s != "Heading" {
		t.Errorf("summary: %q", s)
	}
	if s := noteSummary("first para with [[Link|x]]\n\nsecond"); s != "first para with Link" {
		t.Errorf("summary: %q", s)
	}
	if c, _ := noteCategory(""); c != "note" {
		t.Errorf("default category %q", c)
	}
	if c, _ := noteCategory("  meeting notes "); c != "meeting_notes" {
		t.Errorf("category %q", c)
	}
	if _, err := normalizeTypeName("bad;type"); err == nil {
		t.Error("bad type accepted")
	}
}

// --- database --------------------------------------------------------------------

func (f *fix) noteEntity(noteID string) *Entity {
	f.t.Helper()
	n, err := f.svc.Store.GetNote(context.Background(), noteID)
	if err != nil || n.EntityID == "" {
		f.t.Fatalf("note %s has no entity: %v", noteID, err)
	}
	e, err := f.svc.Store.GetEntity(context.Background(), n.EntityID)
	if err != nil {
		f.t.Fatal(err)
	}
	return e
}

func (f *fix) liveEdges(src, origin string) int {
	return f.count(`SELECT count(*) FROM entity_edges WHERE src_id=$1 AND valid_to IS NULL AND metadata->>'origin'=$2`, src, origin)
}

func TestNoteIsAGraphNodeWithWikilinks(t *testing.T) {
	f := newFix(t)
	ns := f.ns("ng")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner'), ($1,'u-carol','viewer')`, ns)
	mk := func(body map[string]any) Note {
		body["namespace"] = ns
		rec := f.do(req{method: "POST", path: "/api/notes", user: "u-alice", body: body})
		if rec.Code != http.StatusCreated {
			t.Fatalf("create: %d %s", rec.Code, rec.Body)
		}
		return noteOf(t, rec.Body.Bytes())
	}

	// Two notes may share a title; each gets its own entity typed by category.
	a := mk(map[string]any{"title": "Plan", "body": "First para.\n\nLinks [[Target]] and [[Ada|person]].", "category": "meeting", "tags": []string{"q3"}})
	b := mk(map[string]any{"title": "Plan", "body": "other"})
	if a.Category != "meeting" || a.EntityID == "" || b.EntityID == "" || a.EntityID == b.EntityID {
		t.Fatalf("entities: %+v / %+v", a, b)
	}
	ea := f.noteEntity(a.ID)
	if ea.Type != "meeting" || ea.Name != "Plan" || ea.NoteID != a.ID || ea.Summary != "First para." {
		t.Fatalf("note entity: %+v", ea)
	}
	if n := f.liveEdges(ea.ID, OriginWikilink); n != 2 {
		t.Fatalf("want 2 wikilink edges, got %d", n)
	}
	if n := f.liveEdges(ea.ID, OriginExtract); n != 1 {
		t.Fatalf("want 1 tag edge, got %d", n)
	}
	if f.count(`SELECT count(*) FROM entities WHERE namespace=$1 AND name='Ada' AND entity_type='person'`, ns) != 1 {
		t.Fatal("typed wikilink target not created")
	}
	if f.count(`SELECT count(*) FROM memory_entities WHERE entity_id=$1`, ea.ID) == 0 {
		t.Fatal("chunk memories not linked to the note entity")
	}

	// A manual edge from the note entity survives wikilink edits.
	target, _ := f.svc.Store.ResolveEntity(context.Background(), ns, "Target")
	rec := f.do(req{method: "POST", path: "/api/brain/edges", user: "u-alice", body: map[string]any{
		"namespace": ns, "src_id": ea.ID, "dst_id": target.ID, "relation": "depends_on", "create_type": true}})
	if rec.Code != http.StatusCreated {
		t.Fatalf("edge create: %d %s", rec.Code, rec.Body)
	}
	manual := decodeMap(t, rec)["id"].(string)
	if rec := f.do(req{method: "POST", path: "/api/brain/edges", user: "u-alice", body: map[string]any{
		"namespace": ns, "src_id": ea.ID, "dst_id": target.ID, "relation": "depends_on"}}); rec.Code != http.StatusConflict {
		t.Fatalf("duplicate edge: %d", rec.Code)
	}
	if rec := f.do(req{method: "POST", path: "/api/brain/edges", user: "u-alice", body: map[string]any{
		"namespace": ns, "src_id": ea.ID, "dst_id": target.ID, "relation": "never_heard_of"}}); rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown relation: %d", rec.Code)
	}
	rec = f.do(req{method: "PUT", path: "/api/notes/" + a.ID, user: "u-alice", body: map[string]any{"body": "Only [[Plan]] now."}})
	if rec.Code != http.StatusOK {
		t.Fatalf("update: %d %s", rec.Code, rec.Body)
	}
	if n := f.liveEdges(ea.ID, OriginWikilink); n != 1 {
		t.Fatalf("after edit want 1 wikilink edge, got %d", n)
	}
	if f.count(`SELECT count(*) FROM entity_edges WHERE id=$1 AND valid_to IS NULL`, manual) != 1 {
		t.Fatal("a note save touched a manual edge")
	}
	if f.count(`SELECT count(*) FROM entity_edges WHERE src_id=$1 AND metadata->>'origin'='wikilink' AND valid_to IS NOT NULL`, ea.ID) != 2 {
		t.Fatal("removed wikilinks were not closed")
	}

	// Backlinks: b is titled Plan, so a's [[Plan]] resolves to a note entity.
	rec = f.do(req{method: "GET", path: "/api/notes/" + b.ID + "/backlinks", user: "u-carol"})
	if rec.Code != 200 || len(decodeMap(t, rec)["backlinks"].([]any)) != 1 {
		t.Fatalf("backlinks: %d %s", rec.Code, rec.Body)
	}
	if rec := f.do(req{method: "GET", path: "/api/notes/" + a.ID + "/related", user: "u-carol"}); rec.Code != 200 {
		t.Fatalf("related: %d %s", rec.Code, rec.Body)
	}

	// Retype a manual edge: old closed, new opened with the same endpoints.
	rec = f.do(req{method: "PATCH", path: "/api/brain/edges/" + manual, user: "u-alice", body: map[string]any{"relation": "uses", "create_type": true}})
	if rec.Code != 200 || decodeMap(t, rec)["replaced"] != true {
		t.Fatalf("retype: %d %s", rec.Code, rec.Body)
	}
	if f.count(`SELECT count(*) FROM entity_edges WHERE id=$1 AND valid_to IS NOT NULL`, manual) != 1 ||
		f.count(`SELECT count(*) FROM entity_edges WHERE src_id=$1 AND dst_id=$2 AND relation='uses' AND valid_to IS NULL`, ea.ID, target.ID) != 1 {
		t.Fatal("retype did not close + open")
	}
	// Wikilink edges cannot be retyped or deleted here.
	var wl string
	db, _ := f.svc.Store.db(context.Background())
	_ = db.QueryRow(`SELECT id::text FROM entity_edges WHERE src_id=$1 AND metadata->>'origin'='wikilink' AND valid_to IS NULL`, ea.ID).Scan(&wl)
	if rec := f.do(req{method: "DELETE", path: "/api/brain/edges/" + wl, user: "u-alice"}); rec.Code != http.StatusConflict {
		t.Fatalf("delete wikilink edge: %d", rec.Code)
	}

	// Entity PATCH on a note entity renames/retypes the note (new version).
	rec = f.do(req{method: "PATCH", path: "/api/brain/entities/" + ea.ID, user: "u-alice", body: map[string]any{"name": "Plan v2", "entity_type": "decision", "create_type": true}})
	if rec.Code != 200 {
		t.Fatalf("entity patch: %d %s", rec.Code, rec.Body)
	}
	n2, _ := f.svc.Store.GetNote(context.Background(), a.ID)
	if n2.Title != "Plan v2" || n2.Category != "decision" || n2.Version != 3 {
		t.Fatalf("note not synced: %+v", n2)
	}
	if e := f.noteEntity(a.ID); e.Name != "Plan v2" || e.Type != "decision" {
		t.Fatalf("entity: %+v", e)
	}
	if rec := f.do(req{method: "DELETE", path: "/api/brain/entities/" + ea.ID, user: "u-alice"}); rec.Code != http.StatusConflict {
		t.Fatalf("delete note entity: %d", rec.Code)
	}

	// Delete the note: derived edges closed, entity tombstoned, manual edge kept.
	if rec := f.do(req{method: "DELETE", path: "/api/notes/" + a.ID, user: "u-alice"}); rec.Code != 200 {
		t.Fatalf("delete: %d", rec.Code)
	}
	if f.liveEdges(ea.ID, OriginWikilink) != 0 || !f.noteEntity(a.ID).Deleted {
		t.Fatal("delete did not close edges / tombstone the entity")
	}
	if rec := f.do(req{method: "POST", path: "/api/notes/" + a.ID + "/restore", user: "u-alice", body: map[string]any{}}); rec.Code != 200 {
		t.Fatalf("restore: %d", rec.Code)
	}
	if f.liveEdges(ea.ID, OriginWikilink) != 1 || f.noteEntity(a.ID).Deleted {
		t.Fatal("restore did not re-sync")
	}

	// Graph payload carries noteId + type.
	rec = f.do(req{method: "GET", path: "/api/brain/graph?namespace=" + ns, user: "u-carol"})
	var g GraphData
	_ = jsonUnmarshal(rec.Body.Bytes(), &g)
	found := false
	for _, n := range g.Nodes {
		if n.ID == ea.ID && n.NoteID == a.ID && n.Type == "decision" {
			found = true
		}
	}
	if !found {
		t.Fatalf("graph node without noteId: %s", rec.Body)
	}

	// Viewer cannot write; bob (no access) cannot even see.
	for _, c := range []struct {
		method, path string
		body         any
	}{
		{"POST", "/api/brain/entities", map[string]any{"namespace": ns, "name": "X", "entity_type": "concept"}},
		{"PATCH", "/api/brain/entities/" + ea.ID, map[string]any{"summary": "x"}},
		{"POST", "/api/brain/edges", map[string]any{"namespace": ns, "src_id": ea.ID, "dst_id": target.ID, "relation": "uses"}},
		{"POST", "/api/brain/entities/" + target.ID + "/note", map[string]any{}},
		{"POST", "/api/brain/ontology/entity-types", map[string]any{"namespace": ns, "name": "zzz"}},
	} {
		if rec := f.do(req{method: c.method, path: c.path, user: "u-carol", body: c.body}); rec.Code != http.StatusForbidden {
			t.Errorf("viewer %s %s: %d", c.method, c.path, rec.Code)
		}
	}
	if rec := f.do(req{method: "GET", path: "/api/brain/entities/" + ea.ID, user: "u-carol"}); rec.Code != 200 {
		t.Errorf("viewer read entity: %d", rec.Code)
	}
	if rec := f.do(req{method: "GET", path: "/api/brain/entities/" + ea.ID, user: "u-bob"}); rec.Code != http.StatusNotFound {
		t.Errorf("outsider read entity: %d", rec.Code)
	}

	// Open an entity as a note: created once, then returned.
	rec = f.do(req{method: "POST", path: "/api/brain/entities/" + target.ID + "/note", user: "u-alice", body: map[string]any{}})
	if rec.Code != http.StatusCreated {
		t.Fatalf("open as note: %d %s", rec.Code, rec.Body)
	}
	rec2 := f.do(req{method: "POST", path: "/api/brain/entities/" + target.ID + "/note", user: "u-alice", body: map[string]any{}})
	n1 := decodeMap(t, rec)["note"].(map[string]any)
	if rec2.Code != 200 || decodeMap(t, rec2)["note"].(map[string]any)["id"] != n1["id"] || n1["entityId"] != target.ID {
		t.Fatalf("second open: %d %s", rec2.Code, rec2.Body)
	}
	if f.count(`SELECT count(*) FROM notes WHERE entity_id=$1`, target.ID) != 1 {
		t.Fatal("open-as-note created twice")
	}

	// Ontology: in-use type refuses delete without reassign.
	rec = f.do(req{method: "DELETE", path: "/api/brain/ontology/entity-types?namespace=" + ns + "&name=person", user: "u-alice"})
	if rec.Code != http.StatusConflict {
		t.Fatalf("delete in-use type: %d %s", rec.Code, rec.Body)
	}
	rec = f.do(req{method: "DELETE", path: "/api/brain/ontology/entity-types?namespace=" + ns + "&name=person&reassign_to=concept", user: "u-alice"})
	if rec.Code != 200 || f.count(`SELECT count(*) FROM entities WHERE namespace=$1 AND entity_type='person'`, ns) != 0 {
		t.Fatalf("reassign delete: %d %s", rec.Code, rec.Body)
	}
	if rec := f.do(req{method: "GET", path: "/api/brain/ontology?namespace=" + ns, user: "u-carol"}); rec.Code != 200 {
		t.Fatalf("ontology: %d", rec.Code)
	}
	if rec := f.do(req{method: "GET", path: "/api/brain/entities/search?namespace=" + ns + "&q=targ", user: "u-carol"}); rec.Code != 200 ||
		len(decodeMap(t, rec)["entities"].([]any)) != 1 {
		t.Fatalf("search: %d %s", rec.Code, rec.Body)
	}
	rec = f.do(req{method: "POST", path: "/api/brain/entities/path", user: "u-carol", body: map[string]any{"namespace": ns, "from": a.ID, "to": "Target"}})
	if rec.Code != 200 || decodeMap(t, rec)["connected"] != true {
		t.Fatalf("path: %d %s", rec.Code, rec.Body)
	}

	// Backfill is idempotent.
	if _, err := BackfillNotesGraph(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	if f.liveEdges(ea.ID, OriginWikilink) != 1 {
		t.Fatal("backfill changed the edges")
	}
}

func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }
