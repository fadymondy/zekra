package brain

import (
	"context"
	"fmt"
	"testing"
	"time"
)

// fakeReranker scores each doc by a fixed map and can be made slow.
type fakeReranker struct {
	delay  time.Duration
	scores map[string]float64
	sent   int
}

func (f *fakeReranker) Rerank(ctx context.Context, _ string, docs []string) ([]float64, error) {
	f.sent = len(docs)
	select {
	case <-time.After(f.delay):
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	out := make([]float64, len(docs))
	for i, d := range docs {
		out[i] = f.scores[d]
	}
	return out, nil
}

func pool(ids ...string) []Recalled {
	out := make([]Recalled, len(ids))
	for i, id := range ids {
		out[i] = Recalled{ID: id, Content: id, Score: float64(len(ids) - i)}
	}
	return out
}

func ids(p []Recalled) string {
	s := ""
	for _, r := range p {
		s += r.ID
	}
	return s
}

func TestRerankReordersWithinBudget(t *testing.T) {
	t.Setenv("BRAIN_RERANK_TIMEOUT", "1s")
	p := pool("a", "b", "c")
	rerankHead(context.Background(), &fakeReranker{scores: map[string]float64{"a": 0.1, "b": 0.9, "c": 0.5}}, "q", p)
	if got := ids(p); got != "bca" {
		t.Fatalf("order %q, want bca", got)
	}
}

func TestSlowRerankKeepsTheHybridOrder(t *testing.T) {
	// The production failure: the cross-encoder takes ~2.2s per document on
	// CPU, so waiting made every recall a 30s call. Past the budget the RRF
	// order must be returned untouched — not partially rescored, not empty.
	t.Setenv("BRAIN_RERANK_TIMEOUT", "50ms")
	p := pool("a", "b", "c")
	start := time.Now()
	rerankHead(context.Background(), &fakeReranker{delay: 2 * time.Second, scores: map[string]float64{"c": 9}}, "q", p)
	if el := time.Since(start); el > 500*time.Millisecond {
		t.Fatalf("waited %v past a 50ms budget", el)
	}
	if got := ids(p); got != "abc" {
		t.Fatalf("order changed to %q on a timed-out rerank", got)
	}
	if p[0].Score != 3 {
		t.Fatalf("scores were overwritten: %+v", p)
	}
}

func TestRerankNeverSendsMoreThanTEIAccepts(t *testing.T) {
	// TEI rejects batches over its max-client-batch-size (32) with HTTP 413,
	// which Recall swallowed — so a full 40-row pool was never reranked at all.
	t.Setenv("BRAIN_RERANK_TIMEOUT", "1s")
	var names []string
	for i := 0; i < 40; i++ {
		names = append(names, fmt.Sprintf("%02d", i))
	}
	p := pool(names...)
	scores := map[string]float64{"31": 100} // the last doc inside the head
	fr := &fakeReranker{scores: scores}
	rerankHead(context.Background(), fr, "q", p)
	if fr.sent != rerankMaxDocs {
		t.Fatalf("sent %d docs, want %d", fr.sent, rerankMaxDocs)
	}
	if p[0].ID != "31" {
		t.Fatalf("head not reranked: first is %q", p[0].ID)
	}
	// The tail keeps its original order after the reranked head.
	if p[32].ID != "32" || p[39].ID != "39" {
		t.Fatalf("tail disturbed: %q … %q", p[32].ID, p[39].ID)
	}
}

func TestRerankBudgetZeroDisables(t *testing.T) {
	t.Setenv("BRAIN_RERANK_TIMEOUT", "0")
	fr := &fakeReranker{scores: map[string]float64{"c": 9}}
	p := pool("a", "b", "c")
	rerankHead(context.Background(), fr, "q", p)
	if fr.sent != 0 || ids(p) != "abc" {
		t.Fatalf("reranker called with budget 0: sent=%d order=%q", fr.sent, ids(p))
	}
}
