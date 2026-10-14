package brain

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

// The production failure (2026-10-14): "Ask your brains anything" sent the
// whole merged pool to a CPU cross-encoder costing ~4s per document, with no
// budget, so /api/brain/search sat on the TEI client's 30s timeout and the edge
// answered 500. These tests pin the two halves of the fix: the per-brain
// fan-out never lets one brain sink the request, and the reranker is only fed
// what it can finish inside the budget.

func TestFanOutBrainsRunsInParallel(t *testing.T) {
	var inFlight, peak int32
	fn := func(ctx context.Context, ns string) ([]Recalled, error) {
		n := atomic.AddInt32(&inFlight, 1)
		for {
			p := atomic.LoadInt32(&peak)
			if n <= p || atomic.CompareAndSwapInt32(&peak, p, n) {
				break
			}
		}
		time.Sleep(100 * time.Millisecond)
		atomic.AddInt32(&inFlight, -1)
		return []Recalled{{ID: ns + "-1", Score: 1}}, nil
	}
	brains := []string{"a", "b", "c", "d", "e", "f"}
	start := time.Now()
	out, skipped, err := fanOutBrains(context.Background(), brains, 3, time.Second, fn)
	if err != nil || len(skipped) != 0 {
		t.Fatalf("err=%v skipped=%v", err, skipped)
	}
	if len(out) != len(brains) {
		t.Fatalf("got %d results, want %d", len(out), len(brains))
	}
	for _, r := range out {
		if r.Namespace == "" {
			t.Fatalf("result %s not tagged with its brain", r.ID)
		}
	}
	// 6 brains × 100ms, 3 at a time ≈ 200ms; sequential would be 600ms.
	if el := time.Since(start); el > 450*time.Millisecond {
		t.Fatalf("took %v: brains were not queried in parallel", el)
	}
	if peak > 3 {
		t.Fatalf("%d brains in flight, concurrency bound is 3", peak)
	}
}

func TestFanOutBrainsReturnsPartialResults(t *testing.T) {
	fn := func(ctx context.Context, ns string) ([]Recalled, error) {
		switch ns {
		case "slow":
			<-ctx.Done() // a brain that never answers in time
			return nil, ctx.Err()
		case "broken":
			return nil, errors.New("relation does not exist")
		}
		return []Recalled{{ID: ns, Namespace: ns}}, nil
	}
	start := time.Now()
	out, skipped, err := fanOutBrains(context.Background(), []string{"ok1", "slow", "broken", "ok2"}, 4, 150*time.Millisecond, fn)
	if err != nil {
		t.Fatalf("one bad brain failed the whole search: %v", err)
	}
	if el := time.Since(start); el > time.Second {
		t.Fatalf("waited %v on a brain past its 150ms timeout", el)
	}
	if len(out) != 2 {
		t.Fatalf("got %d results, want the 2 healthy brains", len(out))
	}
	if len(skipped) != 2 || skipped[0] != "broken" || skipped[1] != "slow" {
		t.Fatalf("skipped = %v, want [broken slow]", skipped)
	}
}

func TestFanOutBrainsErrorsOnlyWhenEveryBrainFails(t *testing.T) {
	fn := func(context.Context, string) ([]Recalled, error) { return nil, errors.New("db down") }
	if _, _, err := fanOutBrains(context.Background(), []string{"a", "b"}, 2, time.Second, fn); err == nil {
		t.Fatal("every brain failed but no error was returned")
	}
	out, _, err := fanOutBrains(context.Background(), nil, 2, time.Second, fn)
	if err != nil || out == nil || len(out) != 0 {
		t.Fatalf("no brains: out=%v err=%v, want an empty result", out, err)
	}
}

func TestRerankGovernorSkipsAReRankerTooSlowForTheBudget(t *testing.T) {
	// ~4s/doc against a 4s budget, scaled down: every call times out. The
	// governor must stop paying the budget on every request.
	t.Setenv("BRAIN_RERANK_TIMEOUT", "50ms")
	g := withRerankGov(t, -1)
	now := time.Unix(0, 0)
	g.now = func() time.Time { return now }
	fr := &fakeReranker{delay: time.Second}

	var sent []int
	for i := 0; i < 3; i++ {
		fr.sent = 0
		rerankHead(context.Background(), fr, "q", pool("a", "b", "c", "d", "e", "f"))
		sent = append(sent, fr.sent)
	}
	// probe 4 → timeout, halve to 2 → timeout, halve to 1 → skip.
	if sent[0] != rerankProbeDocs || sent[1] != 2 || sent[2] != 0 {
		t.Fatalf("batches sent %v, want [4 2 0]", sent)
	}
	start := time.Now()
	p := pool("a", "b", "c")
	rerankHead(context.Background(), fr, "q", p)
	if el := time.Since(start); el > 20*time.Millisecond || ids(p) != "abc" {
		t.Fatalf("skipped rerank took %v and gave %q", el, ids(p))
	}
	// After the re-probe interval a background probe is due, off the request path.
	now = now.Add(rerankReprobe)
	if n, probe := g.plan(6); n != 0 || !probe {
		t.Fatalf("plan after reprobe interval = (%d, %v), want (0, true)", n, probe)
	}
	if _, probe := g.plan(6); probe {
		t.Fatal("a second probe started while one is in flight")
	}
}

func TestRerankGovernorSizesTheBatchFromMeasuredCost(t *testing.T) {
	g := newRerankGovernor()
	g.observe(4, 400*time.Millisecond, true, 4*time.Second) // 100ms/doc: the full head fits
	if n, _ := g.plan(40); n != rerankMaxDocs {
		t.Fatalf("fast reranker: plan %d, want %d", n, rerankMaxDocs)
	}
	g.observe(2, 2*time.Second, true, 4*time.Second) // 1s/doc: 3.2s of headroom → 3 docs
	if n, _ := g.plan(40); n != 3 {
		t.Fatalf("1s/doc reranker: plan %d, want 3", n)
	}
	if n, _ := g.plan(2); n != 2 {
		t.Fatalf("plan never exceeds the pool: got %d", n)
	}
}
