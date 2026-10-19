package brain

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// --- pure units -----------------------------------------------------------------

func TestConflictCandidatePrefilter(t *testing.T) {
	n := func(sim float64, content string) neighbor { return neighbor{ID: "a", Content: content, Sim: sim} }
	cases := []struct {
		name string
		n    neighbor
		in   string
		want bool
	}{
		{"same subject, similar", n(0.8, "the deploy window is friday 18:00 utc"), "the deploy window is monday 09:00 utc", true},
		{"below the floor", n(0.6, "the deploy window is friday"), "the deploy window is monday", false},
		{"a duplicate is not a conflict", n(0.98, "the deploy window is friday"), "the deploy window is monday", false},
		{"same text", n(0.9, "Deploy window is Friday"), "deploy  window is friday", false},
		{"no shared words", n(0.8, "postgres listens on 5432"), "alice prefers tea", false},
	}
	for _, c := range cases {
		if got := conflictCandidate(c.n, c.in, 0.72); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestHeuristicJudge(t *testing.T) {
	j := heuristicJudge{}
	cases := []struct {
		a, b string
		want bool
		kind string
	}{
		{"the API supports pagination", "the API does not support pagination", true, "negation"},
		{"the API supports pagination", "the API doesn't support pagination", true, "negation"},
		{"postgres runs on port 5432 in staging", "postgres runs on port 55432 in staging", true, "numeric"},
		{"postgres runs on port 5432 in staging", "postgres runs on port 5432 in staging today", false, ""},
		{"alice likes tea", "alice likes green tea", false, ""},
	}
	for _, c := range cases {
		v, err := j.Judge(context.Background(), c.a, c.b)
		if err != nil {
			t.Fatal(err)
		}
		if v.Contradicts != c.want || (c.want && v.Kind != c.kind) {
			t.Errorf("%q vs %q: got %+v, want contradicts=%v kind=%s", c.a, c.b, v, c.want, c.kind)
		}
		if v.Contradicts && v.Confidence >= conflictFlipConfidence {
			t.Errorf("heuristic must never be confident enough to overrule a write (%v)", v.Confidence)
		}
	}
}

func TestParseVerdict(t *testing.T) {
	v, err := parseVerdict("```json\n{\"contradicts\":true,\"kind\":\"weird\",\"reason\":\" r \",\"confidence\":1.7,\"scoped\":false}\n```")
	if err != nil {
		t.Fatal(err)
	}
	if !v.Contradicts || v.Kind != "factual" || v.Reason != "r" || v.Confidence != 1 {
		t.Fatalf("normalised verdict = %+v", v)
	}
	for _, bad := range []string{"", "yes they contradict", `{"kind":"factual"}`, `{"contradicts":"maybe","confidence":0.5}`} {
		if _, err := parseVerdict(bad); err == nil {
			t.Errorf("parseVerdict(%q) accepted malformed output", bad)
		}
	}
}

func TestConflictCredibility(t *testing.T) {
	now := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	manual := memFacts{ID: "m", SourceKind: "manual", Importance: 0.5, ValidAt: now.Add(-24 * time.Hour)}
	chat := memFacts{ID: "c", SourceKind: "chat", Importance: 0.5, ValidAt: now}
	if pref, _ := preferredOf(manual, chat, now); pref != "m" {
		t.Errorf("a hand-written memory should beat a newer chat-derived one, got %s", pref)
	}
	old := memFacts{ID: "o", SourceKind: "note", Importance: 0.5, ValidAt: now.Add(-365 * 24 * time.Hour)}
	fresh := memFacts{ID: "f", SourceKind: "note", Importance: 0.5, ValidAt: now}
	if pref, _ := preferredOf(old, fresh, now); pref != "f" {
		t.Errorf("same source: the recent memory should win, got %s", pref)
	}
	a := memFacts{ID: "a", SourceKind: "note", Importance: 0.5, ValidAt: now}
	b := memFacts{ID: "b", SourceKind: "note", Importance: 0.5, ValidAt: now.Add(time.Minute)}
	if pref, _ := preferredOf(a, b, now.Add(time.Minute)); pref != "b" {
		t.Errorf("a tie should go to the newer memory, got %s", pref)
	}
	c := conflictCredibility(memFacts{SourceKind: "manual", Importance: 1, ValidAt: now}, now)
	if math.Abs(c["score"]-1) > 1e-9 {
		t.Errorf("a fresh manual memory of importance 1 scores %v, want 1", c["score"])
	}
}

func TestLLMJudgeStrictSchema(t *testing.T) {
	var body map[string]any
	reply := `{"contradicts":true,"kind":"temporal","reason":"different days","confidence":0.9,"scoped":false}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": reply}}}})
	}))
	defer srv.Close()
	j := &llmJudge{url: srv.URL, model: "m", client: srv.Client()}
	v, err := j.Judge(context.Background(), "deploys run on friday", "deploys run on monday")
	if err != nil || !v.Contradicts || v.Kind != "temporal" {
		t.Fatalf("verdict %+v, %v", v, err)
	}
	rf, _ := body["response_format"].(map[string]any)
	js, _ := rf["json_schema"].(map[string]any)
	if rf["type"] != "json_schema" || js["strict"] != true {
		t.Fatalf("request does not ask for a strict JSON schema: %v", body["response_format"])
	}
	reply = "I think so"
	if _, err := j.Judge(context.Background(), "a", "b"); err == nil {
		t.Fatal("a malformed LLM answer must be an error (fail open)")
	}
}

// --- database-backed --------------------------------------------------------------

// subjectEmbedder makes "same subject" measurable: the first three words set the
// main direction and the full text adds noise of weight w, so two different
// texts about the same subject sit at cosine ≈ 1/(1+w²).
type subjectEmbedder struct{ w float64 }

func (subjectEmbedder) Dim() int { return 1024 }

func (e subjectEmbedder) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	out := make([][]float32, len(texts))
	for i, t := range texts {
		words := strings.Fields(strings.ToLower(t))
		if len(words) > 3 {
			words = words[:3]
		}
		vs, _ := fakeEmbedder{}.Embed(ctx, []string{strings.Join(words, " "), t})
		v := make([]float32, 1024)
		var norm float64
		for j := range v {
			x := float64(vs[0][j]) + e.w*float64(vs[1][j])
			v[j] = float32(x)
			norm += x * x
		}
		for j := range v {
			v[j] /= float32(math.Sqrt(norm))
		}
		out[i] = v
	}
	return out, nil
}

type fakeJudge struct {
	calls   atomic.Int32
	verdict ConflictVerdict
	err     error
}

func (j *fakeJudge) Judge(context.Context, string, string) (*ConflictVerdict, error) {
	j.calls.Add(1)
	if j.err != nil {
		return nil, j.err
	}
	v := j.verdict
	return &v, nil
}

func conflictFix(t *testing.T, w float64, j ConflictJudge) *fix {
	t.Helper()
	t.Setenv("BRAIN_CONFLICT_DETECT", "")
	f := newFix(t)
	RegisterEmbedder(f.svc.Store.k, subjectEmbedder{w: w})
	if j != nil {
		RegisterConflictJudge(f.svc.Store.k, j)
	}
	return f
}

func (f *fix) retain(in MemoryInput) *RetainResult {
	f.t.Helper()
	res, err := f.svc.Store.Retain(context.Background(), in)
	if err != nil {
		f.t.Fatal(err)
	}
	return res
}

func (f *fix) valid(id string) bool {
	f.t.Helper()
	return f.count(`SELECT count(*) FROM memories WHERE id = $1 AND invalid_at IS NULL`, id) == 1
}

var contradicts = ConflictVerdict{Contradicts: true, Kind: "temporal", Reason: "different days", Confidence: 0.9}

func TestConflictRecordedOpenAndSurfacedInRecall(t *testing.T) {
	j := &fakeJudge{verdict: contradicts}
	f := conflictFix(t, 0.6, j) // sim ≈ 0.74: an ADD that the pre-filter still judges
	ns := f.ns("conflict")
	old := f.retain(MemoryInput{Namespace: ns, Content: "the deploy window is friday 18:00 utc", SourceKind: "chat"})
	neu := f.retain(MemoryInput{Namespace: ns, Content: "the deploy window is monday 09:00 utc", SourceKind: "manual"})
	if neu.Decision != "add" || len(neu.Conflicts) != 1 {
		t.Fatalf("retain = %+v, want an add with one conflict", neu)
	}
	c := neu.Conflicts[0]
	if c.Status != ConflictOpen || c.With != old.ID || c.Preferred != neu.ID {
		t.Fatalf("conflict ref = %+v (manual should be preferred over chat)", c)
	}
	if !f.valid(old.ID) || !f.valid(neu.ID) {
		t.Fatal("both facts must stay valid while the conflict is open")
	}

	rec := f.do(req{method: "GET", path: "/api/brain/conflicts?namespace=" + ns, user: "u-admin"})
	if rec.Code != 200 {
		t.Fatalf("list: %d %s", rec.Code, rec.Body)
	}
	var list struct{ Conflicts []Conflict }
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list.Conflicts) != 1 || list.Conflicts[0].A.ID != old.ID || list.Conflicts[0].B.Content == "" ||
		list.Conflicts[0].Credibility["rule"] == nil {
		t.Fatalf("list = %s", rec.Body)
	}
	if rec := f.do(req{method: "GET", path: "/api/brain/conflicts?namespace=" + ns, user: "u-carol"}); rec.Code != 403 {
		t.Fatalf("a caller without read access listed conflicts: %d", rec.Code)
	}

	rec = f.do(req{method: "POST", path: "/api/brain/recall", user: "u-admin",
		body: map[string]any{"namespace": ns, "query": "the deploy window is", "expandEntity": false}})
	var out struct {
		Results   []Recalled
		Conflicts []ConflictRef
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if len(out.Conflicts) != 1 || out.Conflicts[0].ID != c.ID {
		t.Fatalf("recall top-level conflicts = %s", rec.Body)
	}
	pos := map[string]int{}
	for i, r := range out.Results {
		pos[r.ID] = i
		if len(r.Conflicts) != 1 {
			t.Fatalf("result %s carries %d conflicts", r.ID, len(r.Conflicts))
		}
	}
	if pos[neu.ID] > pos[old.ID] {
		t.Fatalf("the less credible side ranks above the preferred one: %v", pos)
	}
}

func TestConflictDoesNotLetAnotherAuthorOverwrite(t *testing.T) {
	f := conflictFix(t, 0.3, &fakeJudge{verdict: contradicts}) // sim ≈ 0.92: an UPDATE
	ns := f.ns("overwrite")
	old := f.retain(MemoryInput{Namespace: ns, Content: "the release train leaves on friday", SourceKind: "claude_code", OwnerAgentID: "agent-x"})
	neu := f.retain(MemoryInput{Namespace: ns, Content: "the release train leaves on tuesday", SourceKind: "claude_code", OwnerAgentID: "agent-y"})
	if neu.Decision != "add" || neu.SupersededID != "" {
		t.Fatalf("another author's contradiction overwrote: %+v", neu)
	}
	if !f.valid(old.ID) || !f.valid(neu.ID) || len(neu.Conflicts) != 1 || neu.Conflicts[0].Status != ConflictOpen {
		t.Fatalf("want both valid and an open conflict, got %+v", neu)
	}
}

func TestConflictSelfCorrectionUpdates(t *testing.T) {
	f := conflictFix(t, 0.3, &fakeJudge{verdict: contradicts})
	ns := f.ns("selffix")
	old := f.retain(MemoryInput{Namespace: ns, Content: "the release train leaves on friday", SourceKind: "claude_code", OwnerAgentID: "agent-x"})
	neu := f.retain(MemoryInput{Namespace: ns, Content: "the release train leaves on tuesday", SourceKind: "claude_code", OwnerAgentID: "agent-x"})
	if neu.Decision != "update" || neu.SupersededID != old.ID {
		t.Fatalf("a self-correction should update: %+v", neu)
	}
	if len(neu.Conflicts) != 1 || neu.Conflicts[0].Status != ConflictKeepNew {
		t.Fatalf("the correction should be recorded resolved_keep_new: %+v", neu.Conflicts)
	}
	if n := f.count(`SELECT count(*) FROM memories WHERE id = $1 AND metadata->>'invalidated_by_conflict' = $2`, old.ID, neu.Conflicts[0].ID); n != 1 {
		t.Fatal("the retired memory does not point at its conflict")
	}
}

func TestConflictNegationRecorded(t *testing.T) {
	f := conflictFix(t, 0.3, &fakeJudge{verdict: ConflictVerdict{}})
	ns := f.ns("negation")
	old := f.retain(MemoryInput{Namespace: ns, Content: "the staging api key rotates monthly", SourceKind: "manual"})
	neu := f.retain(MemoryInput{Namespace: ns, Content: "the staging api correction: the key no longer rotates monthly", SourceKind: "manual"})
	if neu.Decision != "invalidate" || len(neu.Conflicts) != 1 {
		t.Fatalf("retain = %+v", neu)
	}
	if c := neu.Conflicts[0]; c.Detector != "negation" || c.Status != ConflictKeepNew || c.With != old.ID {
		t.Fatalf("negation conflict = %+v", c)
	}
}

func TestConflictNoopAndJudgeFailure(t *testing.T) {
	j := &fakeJudge{err: errors.New("llm down")}
	f := conflictFix(t, 0.6, j)
	ns := f.ns("failopen")
	f.retain(MemoryInput{Namespace: ns, Content: "the deploy window is friday 18:00 utc", SourceKind: "manual"})
	if res := f.retain(MemoryInput{Namespace: ns, Content: "the deploy window is friday 18:00 utc", SourceKind: "manual"}); res.Decision != "noop" || j.calls.Load() != 0 {
		t.Fatalf("a NOOP must not be judged: %+v, %d calls", res, j.calls.Load())
	}
	res := f.retain(MemoryInput{Namespace: ns, Content: "the deploy window is monday 09:00 utc", SourceKind: "manual"})
	if res.Decision != "add" || len(res.Conflicts) != 0 || j.calls.Load() != 1 {
		t.Fatalf("a failing judge must fail open: %+v, %d calls", res, j.calls.Load())
	}
}

func TestResolveConflictKeepOldThenKeepNew(t *testing.T) {
	f := conflictFix(t, 0.6, &fakeJudge{verdict: contradicts})
	ns := f.ns("resolve")
	old := f.retain(MemoryInput{Namespace: ns, Content: "the deploy window is friday 18:00 utc", SourceKind: "manual"})
	neu := f.retain(MemoryInput{Namespace: ns, Content: "the deploy window is monday 09:00 utc", SourceKind: "manual"})
	id := neu.Conflicts[0].ID

	if rec := f.do(req{method: "POST", path: "/api/brain/conflicts/resolve", user: "u-carol",
		body: map[string]any{"id": id, "resolution": "keep_old"}}); rec.Code != 403 {
		t.Fatalf("a caller without write access resolved a conflict: %d", rec.Code)
	}
	if rec := f.do(req{method: "POST", path: "/api/brain/conflicts/resolve", user: "u-admin",
		body: map[string]any{"id": id, "resolution": "pick one"}}); rec.Code != 400 {
		t.Fatalf("an unknown resolution: %d", rec.Code)
	}
	rec := f.do(req{method: "POST", path: "/api/brain/conflicts/resolve", user: "u-admin",
		body: map[string]any{"id": id, "resolution": "keep_old", "note": "friday is right"}})
	if rec.Code != 200 || decodeMap(t, rec)["status"] != ConflictKeepOld {
		t.Fatalf("resolve: %d %s", rec.Code, rec.Body)
	}
	if !f.valid(old.ID) || f.valid(neu.ID) {
		t.Fatal("keep_old must retire the newer memory only")
	}
	// Changing one's mind restores the retired side and retires the other.
	if _, err := f.svc.Store.ResolveConflict(context.Background(), id, "keep_new", ""); err != nil {
		t.Fatal(err)
	}
	if f.valid(old.ID) || !f.valid(neu.ID) {
		t.Fatal("keep_new after keep_old must swap which memory is valid")
	}
	if _, err := f.svc.Store.ResolveConflict(context.Background(), id, "both_valid_scoped", "two regions"); err != nil {
		t.Fatal(err)
	}
	if !f.valid(old.ID) || !f.valid(neu.ID) {
		t.Fatal("both_valid_scoped must keep both")
	}
	if n := f.count(`SELECT count(*) FROM memory_conflicts WHERE id = $1 AND resolution_note = 'two regions' AND resolved_at IS NOT NULL`, id); n != 1 {
		t.Fatal("the resolution note was not kept")
	}
}
