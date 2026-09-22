package brain

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
)

/*
The top level of the notes tree view (MH-306, MH-217).

The product decision was "the graph spine", but Spine() is a walk AROUND a
named entity — it answers "what surrounds X", not "where do I start". So this
answers the missing half: which entities ARE the spine of a brain.

The answer is the hub types (DefaultSpineHubs: repo, venture, feed — the types
the spine walk is willing to expand THROUGH) ordered by degree, because a hub
with one edge is not a hub in any useful sense. Two properties matter for a
sidebar:

  - it is stable. Adding a note does not reshuffle the top level, which a
    recency ordering would.
  - it degrades. A brain with no typed hubs at all would otherwise show an
    empty tree, which reads as breakage rather than as "this brain has no
    graph structure yet"; so it falls back to the most-connected entities of
    ANY type, and says which of the two it did via `fallback`.

Edges are counted in BOTH directions: a venture that is only ever the target of
OWNS edges is still the hub of its own subtree. Only currently-valid edges
count (valid_to IS NULL), matching Neighbors().
*/

// DefaultRootLimit caps the top level. A sidebar that needs a scrollbar before
// the first disclosure is not a tree, it is a list.
const DefaultRootLimit = 25

// GraphRoot is one entry in the tree's top level.
type GraphRoot struct {
	Name   string `json:"name"`
	Type   string `json:"type"`
	Degree int    `json:"degree"`
}

// Roots returns the brain's spine hubs, most-connected first. `fallback` is
// true when no entity of a hub type had any edges and the result is therefore
// the most-connected entities of any type.
func (s *Store) Roots(ctx context.Context, ns string, limit int) (roots []GraphRoot, fallback bool, err error) {
	if limit <= 0 || limit > 200 {
		limit = DefaultRootLimit
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, false, err
	}

	query := func(hubsOnly bool) ([]GraphRoot, error) {
		// Degree is counted per entity over valid edges in either direction.
		const base = `
			SELECT e.name, e.entity_type, count(g.id) AS degree
			FROM entities e
			JOIN entity_edges g
			  ON (g.src_id = e.id OR g.dst_id = e.id)
			 AND g.namespace = e.namespace
			 AND g.valid_to IS NULL
			WHERE e.namespace = $1`
		args := []any{ns}
		cond := ""
		if hubsOnly {
			next := 2
			cond = " AND e.entity_type IN (" + placeholders(&args, &next, DefaultSpineHubs) + ")"
		}
		args = append(args, limit)
		rows, qErr := db.QueryContext(ctx,
			base+cond+` GROUP BY e.name, e.entity_type
			ORDER BY degree DESC, e.name
			LIMIT $`+strconv.Itoa(len(args)), args...)
		if qErr != nil {
			return nil, qErr
		}
		defer rows.Close()
		out := []GraphRoot{}
		for rows.Next() {
			var g GraphRoot
			if rows.Scan(&g.Name, &g.Type, &g.Degree) == nil {
				out = append(out, g)
			}
		}
		return out, rows.Err()
	}

	roots, err = query(true)
	if err != nil {
		return nil, false, err
	}
	if len(roots) > 0 {
		return roots, false, nil
	}
	roots, err = query(false)
	if err != nil {
		return nil, false, err
	}
	return roots, true, nil
}

// RootsHandler — GET/POST /api/brain/graph/roots { namespace, limit? }
//
// GET takes the same names as query parameters so it is curl-able, matching
// SpineHandler.
func (s *Service) RootsHandler(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Namespace string `json:"namespace"`
		Limit     int    `json:"limit"`
	}
	if r.Method == http.MethodGet {
		in.Namespace = r.URL.Query().Get("namespace")
		in.Limit, _ = strconv.Atoi(r.URL.Query().Get("limit"))
	} else if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "bad JSON body"))
		return
	}
	if !s.canRead(r, in.Namespace) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no read access to brain "+in.Namespace))
		return
	}
	roots, fallback, err := s.Store.Roots(r.Context(), in.Namespace, in.Limit)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"roots": roots, "count": len(roots), "fallback": fallback})
}
