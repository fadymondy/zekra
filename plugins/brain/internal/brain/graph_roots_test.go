package brain

import (
	"encoding/json"
	"net/http"
	"testing"
)

// The tree view's top level (MH-306). Every assertion here is about a property
// the sidebar depends on, not about the SQL: hub types win, degree orders them,
// both edge directions count, dead edges do not, and an untyped brain still
// gets a usable list instead of an empty tree.

type rootsAnswer struct {
	Roots []struct {
		Name   string `json:"name"`
		Type   string `json:"type"`
		Degree int    `json:"degree"`
	} `json:"roots"`
	Count    int  `json:"count"`
	Fallback bool `json:"fallback"`
}

func (f *fix) roots(ns, user string) rootsAnswer {
	f.t.Helper()
	rec := f.do(req{method: "POST", path: "/api/brain/graph/roots", user: user, body: map[string]any{"namespace": ns}})
	if rec.Code != http.StatusOK {
		f.t.Fatalf("roots: %d %s", rec.Code, rec.Body)
	}
	var out rootsAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		f.t.Fatal(err)
	}
	return out
}

// entity inserts a typed node directly; these tests are about the projection,
// not about how entities come to exist.
func (f *fix) entity(ns, name, kind string) string {
	f.t.Helper()
	var id string
	db, err := f.svc.Store.db(f.t.Context())
	if err != nil {
		f.t.Fatal(err)
	}
	if err := db.QueryRow(
		`INSERT INTO entities (namespace, name, entity_type) VALUES ($1,$2,$3) RETURNING id::text`,
		ns, name, kind).Scan(&id); err != nil {
		f.t.Fatal(err)
	}
	return id
}

func (f *fix) edge(ns, src, dst, relation string, dead bool) {
	f.t.Helper()
	validTo := "NULL"
	if dead {
		validTo = "now()"
	}
	f.exec(`INSERT INTO entity_edges (namespace, src_id, dst_id, relation, valid_to)
	        VALUES ($1,$2,$3,$4,`+validTo+`)`, ns, src, dst, relation)
}

func TestGraphRootsPrefersHubsByDegree(t *testing.T) {
	f := newFix(t)
	ns := f.ns("roots")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner')`, ns)

	acme := f.entity(ns, "Acme", "venture")
	repo := f.entity(ns, "acme/api", "repo")
	ada := f.entity(ns, "Ada", "person")
	doc := f.entity(ns, "Charter", "note")

	// Acme: three live edges, and deliberately as the DST of one of them — a
	// venture that is only ever the target of OWNS is still the hub of its
	// own subtree, which is why degree counts both directions.
	f.edge(ns, acme, repo, "owns", false)
	f.edge(ns, acme, ada, "employs", false)
	f.edge(ns, doc, acme, "describes", false)
	// One dead edge that must not count.
	f.edge(ns, acme, doc, "mentions", true)
	// The repo has two live edges (one shared with Acme above).
	f.edge(ns, repo, ada, "maintained_by", false)

	got := f.roots(ns, "u-alice")
	if got.Fallback {
		t.Fatal("fell back despite typed hubs existing")
	}
	if len(got.Roots) != 2 {
		t.Fatalf("want the two hub-typed entities, got %+v", got.Roots)
	}
	// Ordered by degree: Acme (3 live) before the repo (2 live).
	if got.Roots[0].Name != "Acme" || got.Roots[0].Degree != 3 {
		t.Errorf("first root %+v; the dead edge or a direction is being miscounted", got.Roots[0])
	}
	if got.Roots[1].Name != "acme/api" || got.Roots[1].Degree != 2 {
		t.Errorf("second root %+v", got.Roots[1])
	}
	// A person and a note are not hub types, however connected they are.
	for _, r := range got.Roots {
		if r.Type == "person" || r.Type == "note" {
			t.Errorf("non-hub type %q surfaced as a root", r.Type)
		}
	}
}

func TestGraphRootsFallsBackWhenNoHubsAreTyped(t *testing.T) {
	f := newFix(t)
	ns := f.ns("rootsfb")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner')`, ns)

	// A brain with a graph but no repo/venture/feed in it. Returning nothing
	// here would render an empty tree, which reads as breakage rather than as
	// "this brain has no declared structure".
	ada := f.entity(ns, "Ada", "person")
	plan := f.entity(ns, "Plan", "note")
	side := f.entity(ns, "Aside", "note")
	f.edge(ns, ada, plan, "wrote", false)
	f.edge(ns, plan, side, "links", false)

	got := f.roots(ns, "u-alice")
	if !got.Fallback {
		t.Fatal("did not report the fallback, so the caller cannot tell these are not real hubs")
	}
	if len(got.Roots) != 3 || got.Roots[0].Name != "Plan" {
		t.Fatalf("want the most-connected entities of any type, got %+v", got.Roots)
	}
}

func TestGraphRootsIsEmptyForAnEdgelessBrain(t *testing.T) {
	f := newFix(t)
	ns := f.ns("rootsempty")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner')`, ns)
	f.entity(ns, "Lonely", "venture")

	// An entity with no edges is not a hub in any useful sense, so it does not
	// carry the top level; the tree renders its own empty state.
	got := f.roots(ns, "u-alice")
	if len(got.Roots) != 0 || got.Count != 0 {
		t.Fatalf("want no roots, got %+v", got.Roots)
	}
}

func TestGraphRootsRefusesAStranger(t *testing.T) {
	f := newFix(t)
	ns := f.ns("rootsacl")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner')`, ns)
	acme := f.entity(ns, "Acme", "venture")
	repo := f.entity(ns, "acme/api", "repo")
	f.edge(ns, acme, repo, "owns", false)

	// The graph is as sensitive as the notes it is built from, so the roots
	// endpoint is read-gated like every other graph route.
	rec := f.do(req{method: "POST", path: "/api/brain/graph/roots", user: "u-mallory", body: map[string]any{"namespace": ns}})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403 for a non-member, got %d %s", rec.Code, rec.Body)
	}
}
