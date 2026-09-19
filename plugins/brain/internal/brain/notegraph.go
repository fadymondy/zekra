package brain

/*
Notes ARE the graph's nodes (and the graph is editable).

Every note owns exactly one entity: natural_key 'note:<id>', name = the title,
entity_type = the note's category, summary = its first paragraph,
metadata {note_id, source:'note'}. notes.entity_id points back at it. The entity
is written in the same transaction as the note, so a note and its node never
disagree.

Derived edges. A save re-derives the edges the note's text implies and syncs
them against what is live, touching ONLY edges it owns (metadata.origin):

  - [[Target]] / [[Target|type]] → links_to, origin 'wikilink'. Target resolves
    to a note with that title, else any entity with that name, else a new entity
    (entity_type = the given type, default 'concept');
  - tags → tagged, origin 'extract', to a 'tag' entity keyed 'tag:<lower>'.

Removed links are closed (valid_to = now()), never deleted; manual edges
(origin 'manual'), Cognee edges and anything else are never touched.

Delete / restore. Deleting a note tombstones its entity too (metadata.deleted =
true) and closes its derived edges; the entity row itself is KEPT so manual
edges drawn to/from it, and the edge history, survive and come back on restore.
Deleted entities are hidden from the graph payload and the link picker. Restore
re-syncs, which reopens the derived edges and clears the flag.
*/

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// querier is what both *sql.DB and *sql.Tx offer.
type querier interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

var (
	// ErrEntityHasNote: the entity already is a note's node.
	ErrEntityHasNote = errors.New("brain: the entity already has a note")
	// ErrGraphConflict is a 409 on a graph edit (duplicate, in use, derived, builtin).
	ErrGraphConflict = errors.New("brain: conflict")
)

// Edge origins (entity_edges.metadata->>'origin').
const (
	OriginManual   = "manual"
	OriginWikilink = "wikilink"
	OriginExtract  = "extract"
	OriginCognee   = "cognee"
)

const (
	noteEntityType  = "note"
	noteSummaryMax  = 280
	maxNoteLinks    = 200
	entityNameMax   = 300
	typeNameMax     = 64
	relLinksTo      = "links_to"
	relTagged       = "tagged"
	relMentionedIn  = "mentioned_in"
	relRelatedTo    = "related_to"
	tagKeyPrefix    = "tag:"
	defaultLinkType = "concept"
)

// The note vocabulary, seeded per namespace on first use (idempotent).
var (
	noteEntityTypes = [][2]string{
		{noteEntityType, "A note in this brain"},
	}
	noteEdgeTypes = [][2]string{
		{relLinksTo, "A note links to it with a [[wikilink]]"},
		{relMentionedIn, "It is mentioned in a note"},
		{relTagged, "A note is tagged with it"},
		{relRelatedTo, "Loosely related"},
	}
	builtinEntityTypes = map[string]bool{noteEntityType: true}
	builtinEdgeTypes   = map[string]bool{relLinksTo: true, relMentionedIn: true, relTagged: true, relRelatedTo: true}
)

func ensureNoteOntology(ctx context.Context, q querier, ns string) error {
	for _, t := range noteEntityTypes {
		if err := ensureEntityType(ctx, q, ns, t[0], t[1]); err != nil {
			return err
		}
	}
	for _, t := range noteEdgeTypes {
		if _, err := q.ExecContext(ctx, `INSERT INTO edge_types (namespace, name, description) VALUES ($1,$2,$3)
			ON CONFLICT DO NOTHING`, ns, t[0], t[1]); err != nil {
			return err
		}
	}
	return nil
}

func ensureEntityType(ctx context.Context, q querier, ns, name, desc string) error {
	_, err := q.ExecContext(ctx, `INSERT INTO entity_types (namespace, name, description) VALUES ($1,$2,NULLIF($3,''))
		ON CONFLICT DO NOTHING`, ns, name, desc)
	return err
}

func ensureEdgeType(ctx context.Context, q querier, ns, name, desc string) error {
	_, err := q.ExecContext(ctx, `INSERT INTO edge_types (namespace, name, description) VALUES ($1,$2,NULLIF($3,''))
		ON CONFLICT DO NOTHING`, ns, name, desc)
	return err
}

func entityTypeExists(ctx context.Context, q querier, ns, name string) (bool, error) {
	var ok bool
	err := q.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM entity_types WHERE namespace=$1 AND name=$2)`, ns, name).Scan(&ok)
	return ok, err
}

func edgeTypeExists(ctx context.Context, q querier, ns, name string) (bool, error) {
	var ok bool
	err := q.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM edge_types WHERE namespace=$1 AND name=$2)`, ns, name).Scan(&ok)
	return ok, err
}

// --- names (pure) --------------------------------------------------------------

var (
	spaceRunRE = regexp.MustCompile(`\s+`)
	typeNameRE = regexp.MustCompile(`^[\p{L}\p{N}][\p{L}\p{N}_.:\-]*$`)
)

// normalizeTypeName cleans an entity type / relation / category name: trimmed,
// inner whitespace → '_', case kept. "" stays "".
func normalizeTypeName(s string) (string, error) {
	s = spaceRunRE.ReplaceAllString(strings.TrimSpace(s), "_")
	if s == "" {
		return "", nil
	}
	if utf8.RuneCountInString(s) > typeNameMax || !typeNameRE.MatchString(s) {
		return "", fmt.Errorf("%w: %q is not a valid type name (letters, digits, _ . : -; up to %d)", ErrInvalidInput, s, typeNameMax)
	}
	return s, nil
}

// noteCategory is a note's category ("" → "note").
func noteCategory(s string) (string, error) {
	c, err := normalizeTypeName(s)
	if err != nil {
		return "", err
	}
	if c == "" {
		c = noteEntityType
	}
	return c, nil
}

// wikiLink is one [[Target]] or [[Target|type]].
type wikiLink struct {
	Target string
	Type   string // normalized; "" = default
}

var wikiLinkRE = regexp.MustCompile(`\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]*?))?\]\]`)

// parseWikilinks returns the distinct link targets (case-insensitive, first
// spelling wins) in order of appearance. An invalid |type is ignored.
func parseWikilinks(body string) []wikiLink {
	var out []wikiLink
	seen := map[string]bool{}
	for _, m := range wikiLinkRE.FindAllStringSubmatch(body, -1) {
		t := spaceRunRE.ReplaceAllString(strings.TrimSpace(m[1]), " ")
		if t == "" || utf8.RuneCountInString(t) > entityNameMax || seen[strings.ToLower(t)] {
			continue
		}
		seen[strings.ToLower(t)] = true
		typ, err := normalizeTypeName(m[2])
		if err != nil {
			typ = ""
		}
		out = append(out, wikiLink{Target: t, Type: typ})
		if len(out) == maxNoteLinks {
			break
		}
	}
	return out
}

// noteSummary is the first paragraph of the body, wikilinks unwrapped, capped.
func noteSummary(body string) string {
	body = strings.TrimSpace(strings.ReplaceAll(body, "\r\n", "\n"))
	for _, p := range strings.Split(body, "\n\n") {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		p = strings.TrimSpace(strings.TrimLeft(p, "#"))
		p = wikiLinkRE.ReplaceAllString(p, "$1")
		p = spaceRunRE.ReplaceAllString(p, " ")
		if p == "" {
			continue
		}
		if utf8.RuneCountInString(p) > noteSummaryMax {
			r := []rune(p)
			p = strings.TrimSpace(string(r[:noteSummaryMax-1])) + "…"
		}
		return p
	}
	return ""
}

func noteEntityName(title string) string {
	if t := strings.TrimSpace(title); t != "" {
		return t
	}
	return "Untitled"
}

func noteKey(id string) string { return noteSourceRef + id }

// --- sync ----------------------------------------------------------------------

// syncNoteGraph makes the note's entity and derived edges match the note. It
// runs inside the note's write transaction and sets n.EntityID.
func syncNoteGraph(ctx context.Context, q querier, n *Note) error {
	ns := n.Namespace
	if err := ensureNoteOntology(ctx, q, ns); err != nil {
		return fmt.Errorf("note ontology: %w", err)
	}
	if n.Category == "" {
		n.Category = noteEntityType
	}
	if err := ensureEntityType(ctx, q, ns, n.Category, ""); err != nil {
		return err
	}
	meta := map[string]any{"note_id": n.ID, "source": "note"}
	if n.Deleted {
		meta["deleted"] = true
	}
	metaJSON, _ := json.Marshal(meta)
	name, summary := noteEntityName(n.Title), noteSummary(n.Body)

	var eid string
	if n.EntityID != "" {
		// Keep (or adopt) the entity the note already points at.
		err := q.QueryRowContext(ctx, `
			UPDATE entities SET natural_key=$3, name=$4, entity_type=$5, summary=NULLIF($6,''),
			       metadata=(metadata - 'deleted') || $7::jsonb
			WHERE id=$1 AND namespace=$2 RETURNING id::text`,
			n.EntityID, ns, noteKey(n.ID), name, n.Category, summary, string(metaJSON)).Scan(&eid)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("note entity: %w", err)
		}
	}
	if eid == "" {
		err := q.QueryRowContext(ctx, `
			INSERT INTO entities (namespace, natural_key, name, entity_type, summary, metadata)
			VALUES ($1,$2,$3,$4,NULLIF($5,''),$6::jsonb)
			ON CONFLICT (namespace, natural_key) WHERE natural_key IS NOT NULL DO UPDATE
			  SET name=EXCLUDED.name, entity_type=EXCLUDED.entity_type, summary=EXCLUDED.summary,
			      metadata=(entities.metadata - 'deleted') || EXCLUDED.metadata
			RETURNING id::text`,
			ns, noteKey(n.ID), name, n.Category, summary, string(metaJSON)).Scan(&eid)
		if err != nil {
			return fmt.Errorf("note entity: %w", err)
		}
	}
	if eid != n.EntityID {
		if _, err := q.ExecContext(ctx, `UPDATE notes SET entity_id=$2 WHERE id=$1`, n.ID, eid); err != nil {
			return err
		}
		n.EntityID = eid
	}

	var links, tags []string
	if !n.Deleted {
		for _, l := range parseWikilinks(n.Body) {
			dst, err := resolveLinkTarget(ctx, q, ns, eid, l)
			if err != nil {
				return fmt.Errorf("wikilink %q: %w", l.Target, err)
			}
			if dst != eid {
				links = append(links, dst)
			}
		}
		if len(n.Tags) > 0 {
			if err := ensureEntityType(ctx, q, ns, "tag", "A note tag"); err != nil {
				return err
			}
		}
		for _, t := range n.Tags {
			var dst string
			err := q.QueryRowContext(ctx, `
				INSERT INTO entities (namespace, natural_key, name, entity_type, metadata)
				VALUES ($1,$2,$3,'tag','{"source":"tag"}')
				ON CONFLICT (namespace, natural_key) WHERE natural_key IS NOT NULL DO UPDATE
				  SET metadata = entities.metadata - 'deleted'
				RETURNING id::text`, ns, tagKeyPrefix+strings.ToLower(t), t).Scan(&dst)
			if err != nil {
				return fmt.Errorf("tag %q: %w", t, err)
			}
			tags = append(tags, dst)
		}
	}
	if err := syncDerivedEdges(ctx, q, ns, eid, n.ID, OriginWikilink, relLinksTo, links); err != nil {
		return err
	}
	return syncDerivedEdges(ctx, q, ns, eid, n.ID, OriginExtract, relTagged, tags)
}

// resolveLinkTarget finds the entity a [[wikilink]] names — a live note with that
// title first, then any entity with that name — or creates it.
func resolveLinkTarget(ctx context.Context, q querier, ns, self string, l wikiLink) (string, error) {
	var id string
	var deleted, isNote bool
	err := q.QueryRowContext(ctx, `
		SELECT id::text, COALESCE(metadata->>'deleted','') = 'true', COALESCE(natural_key,'') LIKE 'note:%'
		FROM entities WHERE namespace=$1 AND lower(name)=lower($2) AND id <> $3::uuid
		ORDER BY COALESCE(metadata->>'deleted','') = 'true', COALESCE(natural_key,'') LIKE 'note:%' DESC, created_at
		LIMIT 1`, ns, l.Target, self).Scan(&id, &deleted, &isNote)
	switch {
	case err == nil:
		if deleted && !isNote { // linking to it again brings it back
			_, err = q.ExecContext(ctx, `UPDATE entities SET metadata = metadata - 'deleted' WHERE id=$1`, id)
		}
		return id, err
	case !errors.Is(err, sql.ErrNoRows):
		return "", err
	}
	typ := l.Type
	if typ == "" {
		typ = defaultLinkType
	}
	if err := ensureEntityType(ctx, q, ns, typ, ""); err != nil {
		return "", err
	}
	err = q.QueryRowContext(ctx, `
		INSERT INTO entities (namespace, name, entity_type, metadata) VALUES ($1,$2,$3,'{"source":"wikilink"}')
		ON CONFLICT (namespace, name) WHERE natural_key IS NULL DO UPDATE SET name = EXCLUDED.name
		RETURNING id::text`, ns, l.Target, typ).Scan(&id)
	return id, err
}

// syncDerivedEdges makes src's live edges of one origin exactly {src -rel-> dst}.
// Edges of any other origin are never read or written.
func syncDerivedEdges(ctx context.Context, q querier, ns, src, noteID, origin, rel string, dsts []string) error {
	want := map[string]bool{}
	for _, d := range dsts {
		want[d] = true
	}
	rows, err := q.QueryContext(ctx, `
		SELECT id::text, dst_id::text, relation FROM entity_edges
		WHERE src_id=$1 AND valid_to IS NULL AND metadata->>'origin' = $2`, src, origin)
	if err != nil {
		return err
	}
	have := map[string]bool{}
	var closeIDs []string
	for rows.Next() {
		var id, dst, r string
		if err := rows.Scan(&id, &dst, &r); err != nil {
			rows.Close()
			return err
		}
		if want[dst] && r == rel && !have[dst] {
			have[dst] = true
		} else {
			closeIDs = append(closeIDs, id)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if len(closeIDs) > 0 {
		if _, err := q.ExecContext(ctx, `UPDATE entity_edges SET valid_to = now()
			WHERE id = ANY($1::text[]::uuid[]) AND valid_to IS NULL`, stringArray(closeIDs)); err != nil {
			return err
		}
	}
	meta, _ := json.Marshal(map[string]any{"origin": origin, "note_id": noteID})
	for _, d := range dsts {
		if have[d] {
			continue
		}
		have[d] = true
		if _, err := q.ExecContext(ctx, `
			INSERT INTO entity_edges (namespace, src_id, dst_id, relation, metadata)
			VALUES ($1,$2,$3,$4,$5::jsonb)
			ON CONFLICT (namespace, src_id, dst_id, relation, valid_from) DO NOTHING`,
			ns, src, d, rel, string(meta)); err != nil {
			return err
		}
	}
	return nil
}

// linkNoteMemories links the note's live chunk memories to its entity (and
// unlinks its invalidated ones). Best-effort: runs after the index pass.
func (s *Store) linkNoteMemories(ctx context.Context, n *Note) {
	db, err := s.db(ctx)
	if err != nil || n == nil {
		return
	}
	_ = linkNoteMemoriesQ(context.WithoutCancel(ctx), db, n.Namespace, n.ID, n.EntityID)
}

func linkNoteMemoriesQ(ctx context.Context, q querier, ns, noteID, eid string) error {
	if eid == "" {
		return nil
	}
	like := noteSourceRef + noteID + "#%"
	if _, err := q.ExecContext(ctx, `
		INSERT INTO memory_entities (memory_id, entity_id)
		SELECT id, $3::uuid FROM memories
		WHERE namespace=$1 AND source_kind='note' AND source_ref LIKE $2 AND invalid_at IS NULL
		ON CONFLICT DO NOTHING`, ns, like, eid); err != nil {
		return err
	}
	_, err := q.ExecContext(ctx, `
		DELETE FROM memory_entities me USING memories m
		WHERE me.entity_id=$3::uuid AND me.memory_id=m.id AND m.namespace=$1 AND m.source_kind='note'
		  AND m.source_ref LIKE $2 AND m.invalid_at IS NOT NULL`, ns, like, eid)
	return err
}

// BackfillNotesGraph syncs every existing note (tombstones included) into the
// graph: its entity, its derived edges and its memory links. Idempotent; each
// note is its own transaction. Returns how many notes were synced.
func BackfillNotesGraph(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx, `SELECT id::text FROM notes ORDER BY created_at, id`)
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	done := 0
	for _, id := range ids {
		n, err := backfillOne(ctx, db, id)
		if err != nil {
			return done, fmt.Errorf("note %s: %w", id, err)
		}
		if !n.Deleted {
			if err := linkNoteMemoriesQ(ctx, db, n.Namespace, n.ID, n.EntityID); err != nil {
				return done, fmt.Errorf("note %s memories: %w", id, err)
			}
		}
		done++
	}
	return done, nil
}

func backfillOne(ctx context.Context, db *sql.DB, id string) (*Note, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	n, err := scanNote(tx.QueryRowContext(ctx, `SELECT `+noteCols+` FROM notes WHERE id=$1 FOR UPDATE`, id))
	if err != nil {
		return nil, err
	}
	if err := syncNoteGraph(ctx, tx, n); err != nil {
		return nil, err
	}
	return n, tx.Commit()
}
