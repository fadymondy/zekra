package brain

import (
	"context"
	"database/sql"
	"errors"
)

// Per-caller scoped variants of the global read models, for callers that may
// only see some brains (members, scoped tokens, OAuth-connected apps).

// StatsFor is Stats restricted to the given brains.
func (s *Store) StatsFor(ctx context.Context, namespaces []string) (*Stats, error) {
	db, err := s.db(ctx)
	if err != nil || !s.ready(ctx, db) {
		return &Stats{Ready: false}, nil
	}
	st := &Stats{Ready: true}
	if len(namespaces) == 0 {
		return st, nil
	}
	ns := stringArray(namespaces)
	scan := func(q string, dst *int) { _ = db.QueryRowContext(ctx, q, ns).Scan(dst) }
	scan(`SELECT COUNT(DISTINCT namespace) FROM memories WHERE invalid_at IS NULL AND namespace = ANY($1)`, &st.Brains)
	scan(`SELECT COUNT(*) FROM memories WHERE invalid_at IS NULL AND namespace = ANY($1)`, &st.Memories)
	scan(`SELECT COUNT(*) FROM entities WHERE namespace = ANY($1)`, &st.Entities)
	scan(`SELECT COUNT(*) FROM memory_entities me JOIN entities e ON e.id = me.entity_id WHERE e.namespace = ANY($1)`, &st.Edges)
	scan(`SELECT COUNT(DISTINCT owner_agent_id) FROM memories WHERE owner_agent_id IS NOT NULL AND namespace = ANY($1)`, &st.Agents)
	scan(`SELECT COUNT(DISTINCT source_ref) FROM memories WHERE source_ref IS NOT NULL AND valid_at > now() - interval '24 hours' AND namespace = ANY($1)`, &st.Sessions24h)
	scan(`SELECT COUNT(*) FROM memory_events WHERE op='recall' AND ts > now() - interval '24 hours' AND namespace = ANY($1)`, &st.Recalls24h)
	scan(`SELECT COUNT(*) FROM memory_gaps WHERE status='open' AND namespace = ANY($1)`, &st.OpenGaps)
	return st, nil
}

// ActivityFor is Activity restricted to the given brains.
func (s *Store) ActivityFor(ctx context.Context, namespaces []string, limit int) ([]ActivityItem, error) {
	out := []ActivityItem{}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if len(namespaces) == 0 {
		return out, nil
	}
	db, err := s.db(ctx)
	if err != nil || !s.ready(ctx, db) {
		return out, nil
	}
	rows, err := db.QueryContext(ctx, `
		SELECT id, ts, op, COALESCE(namespace,''), COALESCE(agent_id,''),
		       COALESCE(metadata->>'outcome','hit'), COALESCE(latency_ms,0)
		FROM memory_events WHERE namespace = ANY($1) ORDER BY ts DESC LIMIT $2`, stringArray(namespaces), limit)
	if err != nil {
		return out, nil
	}
	defer rows.Close()
	for rows.Next() {
		var a ActivityItem
		if err := rows.Scan(&a.ID, &a.TS, &a.Op, &a.Namespace, &a.AgentID, &a.Outcome, &a.LatencyMs); err == nil {
			out = append(out, a)
		}
	}
	return out, nil
}

// GapNamespace returns the brain a knowledge gap belongs to.
func (s *Store) GapNamespace(ctx context.Context, id int64) (string, error) {
	db, err := s.db(ctx)
	if err != nil {
		return "", err
	}
	var ns string
	err = db.QueryRowContext(ctx, `SELECT namespace FROM memory_gaps WHERE id=$1`, id).Scan(&ns)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return ns, err
}
