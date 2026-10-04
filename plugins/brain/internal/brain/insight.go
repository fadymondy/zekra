package brain

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"
)

/*
Insight queries behind the console's Overview / Memory / Recalls / Agents screens
(docs/ux/ZEKRA-TARGET-IA.md). Every number here is a count or timestamp read from
stored rows — nothing is estimated. Recall telemetry (agent, query, result ids)
exists only for events written after the P1a deploy; TelemetrySince tells the UI
from when.
*/

// Bucket is one facet value and its count.
type Bucket struct {
	Key   string `json:"key"`
	Count int    `json:"count"`
}

// DayCount is a per-day count (UTC day).
type DayCount struct {
	Day   string `json:"day"` // YYYY-MM-DD
	Count int    `json:"count"`
}

// EntityRef is a light entity reference attached to a memory.
type EntityRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}

// MemoryBrief is a memory as listed by the explorer.
type MemoryBrief struct {
	ID             string      `json:"id"`
	Content        string      `json:"content"`
	MemoryType     string      `json:"memoryType"`
	Network        string      `json:"network"`
	Kind           string      `json:"kind,omitempty"` // metadata.type
	Title          string      `json:"title,omitempty"`
	Tags           []string    `json:"tags,omitempty"`
	SourceKind     string      `json:"sourceKind,omitempty"`
	SourceRef      string      `json:"sourceRef,omitempty"`
	Datasource     string      `json:"datasource,omitempty"`
	OwnerAgentID   string      `json:"ownerAgentId,omitempty"`
	Importance     float64     `json:"importance"`
	AccessCount    int         `json:"accessCount"`
	ValidAt        time.Time   `json:"validAt"`
	IngestedAt     time.Time   `json:"ingestedAt"`
	LastAccessedAt *time.Time  `json:"lastAccessedAt,omitempty"`
	State          string      `json:"state"` // active | invalidated | superseded
	Entities       []EntityRef `json:"entities,omitempty"`
}

// RecallEvent is one logged recall/search.
type RecallEvent struct {
	ID        int64     `json:"id"`
	TS        time.Time `json:"ts"`
	Op        string    `json:"op"`
	Namespace string    `json:"namespace"`
	Agent     string    `json:"agent,omitempty"`
	Client    string    `json:"client,omitempty"`
	Session   string    `json:"session,omitempty"`
	Query     string    `json:"query,omitempty"`
	Returned  int       `json:"returned"`
	Results   []string  `json:"results,omitempty"`
	Outcome   string    `json:"outcome"`
	Cached    bool      `json:"cached,omitempty"`
	LatencyMs int       `json:"latencyMs"`
	Tracked   bool      `json:"tracked"` // carries P1a telemetry (query/results)
}

// AgentAccess is one identity that can reach (or has used) a brain.
type AgentAccess struct {
	ID         string     `json:"id"`   // activity label: oauth:<app>, token agent id, user:<uid>, …
	Kind       string     `json:"kind"` // oauth | grant | activity
	Name       string     `json:"name"`
	CanWrite   bool       `json:"canWrite"`
	GrantedAt  *time.Time `json:"grantedAt,omitempty"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
	LastSeenAt *time.Time `json:"lastSeenAt,omitempty"` // last event in this brain
	Recalls7d  int        `json:"recalls7d"`
	Retains7d  int        `json:"retains7d"`
}

// Health is the set of real memory-health signals (rules in TARGET-IA §3).
type Health struct {
	Active          int `json:"active"`
	WithSource      int `json:"withSource"`
	Invalidated     int `json:"invalidated"`
	Superseded      int `json:"superseded"`
	Unused90d       int `json:"unused90d"`
	OrphanEntities  int `json:"orphanEntities"`
	Sources         int `json:"sources"`
	SourcesErroring int `json:"sourcesErroring"`
}

// Overview is the Brain Overview payload.
type Overview struct {
	Namespace       string        `json:"namespace"`
	Memories        int           `json:"memories"` // active, excluding the system seed
	Entities        int           `json:"entities"`
	Edges           int           `json:"edges"`
	LastLearnedAt   *time.Time    `json:"lastLearnedAt,omitempty"`
	Recalls7d       int           `json:"recalls7d"`
	RecallsPrev7d   int           `json:"recallsPrev7d"`
	RecallsByDay    []DayCount    `json:"recallsByDay"`
	OpenGaps        int           `json:"openGaps"`
	ByMemoryType    []Bucket      `json:"byMemoryType"`
	ByNetwork       []Bucket      `json:"byNetwork"`
	BySource        []Bucket      `json:"bySource"`
	ByKind          []Bucket      `json:"byKind"`
	TopEntityTypes  []Bucket      `json:"topEntityTypes"`
	TopEntities     []Bucket      `json:"topEntities"`
	RecentlyLearned []MemoryBrief `json:"recentlyLearned"`
	RecentRecalls   []RecallEvent `json:"recentRecalls"`
	Agents          []AgentAccess `json:"agents"`
	Health          Health        `json:"health"`
	TelemetrySince  *time.Time    `json:"telemetrySince,omitempty"`
}

// recallEventsCTE yields (ns, ts, agent_id, id) for every recall in a brain:
// per-brain recall events plus cross-brain searches that returned results from
// it. $1 = namespace (or NULL for every brain), $2 = since.
const recallEventsCTE = `
WITH ev AS (
  SELECT id, namespace AS ns, ts, agent_id FROM memory_events
   WHERE op IN ('recall','recall_archive') AND ts >= $2 AND ($1::text IS NULL OR namespace = $1)
  UNION ALL
  SELECT e.id, n.ns, e.ts, e.agent_id FROM memory_events e,
         jsonb_array_elements_text(CASE WHEN jsonb_typeof(e.metadata->'namespaces')='array'
                                        THEN e.metadata->'namespaces' ELSE '[]'::jsonb END) AS n(ns)
   WHERE e.op = 'search' AND e.ts >= $2 AND ($1::text IS NULL OR n.ns = $1)
)`

// Overview builds the Brain Overview for one namespace.
func (s *Store) Overview(ctx context.Context, ns string) (*Overview, error) {
	o := &Overview{Namespace: ns, RecallsByDay: []DayCount{}, ByMemoryType: []Bucket{}, ByNetwork: []Bucket{},
		BySource: []Bucket{}, ByKind: []Bucket{}, TopEntityTypes: []Bucket{}, TopEntities: []Bucket{},
		RecentlyLearned: []MemoryBrief{}, RecentRecalls: []RecallEvent{}, Agents: []AgentAccess{}}
	db, err := s.db(ctx)
	if err != nil || !s.ready(ctx, db) {
		return o, err
	}
	var last sql.NullTime
	_ = db.QueryRowContext(ctx, `
		SELECT count(*) FILTER (WHERE COALESCE(source_kind,'') <> 'system'),
		       max(ingested_at) FILTER (WHERE COALESCE(source_kind,'') <> 'system')
		FROM memories WHERE namespace=$1 AND invalid_at IS NULL`, ns).Scan(&o.Memories, &last)
	if last.Valid {
		o.LastLearnedAt = &last.Time
	}
	_ = db.QueryRowContext(ctx, `SELECT count(*) FROM entities WHERE namespace=$1`, ns).Scan(&o.Entities)
	_ = db.QueryRowContext(ctx, `SELECT count(*) FROM entity_edges WHERE namespace=$1 AND valid_to IS NULL`, ns).Scan(&o.Edges)
	_ = db.QueryRowContext(ctx, `SELECT count(*) FROM memory_gaps WHERE namespace=$1 AND status='open'`, ns).Scan(&o.OpenGaps)

	// Recalls: this week, the week before, and per day for the sparkline.
	now := time.Now().UTC()
	day0 := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, -6)
	_ = db.QueryRowContext(ctx, recallEventsCTE+`
		SELECT count(*) FILTER (WHERE ts >= now() - interval '7 days'),
		       count(*) FILTER (WHERE ts <  now() - interval '7 days')
		FROM ev`, ns, now.AddDate(0, 0, -14)).Scan(&o.Recalls7d, &o.RecallsPrev7d)
	perDay := map[string]int{}
	if rows, err := db.QueryContext(ctx, recallEventsCTE+`
		SELECT to_char(ts AT TIME ZONE 'UTC','YYYY-MM-DD'), count(*) FROM ev GROUP BY 1`, ns, day0); err == nil {
		for rows.Next() {
			var d string
			var c int
			if rows.Scan(&d, &c) == nil {
				perDay[d] = c
			}
		}
		rows.Close()
	}
	for i := 0; i < 7; i++ {
		d := day0.AddDate(0, 0, i).Format("2006-01-02")
		o.RecallsByDay = append(o.RecallsByDay, DayCount{Day: d, Count: perDay[d]})
	}

	f, _ := s.Facets(ctx, ns)
	if f != nil {
		o.ByMemoryType, o.ByNetwork, o.BySource, o.ByKind = f.MemoryTypes, f.Networks, f.Sources, f.Kinds
	}
	o.TopEntityTypes = buckets(ctx, db, `
		SELECT entity_type, count(*) FROM entities WHERE namespace=$1 GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, ns)
	o.TopEntities = buckets(ctx, db, `
		SELECT e.name, count(*) FROM memory_entities me JOIN entities e ON e.id = me.entity_id
		WHERE e.namespace=$1 GROUP BY e.id, e.name ORDER BY 2 DESC LIMIT 8`, ns)

	if page, err := s.ListMemories(ctx, MemoryFilter{Namespace: ns, Limit: 8, ExcludeSystem: true}); err == nil {
		o.RecentlyLearned = page.Items
	}
	if rs, err := s.Recalls(ctx, RecallFilter{Namespace: ns, Limit: 8}); err == nil {
		o.RecentRecalls = rs
	}
	if ag, err := s.BrainAgents(ctx, ns); err == nil {
		o.Agents = ag
	}
	o.Health = s.health(ctx, db, ns)
	o.TelemetrySince = s.telemetrySince(ctx, db)
	return o, nil
}

func (s *Store) health(ctx context.Context, db *sql.DB, ns string) Health {
	var h Health
	_ = db.QueryRowContext(ctx, `
		SELECT count(*) FILTER (WHERE invalid_at IS NULL AND COALESCE(source_kind,'') <> 'system'),
		       count(*) FILTER (WHERE invalid_at IS NULL AND (COALESCE(source_kind,'') NOT IN ('','system') OR COALESCE(source_ref,'') <> '')),
		       count(*) FILTER (WHERE invalid_at IS NOT NULL AND superseded_by IS NULL),
		       count(*) FILTER (WHERE superseded_by IS NOT NULL),
		       count(*) FILTER (WHERE invalid_at IS NULL AND COALESCE(source_kind,'') <> 'system'
		                          AND ingested_at < now() - interval '90 days'
		                          AND (last_accessed_at IS NULL OR last_accessed_at < now() - interval '90 days'))
		FROM memories WHERE namespace=$1`, ns).
		Scan(&h.Active, &h.WithSource, &h.Invalidated, &h.Superseded, &h.Unused90d)
	_ = db.QueryRowContext(ctx, `
		SELECT count(*) FROM entities e WHERE e.namespace=$1
		  AND NOT EXISTS (SELECT 1 FROM memory_entities me WHERE me.entity_id = e.id)`, ns).Scan(&h.OrphanEntities)
	_ = db.QueryRowContext(ctx, `
		SELECT count(*), count(*) FILTER (WHERE status='error') FROM datasources WHERE namespace=$1`, ns).
		Scan(&h.Sources, &h.SourcesErroring)
	return h
}

// telemetrySince is the time of the first recall event carrying P1a telemetry.
func (s *Store) telemetrySince(ctx context.Context, db *sql.DB) *time.Time {
	var t sql.NullTime
	_ = db.QueryRowContext(ctx, `
		SELECT min(ts) FROM memory_events WHERE op IN ('recall','search') AND metadata ? 'n'`).Scan(&t)
	if !t.Valid {
		return nil
	}
	return &t.Time
}

func buckets(ctx context.Context, db *sql.DB, q string, args ...any) []Bucket {
	out := []Bucket{}
	rows, err := db.QueryContext(ctx, q, args...)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var b Bucket
		if rows.Scan(&b.Key, &b.Count) == nil {
			out = append(out, b)
		}
	}
	return out
}

// --- facets ----------------------------------------------------------------------

// Facets are the explorer's filter values with counts (active memories).
type Facets struct {
	MemoryTypes []Bucket `json:"memoryTypes"`
	Networks    []Bucket `json:"networks"`
	Sources     []Bucket `json:"sources"`
	Kinds       []Bucket `json:"kinds"`
	Tags        []Bucket `json:"tags"`
	Agents      []Bucket `json:"agents"`
}

func (s *Store) Facets(ctx context.Context, ns string) (*Facets, error) {
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	const base = ` FROM memories WHERE namespace=$1 AND invalid_at IS NULL `
	return &Facets{
		MemoryTypes: buckets(ctx, db, `SELECT memory_type, count(*)`+base+`GROUP BY 1 ORDER BY 2 DESC`, ns),
		Networks:    buckets(ctx, db, `SELECT network, count(*)`+base+`GROUP BY 1 ORDER BY 2 DESC`, ns),
		Sources:     buckets(ctx, db, `SELECT COALESCE(NULLIF(source_kind,''),'unknown'), count(*)`+base+`GROUP BY 1 ORDER BY 2 DESC LIMIT 40`, ns),
		Kinds:       buckets(ctx, db, `SELECT metadata->>'type', count(*)`+base+`AND COALESCE(metadata->>'type','') <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 40`, ns),
		Tags: buckets(ctx, db, `SELECT t, count(*)`+base+`
			AND jsonb_typeof(metadata->'tags') = 'array'
			CROSS JOIN LATERAL jsonb_array_elements_text(metadata->'tags') AS t GROUP BY 1 ORDER BY 2 DESC LIMIT 40`, ns),
		Agents: buckets(ctx, db, `SELECT owner_agent_id, count(*)`+base+`AND owner_agent_id IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 40`, ns),
	}, nil
}

// --- memory browse ---------------------------------------------------------------

// MemoryFilter selects memories for the explorer. Zero values mean "any".
type MemoryFilter struct {
	Namespace     string
	IDs           []string
	MemoryType    string
	Network       string
	SourceKind    string
	Kind          string // metadata.type
	Tag           string
	Entity        string // entity id
	Agent         string // owner_agent_id
	Since, Until  *time.Time
	State         string // active (default) | invalidated | superseded | all
	ExcludeSystem bool
	Cursor        string // "<ingested_at RFC3339Nano>|<id>" of the last row seen
	Limit         int
}

// MemoryPage is one page of the explorer.
type MemoryPage struct {
	Items      []MemoryBrief `json:"items"`
	NextCursor string        `json:"nextCursor,omitempty"`
}

func (s *Store) ListMemories(ctx context.Context, f MemoryFilter) (*MemoryPage, error) {
	page := &MemoryPage{Items: []MemoryBrief{}}
	if f.Namespace == "" {
		return page, ErrInvalidInput
	}
	db, err := s.db(ctx)
	if err != nil {
		return page, err
	}
	if f.Limit <= 0 || f.Limit > 100 {
		f.Limit = 30
	}
	where := []string{"m.namespace = $1"}
	args := []any{f.Namespace}
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, strings.ReplaceAll(cond, "?", "$"+itoa(len(args))))
	}
	switch f.State {
	case "all":
	case "invalidated":
		where = append(where, "m.invalid_at IS NOT NULL AND m.superseded_by IS NULL")
	case "superseded":
		where = append(where, "m.superseded_by IS NOT NULL")
	default:
		if len(f.IDs) == 0 { // explicit ids (a recall's results) are shown whatever their state
			where = append(where, "m.invalid_at IS NULL")
		}
	}
	if len(f.IDs) > 0 {
		add("m.id::text = ANY(?)", stringArray(f.IDs))
	}
	if f.MemoryType != "" {
		add("m.memory_type = ?", f.MemoryType)
	}
	if f.Network != "" {
		add("m.network = ?", f.Network)
	}
	if f.SourceKind != "" {
		add("COALESCE(NULLIF(m.source_kind,''),'unknown') = ?", f.SourceKind)
	}
	if f.ExcludeSystem {
		where = append(where, "COALESCE(m.source_kind,'') <> 'system'")
	}
	if f.Kind != "" {
		add("m.metadata->>'type' = ?", f.Kind)
	}
	if f.Tag != "" {
		add("jsonb_typeof(m.metadata->'tags') = 'array' AND m.metadata->'tags' ? ?", f.Tag)
	}
	if f.Entity != "" {
		add("EXISTS (SELECT 1 FROM memory_entities me WHERE me.memory_id = m.id AND me.entity_id::text = ?)", f.Entity)
	}
	if f.Agent != "" {
		add("m.owner_agent_id = ?", f.Agent)
	}
	if f.Since != nil {
		add("m.ingested_at >= ?", *f.Since)
	}
	if f.Until != nil {
		add("m.ingested_at < ?", *f.Until)
	}
	if ts, id, ok := strings.Cut(f.Cursor, "|"); ok {
		if t, err := time.Parse(time.RFC3339Nano, ts); err == nil {
			args = append(args, t, id)
			n := len(args)
			where = append(where, "(m.ingested_at, m.id::text) < ($"+itoa(n-1)+", $"+itoa(n)+")")
		}
	}
	args = append(args, f.Limit+1)
	rows, err := db.QueryContext(ctx, `
		SELECT m.id::text, m.content, m.memory_type, m.network, COALESCE(m.metadata->>'type',''),
		       COALESCE(m.metadata->>'title',''), COALESCE(m.metadata->'tags','[]'::jsonb),
		       COALESCE(m.source_kind,''), COALESCE(m.source_ref,''), COALESCE(m.metadata->>'datasource',''),
		       COALESCE(m.owner_agent_id,''), m.importance, m.access_count, m.valid_at, m.ingested_at,
		       m.last_accessed_at, m.invalid_at IS NOT NULL, m.superseded_by IS NOT NULL
		FROM memories m
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY m.ingested_at DESC, m.id::text DESC
		LIMIT $`+itoa(len(args)), args...)
	if err != nil {
		return page, err
	}
	defer rows.Close()
	for rows.Next() {
		var b MemoryBrief
		var tags []byte
		var la sql.NullTime
		var invalid, superseded bool
		if err := rows.Scan(&b.ID, &b.Content, &b.MemoryType, &b.Network, &b.Kind, &b.Title, &tags,
			&b.SourceKind, &b.SourceRef, &b.Datasource, &b.OwnerAgentID, &b.Importance, &b.AccessCount,
			&b.ValidAt, &b.IngestedAt, &la, &invalid, &superseded); err != nil {
			continue
		}
		b.Content = clipRunes(b.Content, 600)
		b.Tags = jsonStrings(tags)
		if la.Valid {
			b.LastAccessedAt = &la.Time
		}
		b.State = "active"
		switch {
		case superseded:
			b.State = "superseded"
		case invalid:
			b.State = "invalidated"
		}
		page.Items = append(page.Items, b)
	}
	if err := rows.Err(); err != nil {
		return page, err
	}
	if len(page.Items) > f.Limit {
		page.Items = page.Items[:f.Limit]
		last := page.Items[f.Limit-1]
		page.NextCursor = last.IngestedAt.Format(time.RFC3339Nano) + "|" + last.ID
	}
	s.attachEntities(ctx, db, page.Items, 3)
	return page, nil
}

// attachEntities adds up to max linked entities to each memory.
func (s *Store) attachEntities(ctx context.Context, db *sql.DB, items []MemoryBrief, max int) {
	if len(items) == 0 {
		return
	}
	idx := map[string]int{}
	ids := make([]string, len(items))
	for i, m := range items {
		idx[m.ID] = i
		ids[i] = m.ID
	}
	rows, err := db.QueryContext(ctx, `
		SELECT me.memory_id::text, e.id::text, e.name, e.entity_type
		FROM memory_entities me JOIN entities e ON e.id = me.entity_id
		WHERE me.memory_id::text = ANY($1) ORDER BY e.name`, stringArray(ids))
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var mid string
		var e EntityRef
		if rows.Scan(&mid, &e.ID, &e.Name, &e.Type) != nil {
			continue
		}
		if i, ok := idx[mid]; ok && len(items[i].Entities) < max {
			items[i].Entities = append(items[i].Entities, e)
		}
	}
}

func jsonStrings(raw []byte) []string {
	var out []string
	if json.Unmarshal(raw, &out) != nil {
		return nil
	}
	return out
}

// --- recalls ---------------------------------------------------------------------

// RecallFilter selects recall/search events for one brain.
type RecallFilter struct {
	Namespace string
	Agent     string
	Outcome   string // hit | empty
	Session   string
	Memory    string // only recalls that returned this memory id
	Since     *time.Time
	Before    int64 // cursor: events with id < Before
	Limit     int
}

func (s *Store) Recalls(ctx context.Context, f RecallFilter) ([]RecallEvent, error) {
	out := []RecallEvent{}
	if f.Namespace == "" {
		return out, ErrInvalidInput
	}
	db, err := s.db(ctx)
	if err != nil {
		return out, err
	}
	if f.Limit <= 0 || f.Limit > 200 {
		f.Limit = 50
	}
	where := []string{`((e.op IN ('recall','recall_archive') AND e.namespace = $1)
		OR (e.op = 'search' AND jsonb_typeof(e.metadata->'namespaces') = 'array' AND e.metadata->'namespaces' ? $1))`}
	args := []any{f.Namespace}
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, strings.ReplaceAll(cond, "?", "$"+itoa(len(args))))
	}
	if f.Agent != "" {
		add("e.agent_id = ?", f.Agent)
	}
	if f.Outcome != "" {
		add("COALESCE(e.metadata->>'outcome','hit') = ?", f.Outcome)
	}
	if f.Session != "" {
		add("e.metadata->>'session' = ?", f.Session)
	}
	if f.Memory != "" {
		add("jsonb_typeof(e.metadata->'results') = 'array' AND e.metadata->'results' ? ?", f.Memory)
	}
	if f.Since != nil {
		add("e.ts >= ?", *f.Since)
	}
	if f.Before > 0 {
		add("e.id < ?", f.Before)
	}
	args = append(args, f.Limit)
	rows, err := db.QueryContext(ctx, `
		SELECT e.id, e.ts, e.op, COALESCE(e.namespace,''), COALESCE(e.agent_id,''), COALESCE(e.latency_ms,0), e.metadata
		FROM memory_events e
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY e.id DESC LIMIT $`+itoa(len(args)), args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var r RecallEvent
		var meta []byte
		if rows.Scan(&r.ID, &r.TS, &r.Op, &r.Namespace, &r.Agent, &r.LatencyMs, &meta) != nil {
			continue
		}
		var m struct {
			Outcome string   `json:"outcome"`
			Client  string   `json:"client"`
			Session string   `json:"session"`
			Query   string   `json:"query"`
			N       *int     `json:"n"`
			Results []string `json:"results"`
			Cached  bool     `json:"cached"`
		}
		_ = json.Unmarshal(meta, &m)
		r.Outcome, r.Client, r.Session, r.Query, r.Results, r.Cached = m.Outcome, m.Client, m.Session, m.Query, m.Results, m.Cached
		if r.Outcome == "" {
			r.Outcome = "hit"
		}
		if m.N != nil {
			r.Tracked, r.Returned = true, *m.N
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// --- agents ----------------------------------------------------------------------

// BrainAgents lists who can reach a brain (OAuth apps, granted agents) plus any
// other identity active in it during the last 30 days, with their activity.
func (s *Store) BrainAgents(ctx context.Context, ns string) ([]AgentAccess, error) {
	out := []AgentAccess{}
	db, err := s.db(ctx)
	if err != nil {
		return out, err
	}
	byID := map[string]int{}
	put := func(a AgentAccess) {
		if i, ok := byID[a.ID]; ok {
			cur := &out[i]
			cur.CanWrite = cur.CanWrite || a.CanWrite
			cur.LastUsedAt = laterOf(cur.LastUsedAt, a.LastUsedAt)
			return
		}
		byID[a.ID] = len(out)
		out = append(out, a)
	}
	// OAuth-connected apps with a live grant naming this brain.
	if rows, err := db.QueryContext(ctx, `
		SELECT COALESCE(NULLIF(c.client_name,''), c.id), gn.can_write, g.created_at, g.last_used_at
		FROM mcp_oauth_grant_namespaces gn
		JOIN mcp_oauth_grants g ON g.id = gn.grant_id AND g.revoked_at IS NULL
		JOIN mcp_oauth_clients c ON c.id = g.client_id
		WHERE gn.namespace = $1`, ns); err == nil {
		for rows.Next() {
			var name string
			var w bool
			var created time.Time
			var used sql.NullTime
			if rows.Scan(&name, &w, &created, &used) == nil {
				a := AgentAccess{ID: "oauth:" + oauthClip(name, 60), Kind: "oauth", Name: name, CanWrite: w, GrantedAt: &created}
				if used.Valid {
					a.LastUsedAt = &used.Time
				}
				put(a)
			}
		}
		rows.Close()
	}
	// ACL-token agents granted this brain.
	if rows, err := db.QueryContext(ctx, `
		SELECT g.agent_id, g.can_write,
		       (SELECT max(t.last_used_at) FROM brain_tokens t WHERE t.agent_id = g.agent_id AND t.revoked_at IS NULL)
		FROM namespace_grants g WHERE g.namespace = $1 AND g.can_read`, ns); err == nil {
		for rows.Next() {
			var id string
			var w bool
			var used sql.NullTime
			if rows.Scan(&id, &w, &used) == nil {
				a := AgentAccess{ID: id, Kind: "grant", Name: id, CanWrite: w}
				if used.Valid {
					a.LastUsedAt = &used.Time
				}
				put(a)
			}
		}
		rows.Close()
	}
	// Activity in this brain (also surfaces admins/console users with no grant row).
	if rows, err := db.QueryContext(ctx, recallEventsCTE+`,
		act AS (
		  SELECT agent_id, ts, 'recall' AS kind FROM ev WHERE agent_id IS NOT NULL
		  UNION ALL
		  SELECT agent_id, ts, 'retain' FROM memory_events
		   WHERE namespace = $1 AND op = 'retain' AND agent_id IS NOT NULL AND ts >= $2
		)
		SELECT agent_id, max(ts),
		       count(*) FILTER (WHERE kind='recall' AND ts >= now() - interval '7 days'),
		       count(*) FILTER (WHERE kind='retain' AND ts >= now() - interval '7 days')
		FROM act GROUP BY agent_id ORDER BY max(ts) DESC LIMIT 100`, ns, time.Now().AddDate(0, 0, -30)); err == nil {
		for rows.Next() {
			var id string
			var seen time.Time
			var rc, wc int
			if rows.Scan(&id, &seen, &rc, &wc) != nil {
				continue
			}
			if _, ok := byID[id]; !ok {
				put(AgentAccess{ID: id, Kind: "activity", Name: id})
			}
			a := &out[byID[id]]
			a.LastSeenAt, a.Recalls7d, a.Retains7d = &seen, rc, wc
		}
		rows.Close()
	}
	return out, nil
}

func laterOf(a, b *time.Time) *time.Time {
	if a == nil || (b != nil && b.After(*a)) {
		return b
	}
	return a
}

// --- one memory's usage ------------------------------------------------------------

// MemoryUsage is the Memory Detail's WHY / RELATIONSHIPS / USAGE / HISTORY.
type MemoryUsage struct {
	IngestedAt     time.Time      `json:"ingestedAt"`
	LastAccessedAt *time.Time     `json:"lastAccessedAt,omitempty"`
	Entities       []EntityRef    `json:"entities"`
	Supersedes     []string       `json:"supersedes"`          // memories this one replaced
	WriteDecision  string         `json:"writeDecision"`       // add | update | invalidate | noop | "" (unknown)
	WrittenBy      string         `json:"writtenBy,omitempty"` // agent on the retain event
	Recalls        []RecallEvent  `json:"recalls"`             // recent recalls that returned it (tracked only)
	RecalledBy     []Bucket       `json:"recalledBy"`          // agent → times (tracked only)
	Edits          []ActivityItem `json:"edits"`
}

func (s *Store) MemoryUsage(ctx context.Context, ns, id string) (*MemoryUsage, error) {
	if ns == "" || id == "" {
		return nil, ErrInvalidInput
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	u := &MemoryUsage{Entities: []EntityRef{}, Supersedes: []string{}, Recalls: []RecallEvent{},
		RecalledBy: []Bucket{}, Edits: []ActivityItem{}}
	var la sql.NullTime
	err = db.QueryRowContext(ctx, `SELECT ingested_at, last_accessed_at FROM memories WHERE id::text=$1 AND namespace=$2 LIMIT 1`, id, ns).
		Scan(&u.IngestedAt, &la)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if la.Valid {
		u.LastAccessedAt = &la.Time
	}
	items := []MemoryBrief{{ID: id}}
	s.attachEntities(ctx, db, items, 50)
	if items[0].Entities != nil {
		u.Entities = items[0].Entities
	}
	if rows, err := db.QueryContext(ctx, `SELECT id::text FROM memories WHERE namespace=$1 AND superseded_by::text=$2 LIMIT 50`, ns, id); err == nil {
		for rows.Next() {
			var sid string
			if rows.Scan(&sid) == nil {
				u.Supersedes = append(u.Supersedes, sid)
			}
		}
		rows.Close()
	}
	_ = db.QueryRowContext(ctx, `
		SELECT COALESCE(metadata->>'outcome',''), COALESCE(agent_id,'') FROM memory_events
		WHERE namespace=$1 AND op='retain' AND memory_id::text=$2 ORDER BY ts LIMIT 1`, ns, id).
		Scan(&u.WriteDecision, &u.WrittenBy)
	u.Recalls, _ = s.Recalls(ctx, RecallFilter{Namespace: ns, Memory: id, Limit: 20})
	u.RecalledBy = buckets(ctx, db, `
		SELECT COALESCE(agent_id,'unknown'), count(*) FROM memory_events
		WHERE ((op IN ('recall','recall_archive') AND namespace=$1)
		       OR (op='search' AND jsonb_typeof(metadata->'namespaces')='array' AND metadata->'namespaces' ? $1))
		  AND jsonb_typeof(metadata->'results')='array' AND metadata->'results' ? $2
		GROUP BY 1 ORDER BY 2 DESC LIMIT 20`, ns, id)
	if rows, err := db.QueryContext(ctx, `
		SELECT id, ts, op, COALESCE(namespace,''), COALESCE(agent_id,''), COALESCE(metadata->>'outcome','ok'), COALESCE(latency_ms,0)
		FROM memory_events WHERE namespace=$1 AND memory_id::text=$2 AND op IN ('edit','forget','retain')
		ORDER BY ts DESC LIMIT 20`, ns, id); err == nil {
		for rows.Next() {
			var a ActivityItem
			if rows.Scan(&a.ID, &a.TS, &a.Op, &a.Namespace, &a.AgentID, &a.Outcome, &a.LatencyMs) == nil {
				u.Edits = append(u.Edits, a)
			}
		}
		rows.Close()
	}
	return u, nil
}

// --- activity (filtered) -----------------------------------------------------------

// ActivityFilter narrows the activity log. Namespaces nil = every brain (admin only).
type ActivityFilter struct {
	Namespaces []string
	All        bool
	Op         string
	Agent      string
	Since      *time.Time
	Before     int64 // cursor: events with id < Before
	Limit      int
}

func (s *Store) ActivityFiltered(ctx context.Context, f ActivityFilter) ([]ActivityItem, error) {
	out := []ActivityItem{}
	if f.Limit <= 0 || f.Limit > 200 {
		f.Limit = 50
	}
	if !f.All && len(f.Namespaces) == 0 {
		return out, nil
	}
	db, err := s.db(ctx)
	if err != nil || !s.ready(ctx, db) {
		return out, nil
	}
	where := []string{"TRUE"}
	args := []any{}
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, strings.ReplaceAll(cond, "?", "$"+itoa(len(args))))
	}
	if !f.All {
		add("namespace = ANY(?)", stringArray(f.Namespaces))
	}
	if f.Op != "" {
		add("op = ?", f.Op)
	}
	if f.Agent != "" {
		add("agent_id = ?", f.Agent)
	}
	if f.Since != nil {
		add("ts >= ?", *f.Since)
	}
	if f.Before > 0 {
		add("id < ?", f.Before)
	}
	args = append(args, f.Limit)
	rows, err := db.QueryContext(ctx, `
		SELECT id, ts, op, COALESCE(namespace,''), COALESCE(agent_id,''),
		       COALESCE(metadata->>'outcome','hit'), COALESCE(latency_ms,0)
		FROM memory_events WHERE `+strings.Join(where, " AND ")+`
		ORDER BY id DESC LIMIT $`+itoa(len(args)), args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var a ActivityItem
		if rows.Scan(&a.ID, &a.TS, &a.Op, &a.Namespace, &a.AgentID, &a.Outcome, &a.LatencyMs) == nil {
			out = append(out, a)
		}
	}
	return out, rows.Err()
}
