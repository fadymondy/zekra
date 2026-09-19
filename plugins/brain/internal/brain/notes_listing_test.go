package brain

import (
	"net/url"
	"testing"
	"time"
)

/*
Notes listing (tags=, pinned=, sort= with keyset paging per sort), the tag
counts endpoint, write access reported up front (brain detail, profile,
entity), and entity metadata null-key removal.
*/

func (f *fix) mkNote(ns, title string, tags []string, pinned bool) string {
	f.t.Helper()
	rec := f.do(req{method: "POST", path: "/api/notes", user: "u-alice",
		body: map[string]any{"namespace": ns, "title": title, "body": "body of " + title, "tags": tags, "pinned": pinned}})
	if rec.Code != 201 {
		f.t.Fatalf("create note %q: %d %s", title, rec.Code, rec.Body.String())
	}
	id, _ := decodeMap(f.t, rec)["id"].(string)
	time.Sleep(5 * time.Millisecond) // distinct updated_at / created_at
	return id
}

// pages walks every page of a notes listing and returns the titles in order.
func (f *fix) pages(q url.Values, limit int) []string {
	f.t.Helper()
	q.Set("limit", pad2(limit))
	out := []string{}
	for i := 0; i < 50; i++ {
		rec := f.do(req{method: "GET", path: "/api/notes?" + q.Encode(), user: "u-alice"})
		if rec.Code != 200 {
			f.t.Fatalf("list %v: %d %s", q, rec.Code, rec.Body.String())
		}
		m := decodeMap(f.t, rec)
		for _, n := range m["notes"].([]any) {
			out = append(out, n.(map[string]any)["title"].(string))
		}
		next, _ := m["nextCursor"].(string)
		if next == "" {
			return out
		}
		q.Set("cursor", next)
	}
	f.t.Fatal("paging did not end")
	return nil
}

func pad2(n int) string { return string(rune('0'+n/10)) + string(rune('0'+n%10)) }

func eq(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestNotesListingSortAndFilters(t *testing.T) {
	f := newFix(t)
	ns := f.ns("list")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner'), ($1,'u-carol','viewer')`, ns)
	// Pinned notes are OLDER than the unpinned ones, so only the pin boost puts them first.
	f.mkNote(ns, "p-one", []string{"a", "b"}, true)
	f.mkNote(ns, "p-two", []string{"a"}, true)
	f.mkNote(ns, "p-three", nil, true)
	f.mkNote(ns, "u-one", []string{"a", "b"}, false)
	f.mkNote(ns, "U-two", []string{"c"}, false)
	f.mkNote(ns, "u-three", nil, false)

	base := func() url.Values { return url.Values{"namespace": {ns}} }

	// sort=updated (default): pinned first on EVERY page, newest first within each group.
	want := []string{"p-three", "p-two", "p-one", "u-three", "U-two", "u-one"}
	for _, limit := range []int{1, 2, 4, 50} {
		if got := f.pages(base(), limit); !eq(got, want) {
			t.Errorf("updated, limit %d: %v", limit, got)
		}
	}
	q := base()
	q.Set("sort", "created")
	if got := f.pages(q, 2); !eq(got, []string{"u-three", "U-two", "u-one", "p-three", "p-two", "p-one"}) {
		t.Errorf("created: %v", got)
	}
	q = base()
	q.Set("sort", "title")
	if got := f.pages(q, 2); !eq(got, []string{"p-one", "p-three", "p-two", "u-one", "u-three", "U-two"}) {
		t.Errorf("title (case-insensitive): %v", got)
	}

	// Filters.
	q = base()
	q.Set("tags", "a,b")
	if got := f.pages(q, 50); !eq(got, []string{"p-one", "u-one"}) {
		t.Errorf("tags=a,b: %v", got)
	}
	q = base()
	q.Set("tag", "a")
	q.Set("tags", "b")
	if got := f.pages(q, 50); !eq(got, []string{"p-one", "u-one"}) {
		t.Errorf("tag=a&tags=b: %v", got)
	}
	q = base()
	q.Set("tag", "c")
	if got := f.pages(q, 50); !eq(got, []string{"U-two"}) {
		t.Errorf("tag=c still works: %v", got)
	}
	q = base()
	q.Set("pinned", "1")
	q.Set("sort", "title")
	if got := f.pages(q, 1); !eq(got, []string{"p-one", "p-three", "p-two"}) {
		t.Errorf("pinned=1: %v", got)
	}

	// Bad sort; a cursor from another sort.
	if rec := f.do(req{method: "GET", path: "/api/notes?namespace=" + ns + "&sort=size", user: "u-alice"}); rec.Code != 400 {
		t.Errorf("bad sort: %d", rec.Code)
	}
	rec := f.do(req{method: "GET", path: "/api/notes?namespace=" + ns + "&limit=1&sort=title", user: "u-alice"})
	cur, _ := decodeMap(t, rec)["nextCursor"].(string)
	if rec := f.do(req{method: "GET", path: "/api/notes?namespace=" + ns + "&limit=1&sort=created&cursor=" + url.QueryEscape(cur), user: "u-alice"}); rec.Code != 400 {
		t.Errorf("cross-sort cursor: %d", rec.Code)
	}
}

func TestNoteTagCounts(t *testing.T) {
	f := newFix(t)
	ns := f.ns("tags")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner'), ($1,'u-carol','viewer')`, ns)
	f.mkNote(ns, "one", []string{"alpha", "beta"}, false)
	f.mkNote(ns, "two", []string{"alpha"}, false)
	f.mkNote(ns, "three", []string{"gamma"}, false)
	gone := f.mkNote(ns, "four", []string{"alpha", "delta"}, false)
	if rec := f.do(req{method: "DELETE", path: "/api/notes/" + gone, user: "u-alice"}); rec.Code >= 300 {
		t.Fatalf("delete: %d", rec.Code)
	}

	rec := f.do(req{method: "GET", path: "/api/notes/tags?namespace=" + ns, user: "u-carol"})
	if rec.Code != 200 {
		t.Fatalf("tags as viewer: %d %s", rec.Code, rec.Body.String())
	}
	got := []string{}
	for _, x := range decodeMap(t, rec)["tags"].([]any) {
		m := x.(map[string]any)
		got = append(got, m["tag"].(string)+"="+pad2(int(m["count"].(float64))))
	}
	if !eq(got, []string{"alpha=02", "beta=01", "gamma=01"}) {
		t.Errorf("tag counts: %v", got)
	}
	for _, user := range []string{"u-bob", ""} {
		if rec := f.do(req{method: "GET", path: "/api/notes/tags?namespace=" + ns, user: user}); rec.Code != 403 {
			t.Errorf("tags as %q: %d", user, rec.Code)
		}
	}
}

func TestWriteAccessUpFront(t *testing.T) {
	f := newFix(t)
	ns := f.ns("wa")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner'), ($1,'u-bob','editor'), ($1,'u-carol','viewer')`, ns)
	rec := f.do(req{method: "POST", path: "/api/brain/entities", user: "u-alice",
		body: map[string]any{"namespace": ns, "name": "Ada", "entity_type": "concept", "create_type": true}})
	if rec.Code != 201 {
		t.Fatalf("create entity: %d %s", rec.Code, rec.Body.String())
	}
	eid, _ := decodeMap(t, rec)["id"].(string)

	for _, c := range []struct {
		user, role string
		write      bool
	}{{"u-alice", "owner", true}, {"u-bob", "editor", true}, {"u-carol", "viewer", false}, {"u-admin", "admin", true}} {
		d := decodeMap(t, f.do(req{method: "GET", path: "/api/brain/brain?namespace=" + ns, user: c.user}))
		if d["canWrite"] != c.write || d["role"] != c.role {
			t.Errorf("brain detail as %s: canWrite=%v role=%v", c.user, d["canWrite"], d["role"])
		}
		p := decodeMap(t, f.do(req{method: "GET", path: "/api/brain/profile?namespace=" + ns, user: c.user}))
		if p["canWrite"] != c.write || p["role"] != c.role {
			t.Errorf("profile as %s: canWrite=%v role=%v", c.user, p["canWrite"], p["role"])
		}
		e := decodeMap(t, f.do(req{method: "GET", path: "/api/brain/entities/" + eid, user: c.user}))
		if e["canWrite"] != c.write {
			t.Errorf("entity as %s: canWrite=%v", c.user, e["canWrite"])
		}
	}
}

func TestEntityMetadataNullRemovesKey(t *testing.T) {
	f := newFix(t)
	ns := f.ns("meta")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner')`, ns)
	rec := f.do(req{method: "POST", path: "/api/brain/entities", user: "u-alice",
		body: map[string]any{"namespace": ns, "name": "Grace", "entity_type": "concept", "create_type": true}})
	eid, _ := decodeMap(t, rec)["id"].(string)
	patch := func(meta map[string]any) map[string]any {
		t.Helper()
		rec := f.do(req{method: "PATCH", path: "/api/brain/entities/" + eid, user: "u-alice", body: map[string]any{"metadata": meta}})
		if rec.Code != 200 {
			t.Fatalf("patch %v: %d %s", meta, rec.Code, rec.Body.String())
		}
		m := decodeMap(t, f.do(req{method: "GET", path: "/api/brain/entities/" + eid, user: "u-alice"}))
		md, _ := m["metadata"].(map[string]any)
		return md
	}
	md := patch(map[string]any{"x": 1, "y": "two", "z": true})
	if md["x"] != float64(1) || md["y"] != "two" || md["z"] != true {
		t.Fatalf("set: %v", md)
	}
	md = patch(map[string]any{"x": nil, "y": "three"})
	if _, ok := md["x"]; ok || md["y"] != "three" || md["z"] != true {
		t.Errorf("null removes x, keeps z, updates y: %v", md)
	}
	md = patch(map[string]any{"absent": nil})
	if _, ok := md["absent"]; ok || md["z"] != true {
		t.Errorf("removing an absent key: %v", md)
	}
}
