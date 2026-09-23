package brain

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestDocKey(t *testing.T) {
	cases := []struct {
		ref, key string
		chunk    int
	}{
		{"repo/docs/index.md#3", "repo/docs/index.md", 3},
		{"zekra:SPEC.md#0", "zekra:SPEC.md", 0},
		{"a/b.go#chunk-2", "a/b.go", 2},
		{"a/b.go:chunk-7", "a/b.go", 7},
		{"https://x.io/p?part=4", "https://x.io/p", 4},
		{"README.md", "README.md", -1},
		{"handoff/X1-notifications/backend-web/1", "handoff/X1-notifications/backend-web/1", -1}, // a path segment, not a chunk
		{"zekra:log:abc123", "zekra:log:abc123", -1},
		{"#3", "#3", -1}, // nothing left of the key
	}
	for _, c := range cases {
		if k, n := docKey(c.ref); k != c.key || n != c.chunk {
			t.Errorf("docKey(%q) = %q,%d; want %q,%d", c.ref, k, n, c.key, c.chunk)
		}
	}
}

func TestMemoTitle(t *testing.T) {
	cases := map[string]string{
		"Health Debug analytics privacy line: Firebase Analytics and Crashlytics ship on all four native apps.": "Health Debug analytics privacy line",
		"CircleXO rebuild verdict (2026-08-24): the rebuild is very well matched to ToGo":                       "CircleXO rebuild verdict (2026-08-24)",
		"Sentra — what the product is.\n\nSentra is the capability-intelligence product.":                       "Sentra — what the product is.",
		"The API moved. It now lives on :8081.":                                                                 "The API moved",
		"https://example.com/x is the docs site":                                                                "https://example.com/x is the docs site",
		"## Deploy notes\n\nbody":                                                                               "Deploy notes",
		"Note: short":                                                                                           "Note: short", // a one-word label is not a title
	}
	for in, want := range cases {
		if got := memoTitle(in); got != want {
			t.Errorf("memoTitle(%q) = %q, want %q", in, got, want)
		}
	}
	if got := memoTitle(strings.Repeat("word ", 60)); len([]rune(got)) > memoTitleMax {
		t.Errorf("title not capped: %d runes", len([]rune(got)))
	}
}

func TestGroupDocuments(t *testing.T) {
	t0 := time.Unix(1_700_000_000, 0)
	memo := "Health Debug analytics privacy line: Firebase Analytics ships on all four native apps."
	mems := []adoptMem{
		{ID: "1", Ref: "r/guide.md#2", Content: "C", ValidAt: t0},
		{ID: "2", Ref: "r/guide.md#0", Content: "A", ValidAt: t0.Add(time.Hour)},
		{ID: "3", Ref: "r/guide.md#1", Content: "B", ValidAt: t0},
		{ID: "4", Ref: "r/README.md", Content: "R", Meta: map[string]any{"type": "doc", "tags": []any{"x", "y"}}},
		{ID: "5", Content: memo, Kind: "claude_code", Meta: map[string]any{"type": "legacy-reference"}},
		{ID: "6", Content: "a short fact", Kind: "claude_code"},
		{ID: "7", Content: "titled", Meta: map[string]any{"type": "ops", "title": "Prod topology"}},
		{ID: "8", Ref: "291f9659-2977-44ad-b81a-5f9890308662", Content: "one of a session"},
		{ID: "9", Ref: "291f9659-2977-44ad-b81a-5f9890308662", Content: "another of the session"},
		{ID: "10", Ref: "handoff/X1/backend/1", Content: "SESSION HANDOFF X1 — notifications"},
		{ID: "11", Ref: "x.md", Content: "intro"},
		{ID: "12", Ref: "x.md#1", Content: "part one"},
	}
	docs := groupDocuments(mems)
	got := map[string][]string{}
	for _, d := range docs {
		for _, m := range d.Mems {
			got[d.Key] = append(got[d.Key], m.Content)
		}
	}
	want := map[string][]string{
		"r/guide.md":           {"A", "B", "C"},
		"r/README.md":          {"R"},
		"zekra:memory:5":       {memo},
		"zekra:memory:6":       {"a short fact"},
		"zekra:memory:7":       {"titled"},
		"zekra:memory:8":       {"one of a session"},
		"zekra:memory:9":       {"another of the session"},
		"handoff/X1/backend/1": {"SESSION HANDOFF X1 — notifications"},
		"x.md":                 {"intro", "part one"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("grouping:\n got %v\nwant %v", got, want)
	}
	shape := map[string][3]string{
		"r/README.md":          {"r/README.md", "doc", "import"},
		"r/guide.md":           {"r/guide.md", "document", "import"},
		"zekra:memory:5":       {"Health Debug analytics privacy line", "legacy-reference", "claude_code"},
		"zekra:memory:6":       {"a short fact", "memory", "claude_code"},
		"zekra:memory:7":       {"Prod topology", "ops", "import"},
		"handoff/X1/backend/1": {"SESSION HANDOFF X1 — notifications", "memory", "import"},
	}
	for _, d := range docs {
		title, cat, src, tags := adoptedNoteShape(d)
		if w, ok := shape[d.Key]; ok && (title != w[0] || cat != w[1] || src != w[2]) {
			t.Errorf("%s: got (%q,%q,%q) want %v", d.Key, title, cat, src, w)
		}
		if d.Key == "r/README.md" && !reflect.DeepEqual(tags, []string{"x", "y"}) {
			t.Errorf("README tags: %v", tags)
		}
	}
}

// loose inserts a pre-notes memory straight into the table (no embedding, no
// note) — what brains held before every memory became a note.
func (f *fix) loose(ns, content, ref, kind string, meta map[string]any) string {
	f.t.Helper()
	db, _ := f.svc.Store.db(context.Background())
	raw, _ := json.Marshal(meta)
	if meta == nil {
		raw = []byte("{}")
	}
	var id string
	if err := db.QueryRow(`INSERT INTO memories (namespace, network, memory_type, content, source_kind, source_ref, metadata)
		VALUES ($1,'fact','semantic',$2,NULLIF($3,''),NULLIF($4,''),$5::jsonb) RETURNING id::text`,
		ns, content, kind, ref, string(raw)).Scan(&id); err != nil {
		f.t.Fatal(err)
	}
	return id
}

func (f *fix) noteByOrigin(ns, key string) *Note {
	f.t.Helper()
	var id string
	db, _ := f.svc.Store.db(context.Background())
	if err := db.QueryRow(`SELECT id::text FROM notes WHERE namespace=$1 AND origin_ref=$2`, ns, key).Scan(&id); err != nil {
		f.t.Fatalf("no note for %q: %v", key, err)
	}
	return f.note(id)
}

func (f *fix) note(id string) *Note {
	f.t.Helper()
	n, err := f.svc.Store.GetNote(context.Background(), id)
	if err != nil {
		f.t.Fatal(err)
	}
	return n
}

func (f *fix) countIn(ns, where string, args ...any) int {
	return f.count(`SELECT count(*) FROM memories WHERE namespace=$1 AND `+where, append([]any{ns}, args...)...)
}

func (f *fix) looseLive(ns string) int {
	return f.count(`SELECT count(*) FROM memories WHERE `+unadoptedWhere, ns)
}

func TestAdoptDocumentsEndToEnd(t *testing.T) {
	f := newFix(t)
	ns := f.ns("adopt")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner'), ($1,'u-carol','viewer')`, ns)
	ctx := context.Background()

	secA, secB, secC := "# Setup\n\nInstall it.", "# Usage\n\nRun it.", "# FAQ\n\nAsk."
	memo := "Health Debug analytics privacy line: Firebase Analytics and Crashlytics ship on all four native apps."
	// A chunked document, retained out of order.
	f.loose(ns, secC, "repo/guide.md#2", "datasource:github", map[string]any{"type": "doc"})
	f.loose(ns, secA, "repo/guide.md#0", "datasource:github", map[string]any{"type": "doc", "tags": []any{"guide"}})
	f.loose(ns, secB, "repo/guide.md#1", "datasource:github", map[string]any{"type": "doc"})
	f.loose(ns, "The readme.", "repo/README.md", "datasource:github", map[string]any{"type": "doc"})
	// Standalone agent memories: no ref, and a ref shared by two.
	memoID := f.loose(ns, memo, "", "claude_code", map[string]any{"type": "legacy-reference", "tags": []any{"privacy"}})
	f.loose(ns, "Session fact one.", "sess-1", "claude_code", nil)
	f.loose(ns, "Session fact two.", "sess-1", "claude_code", nil)
	total := f.countIn(ns, "true")

	// A viewer cannot adopt.
	if rec := f.do(req{method: "POST", path: "/api/notes/adopt", user: "u-carol", body: map[string]any{"namespace": ns}}); rec.Code != http.StatusForbidden {
		t.Fatalf("viewer adopt: %d %s", rec.Code, rec.Body)
	}
	rec := f.do(req{method: "POST", path: "/api/notes/adopt", user: "u-alice", body: map[string]any{"namespace": ns}})
	if rec.Code != http.StatusOK {
		t.Fatalf("adopt: %d %s", rec.Code, rec.Body)
	}
	var res AdoptResult
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res.Adopted != 5 || res.Notes != 5 || res.Memories != 7 {
		t.Fatalf("adopt result: %+v", res)
	}
	// No memory created or lost; every one is a note chunk now.
	if got := f.countIn(ns, "true"); got != total {
		t.Fatalf("adoption created/removed memories: %d → %d", total, got)
	}
	if n := f.looseLive(ns); n != 0 {
		t.Fatalf("%d memories left loose", n)
	}

	guide := f.noteByOrigin(ns, "repo/guide.md")
	if guide.Title != "repo/guide.md" || guide.Body != secA+"\n\n"+secB+"\n\n"+secC || guide.Category != "doc" ||
		guide.Source != "datasource:github" || !reflect.DeepEqual(guide.Tags, []string{"guide"}) || guide.Chunks != 3 || !guide.Indexed {
		t.Fatalf("guide note: %+v", guide)
	}
	mem := f.liveNoteMemories(ns, guide.ID)
	if len(mem) != 3 {
		t.Fatalf("guide memories: %v", mem)
	}
	db, _ := f.svc.Store.db(ctx)
	for i, want := range []string{secA, secB, secC} {
		var content, origin string
		_ = db.QueryRow(`SELECT content, metadata->>'origin_ref' FROM memories WHERE id=$1`, mem[noteRef(guide.ID, i)]).Scan(&content, &origin)
		if content != want || origin != "repo/guide.md#"+string(rune('0'+i)) {
			t.Errorf("chunk %d: %q from %q", i, content, origin)
		}
	}
	if e := f.noteEntity(guide.ID); e.Type != "doc" || e.Name != "repo/guide.md" {
		t.Fatalf("guide entity: %+v", e)
	}
	if n := f.count(`SELECT count(*) FROM memory_entities WHERE entity_id=$1`, guide.EntityID); n != 3 {
		t.Fatalf("memory_entities links: %d", n)
	}
	// The standalone memo is its own note, the memory itself its single chunk.
	memoNote := f.noteByOrigin(ns, adoptKeyMemory+memoID)
	if memoNote.Title != "Health Debug analytics privacy line" || memoNote.Body != memo || memoNote.Category != "legacy-reference" ||
		memoNote.Source != "claude_code" || !reflect.DeepEqual(memoNote.Tags, []string{"privacy"}) || memoNote.Chunks != 1 {
		t.Fatalf("memo note: %+v", memoNote)
	}
	if live := f.liveNoteMemories(ns, memoNote.ID); live[noteRef(memoNote.ID, 0)] != memoID {
		t.Fatalf("memo memory not adopted as chunk #0: %v", live)
	}
	if e := f.noteEntity(memoNote.ID); e.Type != "legacy-reference" {
		t.Fatalf("memo entity type: %q", e.Type)
	}
	// The derived mindmap's memory node points at the note.
	g := &GraphData{Nodes: []GraphNode{{ID: "ent:" + memoID}}}
	annotateNoteNodes(ctx, db, g)
	if g.Nodes[0].NoteID != memoNote.ID || g.Nodes[0].Type != "legacy-reference" {
		t.Fatalf("derived graph node: %+v", g.Nodes[0])
	}

	// Idempotent.
	again, err := f.svc.Store.AdoptDocuments(ctx, ns, true)
	if err != nil || again.Adopted != 0 || again.Notes != 0 || again.Memories != 0 {
		t.Fatalf("re-run: %+v %v", again, err)
	}
	if n := f.count(`SELECT count(*) FROM notes WHERE namespace=$1`, ns); n != 5 {
		t.Fatalf("notes after re-run: %d", n)
	}

	// --- retain is note-first --------------------------------------------------
	// Identical text for an adopted ref: NOOP, nothing new.
	before := f.countIn(ns, "true")
	readme := f.noteByOrigin(ns, "repo/README.md")
	r, err := f.svc.Store.Retain(ctx, MemoryInput{Namespace: ns, Content: "The readme.", SourceRef: "repo/README.md"})
	if err != nil || r.Decision != "noop" || r.NoteID != readme.ID || f.countIn(ns, "true") != before {
		t.Fatalf("identical re-retain: %+v %v", r, err)
	}
	// A new version of that chunk updates the note; again after the re-chunk.
	for _, v := range []string{"The readme, v2.", "The readme, v3."} {
		r, err = f.svc.Store.Retain(ctx, MemoryInput{Namespace: ns, Content: v, SourceRef: "repo/README.md"})
		if err != nil || r.Decision != "update" || r.NoteID != readme.ID {
			t.Fatalf("changed re-retain %q: %+v %v", v, r, err)
		}
		if n := f.note(readme.ID); n.Body != v || len(f.liveNoteMemories(ns, readme.ID)) != 1 {
			t.Fatalf("readme after %q: %q", v, n.Body)
		}
	}
	// A new chunk of an adopted document is appended to its note.
	r, err = f.svc.Store.Retain(ctx, MemoryInput{Namespace: ns, Content: "# Changelog\n\nv1.", SourceRef: "repo/guide.md#3"})
	if err != nil || r.NoteID != guide.ID {
		t.Fatalf("new chunk: %+v %v", r, err)
	}
	guide = f.note(guide.ID)
	if !strings.HasSuffix(guide.Body, "# Changelog\n\nv1.") || len(f.liveNoteMemories(ns, guide.ID)) != 4 || guide.Chunks != 4 {
		t.Fatalf("appended chunk: %q, %d live", guide.Body, len(f.liveNoteMemories(ns, guide.ID)))
	}
	// A plain memory_retain (REST) creates a note and returns its id.
	rec = f.do(req{method: "POST", path: "/api/brain/retain", user: "u-alice",
		body: map[string]any{"namespace": ns, "content": "Deploys go out on Tuesdays: never on Fridays.", "sourceKind": "mcp"}})
	var rr RetainResult
	_ = json.Unmarshal(rec.Body.Bytes(), &rr)
	if rec.Code != http.StatusOK || rr.Decision != "add" || rr.NoteID == "" {
		t.Fatalf("retain → note: %d %s", rec.Code, rec.Body)
	}
	if n := f.note(rr.NoteID); n.Title != "Deploys go out on Tuesdays" || n.Source != "mcp" || n.Category != "memory" ||
		f.liveNoteMemories(ns, n.ID)[noteRef(n.ID, 0)] != rr.ID {
		t.Fatalf("retained note: %+v", n)
	}
	// UPDATE of a note's memory (a ref identity) → that note's body, a new version.
	r, err = f.svc.Store.Retain(ctx, MemoryInput{Namespace: ns, Content: "Session fact, revised.", SourceRef: "sess-1"})
	if err != nil || r.Decision != "update" || r.NoteID == "" {
		t.Fatalf("ref update: %+v %v", r, err)
	}
	if n := f.note(r.NoteID); n.Body != "Session fact, revised." || n.Version != 2 || len(f.liveNoteMemories(ns, n.ID)) != 1 {
		t.Fatalf("updated session note: %+v", n)
	}
	// INVALIDATE of a note's memory → that note is tombstoned; the correction is a note.
	stale, err := f.svc.Store.Retain(ctx, MemoryInput{Namespace: ns, Content: "The staging database listens on port 5433."})
	if err != nil || stale.NoteID == "" {
		t.Fatalf("stale fact: %+v %v", stale, err)
	}
	correction := "Correction: the staging database port 5433 is wrong."
	vecs, _ := fakeEmbedder{}.Embed(ctx, []string{correction})
	f.exec(`UPDATE memories SET embedding=$2::vector WHERE id=$1`, stale.ID, vecLit(vecs[0])) // make it the nearest neighbour
	r, err = f.svc.Store.Retain(ctx, MemoryInput{Namespace: ns, Content: correction})
	if err != nil || r.Decision != "invalidate" || r.NoteID == "" || r.NoteID == stale.NoteID {
		t.Fatalf("invalidate: %+v %v", r, err)
	}
	if n := f.note(stale.NoteID); !n.Deleted || len(f.liveNoteMemories(ns, n.ID)) != 0 {
		t.Fatalf("retracted note not tombstoned: %+v", n)
	}
	if n := f.looseLive(ns); n != 0 {
		t.Fatalf("%d loose memories after retains", n)
	}

	// --- editing an adopted note ---------------------------------------------------
	// First edit re-chunks: adopted memories superseded/invalidated, never duplicated.
	edited := strings.Replace(guide.Body, "Run it.", "Run it twice.", 1)
	rec = f.do(req{method: "PUT", path: "/api/notes/" + guide.ID, user: "u-alice", body: map[string]any{"body": edited}})
	if rec.Code != http.StatusOK {
		t.Fatalf("edit: %d %s", rec.Code, rec.Body)
	}
	chunks := noteChunks(guide.Title, edited)
	first := f.liveNoteMemories(ns, guide.ID)
	if len(first) != len(chunks) {
		t.Fatalf("after first edit: %d live chunk memories, want %d", len(first), len(chunks))
	}
	if n := f.countIn(ns, `invalid_at IS NULL AND source_ref LIKE $2 AND metadata ? 'adopted'`, "note:"+guide.ID+"#%"); n != 0 {
		t.Fatalf("%d adopted memories still live after the re-chunk", n)
	}
	// Second edit: only the changed chunk is re-retained.
	edited2 := strings.Replace(edited, "Ask.", "Ask us.", 1)
	rec = f.do(req{method: "PUT", path: "/api/notes/" + guide.ID, user: "u-alice", body: map[string]any{"body": edited2}})
	if rec.Code != http.StatusOK {
		t.Fatalf("edit 2: %d %s", rec.Code, rec.Body)
	}
	second := f.liveNoteMemories(ns, guide.ID)
	changed := 0
	for ref, id := range first {
		if second[ref] != id {
			changed++
		}
	}
	if changed != 1 || len(second) != len(chunks) {
		t.Fatalf("second edit re-retained %d chunks (want 1): %v → %v", changed, first, second)
	}

	// Delete / restore of an adopted note invalidates / restores its memories.
	rec = f.do(req{method: "DELETE", path: "/api/notes/" + memoNote.ID, user: "u-alice"})
	if rec.Code != http.StatusOK || len(f.liveNoteMemories(ns, memoNote.ID)) != 0 {
		t.Fatalf("delete adopted: %d, %d live", rec.Code, len(f.liveNoteMemories(ns, memoNote.ID)))
	}
	rec = f.do(req{method: "POST", path: "/api/notes/" + memoNote.ID + "/restore", user: "u-alice", body: map[string]any{}})
	if rec.Code != http.StatusOK || len(f.liveNoteMemories(ns, memoNote.ID)) != 1 {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body)
	}

	// A deleted document note is not resurrected by adoption.
	f.do(req{method: "DELETE", path: "/api/notes/" + readme.ID, user: "u-alice"})
	f.loose(ns, "Readme from an old importer.", "repo/README.md", "import", nil)
	res2, err := f.svc.Store.AdoptDocuments(ctx, ns, true)
	if err != nil || res2.Notes != 0 || res2.Skipped != 1 {
		t.Fatalf("run with a deleted note: %+v %v", res2, err)
	}

	// A data source re-delivering a whole adopted document refreshes the note.
	handled, err := f.svc.Store.refreshAdoptedDocument(ctx, ns, Document{SourceRef: "repo/guide.md", Content: "# Setup\n\nAll new."})
	if !handled || err != nil {
		t.Fatalf("refresh: %v %v", handled, err)
	}
	if g := f.note(guide.ID); g.Body != "# Setup\n\nAll new." || len(f.liveNoteMemories(ns, g.ID)) != 1 {
		t.Fatalf("refreshed guide: %q", g.Body)
	}
}

func TestAdoptRunsWhenNotesAreListed(t *testing.T) {
	f := newFix(t)
	t.Setenv("ZEKRA_NOTES_AUTO_ADOPT", "1")
	ns := f.ns("lazy")
	adoptChecked.Delete(ns)
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner')`, ns)
	f.loose(ns, "Doc body.", "x/doc.md", "datasource:github", map[string]any{"type": "doc"})
	if rec := f.do(req{method: "GET", path: "/api/notes?namespace=" + ns, user: "u-alice"}); rec.Code != http.StatusOK {
		t.Fatalf("list: %d", rec.Code)
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if f.count(`SELECT count(*) FROM notes WHERE namespace=$1 AND origin_ref='x/doc.md'`, ns) == 1 {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("listing notes did not adopt the brain's document")
}
