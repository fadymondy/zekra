package brain

/*
Graph editing (store side). Nodes are entities, edges are entity_edges rows.
Nothing is hard-deleted: an edge is closed (valid_to = now()), a retype closes
the old row and opens a new one with the same endpoints, and deleting an entity
closes its edges and tombstones it (metadata.deleted). Note entities are edited
through their note (see notegraph.go); a note's derived edges (origin wikilink /
extract) can be re-weighted or re-worded here but not retyped or deleted — the
next save of the note would only bring them back, so the note is the place.
*/

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// Entity is a graph node.
type Entity struct {
	ID         string         `json:"id"`
	Namespace  string         `json:"namespace"`
	Name       string         `json:"name"`
	Type       string         `json:"type"`
	Summary    string         `json:"summary"`
	Metadata   map[string]any `json:"metadata"`
	NaturalKey string         `json:"naturalKey,omitempty"`
	NoteID     string         `json:"noteId,omitempty"`
	Deleted    bool           `json:"deleted"`
	CreatedAt  time.Time      `json:"createdAt"`
}

const entityCols = `id::text, namespace, name, entity_type, COALESCE(summary,''), metadata, COALESCE(natural_key,''), created_at`

func scanEntity(row rowScanner) (*Entity, error) {
	var e Entity
	var meta []byte
	if err := row.Scan(&e.ID, &e.Namespace, &e.Name, &e.Type, &e.Summary, &meta, &e.NaturalKey, &e.CreatedAt); err != nil {
		return nil, err
	}
	e.Metadata = map[string]any{}
	_ = json.Unmarshal(meta, &e.Metadata)
	if strings.HasPrefix(e.NaturalKey, noteSourceRef) {
		e.NoteID = strings.TrimPrefix(e.NaturalKey, noteSourceRef)
	}
	e.Deleted = e.Metadata["deleted"] == true
	return &e, nil
}

// EntityEdge is one live edge seen from an entity.
type EntityEdge struct {
	ID          string    `json:"id"`
	Relation    string    `json:"relation"`
	Label       string    `json:"label"` // relation worded from this side
	Direction   string    `json:"direction"`
	Fact        string    `json:"fact,omitempty"`
	Weight      float64   `json:"weight"`
	Origin      string    `json:"origin"`
	OtherID     string    `json:"otherId"`
	OtherName   string    `json:"otherName"`
	OtherType   string    `json:"otherType"`
	OtherNoteID string    `json:"otherNoteId,omitempty"`
	ValidFrom   time.Time `json:"validFrom"`
}

// EntityMemory is a memory linked to an entity.
type EntityMemory struct {
	ID      string    `json:"id"`
	Content string    `json:"content"`
	ValidAt time.Time `json:"validAt"`
}

// EntityDetail is GET /api/brain/entities/{id}.
type EntityDetail struct {
	Entity
	Edges    []EntityEdge   `json:"edges"`
	Memories []EntityMemory `json:"memories"`
	CanWrite bool           `json:"canWrite"` // the caller may edit this entity's brain (set by the handler)
}

// GraphEdgeRow is one entity_edges row (edge endpoints and history).
type GraphEdgeRow struct {
	ID        string         `json:"id"`
	Namespace string         `json:"namespace"`
	SrcID     string         `json:"srcId"`
	DstID     string         `json:"dstId"`
	SrcName   string         `json:"srcName"`
	DstName   string         `json:"dstName"`
	Relation  string         `json:"relation"`
	Fact      string         `json:"fact,omitempty"`
	Weight    float64        `json:"weight"`
	Origin    string         `json:"origin"`
	Metadata  map[string]any `json:"metadata"`
	ValidFrom time.Time      `json:"validFrom"`
	ValidTo   *time.Time     `json:"validTo,omitempty"`
}

// edgeWords words an edge forwards and backwards (ported from fadymondy.com).
var edgeWords = map[string][2]string{
	relLinksTo:     {"links to", "linked from"},
	relMentionedIn: {"mentioned in", "mentions"},
	relTagged:      {"tagged", "tag of"},
	relRelatedTo:   {"related to", "related to"},
	"works_on":     {"works on", "worked on by"},
	"depends_on":   {"depends on", "dependency of"},
	"uses":         {"uses", "used by"},
	"belongs_to":   {"belongs to", "has"},
	"works_at":     {"works at", "employs"},
	"employs":      {"employs", "works at"},
	"owns":         {"owns", "owned by"},
}

func edgeLabel(rel string, backwards bool) string {
	if w, ok := edgeWords[rel]; ok {
		if backwards {
			return w[1]
		}
		return w[0]
	}
	l := strings.ToLower(strings.ReplaceAll(rel, "_", " "))
	if backwards {
		return l + " (from)"
	}
	return l
}

func isDerivedOrigin(o string) bool { return o == OriginWikilink || o == OriginExtract }

func isUniqueViolation(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "23505") || strings.Contains(err.Error(), "duplicate key"))
}

// GetEntity loads an entity (tombstoned ones included).
func (s *Store) GetEntity(ctx context.Context, id string) (*Entity, error) {
	if !uuidRE.MatchString(id) {
		return nil, ErrNotFound
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	e, err := scanEntity(db.QueryRowContext(ctx, `SELECT `+entityCols+` FROM entities WHERE id=$1`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return e, err
}

// ResolveEntity finds an entity by id, by note id, or by name within ns.
func (s *Store) ResolveEntity(ctx context.Context, ns, ref string) (*Entity, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, fmt.Errorf("%w: entity is required", ErrInvalidInput)
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	var e *Entity
	if uuidRE.MatchString(ref) {
		e, err = scanEntity(db.QueryRowContext(ctx, `SELECT `+entityCols+` FROM entities WHERE id=$1
			UNION ALL SELECT `+prefixCols("e")+` FROM notes n JOIN entities e ON e.id = n.entity_id WHERE n.id=$1
			LIMIT 1`, ref))
	} else {
		if ns == "" {
			return nil, fmt.Errorf("%w: namespace is required to find an entity by name", ErrInvalidInput)
		}
		e, err = scanEntity(db.QueryRowContext(ctx, `SELECT `+entityCols+` FROM entities
			WHERE namespace=$1 AND lower(name)=lower($2)
			ORDER BY COALESCE(metadata->>'deleted','')='true', COALESCE(natural_key,'') LIKE 'note:%' DESC, created_at
			LIMIT 1`, ns, ref))
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if ns != "" && e.Namespace != ns {
		return nil, ErrNotFound
	}
	return e, nil
}

func prefixCols(a string) string {
	return a + `.id::text, ` + a + `.namespace, ` + a + `.name, ` + a + `.entity_type, COALESCE(` + a + `.summary,''), ` +
		a + `.metadata, COALESCE(` + a + `.natural_key,''), ` + a + `.created_at`
}

// EntityEdges lists an entity's live edges, both directions.
func (s *Store) EntityEdges(ctx context.Context, id string, relations []string, limit int) ([]EntityEdge, error) {
	out := []EntityEdge{}
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	db, err := s.db(ctx)
	if err != nil {
		return out, err
	}
	rows, err := db.QueryContext(ctx, `
		SELECT e.id::text, e.relation, COALESCE(e.fact,''), e.weight, COALESCE(e.metadata->>'origin',''),
		       e.src_id = $1::uuid AS outgoing, o.id::text, o.name, o.entity_type, COALESCE(o.natural_key,''), e.valid_from
		FROM entity_edges e
		JOIN entities o ON o.id = CASE WHEN e.src_id = $1::uuid THEN e.dst_id ELSE e.src_id END
		WHERE (e.src_id = $1::uuid OR e.dst_id = $1::uuid) AND e.valid_to IS NULL
		  AND COALESCE(o.metadata->>'deleted','') <> 'true'
		  AND (cardinality($2::text[]) = 0 OR e.relation = ANY($2::text[]))
		ORDER BY e.relation, o.name
		LIMIT $3`, id, stringArray(nonNil(relations)), limit)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var x EntityEdge
		var outgoing bool
		var key string
		var w float32
		if err := rows.Scan(&x.ID, &x.Relation, &x.Fact, &w, &x.Origin, &outgoing, &x.OtherID, &x.OtherName, &x.OtherType, &key, &x.ValidFrom); err != nil {
			return out, err
		}
		x.Weight = float64(w)
		x.Direction = "in"
		if outgoing {
			x.Direction = "out"
		}
		x.Label = edgeLabel(x.Relation, !outgoing)
		if strings.HasPrefix(key, noteSourceRef) {
			x.OtherNoteID = strings.TrimPrefix(key, noteSourceRef)
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// EntityMemories lists the live memories linked to an entity, newest first.
func (s *Store) EntityMemories(ctx context.Context, id string, limit int) ([]EntityMemory, error) {
	out := []EntityMemory{}
	db, err := s.db(ctx)
	if err != nil {
		return out, err
	}
	rows, err := db.QueryContext(ctx, `
		SELECT m.id::text, m.content, m.valid_at FROM memory_entities me
		JOIN memories m ON m.id = me.memory_id
		WHERE me.entity_id = $1 AND m.invalid_at IS NULL
		ORDER BY m.valid_at DESC LIMIT $2`, id, limit)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var m EntityMemory
		if err := rows.Scan(&m.ID, &m.Content, &m.ValidAt); err != nil {
			return out, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// EntityDetail is an entity with its live edges and up to 20 linked memories.
func (s *Store) EntityDetail(ctx context.Context, e *Entity) (*EntityDetail, error) {
	d := &EntityDetail{Entity: *e}
	var err error
	if d.Edges, err = s.EntityEdges(ctx, e.ID, nil, 500); err != nil {
		return nil, err
	}
	if d.Memories, err = s.EntityMemories(ctx, e.ID, 20); err != nil {
		return nil, err
	}
	return d, nil
}

func validEntityName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("%w: name is required", ErrInvalidInput)
	}
	if utf8.RuneCountInString(name) > entityNameMax {
		return "", fmt.Errorf("%w: name is longer than %d characters", ErrInvalidInput, entityNameMax)
	}
	return name, nil
}

// requireEntityType checks (or, with create, registers) an entity type.
func requireEntityType(ctx context.Context, q querier, ns, typ string, create bool) error {
	if err := ensureNoteOntology(ctx, q, ns); err != nil {
		return err
	}
	ok, err := entityTypeExists(ctx, q, ns, typ)
	if err != nil || ok {
		return err
	}
	if !create {
		return fmt.Errorf("%w: unknown entity type %q (pass create_type:true to add it)", ErrInvalidInput, typ)
	}
	return ensureEntityType(ctx, q, ns, typ, "")
}

func requireEdgeType(ctx context.Context, q querier, ns, rel string, create bool) error {
	if err := ensureNoteOntology(ctx, q, ns); err != nil {
		return err
	}
	ok, err := edgeTypeExists(ctx, q, ns, rel)
	if err != nil || ok {
		return err
	}
	if !create {
		return fmt.Errorf("%w: unknown relation %q (pass create_type:true to add it)", ErrInvalidInput, rel)
	}
	return ensureEdgeType(ctx, q, ns, rel, "")
}

// CreateEntity adds a node. A live entity with the same name is a conflict; a
// tombstoned one is brought back with the new type/summary.
func (s *Store) CreateEntity(ctx context.Context, ns, name, typ, summary string, createType bool) (*Entity, error) {
	if ns == "" {
		return nil, fmt.Errorf("%w: namespace is required", ErrInvalidInput)
	}
	name, err := validEntityName(name)
	if err != nil {
		return nil, err
	}
	if typ, err = normalizeTypeName(typ); err != nil {
		return nil, err
	}
	if typ == "" {
		typ = defaultLinkType
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	if err := requireEntityType(ctx, db, ns, typ, createType); err != nil {
		return nil, err
	}
	e, err := scanEntity(db.QueryRowContext(ctx, `
		INSERT INTO entities (namespace, name, entity_type, summary, metadata)
		VALUES ($1,$2,$3,NULLIF($4,''),'{"source":"manual"}')
		ON CONFLICT (namespace, name) WHERE natural_key IS NULL DO UPDATE
		  SET entity_type = EXCLUDED.entity_type, summary = COALESCE(EXCLUDED.summary, entities.summary),
		      metadata = entities.metadata - 'deleted'
		  WHERE COALESCE(entities.metadata->>'deleted','') = 'true'
		RETURNING `+entityCols, ns, name, typ, strings.TrimSpace(summary)))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: an entity named %q already exists", ErrGraphConflict, name)
	}
	return e, err
}

// EntityPatch is a partial entity update.
type EntityPatch struct {
	Name       *string
	Type       *string
	Summary    *string
	Metadata   map[string]any
	CreateType bool
}

// protected metadata keys are owned by the sync, not by callers.
var protectedEntityMeta = map[string]bool{"note_id": true, "source": true, "deleted": true}

// UpdateEntity applies a patch. For a note's entity a name/type change is made
// on the NOTE (title/category, a new note version), which re-syncs the entity;
// the returned note is non-nil then.
func (s *Store) UpdateEntity(ctx context.Context, id string, p EntityPatch, by NoteAuthor) (*Entity, *Note, error) {
	e, err := s.GetEntity(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, nil, err
	}
	var name, typ string
	if p.Name != nil {
		if name, err = validEntityName(*p.Name); err != nil {
			return nil, nil, err
		}
	}
	if p.Type != nil {
		if typ, err = normalizeTypeName(*p.Type); err != nil {
			return nil, nil, err
		}
		if typ == "" {
			return nil, nil, fmt.Errorf("%w: entity_type cannot be empty", ErrInvalidInput)
		}
		if err := requireEntityType(ctx, db, e.Namespace, typ, p.CreateType); err != nil {
			return nil, nil, err
		}
	}
	var note *Note
	if (name != "" && name != e.Name) || (typ != "" && typ != e.Type) {
		if e.NoteID != "" {
			note, err = s.mutateNote(ctx, e.NoteID, 0, by, func(n *Note) error {
				if n.Deleted {
					return fmt.Errorf("%w: the note is deleted; restore it first", ErrInvalidInput)
				}
				if name != "" {
					n.Title = name
				}
				if typ != "" {
					n.Category = typ
				}
				return validateNote(n.Title, n.Body)
			})
			if err != nil {
				return nil, nil, err
			}
		} else {
			if name == "" {
				name = e.Name
			}
			if typ == "" {
				typ = e.Type
			}
			if _, err := db.ExecContext(ctx, `UPDATE entities SET name=$2, entity_type=$3 WHERE id=$1`, id, name, typ); err != nil {
				if isUniqueViolation(err) {
					return nil, nil, fmt.Errorf("%w: an entity named %q already exists", ErrGraphConflict, name)
				}
				return nil, nil, err
			}
		}
	}
	if p.Summary != nil {
		if _, err := db.ExecContext(ctx, `UPDATE entities SET summary=NULLIF($2,'') WHERE id=$1`, id, strings.TrimSpace(*p.Summary)); err != nil {
			return nil, nil, err
		}
	}
	if p.Metadata != nil {
		// Merge set keys; a key sent as null is removed (not stored as JSON null).
		set, drop := map[string]any{}, stringArray{}
		for k, v := range p.Metadata {
			switch {
			case protectedEntityMeta[k]:
			case v == nil:
				drop = append(drop, k)
			default:
				set[k] = v
			}
		}
		raw, _ := json.Marshal(set)
		if _, err := db.ExecContext(ctx, `UPDATE entities SET metadata = (COALESCE(metadata,'{}'::jsonb) || $2::jsonb) - $3::text[] WHERE id=$1`,
			id, string(raw), drop); err != nil {
			return nil, nil, err
		}
	}
	e, err = s.GetEntity(ctx, id)
	return e, note, err
}

// DeleteEntity closes every live edge of a (non-note) entity and tombstones it.
func (s *Store) DeleteEntity(ctx context.Context, id string) (int, error) {
	e, err := s.GetEntity(ctx, id)
	if err != nil {
		return 0, err
	}
	if e.NoteID != "" {
		return 0, fmt.Errorf("%w: this entity is a note's; delete the note instead", ErrGraphConflict)
	}
	db, err := s.db(ctx)
	if err != nil {
		return 0, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `UPDATE entity_edges SET valid_to = now()
		WHERE (src_id=$1 OR dst_id=$1) AND valid_to IS NULL`, id)
	if err != nil {
		return 0, err
	}
	closed, _ := res.RowsAffected()
	if _, err := tx.ExecContext(ctx, `UPDATE entities SET metadata = metadata || '{"deleted":true}' WHERE id=$1`, id); err != nil {
		return 0, err
	}
	return int(closed), tx.Commit()
}

// EntityNote returns the entity's note, creating it (once) when it has none:
// title = name, category = type, body = summary + its linked memories.
func (s *Store) EntityNote(ctx context.Context, id string, by NoteAuthor) (*Note, bool, error) {
	e, err := s.GetEntity(ctx, id)
	if err != nil {
		return nil, false, err
	}
	if e.NoteID != "" {
		n, err := s.GetNote(ctx, e.NoteID)
		return n, false, err
	}
	var b strings.Builder
	if e.Summary != "" {
		b.WriteString(e.Summary)
		b.WriteString("\n\n")
	}
	mems, _ := s.EntityMemories(ctx, id, 10)
	if len(mems) > 0 {
		b.WriteString("## Linked memories\n\n")
		for _, m := range mems {
			c := spaceRunRE.ReplaceAllString(strings.TrimSpace(m.Content), " ")
			if utf8.RuneCountInString(c) > 400 {
				c = string([]rune(c)[:399]) + "…"
			}
			b.WriteString("- " + c + "\n")
		}
	}
	title := e.Name
	if utf8.RuneCountInString(title) > noteMaxTitle {
		title = string([]rune(title)[:noteMaxTitle])
	}
	cat, err := noteCategory(e.Type)
	if err != nil {
		cat = noteEntityType
	}
	n, err := s.CreateNote(ctx, NoteInput{Namespace: e.Namespace, Title: title, Body: strings.TrimSpace(b.String()),
		Category: cat, EntityID: id}, by)
	if errors.Is(err, ErrEntityHasNote) { // lost a race: the other click made it
		if e, err = s.GetEntity(ctx, id); err != nil {
			return nil, false, err
		}
		n, err := s.GetNote(ctx, e.NoteID)
		return n, false, err
	}
	if err != nil {
		return nil, false, err
	}
	return n, true, nil
}

// SearchEntities is the link picker: live entities by name, best match first.
func (s *Store) SearchEntities(ctx context.Context, ns, q, typ string, limit int) ([]Entity, error) {
	out := []Entity{}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	db, err := s.db(ctx)
	if err != nil {
		return out, err
	}
	q = strings.TrimSpace(q)
	rows, err := db.QueryContext(ctx, `SELECT `+entityCols+` FROM entities
		WHERE namespace=$1 AND COALESCE(metadata->>'deleted','') <> 'true'
		  AND ($2 = '' OR name ILIKE '%' || $3 || '%')
		  AND ($4 = '' OR entity_type = $4)
		ORDER BY lower(name) = lower($2) DESC, lower(name) LIKE lower($3) || '%' DESC, length(name), name
		LIMIT $5`, ns, q, escapeLike(q), typ, limit)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		e, err := scanEntity(rows)
		if err != nil {
			return out, err
		}
		out = append(out, *e)
	}
	return out, rows.Err()
}

// --- edges ---------------------------------------------------------------------

const edgeRowSQL = `SELECT e.id::text, e.namespace, e.src_id::text, e.dst_id::text, s.name, d.name, e.relation,
	COALESCE(e.fact,''), e.weight, COALESCE(e.metadata->>'origin',''), e.metadata, e.valid_from, e.valid_to
	FROM entity_edges e JOIN entities s ON s.id = e.src_id JOIN entities d ON d.id = e.dst_id`

func scanEdgeRow(row rowScanner) (*GraphEdgeRow, error) {
	var x GraphEdgeRow
	var meta []byte
	var w float32
	var vt sql.NullTime
	if err := row.Scan(&x.ID, &x.Namespace, &x.SrcID, &x.DstID, &x.SrcName, &x.DstName, &x.Relation, &x.Fact, &w,
		&x.Origin, &meta, &x.ValidFrom, &vt); err != nil {
		return nil, err
	}
	x.Weight = float64(w)
	x.Metadata = map[string]any{}
	_ = json.Unmarshal(meta, &x.Metadata)
	if vt.Valid {
		x.ValidTo = &vt.Time
	}
	return &x, nil
}

// GetEdge loads an edge row (closed ones included).
func (s *Store) GetEdge(ctx context.Context, id string) (*GraphEdgeRow, error) {
	if !uuidRE.MatchString(id) {
		return nil, ErrNotFound
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	x, err := scanEdgeRow(db.QueryRowContext(ctx, edgeRowSQL+` WHERE e.id=$1`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return x, err
}

// EdgeInput is a new manual edge.
type EdgeInput struct {
	Namespace  string
	SrcID      string
	DstID      string
	Relation   string
	Fact       string
	Weight     *float64
	CreateType bool
}

// CreateEdge draws a manual edge. A live edge with the same endpoints and
// relation is a conflict.
func (s *Store) CreateEdge(ctx context.Context, in EdgeInput) (*GraphEdgeRow, error) {
	if in.Namespace == "" {
		return nil, fmt.Errorf("%w: namespace is required", ErrInvalidInput)
	}
	if !uuidRE.MatchString(in.SrcID) || !uuidRE.MatchString(in.DstID) {
		return nil, fmt.Errorf("%w: src_id and dst_id must be entity ids", ErrInvalidInput)
	}
	if in.SrcID == in.DstID {
		return nil, fmt.Errorf("%w: an edge needs two different entities", ErrInvalidInput)
	}
	rel, err := normalizeTypeName(in.Relation)
	if err != nil {
		return nil, err
	}
	if rel == "" {
		return nil, fmt.Errorf("%w: relation is required", ErrInvalidInput)
	}
	w := 1.0
	if in.Weight != nil {
		w = *in.Weight
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	var n int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM entities WHERE id IN ($1,$2) AND namespace=$3
		AND COALESCE(metadata->>'deleted','') <> 'true'`, in.SrcID, in.DstID, in.Namespace).Scan(&n); err != nil {
		return nil, err
	}
	if n != 2 {
		return nil, fmt.Errorf("%w: both endpoints must be live entities in brain %s", ErrNotFound, in.Namespace)
	}
	if err := requireEdgeType(ctx, db, in.Namespace, rel, in.CreateType); err != nil {
		return nil, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	id, err := insertEdge(ctx, tx, in.Namespace, in.SrcID, in.DstID, rel, in.Fact, w, map[string]any{"origin": OriginManual})
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetEdge(ctx, id)
}

func insertEdge(ctx context.Context, tx *sql.Tx, ns, src, dst, rel, fact string, w float64, meta map[string]any) (string, error) {
	var exists bool
	// Serialize writers of the same triple, then refuse a live duplicate.
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, src+dst+rel); err != nil {
		return "", err
	}
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM entity_edges WHERE src_id=$1 AND dst_id=$2
		AND relation=$3 AND valid_to IS NULL)`, src, dst, rel).Scan(&exists); err != nil {
		return "", err
	}
	if exists {
		return "", fmt.Errorf("%w: that edge already exists", ErrGraphConflict)
	}
	raw, _ := json.Marshal(meta)
	var id string
	err := tx.QueryRowContext(ctx, `
		INSERT INTO entity_edges (namespace, src_id, dst_id, relation, fact, weight, metadata)
		VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7::jsonb) RETURNING id::text`,
		ns, src, dst, rel, strings.TrimSpace(fact), w, string(raw)).Scan(&id)
	if isUniqueViolation(err) {
		return "", fmt.Errorf("%w: that edge already exists", ErrGraphConflict)
	}
	return id, err
}

// EdgePatch is a partial edge update.
type EdgePatch struct {
	Relation   *string
	Fact       *string
	Weight     *float64
	CreateType bool
}

// UpdateEdge re-words / re-weights an edge in place, or retypes it: the old row
// is closed and a new one opened with the same endpoints. Returns the live row.
func (s *Store) UpdateEdge(ctx context.Context, id string, p EdgePatch) (*GraphEdgeRow, error) {
	cur, err := s.GetEdge(ctx, id)
	if err != nil {
		return nil, err
	}
	if cur.ValidTo != nil {
		return nil, fmt.Errorf("%w: the edge is closed", ErrNotFound)
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	fact, w := cur.Fact, cur.Weight
	if p.Fact != nil {
		fact = strings.TrimSpace(*p.Fact)
	}
	if p.Weight != nil {
		w = *p.Weight
	}
	rel := cur.Relation
	if p.Relation != nil {
		if rel, err = normalizeTypeName(*p.Relation); err != nil {
			return nil, err
		}
		if rel == "" {
			return nil, fmt.Errorf("%w: relation cannot be empty", ErrInvalidInput)
		}
	}
	if rel == cur.Relation {
		if _, err := db.ExecContext(ctx, `UPDATE entity_edges SET fact=NULLIF($2,''), weight=$3 WHERE id=$1`, id, fact, w); err != nil {
			return nil, err
		}
		return s.GetEdge(ctx, id)
	}
	if isDerivedOrigin(cur.Origin) {
		return nil, fmt.Errorf("%w: this edge comes from a note's text (%s); edit the note to change it", ErrGraphConflict, cur.Origin)
	}
	if err := requireEdgeType(ctx, db, cur.Namespace, rel, p.CreateType); err != nil {
		return nil, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `UPDATE entity_edges SET valid_to = now() WHERE id=$1 AND valid_to IS NULL`, id)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, fmt.Errorf("%w: the edge is closed", ErrNotFound)
	}
	meta := cur.Metadata
	meta["retyped_from"] = id
	newID, err := insertEdge(ctx, tx, cur.Namespace, cur.SrcID, cur.DstID, rel, fact, w, meta)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetEdge(ctx, newID)
}

// DeleteEdge closes an edge.
func (s *Store) DeleteEdge(ctx context.Context, id string) (*GraphEdgeRow, error) {
	cur, err := s.GetEdge(ctx, id)
	if err != nil {
		return nil, err
	}
	if cur.ValidTo != nil {
		return nil, fmt.Errorf("%w: the edge is already closed", ErrNotFound)
	}
	if isDerivedOrigin(cur.Origin) {
		return nil, fmt.Errorf("%w: this edge comes from a note's text (%s); edit the note to remove it", ErrGraphConflict, cur.Origin)
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := db.ExecContext(ctx, `UPDATE entity_edges SET valid_to = now() WHERE id=$1 AND valid_to IS NULL`, id); err != nil {
		return nil, err
	}
	return s.GetEdge(ctx, id)
}

// --- ontology ------------------------------------------------------------------

// OntologyType is one entity or edge type with its live usage.
type OntologyType struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Src         string `json:"src,omitempty"`
	Dst         string `json:"dst,omitempty"`
	Count       int    `json:"count"`
	Builtin     bool   `json:"builtin"`
}

// Ontology lists a brain's entity and edge types with counts.
func (s *Store) Ontology(ctx context.Context, ns string) ([]OntologyType, []OntologyType, error) {
	ents, rels := []OntologyType{}, []OntologyType{}
	db, err := s.db(ctx)
	if err != nil {
		return ents, rels, err
	}
	rows, err := db.QueryContext(ctx, `
		SELECT t.name, COALESCE(t.description,''), (SELECT count(*) FROM entities e
		  WHERE e.namespace=t.namespace AND e.entity_type=t.name AND COALESCE(e.metadata->>'deleted','') <> 'true')
		FROM entity_types t WHERE t.namespace=$1 ORDER BY 3 DESC, 1`, ns)
	if err != nil {
		return ents, rels, err
	}
	for rows.Next() {
		var x OntologyType
		if err := rows.Scan(&x.Name, &x.Description, &x.Count); err == nil {
			x.Builtin = builtinEntityTypes[x.Name]
			ents = append(ents, x)
		}
	}
	rows.Close()
	rows, err = db.QueryContext(ctx, `
		SELECT t.name, COALESCE(t.description,''), COALESCE(t.src_type,''), COALESCE(t.dst_type,''),
		       (SELECT count(*) FROM entity_edges e WHERE e.namespace=t.namespace AND e.relation=t.name AND e.valid_to IS NULL)
		FROM edge_types t WHERE t.namespace=$1 ORDER BY 5 DESC, 1`, ns)
	if err != nil {
		return ents, rels, err
	}
	defer rows.Close()
	for rows.Next() {
		var x OntologyType
		if err := rows.Scan(&x.Name, &x.Description, &x.Src, &x.Dst, &x.Count); err == nil {
			x.Builtin = builtinEdgeTypes[x.Name]
			rels = append(rels, x)
		}
	}
	return ents, rels, rows.Err()
}

// OntologyKind is "entity" or "edge".
type OntologyKind string

const (
	KindEntityType OntologyKind = "entity"
	KindEdgeType   OntologyKind = "edge"
)

func (k OntologyKind) table() string {
	if k == KindEdgeType {
		return "edge_types"
	}
	return "entity_types"
}

// CreateType registers an entity or edge type.
func (s *Store) CreateType(ctx context.Context, k OntologyKind, ns, name, desc string) (*OntologyType, error) {
	name, err := normalizeTypeName(name)
	if err != nil {
		return nil, err
	}
	if ns == "" || name == "" {
		return nil, fmt.Errorf("%w: namespace and name are required", ErrInvalidInput)
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	res, err := db.ExecContext(ctx, `INSERT INTO `+k.table()+` (namespace, name, description) VALUES ($1,$2,NULLIF($3,''))
		ON CONFLICT DO NOTHING`, ns, name, strings.TrimSpace(desc))
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, fmt.Errorf("%w: %s type %q already exists", ErrGraphConflict, k, name)
	}
	return &OntologyType{Name: name, Description: strings.TrimSpace(desc)}, nil
}

// UpdateType changes a type's description.
func (s *Store) UpdateType(ctx context.Context, k OntologyKind, ns, name, desc string) (*OntologyType, error) {
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	res, err := db.ExecContext(ctx, `UPDATE `+k.table()+` SET description=NULLIF($3,'') WHERE namespace=$1 AND name=$2`,
		ns, name, strings.TrimSpace(desc))
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return &OntologyType{Name: name, Description: strings.TrimSpace(desc)}, nil
}

// DeleteType removes a type. While in use it is refused unless reassignTo names
// the type to move its entities / live edges to (notes' categories follow, as a
// new note version). The built-in note vocabulary cannot be removed.
func (s *Store) DeleteType(ctx context.Context, k OntologyKind, ns, name, reassignTo string, by NoteAuthor) (int, error) {
	if (k == KindEntityType && builtinEntityTypes[name]) || (k == KindEdgeType && builtinEdgeTypes[name]) {
		return 0, fmt.Errorf("%w: %q is part of the notes vocabulary", ErrGraphConflict, name)
	}
	db, err := s.db(ctx)
	if err != nil {
		return 0, err
	}
	var exists bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM `+k.table()+` WHERE namespace=$1 AND name=$2)`, ns, name).Scan(&exists); err != nil {
		return 0, err
	}
	if !exists {
		return 0, ErrNotFound
	}
	var inUse int
	if k == KindEntityType {
		err = db.QueryRowContext(ctx, `SELECT count(*) FROM entities WHERE namespace=$1 AND entity_type=$2`, ns, name).Scan(&inUse)
	} else {
		err = db.QueryRowContext(ctx, `SELECT count(*) FROM entity_edges WHERE namespace=$1 AND relation=$2 AND valid_to IS NULL`, ns, name).Scan(&inUse)
	}
	if err != nil {
		return 0, err
	}
	if inUse > 0 && reassignTo == "" {
		return inUse, fmt.Errorf("%w: %d still use %q; pass reassign_to", ErrGraphConflict, inUse, name)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if inUse > 0 {
		if reassignTo == name {
			return 0, fmt.Errorf("%w: reassign_to must be a different type", ErrInvalidInput)
		}
		var ok bool
		if k == KindEntityType {
			ok, err = entityTypeExists(ctx, tx, ns, reassignTo)
		} else {
			ok, err = edgeTypeExists(ctx, tx, ns, reassignTo)
		}
		if err != nil {
			return 0, err
		}
		if !ok {
			return 0, fmt.Errorf("%w: unknown %s type %q", ErrInvalidInput, k, reassignTo)
		}
		if k == KindEntityType {
			if _, err := tx.ExecContext(ctx, `UPDATE entities SET entity_type=$3 WHERE namespace=$1 AND entity_type=$2`, ns, name, reassignTo); err != nil {
				return 0, err
			}
			if _, err := tx.ExecContext(ctx, `
				WITH u AS (
				  UPDATE notes SET category=$3, version=version+1, updated_at=clock_timestamp()
				  WHERE namespace=$1 AND category=$2
				  RETURNING id, version, title, body, tags, pinned, archived, deleted_at, source, category)
				INSERT INTO note_versions (note_id, version, title, body, tags, pinned, archived, deleted, source,
				                           author_user_id, author_agent, category)
				SELECT id, version, title, body, tags, pinned, archived, deleted_at IS NOT NULL, source, $4, $5, category FROM u`,
				ns, name, reassignTo, nullStr(by.UserID), nullStr(by.Agent)); err != nil {
				return 0, err
			}
		} else {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO entity_edges (namespace, src_id, dst_id, relation, fact, embedding, episode_id, memory_id, weight, metadata)
				SELECT e.namespace, e.src_id, e.dst_id, $3, e.fact, e.embedding, e.episode_id, e.memory_id, e.weight,
				       e.metadata || jsonb_build_object('retyped_from', e.id::text)
				FROM entity_edges e
				WHERE e.namespace=$1 AND e.relation=$2 AND e.valid_to IS NULL
				  AND NOT EXISTS (SELECT 1 FROM entity_edges x WHERE x.src_id=e.src_id AND x.dst_id=e.dst_id
				                  AND x.relation=$3 AND x.valid_to IS NULL)
				ON CONFLICT DO NOTHING`, ns, name, reassignTo); err != nil {
				return 0, err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE entity_edges SET valid_to=now()
				WHERE namespace=$1 AND relation=$2 AND valid_to IS NULL`, ns, name); err != nil {
				return 0, err
			}
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM `+k.table()+` WHERE namespace=$1 AND name=$2`, ns, name); err != nil {
		return 0, err
	}
	return inUse, tx.Commit()
}

// --- notes ↔ graph reads ---------------------------------------------------------

// NoteLink is a note seen from another note (backlinks, related).
type NoteLink struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Category string `json:"category,omitempty"`
	Relation string `json:"relation,omitempty"`
}

// Backlinks lists the live notes whose [[wikilinks]] point at this note.
func (s *Store) Backlinks(ctx context.Context, n *Note) ([]NoteLink, error) {
	out := []NoteLink{}
	if n.EntityID == "" {
		return out, nil
	}
	db, err := s.db(ctx)
	if err != nil {
		return out, err
	}
	rows, err := db.QueryContext(ctx, `
		SELECT DISTINCT ON (o.id) o.id::text, o.title, o.category, e.relation
		FROM entity_edges e JOIN notes o ON o.entity_id = e.src_id AND o.deleted_at IS NULL
		WHERE e.dst_id = $1 AND e.valid_to IS NULL AND e.metadata->>'origin' = 'wikilink' AND o.id <> $2
		ORDER BY o.id LIMIT 500`, n.EntityID, n.ID)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var l NoteLink
		if err := rows.Scan(&l.ID, &l.Title, &l.Category, &l.Relation); err != nil {
			return out, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// RelatedLink is a typed edge around a related entity.
type RelatedLink struct {
	Relation  string `json:"relation"` // worded from the related entity's side
	Edge      string `json:"edge"`
	Backwards bool   `json:"backwards"`
	ID        string `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
}

// RelatedEntity is something a note names (or that names it).
type RelatedEntity struct {
	ID        string        `json:"id"`
	Type      string        `json:"type"`
	Name      string        `json:"name"`
	NoteID    string        `json:"noteId,omitempty"`
	Relation  string        `json:"relation"`
	Edge      string        `json:"edge"`
	Backwards bool          `json:"backwards"`
	Notes     []NoteLink    `json:"notes"`
	Links     []RelatedLink `json:"links"`
}

// Related lists what a note names, the other notes that name the same things,
// and the typed edges around them (port of fadymondy.com notes.Related).
func (s *Store) Related(ctx context.Context, n *Note) ([]RelatedEntity, error) {
	out := []RelatedEntity{}
	if n.EntityID == "" {
		return out, nil
	}
	edges, err := s.EntityEdges(ctx, n.EntityID, nil, 50)
	if err != nil {
		return out, err
	}
	seen := map[string]bool{}
	for _, e := range edges {
		if seen[e.OtherID] {
			continue
		}
		seen[e.OtherID] = true
		re := RelatedEntity{ID: e.OtherID, Type: e.OtherType, Name: e.OtherName, NoteID: e.OtherNoteID,
			Relation: e.Label, Edge: e.Relation, Backwards: e.Direction == "in", Notes: []NoteLink{}, Links: []RelatedLink{}}
		around, err := s.EntityEdges(ctx, e.OtherID, nil, 60)
		if err == nil {
			noteSeen := map[string]bool{}
			for _, m := range around {
				if m.OtherID == n.EntityID {
					continue
				}
				if m.OtherNoteID != "" {
					if !noteSeen[m.OtherNoteID] && len(re.Notes) < 8 {
						noteSeen[m.OtherNoteID] = true
						re.Notes = append(re.Notes, NoteLink{ID: m.OtherNoteID, Title: m.OtherName, Category: m.OtherType, Relation: m.Label})
					}
					continue
				}
				if len(re.Links) < 8 {
					re.Links = append(re.Links, RelatedLink{Relation: m.Label, Edge: m.Relation, Backwards: m.Direction == "in",
						ID: m.OtherID, Name: m.OtherName, Type: m.OtherType})
				}
			}
		}
		out = append(out, re)
	}
	sort.SliceStable(out, func(i, j int) bool { return len(out[i].Notes)+len(out[i].Links) > len(out[j].Notes)+len(out[j].Links) })
	return out, nil
}

// --- path by id ------------------------------------------------------------------

// PathStep is one node on a path, with the relation that led to it.
type PathStep struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Type   string `json:"type"`
	NoteID string `json:"noteId,omitempty"`
	Via    string `json:"via,omitempty"`
}

// EntityPath is a breadth-first shortest path between two entities over live
// edges (either direction), level by level so a hub cannot blow up a recursive
// CTE. nil = not connected within maxDepth.
func (s *Store) EntityPath(ctx context.Context, from, to string, maxDepth int) ([]PathStep, error) {
	if maxDepth <= 0 || maxDepth > 6 {
		maxDepth = 4
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	type hop struct{ prev, rel string }
	parent := map[string]hop{from: {}}
	frontier := []string{from}
	found := from == to
	for depth := 0; depth < maxDepth && !found && len(frontier) > 0; depth++ {
		rows, err := db.QueryContext(ctx, `
			SELECT e.src_id::text, e.dst_id::text, e.relation FROM entity_edges e
			JOIN entities s ON s.id = e.src_id JOIN entities d ON d.id = e.dst_id
			WHERE e.valid_to IS NULL
			  AND (e.src_id = ANY($1::text[]::uuid[]) OR e.dst_id = ANY($1::text[]::uuid[]))
			  AND COALESCE(s.metadata->>'deleted','') <> 'true' AND COALESCE(d.metadata->>'deleted','') <> 'true'
			LIMIT 20000`, stringArray(frontier))
		if err != nil {
			return nil, err
		}
		inFrontier := map[string]bool{}
		for _, f := range frontier {
			inFrontier[f] = true
		}
		var next []string
		for rows.Next() {
			var src, dst, rel string
			if err := rows.Scan(&src, &dst, &rel); err != nil {
				rows.Close()
				return nil, err
			}
			for _, pair := range [][2]string{{src, dst}, {dst, src}} {
				if !inFrontier[pair[0]] {
					continue
				}
				if _, ok := parent[pair[1]]; ok {
					continue
				}
				parent[pair[1]] = hop{prev: pair[0], rel: rel}
				next = append(next, pair[1])
				if pair[1] == to {
					found = true
				}
			}
		}
		rows.Close()
		if len(next) > 5000 {
			next = next[:5000]
		}
		frontier = next
	}
	if !found {
		return nil, nil
	}
	var ids []string
	var rels []string
	for cur := to; ; {
		ids = append([]string{cur}, ids...)
		h := parent[cur]
		rels = append([]string{h.rel}, rels...)
		if cur == from {
			break
		}
		cur = h.prev
	}
	steps := make([]PathStep, len(ids))
	for i, id := range ids {
		steps[i] = PathStep{ID: id, Via: rels[i]}
		if e, err := s.GetEntity(ctx, id); err == nil {
			steps[i].Name, steps[i].Type, steps[i].NoteID = e.Name, e.Type, e.NoteID
		}
	}
	return steps, nil
}
