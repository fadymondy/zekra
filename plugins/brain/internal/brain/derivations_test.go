package brain

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/togo-framework/brain/presentations"
)

// derivedFix spreads unrelated texts apart (sim ≈ 0.1) while texts that share
// their first three words still recall together.
func derivedFix(t *testing.T) *fix {
	t.Helper()
	return conflictFix(t, 3, nil)
}

func (f *fix) recallIDs(ns, query string, includeStale bool) map[string]Recalled {
	f.t.Helper()
	rec := f.do(req{method: "POST", path: "/api/brain/recall", user: "u-admin",
		body: map[string]any{"namespace": ns, "query": query, "expandEntity": false, "includeStale": includeStale}})
	if rec.Code != 200 {
		f.t.Fatalf("recall: %d %s", rec.Code, rec.Body)
	}
	var out struct{ Results []Recalled }
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	m := map[string]Recalled{}
	for _, r := range out.Results {
		m[r.ID] = r
	}
	return m
}

func (f *fix) provenance(kind, id string) *Provenance {
	f.t.Helper()
	p, err := f.svc.Store.Provenance(context.Background(), kind, id)
	if err != nil {
		f.t.Fatal(err)
	}
	return p
}

func TestDerivedMemoryGoesStaleWhenASourceIsForgotten(t *testing.T) {
	f := derivedFix(t)
	ns := f.ns("derived")
	ctx := context.Background()
	a := f.retain(MemoryInput{Namespace: ns, Content: "orion launch plan: the beta opens in march", SourceKind: "manual"})
	b := f.retain(MemoryInput{Namespace: ns, Content: "orion launch plan: pricing starts at ten dollars", SourceKind: "manual"})
	sum := f.retain(MemoryInput{Namespace: ns, Content: "orion launch plan summary: march beta at ten dollars",
		SourceKind: "manual", DerivedFrom: []string{a.ID, b.ID, a.ID, "not-a-uuid"}, DerivedVia: "summary"})
	if n := f.count(`SELECT count(*) FROM memory_derivations WHERE derived_id = $1 AND via = 'summary'`, sum.ID); n != 2 {
		t.Fatalf("summary has %d derivation links, want 2", n)
	}
	if _, ok := f.recallIDs(ns, "orion launch plan", false)[sum.ID]; !ok {
		t.Fatal("a summary with fresh sources should be recalled")
	}

	if _, err := f.svc.Store.Forget(ctx, ns, a.ID, "beta moved"); err != nil {
		t.Fatal(err)
	}
	if _, ok := f.recallIDs(ns, "orion launch plan", false)[sum.ID]; ok {
		t.Fatal("a summary of a forgotten memory is still recalled by default")
	}
	got, ok := f.recallIDs(ns, "orion launch plan", true)[sum.ID]
	if !ok || len(got.StaleSource) != 1 {
		t.Fatalf("includeStale should return the summary flagged: %+v", got)
	}
	if s := got.StaleSource[0]; s.Source != a.ID || s.Reason != "invalidated" || s.Depth != 1 {
		t.Fatalf("staleSource = %+v", s)
	}
	if n := f.count(`SELECT count(*) FROM memory_derivations WHERE derived_id = $1 AND source_id = $2 AND stale_reason = 'invalidated' AND stale_at IS NOT NULL`, sum.ID, a.ID); n != 1 {
		t.Fatal("the direct link to the forgotten source was not stamped")
	}
	if n := f.count(`SELECT count(*) FROM memory_derivations WHERE derived_id = $1 AND source_id = $2 AND stale_at IS NULL`, sum.ID, b.ID); n != 1 {
		t.Fatal("the link to the still-valid source must stay unstamped")
	}
	if n := f.count(`SELECT count(*) FROM memory_events WHERE namespace = $1 AND op = 'stale' AND metadata->>'outcome' = 'invalidated'`, ns); n != 1 {
		t.Fatalf("%d stale events, want 1", n)
	}

	// The source comes back: its dependents are fresh again.
	f.exec(`UPDATE memories SET invalid_at = NULL WHERE id = $1`, a.ID)
	db, _ := f.svc.Store.db(ctx)
	f.svc.Store.clearStale(ctx, db, []string{a.ID})
	if _, ok := f.recallIDs(ns, "orion launch plan", false)[sum.ID]; !ok {
		t.Fatal("restoring the source should make the summary fresh again")
	}
	if n := f.count(`SELECT count(*) FROM memory_derivations WHERE derived_id = $1 AND stale_at IS NOT NULL`, sum.ID); n != 0 {
		t.Fatal("clearStale left a stamp behind")
	}
}

func TestStaleSourcePropagatesThroughDerivedMemories(t *testing.T) {
	f := derivedFix(t)
	ns := f.ns("chain")
	ctx := context.Background()
	src := f.retain(MemoryInput{Namespace: ns, Content: "vega region is eu-west-1", SourceKind: "manual"})
	mid := f.retain(MemoryInput{Namespace: ns, Content: "vega deploys run in ireland", SourceKind: "manual", DerivedFrom: []string{src.ID}})
	top := f.retain(MemoryInput{Namespace: ns, Content: "vega latency budget assumes ireland", SourceKind: "manual",
		DerivedFrom: []string{mid.ID}, DerivedVia: "consolidation"})
	if p := f.provenance(DerivedMemory, top.ID); len(p.StaleSource) != 0 || len(p.DerivedFrom) != 1 || p.DerivedFrom[0].ID != mid.ID {
		t.Fatalf("fresh chain provenance = %+v", p)
	}
	if _, err := f.svc.Store.Forget(ctx, ns, src.ID, ""); err != nil {
		t.Fatal(err)
	}
	p := f.provenance(DerivedMemory, top.ID)
	if len(p.StaleSource) != 1 || p.StaleSource[0].Source != src.ID || p.StaleSource[0].Depth != 2 {
		t.Fatalf("a source two hops up should make the top stale: %+v", p.StaleSource)
	}
	if p := f.provenance(DerivedMemory, src.ID); len(p.Dependents) != 1 || p.Dependents[0].ID != mid.ID || p.Dependents[0].StaleReason != "invalidated" {
		t.Fatalf("source dependents = %+v", p.Dependents)
	}
	if _, ok := f.recallIDs(ns, "vega latency budget", false)[top.ID]; ok {
		t.Fatal("a transitively stale memory is still recalled by default")
	}
}

func TestSupersedeAndEditMarkDependentsStale(t *testing.T) {
	f := conflictFix(t, 0.3, nil) // sim ≈ 0.92: a same-author rewrite is an UPDATE
	ns := f.ns("supersede")
	ctx := context.Background()
	old := f.retain(MemoryInput{Namespace: ns, Content: "the release train leaves on friday", SourceKind: "claude_code", OwnerAgentID: "agent-x"})
	dep := f.retain(MemoryInput{Namespace: ns, Content: "weekend on-call covers friday releases", SourceKind: "manual", DerivedFrom: []string{old.ID}})
	neu := f.retain(MemoryInput{Namespace: ns, Content: "the release train leaves on tuesday", SourceKind: "claude_code", OwnerAgentID: "agent-x"})
	if neu.SupersededID != old.ID || neu.StaleDependents != 1 {
		t.Fatalf("update retain = %+v, want it to supersede %s and report 1 stale dependent", neu, old.ID)
	}
	p := f.provenance(DerivedMemory, dep.ID)
	if len(p.StaleSource) != 1 || p.StaleSource[0].Reason != "superseded" || p.StaleSource[0].SupersededBy == "" {
		t.Fatalf("staleSource after supersede = %+v", p.StaleSource)
	}

	// Editing a valid source's wording also stales what was derived from it,
	// until the dependent is derived again.
	src := f.retain(MemoryInput{Namespace: ns, Content: "build cache lives on the e drive", SourceKind: "manual"})
	dep2 := f.retain(MemoryInput{Namespace: ns, Content: "ci runners mount drive e for caching", SourceKind: "manual", DerivedFrom: []string{src.ID}})
	if err := f.svc.Store.EditMemory(ctx, ns, src.ID, "build cache lives on the d drive", 0, nil); err != nil {
		t.Fatal(err)
	}
	p = f.provenance(DerivedMemory, dep2.ID)
	if len(p.StaleSource) != 1 || p.StaleSource[0].Reason != "edited" {
		t.Fatalf("staleSource after edit = %+v", p.StaleSource)
	}
	db, _ := f.svc.Store.db(ctx)
	f.svc.Store.linkDerived(ctx, db, ns, DerivedMemory, dep2.ID, ViaRetain, []string{src.ID})
	if p := f.provenance(DerivedMemory, dep2.ID); len(p.StaleSource) != 0 {
		t.Fatalf("deriving again should clear the edited stamp: %+v", p.StaleSource)
	}
}

func TestDerivationStaysInsideItsBrain(t *testing.T) {
	f := derivedFix(t)
	ns, other := f.ns("own"), f.ns("other")
	foreign := f.retain(MemoryInput{Namespace: other, Content: "secret roadmap item", SourceKind: "manual"})
	d := f.retain(MemoryInput{Namespace: ns, Content: "public roadmap", SourceKind: "manual", DerivedFrom: []string{foreign.ID}})
	if n := f.count(`SELECT count(*) FROM memory_derivations WHERE derived_id = $1`, d.ID); n != 0 {
		t.Fatal("a derivation linked a memory from another brain")
	}
}

func TestProvenanceEndpoint(t *testing.T) {
	f := derivedFix(t)
	ns, other := f.ns("prov"), f.ns("prov2")
	src := f.retain(MemoryInput{Namespace: ns, Content: "atlas owner is alice", SourceKind: "manual"})
	d := f.retain(MemoryInput{Namespace: ns, Content: "ask alice about atlas", SourceKind: "manual", DerivedFrom: []string{src.ID}})
	f.retain(MemoryInput{Namespace: other, Content: "unrelated", SourceKind: "manual"})

	path := "/api/brain/provenance?namespace=" + ns + "&id=" + d.ID
	if rec := f.do(req{method: "GET", path: path, user: "u-carol"}); rec.Code != 403 {
		t.Fatalf("a caller without read access got provenance: %d", rec.Code)
	}
	if rec := f.do(req{method: "GET", path: "/api/brain/provenance?namespace=" + other + "&id=" + d.ID, user: "u-admin"}); rec.Code != 404 {
		t.Fatalf("asking through another brain should be not found: %d %s", rec.Code, rec.Body)
	}
	rec := f.do(req{method: "GET", path: path, user: "u-admin"})
	var p Provenance
	_ = json.Unmarshal(rec.Body.Bytes(), &p)
	if rec.Code != 200 || len(p.DerivedFrom) != 1 || p.DerivedFrom[0].ID != src.ID || !p.DerivedFrom[0].Valid {
		t.Fatalf("provenance = %d %s", rec.Code, rec.Body)
	}
	rec = f.do(req{method: "GET", path: "/api/brain/provenance?namespace=" + ns + "&id=" + src.ID, user: "u-admin"})
	_ = json.Unmarshal(rec.Body.Bytes(), &p)
	if len(p.Dependents) != 1 || p.Dependents[0].ID != d.ID {
		t.Fatalf("source dependents = %s", rec.Body)
	}
}

func TestPresentationFollowsItsSources(t *testing.T) {
	f := derivedFix(t)
	ns := f.ns("deck")
	ctx := context.Background()
	m := f.retain(MemoryInput{Namespace: ns, Content: "q3 revenue grew twelve percent", SourceKind: "manual"})
	n := f.svc.Store.linkPresentation(ctx, ns, []string{"pres-1", "pres-2"}, []presentations.Material{
		{Kind: "memory", Ref: m.ID}, {Kind: "entity", Ref: "e1"}})
	if n != 2 {
		t.Fatalf("linked %d presentation sources, want 2", n)
	}
	if _, err := f.svc.Store.Forget(ctx, ns, m.ID, ""); err != nil {
		t.Fatal(err)
	}
	p := f.provenance(DerivedPresentation, "pres-1")
	if len(p.StaleSource) != 1 || p.StaleSource[0].Source != m.ID {
		t.Fatalf("presentation staleSource = %+v", p.StaleSource)
	}
	if len(f.provenance(DerivedMemory, m.ID).Dependents) != 2 {
		t.Fatal("the memory should list both presentations as dependents")
	}
}
