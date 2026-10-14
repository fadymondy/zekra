package brain

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// SearchQuery is a cross-brain search: human text against one, several, or ALL
// brains at once (a real search engine over the whole store).
type SearchQuery struct {
	Query      string   `json:"query"`
	Namespaces []string `json:"namespaces"` // empty → all brains
	Limit      int      `json:"limit"`
}

// searchSQL is recallSQL generalized across namespaces. $2 is a comma-joined list
// of namespaces (” → all); Search passes one brain per query. Same
// RRF(vector,BM25)+salience fusion; also returns the namespace so results are
// tagged with their brain.
const searchSQL = `
WITH vec AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS r
  FROM memories
  WHERE ($2='' OR namespace = ANY(string_to_array($2,','))) AND invalid_at IS NULL AND tier='hot' AND embedding IS NOT NULL
  ORDER BY embedding <=> $1::vector LIMIT 60
),
txt AS (
  SELECT id, ROW_NUMBER() OVER (
           ORDER BY content_bm25 <&> to_bm25query('memories_default_bm25', tokenize($3::text,$5::text))
         ) AS r
  FROM memories
  WHERE ($2='' OR namespace = ANY(string_to_array($2,','))) AND invalid_at IS NULL AND tier='hot' AND content_bm25 IS NOT NULL
  ORDER BY content_bm25 <&> to_bm25query('memories_default_bm25', tokenize($3::text,$5::text))
  LIMIT 60
)
SELECT m.id, m.namespace, m.content, m.network, m.memory_type, COALESCE(m.source_kind,''),
       COALESCE(m.source_ref,''), m.importance, m.valid_at,
       COALESCE(1.0/(60+vec.r),0) + COALESCE(1.0/(60+txt.r),0) + 0.01*m.importance AS score
FROM memories m
LEFT JOIN vec ON vec.id = m.id
LEFT JOIN txt ON txt.id = m.id
WHERE (vec.id IS NOT NULL OR txt.id IS NOT NULL)
ORDER BY score DESC LIMIT $4;`

// searchVecSQL is the vector-only fallback (BM25 layer absent). It takes exactly
// three params ($1 vec, $2 namespaces, $3 limit) — every one referenced, so PG
// never hits "could not determine data type of parameter" on an unused arg.
const searchVecSQL = `
SELECT id, namespace, content, network, memory_type, COALESCE(source_kind,''),
       COALESCE(source_ref,''), importance, valid_at,
       (1 - (embedding <=> $1::vector)) + 0.15*importance AS score
FROM memories
WHERE ($2='' OR namespace = ANY(string_to_array($2,','))) AND invalid_at IS NULL AND tier='hot' AND embedding IS NOT NULL
ORDER BY embedding <=> $1::vector LIMIT $3;`

// SearchResult is SearchAll plus the brains it had to leave out.
type SearchResult struct {
	Results []Recalled
	// Skipped lists brains whose query failed or ran past the per-brain
	// timeout; the results are partial when it is non-empty.
	Skipped []string
}

// searchBrainPool is how many candidates each brain contributes before the
// merged pool is reranked and cut to the limit.
const searchBrainPool = 30

// searchConcurrency bounds how many brains are queried at once (each holds a
// pooled DB connection). BRAIN_SEARCH_CONCURRENCY tunes it.
func searchConcurrency() int {
	if n, err := strconv.Atoi(strings.TrimSpace(os.Getenv("BRAIN_SEARCH_CONCURRENCY"))); err == nil && n > 0 && n <= 64 {
		return n
	}
	return 6
}

// searchBrainTimeout bounds one brain's query. A brain past it is dropped from
// the answer instead of failing the whole search. BRAIN_SEARCH_BRAIN_TIMEOUT
// (a Go duration) tunes it.
func searchBrainTimeout() time.Duration {
	if d, err := time.ParseDuration(strings.TrimSpace(os.Getenv("BRAIN_SEARCH_BRAIN_TIMEOUT"))); err == nil && d > 0 {
		return d
	}
	return 5 * time.Second
}

// SearchAll runs a hybrid search across brains, reranks the merged pool, and
// returns results tagged with their namespace. Unlike Recall it is not scoped to a
// single brain — it's the search-engine surface.
func (s *Store) SearchAll(ctx context.Context, q SearchQuery) ([]Recalled, error) {
	res, err := s.Search(ctx, q)
	return res.Results, err
}

// Search is SearchAll reporting which brains were skipped.
//
// The query is embedded ONCE, then every brain is queried in parallel (bounded
// by searchConcurrency, each under searchBrainTimeout). A brain that errors or
// runs late is left out rather than failing the request; only when every brain
// fails is it an error. The merged pool is reranked under the same budget as
// Recall, so the whole call stays well inside the edge proxy's 30s limit.
func (s *Store) Search(ctx context.Context, q SearchQuery) (SearchResult, error) {
	emb := s.embedder()
	if emb == nil {
		return SearchResult{}, ErrNoEmbedder
	}
	db, err := s.db(ctx)
	if err != nil {
		return SearchResult{}, err
	}
	if q.Limit <= 0 || q.Limit > 50 {
		q.Limit = 12
	}
	start := time.Now()
	vecs, err := emb.Embed(ctx, []string{q.Query})
	if err != nil || len(vecs) == 0 {
		return SearchResult{}, errors.New("brain.Search: embed failed: " + errStr(err))
	}
	vec := vecLit(vecs[0])
	brains := cleanNamespaces(q.Namespaces)
	if len(brains) == 0 { // all brains
		infos, _ := s.Namespaces(ctx)
		for _, b := range infos {
			brains = append(brains, b.Namespace)
		}
	}
	tok := bm25Tokenizer()
	out, skipped, err := fanOutBrains(ctx, brains, searchConcurrency(), searchBrainTimeout(),
		func(ctx context.Context, ns string) ([]Recalled, error) {
			return s.searchBrain(ctx, db, vec, ns, q.Query, tok)
		})
	if err != nil {
		return SearchResult{Skipped: skipped}, err
	}
	sortByScoreDesc(out)
	// Rerank the head of the merged cross-brain pool with the cross-encoder.
	if rr := s.reranker(); rr != nil {
		rerankHead(ctx, rr, q.Query, out)
	}
	if len(out) > q.Limit {
		out = out[:q.Limit]
	}
	outcome := "hit"
	if len(out) == 0 {
		outcome = "empty"
		s.recordGap(ctx, db, "*", q.Query) // cross-brain miss
	}
	s.eventMeta(ctx, db, "search", "*", "", outcome, nil, int(time.Since(start).Milliseconds()), recallMeta(q.Query, out))
	return SearchResult{Results: out, Skipped: skipped}, nil
}

// searchBrain runs one brain's candidate query: hybrid first, vector-only as a
// fallback when the BM25 layer is absent. Each attempt runs in its OWN
// transaction (searchPool): Postgres aborts a transaction on the first failed
// statement and rejects every command after it with 25P02, so sharing one tx
// made the fallback fail too and masked the real BM25 error.
func (s *Store) searchBrain(ctx context.Context, db *sql.DB, vec, ns, query, tok string) ([]Recalled, error) {
	out, err := s.searchPool(ctx, db, searchSQL, vec, ns, query, searchBrainPool, tok)
	if err == nil {
		return out, nil
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	hybridErr := err
	out, err = s.searchPool(ctx, db, searchVecSQL, vec, ns, searchBrainPool)
	if err != nil {
		return nil, errors.New("brain.Search: query: " + err.Error() + " (hybrid: " + hybridErr.Error() + ")")
	}
	return out, nil
}

// fanOutBrains runs fn for every brain, at most conc at a time, each under its
// own timeout, and concatenates the results. Brains that fail or time out are
// returned in skipped; it errors only when there were brains and none answered.
func fanOutBrains(ctx context.Context, brains []string, conc int, perBrain time.Duration,
	fn func(context.Context, string) ([]Recalled, error)) (out []Recalled, skipped []string, err error) {
	out = []Recalled{}
	if len(brains) == 0 {
		return out, nil, nil
	}
	type answer struct {
		ns  string
		res []Recalled
		err error
	}
	answers := make(chan answer, len(brains))
	sem := make(chan struct{}, max(conc, 1))
	var wg sync.WaitGroup
	for _, ns := range brains {
		wg.Add(1)
		go func(ns string) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				answers <- answer{ns: ns, err: ctx.Err()}
				return
			}
			bctx, cancel := context.WithTimeout(ctx, perBrain)
			defer cancel()
			res, err := fn(bctx, ns)
			answers <- answer{ns: ns, res: res, err: err}
		}(ns)
	}
	wg.Wait()
	close(answers)
	var firstErr error
	for a := range answers {
		if a.err != nil {
			skipped = append(skipped, a.ns)
			if firstErr == nil {
				firstErr = a.err
			}
			slog.Warn("brain.Search: brain skipped", "namespace", a.ns, "err", a.err)
			continue
		}
		for i := range a.res {
			if a.res[i].Namespace == "" {
				a.res[i].Namespace = a.ns
			}
		}
		out = append(out, a.res...)
	}
	sort.Strings(skipped)
	if len(skipped) == len(brains) {
		return nil, skipped, firstErr
	}
	return out, skipped, nil
}

func cleanNamespaces(ns []string) []string {
	out := []string{}
	for _, n := range ns {
		n = strings.TrimSpace(n)
		if n != "" && n != "*" && !strings.ContainsAny(n, ",") {
			out = append(out, n)
		}
	}
	return out
}

// searchPool runs one cross-brain candidate query in its own read-only
// transaction and scans the rows. Mirrors recallPool; the SELECT here also
// returns the namespace each hit came from.
func (s *Store) searchPool(ctx context.Context, db *sql.DB, query string, args ...any) ([]Recalled, error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback() //nolint:errcheck // read-only tx: rollback is the normal exit
	// Same ANN post-filter guard as recall (see hnswEFSearch): the index holds
	// superseded rows too, so a small candidate list is gutted by the
	// invalid_at/tier filter. SET LOCAL keeps it scoped to this transaction.
	_, _ = tx.ExecContext(ctx, "SET LOCAL hnsw.ef_search = "+strconv.Itoa(hnswEFSearch()))
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Recalled{}
	for rows.Next() {
		var r Recalled
		if err := rows.Scan(&r.ID, &r.Namespace, &r.Content, &r.Network, &r.MemoryType,
			&r.SourceKind, &r.SourceRef, &r.Importance, &r.ValidAt, &r.Score); err == nil {
			out = append(out, r)
		}
	}
	return out, rows.Err()
}
