package brain

/*
Notes (Phase 1). A note is a markdown document living in a brain. It is the
source of truth for its own text; its memories are derived:

  - saving a note chunks "title + body" (noteChunks: split on markdown headings,
    then on paragraphs up to noteChunkMax runes, reusing chunkText) and retains
    every chunk through the ordinary write pipeline (Store.Retain) with
    source_kind='note', source_ref='note:<id>#<n>';
  - notes.chunk_hashes remembers the sha256 of what was retained at each index, so
    an edit re-retains only changed chunks (Retain supersedes the row with the
    same source_ref — the write-decision's UPDATE) and soft-invalidates chunks
    that no longer exist (the same invalid_at semantics as memory_forget);
  - memories are never hard-deleted. Deleting a note tombstones it and
    invalidates all of its memories; restoring re-retains them.

Indexing needs the embedder. When it is unavailable the note still saves; the
failed chunks keep an empty hash and index_error says why, so the next save (or
a restore) retries them.
*/

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	noteChunkMax  = 1600
	noteMaxBody   = 1 << 20 // 1 MiB of markdown
	noteMaxTitle  = 300
	noteMaxTags   = 32
	noteSourceRef = "note:"
)

var validNoteSource = map[string]bool{"web": true, "mobile": true, "desktop": true, "agent": true, "api": true}

// ErrConflict is an optimistic-concurrency failure (the note moved on).
var ErrConflict = errors.New("brain: version conflict")

// Note is the REST shape of a note. A tombstone carries Deleted=true and no body.
type Note struct {
	ID             string     `json:"id"`
	Namespace      string     `json:"namespace"`
	OwnerUserID    string     `json:"ownerUserId,omitempty"`
	Title          string     `json:"title"`
	Body           string     `json:"body,omitempty"`
	Tags           []string   `json:"tags"`
	Pinned         bool       `json:"pinned"`
	Archived       bool       `json:"archived"`
	Source         string     `json:"source"`
	Version        int        `json:"version"`
	Chunks         int        `json:"chunks"`
	Indexed        bool       `json:"indexed"`
	IndexError     string     `json:"indexError,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	DeletedAt      *time.Time `json:"deletedAt,omitempty"`
	Deleted        bool       `json:"deleted"`
	chunkHashes    []string
	indexedVersion int
}

// NoteVersion is one entry of a note's history.
type NoteVersion struct {
	Version      int       `json:"version"`
	Title        string    `json:"title"`
	Body         string    `json:"body"`
	Tags         []string  `json:"tags"`
	Pinned       bool      `json:"pinned"`
	Archived     bool      `json:"archived"`
	Deleted      bool      `json:"deleted"`
	Source       string    `json:"source"`
	AuthorUserID string    `json:"authorUserId,omitempty"`
	AuthorAgent  string    `json:"authorAgent,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}

// NoteAuthor is who performed a write (for history + memory attribution).
type NoteAuthor struct {
	UserID string
	Agent  string
	Source string
}

// NotePatch is a partial update; nil fields are left unchanged.
type NotePatch struct {
	Title    *string
	Body     *string
	Tags     *[]string
	Pinned   *bool
	Archived *bool
}

// --- chunking (pure) -----------------------------------------------------------

var headingRE = regexp.MustCompile(`(?m)^#{1,6}[ \t]+\S`)

// noteChunks turns a note into the texts that get retained. Sections start at
// markdown headings; each section is split on paragraphs by chunkText. The title
// leads every chunk so a chunk recalled on its own still says what it is from.
func noteChunks(title, body string) []string {
	title = strings.TrimSpace(title)
	body = strings.TrimSpace(strings.ReplaceAll(body, "\r\n", "\n"))
	if body == "" && title == "" {
		return nil
	}
	var sections []string
	locs := headingRE.FindAllStringIndex(body, -1)
	start := 0
	for _, l := range locs {
		if l[0] > start {
			sections = append(sections, body[start:l[0]])
		}
		start = l[0]
	}
	sections = append(sections, body[start:])

	budget := noteChunkMax - len([]rune(title)) - 2
	if budget < 400 {
		budget = 400
	}
	var out []string
	for _, sec := range sections {
		for _, c := range chunkText(sec, budget) {
			if c = strings.TrimSpace(c); c == "" {
				continue
			}
			if title != "" {
				c = title + "\n\n" + c
			}
			out = append(out, c)
		}
	}
	if len(out) == 0 && title != "" {
		out = []string{title}
	}
	return out
}

func chunkHash(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// chunkPlan is what an edit has to do to the memories.
type chunkPlan struct {
	Retain     []int // chunk indexes to (re-)retain
	Invalidate []int // old chunk indexes that no longer exist
}

// planChunkSync compares what was retained (old hashes, "" = never indexed) with
// the new chunk hashes, index by index.
func planChunkSync(old, next []string) chunkPlan {
	var p chunkPlan
	for i, h := range next {
		if i >= len(old) || old[i] == "" || old[i] != h {
			p.Retain = append(p.Retain, i)
		}
	}
	for i := len(next); i < len(old); i++ {
		p.Invalidate = append(p.Invalidate, i)
	}
	return p
}

func noteRef(id string, n int) string { return noteSourceRef + id + "#" + strconv.Itoa(n) }

// --- validation ----------------------------------------------------------------

func cleanTags(in []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, t := range in {
		t = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(t), "#"))
		if t == "" || len(t) > 64 || seen[strings.ToLower(t)] {
			continue
		}
		seen[strings.ToLower(t)] = true
		out = append(out, t)
		if len(out) == noteMaxTags {
			break
		}
	}
	return out
}

func validateNote(title, body string) error {
	if len([]rune(title)) > noteMaxTitle {
		return fmt.Errorf("%w: title is longer than %d characters", ErrInvalidInput, noteMaxTitle)
	}
	if len(body) > noteMaxBody {
		return fmt.Errorf("%w: body is larger than 1 MiB", ErrInvalidInput)
	}
	if strings.TrimSpace(title) == "" && strings.TrimSpace(body) == "" {
		return fmt.Errorf("%w: a note needs a title or a body", ErrInvalidInput)
	}
	return nil
}

// --- store ---------------------------------------------------------------------

const noteCols = `id::text, namespace, COALESCE(owner_user_id,''), title, body, tags, pinned, archived,
	source, version, chunk_hashes, indexed_version, COALESCE(index_error,''), created_at, updated_at, deleted_at`

type rowScanner interface{ Scan(dest ...any) error }

func scanNote(row rowScanner) (*Note, error) {
	var n Note
	var tags, hashes stringArray
	var deleted sql.NullTime
	if err := row.Scan(&n.ID, &n.Namespace, &n.OwnerUserID, &n.Title, &n.Body, &tags, &n.Pinned, &n.Archived,
		&n.Source, &n.Version, &hashes, &n.indexedVersion, &n.IndexError, &n.CreatedAt, &n.UpdatedAt, &deleted); err != nil {
		return nil, err
	}
	n.Tags = []string(tags)
	if n.Tags == nil {
		n.Tags = []string{}
	}
	n.chunkHashes = []string(hashes)
	n.Chunks = len(n.chunkHashes)
	n.Indexed = n.indexedVersion == n.Version && n.IndexError == ""
	if deleted.Valid {
		n.DeletedAt = &deleted.Time
		n.Deleted = true
	}
	return &n, nil
}

// GetNote loads a note (tombstones included).
func (s *Store) GetNote(ctx context.Context, id string) (*Note, error) {
	if !uuidRE.MatchString(id) {
		return nil, ErrNotFound
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	n, err := scanNote(db.QueryRowContext(ctx, `SELECT `+noteCols+` FROM notes WHERE id=$1`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return n, err
}

var uuidRE = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// CreateNote inserts a note (version 1), records its history and indexes it.
func (s *Store) CreateNote(ctx context.Context, ns, title, body string, tags []string, pinned bool, by NoteAuthor) (*Note, error) {
	if ns == "" {
		return nil, fmt.Errorf("%w: namespace is required", ErrInvalidInput)
	}
	if err := validateNote(title, body); err != nil {
		return nil, err
	}
	src := by.Source
	if !validNoteSource[src] {
		src = "api"
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	n, err := scanNote(tx.QueryRowContext(ctx, `
		INSERT INTO notes (namespace, owner_user_id, title, body, tags, pinned, source)
		VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING `+noteCols,
		ns, nullStr(by.UserID), strings.TrimSpace(title), body, stringArray(cleanTags(tags)), pinned, src))
	if err != nil {
		return nil, err
	}
	if err := insertNoteVersion(ctx, tx, n, by); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	s.indexNote(ctx, n, by)
	return n, nil
}

func insertNoteVersion(ctx context.Context, tx *sql.Tx, n *Note, by NoteAuthor) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO note_versions (note_id, version, title, body, tags, pinned, archived, deleted, source, author_user_id, author_agent)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (note_id, version) DO NOTHING`,
		n.ID, n.Version, n.Title, n.Body, stringArray(n.Tags), n.Pinned, n.Archived, n.Deleted, n.Source,
		nullStr(by.UserID), nullStr(by.Agent))
	return err
}

// UpdateNote applies a patch. expectVersion > 0 enables optimistic concurrency:
// a mismatch returns ErrConflict together with the current server copy.
func (s *Store) UpdateNote(ctx context.Context, id string, expectVersion int, p NotePatch, by NoteAuthor) (*Note, error) {
	return s.mutateNote(ctx, id, expectVersion, by, func(n *Note) error {
		if n.Deleted {
			return ErrNotFound
		}
		if p.Title != nil {
			n.Title = strings.TrimSpace(*p.Title)
		}
		if p.Body != nil {
			n.Body = *p.Body
		}
		if p.Tags != nil {
			n.Tags = cleanTags(*p.Tags)
		}
		if p.Pinned != nil {
			n.Pinned = *p.Pinned
		}
		if p.Archived != nil {
			n.Archived = *p.Archived
		}
		return validateNote(n.Title, n.Body)
	})
}

// AppendNote appends markdown to a note's body (a new paragraph).
func (s *Store) AppendNote(ctx context.Context, id, text string, by NoteAuthor) (*Note, error) {
	if strings.TrimSpace(text) == "" {
		return nil, fmt.Errorf("%w: text is required", ErrInvalidInput)
	}
	return s.mutateNote(ctx, id, 0, by, func(n *Note) error {
		if n.Deleted {
			return ErrNotFound
		}
		if strings.TrimSpace(n.Body) == "" {
			n.Body = text
		} else {
			n.Body = strings.TrimRight(n.Body, "\n") + "\n\n" + text
		}
		return validateNote(n.Title, n.Body)
	})
}

// DeleteNote tombstones a note and invalidates its memories.
func (s *Store) DeleteNote(ctx context.Context, id string, expectVersion int, by NoteAuthor) (*Note, error) {
	return s.mutateNote(ctx, id, expectVersion, by, func(n *Note) error {
		if n.Deleted {
			return ErrNotFound
		}
		now := time.Now().UTC()
		n.Deleted, n.DeletedAt = true, &now
		return nil
	})
}

// RestoreNote undeletes a tombstoned note and/or reverts it to an earlier
// version (version <= 0 = keep the current content). Either way it is a new
// version, so history is append-only.
func (s *Store) RestoreNote(ctx context.Context, id string, version int, by NoteAuthor) (*Note, error) {
	var old *NoteVersion
	if version > 0 {
		vs, err := s.NoteVersions(ctx, id)
		if err != nil {
			return nil, err
		}
		for i := range vs {
			if vs[i].Version == version {
				old = &vs[i]
			}
		}
		if old == nil {
			return nil, fmt.Errorf("%w: no version %d", ErrNotFound, version)
		}
	}
	return s.mutateNote(ctx, id, 0, by, func(n *Note) error {
		if old == nil && !n.Deleted {
			return fmt.Errorf("%w: the note is not deleted; pass a version to revert to", ErrInvalidInput)
		}
		n.Deleted, n.DeletedAt = false, nil
		if old != nil {
			n.Title, n.Body, n.Tags, n.Pinned, n.Archived = old.Title, old.Body, old.Tags, old.Pinned, old.Archived
		}
		return nil
	})
}

// mutateNote is the single write path after creation: lock, check the version,
// apply, bump the version, record history, then reconcile the memories.
func (s *Store) mutateNote(ctx context.Context, id string, expectVersion int, by NoteAuthor, apply func(*Note) error) (*Note, error) {
	if !uuidRE.MatchString(id) {
		return nil, ErrNotFound
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	cur, err := scanNote(tx.QueryRowContext(ctx, `SELECT `+noteCols+` FROM notes WHERE id=$1 FOR UPDATE`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if expectVersion > 0 && expectVersion != cur.Version {
		return cur, ErrConflict
	}
	wasDeleted := cur.Deleted
	prevHashes := cur.chunkHashes
	next := *cur
	if err := apply(&next); err != nil {
		return nil, err
	}
	next.Version = cur.Version + 1
	if validNoteSource[by.Source] {
		next.Source = by.Source
	}
	var deletedAt any
	if next.Deleted {
		deletedAt = *next.DeletedAt
	}
	hashes := prevHashes
	if next.Deleted {
		hashes = nil // its memories are invalidated below
	}
	updated, err := scanNote(tx.QueryRowContext(ctx, `
		UPDATE notes SET title=$2, body=$3, tags=$4, pinned=$5, archived=$6, source=$7, version=$8,
		       deleted_at=$9, chunk_hashes=$10, updated_at=clock_timestamp()
		WHERE id=$1 RETURNING `+noteCols,
		id, next.Title, next.Body, stringArray(next.Tags), next.Pinned, next.Archived, next.Source, next.Version,
		deletedAt, stringArray(nonNil(hashes))))
	if err != nil {
		return nil, err
	}
	if err := insertNoteVersion(ctx, tx, updated, by); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	switch {
	case updated.Deleted:
		s.invalidateNoteMemories(ctx, updated.Namespace, updated.ID, 0, "note deleted")
		s.setNoteIndex(ctx, updated, nil, "")
	case wasDeleted:
		updated.chunkHashes = nil // everything was invalidated on delete
		s.indexNote(ctx, updated, by)
	default:
		s.indexNote(ctx, updated, by)
	}
	return updated, nil
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// indexNote reconciles a note's memories with its current text. Best-effort per
// chunk; the outcome is written to chunk_hashes / indexed_version / index_error.
func (s *Store) indexNote(ctx context.Context, n *Note, by NoteAuthor) {
	ctx = context.WithoutCancel(ctx) // a client hanging up must not leave half an index
	chunks := noteChunks(n.Title, n.Body)
	hashes := make([]string, len(chunks))
	for i, c := range chunks {
		hashes[i] = chunkHash(c)
	}
	plan := planChunkSync(n.chunkHashes, hashes)

	stored := make([]string, len(chunks))
	copy(stored, hashes)
	var firstErr error
	agent := by.Agent
	if agent == "" && by.UserID != "" {
		agent = "user:" + by.UserID
	}
	for _, i := range plan.Retain {
		_, err := s.Retain(ctx, MemoryInput{
			Namespace:    n.Namespace,
			Content:      chunks[i],
			SourceKind:   "note",
			SourceRef:    noteRef(n.ID, i),
			OwnerAgentID: agent,
			MemoryType:   "semantic",
			Network:      "fact",
			Metadata: map[string]any{
				"type": "note", "noteId": n.ID, "chunk": i, "chunks": len(chunks),
				"title": n.Title, "tags": n.Tags, "noteVersion": n.Version,
			},
		})
		if err != nil {
			stored[i] = "" // retried on the next save
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	if len(plan.Invalidate) > 0 {
		s.invalidateNoteMemories(ctx, n.Namespace, n.ID, len(chunks), "note chunk removed")
	}
	msg := ""
	if firstErr != nil {
		msg = firstErr.Error()
	}
	s.setNoteIndex(ctx, n, stored, msg)
}

func (s *Store) setNoteIndex(ctx context.Context, n *Note, hashes []string, errMsg string) {
	db, err := s.db(ctx)
	if err != nil {
		return
	}
	_, _ = db.ExecContext(context.WithoutCancel(ctx), `
		UPDATE notes SET chunk_hashes=$2, indexed_version=$3, index_error=$4 WHERE id=$1 AND version=$3`,
		n.ID, stringArray(nonNil(hashes)), n.Version, nullStr(errMsg))
	n.chunkHashes = hashes
	n.Chunks = len(hashes)
	n.indexedVersion = n.Version
	n.IndexError = errMsg
	n.Indexed = errMsg == ""
}

// invalidateNoteMemories soft-invalidates the note's live memories whose chunk
// index is >= from (from=0: all of them) — memory_forget semantics, never a
// hard delete.
func (s *Store) invalidateNoteMemories(ctx context.Context, ns, id string, from int, reason string) int {
	db, err := s.db(ctx)
	if err != nil {
		return 0
	}
	res, err := db.ExecContext(context.WithoutCancel(ctx), `
		UPDATE memories
		   SET invalid_at = now(),
		       metadata = metadata || jsonb_build_object('forget_reason', $4::text)
		 WHERE namespace = $1 AND source_kind = 'note' AND invalid_at IS NULL
		   AND source_ref LIKE $2
		   AND split_part(source_ref, '#', 2) ~ '^[0-9]+$'
		   AND split_part(source_ref, '#', 2)::int >= $3`,
		ns, noteSourceRef+id+"#%", from, reason)
	if err != nil {
		return 0
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		s.bumpEpoch(ns)
		s.event(ctx, db, "forget", ns, "", reason, nil, 0)
	}
	return int(n)
}

// NoteVersions lists a note's history, newest first.
func (s *Store) NoteVersions(ctx context.Context, id string) ([]NoteVersion, error) {
	out := []NoteVersion{}
	if !uuidRE.MatchString(id) {
		return out, ErrNotFound
	}
	db, err := s.db(ctx)
	if err != nil {
		return out, err
	}
	rows, err := db.QueryContext(ctx, `
		SELECT version, title, body, tags, pinned, archived, deleted, source,
		       COALESCE(author_user_id,''), COALESCE(author_agent,''), created_at
		FROM note_versions WHERE note_id=$1 ORDER BY version DESC LIMIT 500`, id)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var v NoteVersion
		var tags stringArray
		if err := rows.Scan(&v.Version, &v.Title, &v.Body, &tags, &v.Pinned, &v.Archived, &v.Deleted, &v.Source,
			&v.AuthorUserID, &v.AuthorAgent, &v.CreatedAt); err != nil {
			return out, err
		}
		v.Tags = nonNil([]string(tags))
		out = append(out, v)
	}
	return out, rows.Err()
}

// NoteQuery is a list / search / sync request.
type NoteQuery struct {
	Namespaces []string // nil + All = every brain
	All        bool
	Q          string
	Tag        string
	Since      *time.Time // incremental sync: changes (incl. tombstones) after this instant
	Archived   bool       // browse mode: include archived notes
	Limit      int
	Cursor     string
}

// syncSafetyMargin is subtracted from the sync watermark (see ListNotes).
var syncSafetyMargin = 5 * time.Second

// NotePage is a page of notes.
type NotePage struct {
	Notes      []Note    `json:"notes"`
	NextCursor string    `json:"nextCursor,omitempty"`
	ServerTime time.Time `json:"serverTime"`
}

// encodeCursor / decodeCursor carry the (updated_at, id) keyset position.
func encodeCursor(t time.Time, id string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(t.UTC().Format(time.RFC3339Nano) + "|" + id))
}

func decodeCursor(c string) (time.Time, string, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return time.Time{}, "", false
	}
	ts, id, ok := strings.Cut(string(raw), "|")
	if !ok || !uuidRE.MatchString(id) {
		return time.Time{}, "", false
	}
	t, err := time.Parse(time.RFC3339Nano, ts)
	return t, id, err == nil
}

// ListNotes browses (newest first, no tombstones) or, with Since, syncs (oldest
// change first, tombstones included, bodies of tombstones omitted).
func (s *Store) ListNotes(ctx context.Context, q NoteQuery) (*NotePage, error) {
	page := &NotePage{Notes: []Note{}, ServerTime: time.Now().UTC()}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	// The sync watermark comes from the DATABASE clock (updated_at is stamped
	// there), minus a safety margin: a write whose transaction began before this
	// instant but commits after it carries an earlier updated_at, and the margin
	// makes the next sync pick it up. Sync is therefore at-least-once — clients
	// dedupe by (id, version).
	var dbNow time.Time
	if err := db.QueryRowContext(ctx, `SELECT clock_timestamp()`).Scan(&dbNow); err != nil {
		return nil, err
	}
	page.ServerTime = dbNow.Add(-syncSafetyMargin).UTC()
	if !q.All && len(q.Namespaces) == 0 {
		return page, nil
	}
	if q.Limit <= 0 || q.Limit > 200 {
		q.Limit = 50
	}
	var where []string
	var args []any
	arg := func(v any) string { args = append(args, v); return "$" + strconv.Itoa(len(args)) }
	if !q.All {
		where = append(where, "namespace = ANY("+arg(stringArray(q.Namespaces))+")")
	}
	if q.Q != "" {
		p := arg("%" + escapeLike(q.Q) + "%")
		where = append(where, "(title ILIKE "+p+" OR body ILIKE "+p+")")
	}
	if q.Tag != "" {
		where = append(where, "tags @> "+arg(stringArray{q.Tag}))
	}
	sync := q.Since != nil
	if sync {
		where = append(where, "updated_at > "+arg(*q.Since))
	} else {
		where = append(where, "deleted_at IS NULL")
		if !q.Archived {
			where = append(where, "NOT archived")
		}
	}
	if q.Cursor != "" {
		t, id, ok := decodeCursor(q.Cursor)
		if !ok {
			return nil, fmt.Errorf("%w: bad cursor", ErrInvalidInput)
		}
		op := "<"
		if sync {
			op = ">"
		}
		where = append(where, "(updated_at, id) "+op+" ("+arg(t)+"::timestamptz, "+arg(id)+"::uuid)")
	}
	order := "updated_at DESC, id DESC"
	if sync {
		order = "updated_at ASC, id ASC"
	} else {
		order = "pinned DESC, " + order
		if q.Cursor != "" {
			order = "updated_at DESC, id DESC" // keyset paging ignores the pin boost
		}
	}
	query := `SELECT ` + noteCols + ` FROM notes WHERE ` + strings.Join(where, " AND ") +
		` ORDER BY ` + order + ` LIMIT ` + arg(q.Limit+1)
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		n, err := scanNote(rows)
		if err != nil {
			return nil, err
		}
		if n.Deleted {
			n.Body = ""
		}
		page.Notes = append(page.Notes, *n)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(page.Notes) > q.Limit {
		page.Notes = page.Notes[:q.Limit]
		last := page.Notes[len(page.Notes)-1]
		page.NextCursor = encodeCursor(last.UpdatedAt, last.ID)
	} else if sync && len(page.Notes) > 0 {
		// The last page of a sync still hands back a cursor-equivalent watermark:
		// clients store serverTime as their next `since`.
		page.NextCursor = ""
	}
	return page, nil
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

// stringArray is a minimal Postgres text[] codec (no driver-specific helpers).
type stringArray []string

// Value renders the array literal: {"a","b"}.
func (a stringArray) Value() (any, error) {
	if a == nil {
		return "{}", nil
	}
	var b strings.Builder
	b.WriteByte('{')
	for i, s := range a {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteByte('"')
		b.WriteString(strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s))
		b.WriteByte('"')
	}
	b.WriteByte('}')
	return b.String(), nil
}

// Scan parses a text[] literal.
func (a *stringArray) Scan(src any) error {
	var s string
	switch v := src.(type) {
	case nil:
		*a = nil
		return nil
	case string:
		s = v
	case []byte:
		s = string(v)
	default:
		return fmt.Errorf("stringArray: unsupported %T", src)
	}
	out, err := parsePGArray(s)
	*a = out
	return err
}

func parsePGArray(s string) ([]string, error) {
	if len(s) < 2 || s[0] != '{' || s[len(s)-1] != '}' {
		return nil, fmt.Errorf("stringArray: not an array literal")
	}
	s = s[1 : len(s)-1]
	out := []string{}
	if s == "" {
		return out, nil
	}
	var cur strings.Builder
	inQuote, quoted := false, false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case inQuote && c == '\\' && i+1 < len(s):
			i++
			cur.WriteByte(s[i])
		case c == '"':
			inQuote = !inQuote
			quoted = true
		case c == ',' && !inQuote:
			v := cur.String()
			if !quoted && v == "NULL" {
				v = ""
			}
			out = append(out, v)
			cur.Reset()
			quoted = false
		default:
			cur.WriteByte(c)
		}
	}
	v := cur.String()
	if !quoted && v == "NULL" {
		v = ""
	}
	out = append(out, v)
	return out, nil
}
