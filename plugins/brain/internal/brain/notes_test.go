package brain

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"
)

// --- pure: chunking and the re-retain plan ---------------------------------------

func TestNoteChunksSplitOnHeadingsAndCarryTitle(t *testing.T) {
	body := "Intro paragraph.\n\n## Goals\n\nShip notes.\n\n## Risks\n\nNone yet."
	got := noteChunks("Plan", body)
	if len(got) != 3 {
		t.Fatalf("want 3 sections, got %d: %q", len(got), got)
	}
	for _, c := range got {
		if !strings.HasPrefix(c, "Plan\n\n") {
			t.Errorf("chunk does not lead with the title: %q", c)
		}
	}
	if !strings.Contains(got[1], "## Goals") || !strings.Contains(got[2], "## Risks") {
		t.Errorf("sections not split at headings: %q", got)
	}
	// A '#' that is not a heading (no space) does not split.
	if n := len(noteChunks("", "#tag in text\n\nmore")); n != 1 {
		t.Errorf("hashtag split the note: %d chunks", n)
	}
	// Long sections are split on paragraphs under the size cap.
	long := strings.Repeat(strings.Repeat("word ", 150)+"\n\n", 6)
	for _, c := range noteChunks("T", long) {
		if n := len([]rune(c)); n > noteChunkMax+10 {
			t.Errorf("chunk of %d runes exceeds the cap", n)
		}
	}
	if len(noteChunks("T", long)) < 2 {
		t.Error("a long note was not split")
	}
	// Title only, and empty.
	if got := noteChunks("Only a title", ""); len(got) != 1 || got[0] != "Only a title" {
		t.Errorf("title-only note: %q", got)
	}
	if got := noteChunks("", "  "); got != nil {
		t.Errorf("empty note: %q", got)
	}
	// Deterministic.
	if !reflect.DeepEqual(noteChunks("Plan", body), noteChunks("Plan", body)) {
		t.Error("chunking is not deterministic")
	}
}

func TestPlanChunkSync(t *testing.T) {
	cases := []struct {
		old, next       []string
		retain, invalid []int
	}{
		{nil, []string{"a", "b"}, []int{0, 1}, nil},                        // new note
		{[]string{"a", "b"}, []string{"a", "b"}, nil, nil},                 // no change
		{[]string{"a", "b", "c"}, []string{"a", "X", "c"}, []int{1}, nil},  // one chunk edited
		{[]string{"a", "b", "c"}, []string{"a"}, nil, []int{1, 2}},         // shrunk
		{[]string{"a"}, []string{"a", "b"}, []int{1}, nil},                 // grown
		{[]string{"a", "", "c"}, []string{"a", "b", "c"}, []int{1}, nil},   // failed index retried
		{[]string{"a", "b"}, []string{"b", "a", "c"}, []int{0, 1, 2}, nil}, // reordered
	}
	for i, c := range cases {
		p := planChunkSync(c.old, c.next)
		if !reflect.DeepEqual(p.Retain, c.retain) || !reflect.DeepEqual(p.Invalidate, c.invalid) {
			t.Errorf("case %d: got retain=%v invalidate=%v, want %v %v", i, p.Retain, p.Invalidate, c.retain, c.invalid)
		}
	}
}

func TestStringArrayRoundTrip(t *testing.T) {
	for _, in := range [][]string{{}, {"a"}, {"with space", `quo"te`, `back\slash`, "comma,inside", "NULL"}} {
		v, _ := stringArray(in).Value()
		var out stringArray
		if err := out.Scan(v); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual([]string(out), in) {
			t.Errorf("round trip %q → %q → %q", in, v, out)
		}
	}
	var out stringArray
	if err := out.Scan("{a,NULL,\"b c\"}"); err != nil || !reflect.DeepEqual([]string(out), []string{"a", "", "b c"}) {
		t.Errorf("parse: %q %v", out, err)
	}
}

func TestNoteCursorRoundTrip(t *testing.T) {
	ts := time.Date(2026, 9, 19, 10, 11, 12, 123456000, time.UTC)
	id := "0b8a3a8e-9d3c-4f55-a3c4-4c1e7b0b1c2d"
	gt, gid, ok := decodeCursor(encodeCursor(ts, id))
	if !ok || !gt.Equal(ts) || gid != id {
		t.Fatalf("cursor: %v %v %v", gt, gid, ok)
	}
	if _, _, ok := decodeCursor("garbage"); ok {
		t.Error("garbage cursor accepted")
	}
}

// --- database: re-retain / invalidate / sync -------------------------------------

func (f *fix) liveNoteMemories(ns, id string) map[string]string {
	f.t.Helper()
	db, _ := f.svc.Store.db(context.Background())
	rows, err := db.Query(`SELECT source_ref, id::text FROM memories
		WHERE namespace=$1 AND source_kind='note' AND source_ref LIKE $2 AND invalid_at IS NULL`, ns, "note:"+id+"#%")
	if err != nil {
		f.t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var ref, mid string
		_ = rows.Scan(&ref, &mid)
		out[ref] = mid
	}
	return out
}

func noteOf(t *testing.T, body []byte) Note {
	t.Helper()
	var n Note
	if err := json.Unmarshal(body, &n); err != nil {
		t.Fatalf("decode note: %v: %s", err, body)
	}
	return n
}

func TestNoteSaveEditDeleteRestoreReconcilesMemories(t *testing.T) {
	f := newFix(t)
	ns := f.ns("notes")

	// Alice creates a note in a NEW brain: she becomes its owner.
	body := "Intro.\n\n## A\n\nalpha\n\n## B\n\nbeta\n\n## C\n\ngamma"
	rec := f.do(req{method: "POST", path: "/api/notes", user: "u-alice",
		body: map[string]any{"namespace": ns, "title": "Doc", "body": body, "tags": []string{"x", "#y", "x"}}})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	n := noteOf(t, rec.Body.Bytes())
	if n.Version != 1 || n.Chunks != 4 || !n.Indexed || !reflect.DeepEqual(n.Tags, []string{"x", "y"}) || n.OwnerUserID != "u-alice" || n.Source != "web" {
		t.Fatalf("created note: %+v", n)
	}
	if role, _ := f.svc.Store.MemberRole(context.Background(), ns, "u-alice"); role != "owner" {
		t.Fatalf("creator is not the brain owner: %q", role)
	}
	mem := f.liveNoteMemories(ns, n.ID)
	if len(mem) != 4 {
		t.Fatalf("want 4 live chunk memories, got %v", mem)
	}

	// Edit one section: only chunk #2 is re-retained (superseding its row).
	edited := strings.Replace(body, "beta", "beta, revised", 1)
	rec = f.do(req{method: "PUT", path: "/api/notes/" + n.ID, user: "u-alice",
		headers: map[string]string{"If-Match": `"1"`}, body: map[string]any{"body": edited}})
	if rec.Code != http.StatusOK {
		t.Fatalf("update: %d %s", rec.Code, rec.Body)
	}
	after := f.liveNoteMemories(ns, n.ID)
	for i := 0; i < 4; i++ {
		ref := noteRef(n.ID, i)
		changed := after[ref] != mem[ref]
		if (i == 2) != changed {
			t.Errorf("chunk %d changed=%v (only #2 should)", i, changed)
		}
	}
	if sup := f.count(`SELECT count(*) FROM memories WHERE id=$1 AND invalid_at IS NOT NULL AND superseded_by IS NOT NULL`, mem[noteRef(n.ID, 2)]); sup != 1 {
		t.Error("the edited chunk's old memory was not superseded")
	}

	// Stale version → 409 with the server copy.
	rec = f.do(req{method: "PUT", path: "/api/notes/" + n.ID, user: "u-alice",
		body: map[string]any{"body": "lost update", "version": 1}})
	if rec.Code != http.StatusConflict {
		t.Fatalf("stale update: %d %s", rec.Code, rec.Body)
	}
	var conflict struct {
		Current Note `json:"current"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &conflict)
	if conflict.Current.Version != 2 || !strings.Contains(conflict.Current.Body, "revised") {
		t.Fatalf("409 must carry the server copy: %s", rec.Body)
	}

	// Shrink: chunks #2 and #3 disappear and are soft-invalidated (never deleted).
	rec = f.do(req{method: "PUT", path: "/api/notes/" + n.ID, user: "u-alice", body: map[string]any{"body": "Intro.\n\n## A\n\nalpha"}})
	if rec.Code != http.StatusOK {
		t.Fatalf("shrink: %d %s", rec.Code, rec.Body)
	}
	if live := f.liveNoteMemories(ns, n.ID); len(live) != 2 {
		t.Fatalf("after shrink want 2 live chunks, got %v", live)
	}
	total := f.count(`SELECT count(*) FROM memories WHERE namespace=$1 AND source_ref LIKE $2`, ns, "note:"+n.ID+"#%")
	if total < 5 {
		t.Fatalf("memories were hard-deleted: %d rows remain", total)
	}

	// Delete: tombstone + every memory invalidated.
	rec = f.do(req{method: "DELETE", path: "/api/notes/" + n.ID, user: "u-alice"})
	if rec.Code != http.StatusOK || !noteOf(t, rec.Body.Bytes()).Deleted {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body)
	}
	if live := f.liveNoteMemories(ns, n.ID); len(live) != 0 {
		t.Fatalf("delete left live memories: %v", live)
	}
	if got := f.count(`SELECT count(*) FROM memories WHERE namespace=$1 AND source_ref LIKE $2`, ns, "note:"+n.ID+"#%"); got != total {
		t.Fatalf("delete hard-deleted memories: %d → %d", total, got)
	}
	if rec := f.do(req{method: "GET", path: "/api/notes/" + n.ID, user: "u-alice"}); !noteOf(t, rec.Body.Bytes()).Deleted {
		t.Fatal("GET of a deleted note must show the tombstone")
	}

	// Restore: undeleted and re-indexed.
	rec = f.do(req{method: "POST", path: "/api/notes/" + n.ID + "/restore", user: "u-alice", body: map[string]any{}})
	if rec.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body)
	}
	if live := f.liveNoteMemories(ns, n.ID); len(live) != 2 {
		t.Fatalf("restore re-indexed %d chunks, want 2", len(live))
	}
	// Revert to version 1: the original four sections come back.
	rec = f.do(req{method: "POST", path: "/api/notes/" + n.ID + "/restore", user: "u-alice", body: map[string]any{"version": 1}})
	if rec.Code != http.StatusOK || noteOf(t, rec.Body.Bytes()).Chunks != 4 {
		t.Fatalf("revert: %d %s", rec.Code, rec.Body)
	}
	if live := f.liveNoteMemories(ns, n.ID); len(live) != 4 {
		t.Fatalf("revert left %d live chunks, want 4", len(live))
	}

	// History has every version, newest first.
	rec = f.do(req{method: "GET", path: "/api/notes/" + n.ID + "/versions", user: "u-alice"})
	var hist struct {
		Versions []NoteVersion `json:"versions"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &hist)
	if len(hist.Versions) != 6 || hist.Versions[0].Version != 6 || !hist.Versions[2].Deleted {
		t.Fatalf("history: %s", rec.Body)
	}

	// Append (the note_append path).
	rec = f.do(req{method: "POST", path: "/api/notes/" + n.ID + "/append", user: "u-alice", body: map[string]any{"text": "PS"}})
	if rec.Code != http.StatusOK || !strings.HasSuffix(noteOf(t, rec.Body.Bytes()).Body, "\n\nPS") {
		t.Fatalf("append: %d %s", rec.Code, rec.Body)
	}
}

func TestNoteSavesWithoutEmbedderAndRetriesLater(t *testing.T) {
	f := newFix(t)
	ns := f.ns("noemb")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner')`, ns)
	f.svc.k.Set(keyEmbedder, nil)
	rec := f.do(req{method: "POST", path: "/api/notes", user: "u-alice", body: map[string]any{"namespace": ns, "title": "T", "body": "b"}})
	n := noteOf(t, rec.Body.Bytes())
	if rec.Code != http.StatusCreated || n.Indexed || n.IndexError == "" {
		t.Fatalf("save without embedder: %d %s", rec.Code, rec.Body)
	}
	RegisterEmbedder(f.svc.k, fakeEmbedder{})
	rec = f.do(req{method: "PUT", path: "/api/notes/" + n.ID, user: "u-alice", body: map[string]any{"pinned": true}})
	if n := noteOf(t, rec.Body.Bytes()); !n.Indexed || len(f.liveNoteMemories(ns, n.ID)) != 1 {
		t.Fatalf("the next save did not retry indexing: %s", rec.Body)
	}
}

func TestNotesSyncEndpoint(t *testing.T) {
	f := newFix(t)
	a, b := f.ns("sa"), f.ns("sb")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner'), ($2,'u-bob','owner')`, a, b)
	mk := func(user, ns, title string) Note {
		rec := f.do(req{method: "POST", path: "/api/notes", user: user, body: map[string]any{"namespace": ns, "title": title, "body": "body " + title, "tags": []string{"t"}}})
		if rec.Code != http.StatusCreated {
			t.Fatalf("create: %d %s", rec.Code, rec.Body)
		}
		return noteOf(t, rec.Body.Bytes())
	}
	var mine []Note
	for i := 0; i < 5; i++ {
		mine = append(mine, mk("u-alice", a, "n"+strconv.Itoa(i)))
	}
	mk("u-bob", b, "bobs")

	type page struct {
		Notes      []Note    `json:"notes"`
		NextCursor string    `json:"nextCursor"`
		ServerTime time.Time `json:"serverTime"`
	}
	get := func(path string) page {
		rec := f.do(req{method: "GET", path: path, user: "u-alice"})
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s: %d %s", path, rec.Code, rec.Body)
		}
		var p page
		_ = json.Unmarshal(rec.Body.Bytes(), &p)
		return p
	}

	// Full sync from the epoch, paged by 2 across ALL my brains (no namespace).
	since := url0()
	seen := map[string]bool{}
	cursor := ""
	for pages := 0; pages < 10; pages++ {
		p := get("/api/notes?limit=2&since=" + since + cursorParam(cursor))
		for _, n := range p.Notes {
			if n.Namespace != a {
				t.Fatalf("sync leaked another user's note: %+v", n)
			}
			seen[n.ID] = true
		}
		if p.NextCursor == "" {
			break
		}
		cursor = p.NextCursor
	}
	if len(seen) != 5 {
		t.Fatalf("sync saw %d notes, want 5", len(seen))
	}

	// Incremental: after a watermark, only changes — including a tombstone.
	// (Production subtracts a safety margin, making sync at-least-once; zero here
	// so the exact set can be asserted.)
	margin := syncSafetyMargin
	syncSafetyMargin = 0
	defer func() { syncSafetyMargin = margin }()
	mark := get("/api/notes?namespace=" + a + "&limit=1").ServerTime
	time.Sleep(20 * time.Millisecond)
	f.do(req{method: "DELETE", path: "/api/notes/" + mine[0].ID, user: "u-alice"})
	f.do(req{method: "PUT", path: "/api/notes/" + mine[1].ID, user: "u-alice", body: map[string]any{"title": "renamed"}})
	p := get("/api/notes?namespace=" + a + "&since=" + mark.Format(time.RFC3339Nano))
	if len(p.Notes) != 2 {
		t.Fatalf("incremental sync: want 2 changes, got %d: %+v", len(p.Notes), p.Notes)
	}
	var tomb *Note
	for i := range p.Notes {
		if p.Notes[i].ID == mine[0].ID {
			tomb = &p.Notes[i]
		}
	}
	if tomb == nil || !tomb.Deleted || tomb.DeletedAt == nil || tomb.Body != "" {
		t.Fatalf("tombstone missing or carries a body: %+v", p.Notes)
	}

	// Browsing excludes tombstones; q and tag filter.
	if p := get("/api/notes?namespace=" + a); len(p.Notes) != 4 {
		t.Fatalf("browse: %d notes", len(p.Notes))
	}
	if p := get("/api/notes?namespace=" + a + "&q=renamed"); len(p.Notes) != 1 {
		t.Fatalf("q filter: %d", len(p.Notes))
	}
	if p := get("/api/notes?tag=nope"); len(p.Notes) != 0 {
		t.Fatalf("tag filter: %d", len(p.Notes))
	}
	// Another user's brain: 403 on the list, 404 on the note (existence not disclosed).
	if rec := f.do(req{method: "GET", path: "/api/notes?namespace=" + b, user: "u-alice"}); rec.Code != http.StatusForbidden {
		t.Fatalf("listed another user's brain: %d", rec.Code)
	}
	if bad := f.do(req{method: "GET", path: "/api/notes?since=yesterday", user: "u-alice"}); bad.Code != http.StatusBadRequest {
		t.Fatalf("bad since: %d", bad.Code)
	}
}

func url0() string { return time.Unix(0, 0).UTC().Format(time.RFC3339Nano) }

func cursorParam(c string) string {
	if c == "" {
		return ""
	}
	return "&cursor=" + c
}

func TestNoteEventsAreScopedPerCaller(t *testing.T) {
	f := newFix(t)
	a, b := f.ns("ea"), f.ns("eb")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner'), ($2,'u-bob','owner')`, a, b)
	aliceReq := httptestRequest("u-alice")
	alice := f.svc.hub.subscribe(f.svc.readFilter(aliceReq))
	defer f.svc.hub.unsubscribe(alice)
	admin := f.svc.hub.subscribe(nil)
	defer f.svc.hub.unsubscribe(admin)

	f.do(req{method: "POST", path: "/api/notes", user: "u-bob", body: map[string]any{"namespace": b, "title": "bob only"}})
	f.do(req{method: "POST", path: "/api/notes", user: "u-alice", body: map[string]any{"namespace": a, "title": "alice"}})

	got := drain(alice.ch)
	if strings.Contains(got, b) || !strings.Contains(got, "event: note") || !strings.Contains(got, a) {
		t.Fatalf("alice's stream: %q", got)
	}
	if all := drain(admin.ch); !strings.Contains(all, a) || !strings.Contains(all, b) {
		t.Fatalf("admin stream misses events: %q", all)
	}
}

func drain(ch chan string) string {
	var b strings.Builder
	for {
		select {
		case m := <-ch:
			b.WriteString(m)
		case <-time.After(50 * time.Millisecond):
			return b.String()
		}
	}
}

func httptestRequest(user string) *http.Request {
	r, _ := http.NewRequest(http.MethodGet, "/api/brain/events", nil)
	r.Header.Set("X-Test-User", user)
	return r
}

var _ = fmt.Sprintf
