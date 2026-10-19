package brain

import (
	"context"
	"database/sql"
	"sort"
	"strings"
	"time"

	"github.com/togo-framework/brain/presentations"
)

/*
Derived items follow their sources.

A memory written from other memories (a chat answer grounded on recall, a
summary, a consolidation, a caller's `derived_from`) and a presentation built
from recall both record where they came from in memory_derivations. When one of
those sources is invalidated or superseded, everything derived from it, directly
or through other derived memories, is stale_source:

  - Staleness is computed at read time by walking the derivation links upward
    (up to derivationDepth hops) to a source that is no longer valid, so a source
    brought back by a conflict resolution makes its dependents fresh again with
    no bookkeeping.
  - The direct links are also stamped (stale_at, stale_reason) when a source is
    retired, and a "stale" event is logged, so the activity log shows what went
    stale and why.
  - Recall leaves stale-derived memories out unless the caller asks for them
    (includeStale), and then returns them flagged with staleSource and at half
    their score.
*/

const (
	derivationDepth = 4  // how far a stale source propagates through derived memories
	maxDerivedFrom  = 50 // sources per derived item
)

// Kinds of derived items and how they were derived.
const (
	DerivedMemory       = "memory"
	DerivedPresentation = "presentation"

	ViaRetain       = "retain"
	ViaChat         = "chat"
	ViaPresentation = "presentation"
	ViaSummary      = "summary"
	ViaConsolidate  = "consolidation"
)

// StaleRef names a source that is no longer valid behind a derived item.
type StaleRef struct {
	Source       string `json:"source"`                 // the retired source memory
	Reason       string `json:"reason"`                 // invalidated | superseded | edited | deleted
	SupersededBy string `json:"supersededBy,omitempty"` // its replacement, if any
	Depth        int    `json:"depth"`                  // 1 = a direct source; >1 = through derived memories
}

// Derivation is one provenance link as shown on a memory or presentation.
type Derivation struct {
	Kind        string     `json:"kind"` // memory | presentation
	ID          string     `json:"id"`
	Via         string     `json:"via"`
	Content     string     `json:"content,omitempty"` // memory sides only
	Valid       bool       `json:"valid"`
	StaleAt     *time.Time `json:"staleAt,omitempty"`
	StaleReason string     `json:"staleReason,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
}

// Provenance is the dependency trail of one item.
type Provenance struct {
	Kind        string       `json:"kind"`
	ID          string       `json:"id"`
	DerivedFrom []Derivation `json:"derivedFrom"`
	Dependents  []Derivation `json:"dependents"`
	StaleSource []StaleRef   `json:"staleSource,omitempty"`
}

func normVia(v string) string {
	switch v = strings.ToLower(strings.TrimSpace(v)); v {
	case ViaRetain, ViaChat, ViaPresentation, ViaSummary, ViaConsolidate:
		return v
	case "consolidate":
		return ViaConsolidate
	}
	return ViaRetain
}

// cleanSourceIDs keeps distinct well-formed memory ids, capped.
func cleanSourceIDs(ids []string, self string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, id := range ids {
		id = strings.ToLower(strings.TrimSpace(id))
		if !uuidRE.MatchString(id) || id == self || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
		if len(out) == maxDerivedFrom {
			break
		}
	}
	return out
}

// linkDerived records that derivedID was derived from the given memories. Only
// existing memories in the same brain are linked (a derivation never reaches
// into a brain the writer could not read). Deriving again from a source clears
// its stale stamp. Returns the number of links written.
func (s *Store) linkDerived(ctx context.Context, db *sql.DB, ns, kind, derivedID, via string, sources []string) int {
	src := cleanSourceIDs(sources, derivedID)
	if derivedID == "" || len(src) == 0 {
		return 0
	}
	res, err := db.ExecContext(ctx, `
		INSERT INTO memory_derivations (namespace, derived_kind, derived_id, source_id, via)
		SELECT DISTINCT $1, $2, $3, m.id, $4
		  FROM memories m
		 WHERE m.id = ANY($5::text[]::uuid[]) AND m.namespace = $1
		ON CONFLICT (derived_kind, derived_id, source_id)
		DO UPDATE SET stale_at = NULL, stale_reason = NULL, via = EXCLUDED.via`,
		ns, kind, derivedID, normVia(via), stringArray(src))
	if err != nil {
		return 0
	}
	n, _ := res.RowsAffected()
	return int(n)
}

// staleSources returns, per derived id, the retired sources behind it (directly
// or through other derived memories). Ids with fresh sources are absent.
func (s *Store) staleSources(ctx context.Context, db *sql.DB, kind string, ids []string) map[string][]StaleRef {
	out := map[string][]StaleRef{}
	if len(ids) == 0 {
		return out
	}
	rows, err := db.QueryContext(ctx, `
		WITH RECURSIVE up(derived_id, source_id, depth, edited) AS (
		  SELECT derived_id, source_id, 1, COALESCE(stale_reason = 'edited', false) FROM memory_derivations
		   WHERE derived_kind = $1 AND derived_id = ANY($2::text[])
		  UNION
		  SELECT up.derived_id, d.source_id, up.depth + 1, COALESCE(d.stale_reason = 'edited', false)
		    FROM up JOIN memory_derivations d
		      ON d.derived_kind = 'memory' AND d.derived_id = up.source_id::text
		   WHERE up.depth < $3
		)
		SELECT up.derived_id, up.source_id::text, min(up.depth),
		       bool_or(m.found IS NULL), bool_or(m.invalid_at IS NOT NULL),
		       COALESCE(max(m.superseded_by::text), ''), bool_or(up.edited)
		  FROM up
		  LEFT JOIN LATERAL (SELECT true AS found, invalid_at, superseded_by FROM memories
		                      WHERE id = up.source_id ORDER BY valid_at DESC LIMIT 1) m ON true
		 WHERE m.found IS NULL OR m.invalid_at IS NOT NULL OR up.edited
		 GROUP BY up.derived_id, up.source_id`, kind, stringArray(ids), derivationDepth)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var r StaleRef
		var did string
		var gone, invalid, edited bool
		if rows.Scan(&did, &r.Source, &r.Depth, &gone, &invalid, &r.SupersededBy, &edited) != nil {
			continue
		}
		switch {
		case gone:
			r.Reason = "deleted"
		case r.SupersededBy != "":
			r.Reason = "superseded"
		case invalid:
			r.Reason = "invalidated"
		default:
			r.Reason = "edited"
		}
		out[did] = append(out[did], r)
	}
	for _, refs := range out {
		sort.Slice(refs, func(i, j int) bool {
			if refs[i].Depth != refs[j].Depth {
				return refs[i].Depth < refs[j].Depth
			}
			return refs[i].Source < refs[j].Source
		})
	}
	return out
}

// applyStale drops recall results derived from retired sources, or (includeStale)
// keeps them flagged at half their score, sorted below the fresh ones. A time-
// travel recall (asOf) shows history as it was and is left alone.
func (s *Store) applyStale(ctx context.Context, db *sql.DB, pool []Recalled, q RecallQuery) []Recalled {
	if len(pool) == 0 || q.AsOf != nil {
		return pool
	}
	ids := make([]string, len(pool))
	for i, r := range pool {
		ids[i] = r.ID
	}
	stale := s.staleSources(ctx, db, DerivedMemory, ids)
	if len(stale) == 0 {
		return pool
	}
	fresh, flagged := make([]Recalled, 0, len(pool)), []Recalled{}
	for _, r := range pool {
		refs, ok := stale[r.ID]
		if !ok {
			fresh = append(fresh, r)
			continue
		}
		if q.IncludeStale {
			r.StaleSource = refs
			r.Score /= 2
			flagged = append(flagged, r)
		}
	}
	return append(fresh, flagged...)
}

// markDependentsStale stamps the derivation links of retired sources and logs
// one "stale" event per brain affected. Read-time staleness (staleSources) is
// the source of truth; this is the audit trail. Returns the number of derived
// items affected directly.
func (s *Store) markDependentsStale(ctx context.Context, db *sql.DB, sourceIDs []string, reason string) int {
	src := cleanSourceIDs(sourceIDs, "")
	if len(src) == 0 {
		return 0
	}
	ctx = context.WithoutCancel(ctx)
	rows, err := db.QueryContext(ctx, `
		UPDATE memory_derivations SET stale_at = now(), stale_reason = $2
		 WHERE source_id = ANY($1::text[]::uuid[]) AND stale_at IS NULL
		RETURNING namespace, derived_kind, derived_id`, stringArray(src), reason)
	if err != nil {
		return 0
	}
	byNS := map[string][]string{}
	n := 0
	for rows.Next() {
		var ns, kind, id string
		if rows.Scan(&ns, &kind, &id) == nil {
			byNS[ns] = append(byNS[ns], kind+":"+id)
			n++
		}
	}
	rows.Close()
	for ns, items := range byNS {
		s.bumpEpoch(ns)
		s.eventMeta(ctx, db, "stale", ns, "", reason, nil, 0, map[string]any{"sources": src, "dependents": items})
	}
	return n
}

// clearStale removes the stamps of sources that are valid again.
func (s *Store) clearStale(ctx context.Context, db *sql.DB, sourceIDs []string) {
	src := cleanSourceIDs(sourceIDs, "")
	if len(src) == 0 {
		return
	}
	rows, err := db.QueryContext(context.WithoutCancel(ctx), `
		UPDATE memory_derivations SET stale_at = NULL, stale_reason = NULL
		 WHERE source_id = ANY($1::text[]::uuid[]) AND stale_at IS NOT NULL
		RETURNING namespace`, stringArray(src))
	if err != nil {
		return
	}
	defer rows.Close()
	seen := map[string]bool{}
	for rows.Next() {
		var ns string
		if rows.Scan(&ns) == nil && !seen[ns] {
			seen[ns] = true
			s.bumpEpoch(ns)
		}
	}
}

// Provenance returns an item's sources and dependents, and the retired sources
// that make it stale. kind is memory or presentation; a presentation has no
// dependents.
func (s *Store) Provenance(ctx context.Context, kind, id string) (*Provenance, error) {
	if kind == "" {
		kind = DerivedMemory
	}
	if (kind != DerivedMemory && kind != DerivedPresentation) || strings.TrimSpace(id) == "" {
		return nil, ErrInvalidInput
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	p := &Provenance{Kind: kind, ID: id, DerivedFrom: []Derivation{}, Dependents: []Derivation{}}
	scan := func(rows *sql.Rows, err error, dst *[]Derivation) error {
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var d Derivation
			var reason sql.NullString
			if err := rows.Scan(&d.Kind, &d.ID, &d.Via, &d.Content, &d.Valid, &d.StaleAt, &reason, &d.CreatedAt); err != nil {
				return err
			}
			d.StaleReason = reason.String
			*dst = append(*dst, d)
		}
		return rows.Err()
	}
	rows, err := db.QueryContext(ctx, `
		SELECT 'memory', d.source_id::text, d.via, COALESCE(m.content,''), COALESCE(m.invalid_at IS NULL, false),
		       d.stale_at, d.stale_reason, d.created_at
		  FROM memory_derivations d
		  LEFT JOIN LATERAL (SELECT content, invalid_at FROM memories WHERE id = d.source_id
		                      ORDER BY valid_at DESC LIMIT 1) m ON true
		 WHERE d.derived_kind = $1 AND d.derived_id = $2
		 ORDER BY d.created_at, d.source_id`, kind, id)
	if err := scan(rows, err, &p.DerivedFrom); err != nil {
		return nil, err
	}
	if kind == DerivedMemory && uuidRE.MatchString(id) {
		rows, err = db.QueryContext(ctx, `
			SELECT d.derived_kind, d.derived_id, d.via, COALESCE(m.content,''),
			       CASE WHEN d.derived_kind = 'memory' THEN COALESCE(m.invalid_at IS NULL, false) ELSE true END,
			       d.stale_at, d.stale_reason, d.created_at
			  FROM memory_derivations d
			  LEFT JOIN LATERAL (SELECT content, invalid_at FROM memories
			                      WHERE d.derived_kind = 'memory' AND id::text = d.derived_id
			                      ORDER BY valid_at DESC LIMIT 1) m ON true
			 WHERE d.source_id = $1::uuid
			 ORDER BY d.created_at, d.derived_id`, id)
		if err := scan(rows, err, &p.Dependents); err != nil {
			return nil, err
		}
	}
	p.StaleSource = s.staleSources(ctx, db, kind, []string{id})[id]
	return p, nil
}

// derivationNamespace is the brain an item's provenance belongs to ("" if it
// has none recorded).
func (s *Store) derivationNamespace(ctx context.Context, kind, id string) string {
	db, err := s.db(ctx)
	if err != nil {
		return ""
	}
	var ns string
	_ = db.QueryRowContext(ctx, `
		SELECT namespace FROM memory_derivations
		 WHERE (derived_kind = $1 AND derived_id = $2) OR ($1 = 'memory' AND source_id::text = $2)
		 LIMIT 1`, kind, id).Scan(&ns)
	return ns
}

// linkPresentation records the memories a brain-built presentation was drawn
// from: recalled memories directly, and the current chunks of each note.
// Entity material has no memory behind it and is not linked.
func (s *Store) linkPresentation(ctx context.Context, ns string, docIDs []string, items []presentations.Material) int {
	db, err := s.db(ctx)
	if err != nil || len(docIDs) == 0 {
		return 0
	}
	var mems, notes []string
	for _, m := range items {
		switch m.Kind {
		case "memory":
			mems = append(mems, m.Ref)
		case "note":
			notes = append(notes, "note:"+m.Ref+"#%")
		}
	}
	if len(notes) > 0 {
		rows, err := db.QueryContext(ctx, `
			SELECT id::text FROM memories
			 WHERE namespace = $1 AND source_kind = 'note' AND invalid_at IS NULL
			   AND source_ref LIKE ANY($2::text[])`, ns, stringArray(notes))
		if err == nil {
			for rows.Next() {
				var id string
				if rows.Scan(&id) == nil {
					mems = append(mems, id)
				}
			}
			rows.Close()
		}
	}
	n := 0
	for _, id := range docIDs {
		n += s.linkDerived(ctx, db, ns, DerivedPresentation, id, ViaPresentation, mems)
	}
	return n
}
