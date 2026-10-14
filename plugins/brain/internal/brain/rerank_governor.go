package brain

import (
	"context"
	"sync"
	"time"
)

// rerankGovernor sizes each rerank call to what the cross-encoder can actually
// finish inside the budget.
//
// Measured on production (a 24-core CPU host, bge-reranker-v2-m3 on CPU, 2026-10-14):
// ~4s per document — 1 doc 3.9s, 8 docs 31.8s, 16 docs 66s. Sending the usual
// 32-doc head with a 4s budget therefore ALWAYS timed out: every recall waited
// the full 4s for nothing, and TEI kept scoring the abandoned batch for minutes
// afterwards, slowing every later call. Cross-brain search sent the whole
// merged pool with no budget at all and sat on the TEI client's 30s timeout,
// past the edge proxy's limit — the "500 after 30s" on "Ask your brains".
//
// The governor learns the per-document cost from completed calls and halves
// its batch on a timeout. When not even two documents fit, reranking is skipped
// (the RRF order is kept) and a small probe runs in the background now and then,
// so a faster reranker (GPU, smaller model) is picked up without a restart.
type rerankGovernor struct {
	mu        sync.Mutex
	limit     int // docs that fit in the budget; -1 = not measured yet
	lastProbe time.Time
	probing   bool
	now       func() time.Time
}

const (
	// rerankProbeDocs is the first batch sent before any cost is known: small
	// enough that a slow CPU reranker wastes little, big enough to measure.
	rerankProbeDocs = 4
	// rerankReprobe is how often a background probe re-measures a reranker
	// that was too slow to use.
	rerankReprobe = 10 * time.Minute
)

func newRerankGovernor() *rerankGovernor {
	return &rerankGovernor{limit: -1, now: time.Now}
}

// rerankGov is shared by Recall and SearchAll: they hit the same TEI instance.
var rerankGov = newRerankGovernor()

// plan returns how many of n docs to rerank in the foreground (0 = skip), and
// whether the caller should launch a background probe instead.
func (g *rerankGovernor) plan(n int) (docs int, probe bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	switch {
	case g.limit < 0:
		return min(n, rerankProbeDocs), false
	case g.limit >= 2:
		return min(n, g.limit), false
	}
	if !g.probing && g.now().Sub(g.lastProbe) >= rerankReprobe {
		g.probing = true
		g.lastProbe = g.now()
		return 0, true
	}
	return 0, false
}

// observe records one rerank call of sent docs: ok when it finished inside the
// budget, took its wall time.
func (g *rerankGovernor) observe(sent int, took time.Duration, ok bool, budget time.Duration) {
	if sent <= 0 {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	g.lastProbe = g.now() // a real call is as good as a probe
	if !ok {
		g.limit = sent / 2
		return
	}
	perDoc := took / time.Duration(sent)
	if perDoc <= 0 {
		g.limit = rerankMaxDocs
		return
	}
	// Keep 20% headroom: the cost varies with document length.
	g.limit = min(int(budget*8/10/perDoc), rerankMaxDocs)
}

func (g *rerankGovernor) probeDone() {
	g.mu.Lock()
	g.probing = false
	g.mu.Unlock()
}

// timedRerank runs one budgeted rerank call and reports it to the governor.
func (g *rerankGovernor) timedRerank(ctx context.Context, rr Reranker, query string, docs []string, budget time.Duration) ([]float64, bool) {
	rctx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	start := g.now()
	scores, err := rr.Rerank(rctx, query, docs)
	ok := err == nil && len(scores) == len(docs)
	if ok || ctx.Err() == nil { // the caller giving up says nothing about the reranker
		g.observe(len(docs), g.now().Sub(start), ok, budget)
	}
	return scores, ok
}
