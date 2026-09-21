package brain

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
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
// of namespaces (” → all). Same RRF(vector,BM25)+salience fusion; also returns the
// namespace so results are tagged with their brain.
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

// SearchAll runs a hybrid search across brains, reranks the merged pool, and
// returns results tagged with their namespace. Unlike Recall it is not scoped to a
// single brain — it's the search-engine surface.
func (s *Store) SearchAll(ctx context.Context, q SearchQuery) ([]Recalled, error) {
	emb := s.embedder()
	if emb == nil {
		return nil, ErrNoEmbedder
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	if q.Limit <= 0 || q.Limit > 50 {
		q.Limit = 12
	}
	start := time.Now()
	vecs, err := emb.Embed(ctx, []string{q.Query})
	if err != nil || len(vecs) == 0 {
		return nil, errors.New("brain.Search: embed failed: " + errStr(err))
	}
	vec := vecLit(vecs[0])
	nsList := strings.Join(cleanNamespaces(q.Namespaces), ",")
	const pool = 60

	// Hybrid first, vector-only as a fallback when the BM25 layer is absent.
	// Each attempt runs in its OWN transaction (searchPool): Postgres aborts a
	// transaction on the first failed statement and rejects every command after
	// it with 25P02, so sharing one tx made the fallback fail too and masked the
	// real BM25 error behind "current transaction is aborted". recallPool opens
	// one transaction per attempt for exactly this reason.
	out, err := s.searchPool(ctx, db, searchSQL, vec, nsList, q.Query, pool, bm25Tokenizer())
	if err != nil {
		hybridErr := err
		out, err = s.searchPool(ctx, db, searchVecSQL, vec, nsList, q.Limit)
		if err != nil {
			return nil, errors.New("brain.Search: query: " + err.Error() + " (hybrid: " + hybridErr.Error() + ")")
		}
	}
	// Rerank the merged cross-brain pool with the cross-encoder.
	if rr := s.reranker(); rr != nil && len(out) > 1 {
		docs := make([]string, len(out))
		for i := range out {
			docs[i] = out[i].Content
		}
		if scores, err := rr.Rerank(ctx, q.Query, docs); err == nil && len(scores) == len(out) {
			for i := range out {
				out[i].Score = scores[i]
			}
			sortByScoreDesc(out)
		}
	}
	if len(out) > q.Limit {
		out = out[:q.Limit]
	}
	outcome := "hit"
	if len(out) == 0 {
		outcome = "empty"
		s.recordGap(ctx, db, "*", q.Query) // cross-brain miss
	}
	s.event(ctx, db, "search", "*", "", outcome, nil, int(time.Since(start).Milliseconds()))
	return out, nil
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
