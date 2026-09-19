package brain

/*
Every memory is a note.

Notes are the one surface for pushing to and reading from a brain: a memory is
always a chunk of some note (source_kind='note', source_ref='note:<id>#<n>').
Two mechanisms get it there.

1. Document adoption (existing memories). Brains filled before this — by data
   sources, the CLI, MCP memory_retain and the ingestion scripts — hold loose
   memories. Adoption turns them into notes WITHOUT re-ingesting: the existing
   memories are re-pointed at the note. Grouping (groupDocuments):

     - chunked documents: a source_ref with a chunk suffix — '#<n>' (what
       ingestDocuments, refresh-zekra-brain.py and code-index.py write), and the
       defensive variants '#chunk-<n>', ':chunk-<n>', '/part-<n>', '?part=<n>' —
       is grouped by the ref minus the suffix (the document key). One note per
       document, chunks in suffix order (then valid_at / ingested_at). A bare ref
       that equals a chunked document's key (e.g. 'x.md' next to 'x.md#1') joins
       that document.
     - everything else is standalone: one note per memory. A bare ref that is
       unique among the brain's loose memories keys the note by that ref (so a
       later retain with the same ref finds it); otherwise — no ref, or a ref
       shared by several memories (session ids, commit refs) — the key is
       'zekra:memory:<id>'.

   The note: title = metadata.title, else the key when it reads as a file path /
   URL, else (standalone) the memo's first line cut at a leading 'Label:' or its
   first sentence, else (document) its first heading/line; body = the chunk
   texts in order; category = the shared metadata.type (else 'memory' for a
   standalone note, 'document' for a document); tags = metadata.tags; source =
   the memory's source_kind (else 'import'); origin_ref = the key (unique per
   brain → idempotent). The memories are re-pointed (source_kind='note',
   source_ref='note:<id>#<n>', metadata.origin_ref / origin_source_kind keep
   where they came from), linked to the note's graph entity, and chunk_hashes
   gets an 'adopted:<sha>' per memory. That value never equals a real chunk hash,
   so the note's FIRST edit re-chunks it: each chunk re-retained at
   'note:<id>#<n>' supersedes the adopted memory holding that ref and adopted
   memories past the new chunk count are invalidated — no duplicates, nothing
   hard-deleted; later edits are diffed chunk by chunk.

   A document whose note already exists is merged into it (text already in the
   body → the memory is invalidated as a duplicate; the rest is appended). A
   document whose note was deleted is left alone.

2. Retain is note-first (Store.Retain, for every caller: REST, MCP, CLI,
   scripts, data sources). Unless the write is itself a note chunk:

     - a source_ref that belongs to an adopted document (origin_ref) is routed
       into that note: identical text → NOOP; a new version of an adopted chunk
       (origin_parts) → the note body is updated;
     - otherwise the write-decision runs, and when the memory it relates to is a
       note chunk: NOOP → nothing; UPDATE → that note's body is updated (a new
       version; a single-chunk note takes the new text); INVALIDATE → the chunk is
       removed from its note (the note is tombstoned if it was its only chunk)
       and the correction lands as a new note;
     - an ADD (or an UPDATE/INVALIDATE of a loose legacy memory) is retained and
       becomes a note right away (adoptRetained): a new standalone note, or
       appended to its document's note for a chunked ref.
   The retain response carries the noteId.

Triggers: POST /api/notes/adopt, MCP notes_adopt, `zekractl notes-adopt`, after
every data-source sync, and in the background the first time (per adoptRecheck)
a brain's notes are listed.
*/

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// ErrAdoptBusy: another adoption holds the namespace's advisory lock.
var ErrAdoptBusy = errors.New("brain: document adoption is already running for this brain")

// AdoptResult is what one adoption run did.
type AdoptResult struct {
	Namespace string `json:"namespace"`
	Adopted   int    `json:"adopted"`  // documents adopted into (new or existing) notes
	Notes     int    `json:"notes"`    // notes created
	Memories  int    `json:"memories"` // memories re-pointed at a note
	Merged    int    `json:"merged"`   // duplicate chunks invalidated (text already in the note)
	Skipped   int    `json:"skipped"`  // memories left alone (deleted note, busy note, size cap)
}

const (
	adoptKeyMemory = "zekra:memory:"
	adoptedHash    = "adopted:"
	adoptAgent     = "zekra:adopt"
	memoTitleMax   = 120
)

var (
	chunkSuffixRE = regexp.MustCompile(`(?i)(?:#(?:chunk|part)?[-_]?|[:/](?:chunk|part)[-_]?|[?&]part=)(\d{1,6})$`)
	// fileLikeRE: a key that reads as a file path or URL is its own best title.
	fileLikeRE = regexp.MustCompile(`(?i)^https?://|\.[a-z0-9]{1,8}$`)
	// noteSourceRE is what notes.source accepts (see schema.sql notes_source_chk).
	noteSourceRE = regexp.MustCompile(`^[A-Za-z0-9_:.\-]{1,64}$`)
)

// docKey strips a chunk suffix off a source_ref: the document key and the chunk
// number (-1 = none).
func docKey(ref string) (string, int) {
	ref = strings.TrimSpace(ref)
	if m := chunkSuffixRE.FindStringSubmatchIndex(ref); m != nil && m[0] > 0 {
		n, _ := strconv.Atoi(ref[m[2]:m[3]])
		return ref[:m[0]], n
	}
	return ref, -1
}

type adoptMem struct {
	ID, Ref, Kind, Content string
	Meta                   map[string]any
	Chunk                  int
	ValidAt, IngestedAt    time.Time
}

type adoptDoc struct {
	Key  string
	Mems []adoptMem
}

func metaStr(m map[string]any, k string) string {
	s, _ := m[k].(string)
	return strings.TrimSpace(s)
}

func isMemoryKey(key string) bool { return strings.HasPrefix(key, adoptKeyMemory) }

// groupDocuments applies the grouping rule (see the file comment). Pure.
func groupDocuments(mems []adoptMem) []adoptDoc {
	chunked := map[string]bool{} // document keys that have suffixed chunks
	bare := map[string]int{}     // bare refs → how many loose memories carry them
	for _, m := range mems {
		if strings.TrimSpace(m.Ref) == "" {
			continue
		}
		if k, n := docKey(m.Ref); n >= 0 {
			chunked[k] = true
		} else {
			bare[k]++
		}
	}
	by := map[string]*adoptDoc{}
	var keys []string
	for _, m := range mems {
		var key string
		m.Chunk = -1
		ref := strings.TrimSpace(m.Ref)
		switch k, n := docKey(ref); {
		case ref != "" && n >= 0:
			key, m.Chunk = k, n
		case ref != "" && (chunked[k] || bare[k] == 1):
			key = k
		default:
			key = adoptKeyMemory + m.ID
		}
		d, ok := by[key]
		if !ok {
			d = &adoptDoc{Key: key}
			by[key] = d
			keys = append(keys, key)
		}
		d.Mems = append(d.Mems, m)
	}
	sort.Strings(keys)
	out := make([]adoptDoc, 0, len(keys))
	for _, k := range keys {
		d := by[k]
		sort.SliceStable(d.Mems, func(i, j int) bool {
			a, b := d.Mems[i], d.Mems[j]
			if a.Chunk != b.Chunk {
				return a.Chunk < b.Chunk
			}
			if !a.ValidAt.Equal(b.ValidAt) {
				return a.ValidAt.Before(b.ValidAt)
			}
			if !a.IngestedAt.Equal(b.IngestedAt) {
				return a.IngestedAt.Before(b.IngestedAt)
			}
			return a.ID < b.ID
		})
		out = append(out, *d)
	}
	return out
}

// retainKey is the document key a single freshly retained memory belongs to —
// the same rule as groupDocuments for one memory.
func retainKey(ref, memID string) string {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return adoptKeyMemory + memID
	}
	k, _ := docKey(ref)
	return k
}

func capRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:n-1])) + "…"
}

func firstNonEmptyLine(content string) string {
	for _, l := range strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n") {
		if l = strings.TrimSpace(l); l != "" {
			return strings.TrimSpace(strings.TrimLeft(l, "#"))
		}
	}
	return ""
}

// memoTitle titles a standalone memory: its first line, cut at a leading
// "Label:" (2+ words, up to 80 chars) or at the end of its first sentence, at
// most memoTitleMax runes. "Health Debug analytics privacy line: Firebase …" →
// "Health Debug analytics privacy line".
func memoTitle(content string) string {
	line := firstNonEmptyLine(content)
	line = strings.TrimSpace(strings.Trim(line, "*_"))
	end := strings.Index(line, ". ")
	if i := strings.Index(line, ":"); i >= 3 && i <= 80 && (end < 0 || i < end) {
		label := strings.TrimSpace(line[:i])
		if strings.Contains(label, " ") && !strings.HasPrefix(line[i:], "://") {
			return capRunes(label, memoTitleMax)
		}
	}
	if end > 0 && utf8.RuneCountInString(line[:end]) < memoTitleMax {
		return line[:end]
	}
	return capRunes(line, memoTitleMax)
}

// docTitle titles a multi-chunk document with an opaque key: its first markdown
// heading, else its first line.
func docTitle(content string) string {
	for _, l := range strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n") {
		if headingRE.MatchString(l) {
			return capRunes(strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(l), "#")), memoTitleMax)
		}
	}
	return capRunes(firstNonEmptyLine(content), memoTitleMax)
}

func noteSourceFor(kind string) string {
	if kind = strings.TrimSpace(kind); kind != "" && kind != "note" && noteSourceRE.MatchString(kind) {
		return kind
	}
	return "import"
}

// adoptedNoteShape derives a document's note fields. Pure.
func adoptedNoteShape(d adoptDoc) (title, category, source string, tags []string) {
	standalone := isMemoryKey(d.Key) || (len(d.Mems) == 1 && d.Mems[0].Chunk < 0 && !fileLikeRE.MatchString(d.Key))
	for _, m := range d.Mems {
		if t := metaStr(m.Meta, "title"); t != "" {
			title = t
			break
		}
	}
	switch {
	case title != "":
	case !isMemoryKey(d.Key) && fileLikeRE.MatchString(d.Key):
		title = d.Key
	case len(d.Mems) > 0 && standalone:
		title = memoTitle(d.Mems[0].Content)
	case len(d.Mems) > 0:
		title = docTitle(d.Mems[0].Content)
	}
	if title == "" {
		title = strings.TrimPrefix(d.Key, adoptKeyMemory)
	}
	title = capRunes(title, noteMaxTitle)

	typ := ""
	for i, m := range d.Mems {
		t := metaStr(m.Meta, "type")
		if i == 0 {
			typ = t
		} else if t != typ {
			typ = ""
			break
		}
	}
	category = "document"
	if standalone {
		category = "memory"
	}
	if c, err := normalizeTypeName(typ); err == nil && c != "" {
		category = c
	}
	source = "import"
	if len(d.Mems) > 0 {
		source = noteSourceFor(d.Mems[0].Kind)
	}
	var raw []string
	for _, m := range d.Mems {
		switch arr := m.Meta["tags"].(type) {
		case []any:
			for _, t := range arr {
				if s, ok := t.(string); ok {
					raw = append(raw, s)
				}
			}
		case []string:
			raw = append(raw, arr...)
		}
	}
	return title, category, source, cleanTags(raw)
}

// --- the batch run -----------------------------------------------------------------

func adoptLockKey(ns string) string { return "zekra:notes-adopt:" + ns }

const unadoptedWhere = `namespace = $1 AND invalid_at IS NULL
	AND COALESCE(source_kind,'') <> 'note' AND COALESCE(source_ref,'') NOT LIKE 'note:%'`

// AdoptDocuments adopts every loose memory of a namespace into notes (see the
// file comment). wait=false returns ErrAdoptBusy instead of waiting for a
// running adoption. Idempotent and restartable: each document is its own
// transaction. Needs no embedder. Callers with a Store should use
// Store.AdoptDocuments, which also invalidates the L1 recall cache.
func AdoptDocuments(ctx context.Context, db *sql.DB, ns string, wait bool) (*AdoptResult, error) {
	res := &AdoptResult{Namespace: ns}
	if strings.TrimSpace(ns) == "" {
		return res, fmt.Errorf("%w: namespace is required", ErrInvalidInput)
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return res, err
	}
	defer conn.Close()
	if wait {
		if _, err := conn.ExecContext(ctx, `SELECT pg_advisory_lock(hashtext($1))`, adoptLockKey(ns)); err != nil {
			return res, err
		}
	} else {
		var got bool
		if err := conn.QueryRowContext(ctx, `SELECT pg_try_advisory_lock(hashtext($1))`, adoptLockKey(ns)).Scan(&got); err != nil {
			return res, err
		}
		if !got {
			return res, ErrAdoptBusy
		}
	}
	defer conn.ExecContext(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock(hashtext($1))`, adoptLockKey(ns))

	mems, err := loadUnadopted(ctx, db, ns)
	if err != nil {
		return res, err
	}
	for _, d := range groupDocuments(mems) {
		if err := ctx.Err(); err != nil {
			return res, err
		}
		if _, err := adoptOne(ctx, db, ns, d, res); err != nil {
			return res, fmt.Errorf("adopt %q: %w", d.Key, err)
		}
	}
	return res, nil
}

func loadUnadopted(ctx context.Context, db *sql.DB, ns string) ([]adoptMem, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT id::text, COALESCE(source_ref,''), COALESCE(source_kind,''), content, metadata, valid_at, ingested_at
		FROM memories WHERE `+unadoptedWhere, ns)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []adoptMem
	for rows.Next() {
		var m adoptMem
		var meta []byte
		if err := rows.Scan(&m.ID, &m.Ref, &m.Kind, &m.Content, &meta, &m.ValidAt, &m.IngestedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(meta, &m.Meta)
		out = append(out, m)
	}
	return out, rows.Err()
}

// HasUnadoptedDocuments reports whether a namespace has live memories that are
// not note chunks.
func HasUnadoptedDocuments(ctx context.Context, db *sql.DB, ns string) (bool, error) {
	var ok bool
	err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM memories WHERE `+unadoptedWhere+`)`, ns).Scan(&ok)
	return ok, err
}

// UnadoptedNamespaces lists the namespaces with loose (non-note) memories.
func UnadoptedNamespaces(ctx context.Context, db *sql.DB) ([]string, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT DISTINCT namespace FROM memories
		WHERE invalid_at IS NULL AND COALESCE(source_kind,'') <> 'note' AND COALESCE(source_ref,'') NOT LIKE 'note:%'
		ORDER BY 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var ns string
		if err := rows.Scan(&ns); err != nil {
			return nil, err
		}
		out = append(out, ns)
	}
	return out, rows.Err()
}

// adoptOne adopts one document in one transaction and returns its note id (""
// when nothing was adopted: rows gone, the note deleted or mid-index).
func adoptOne(ctx context.Context, db *sql.DB, ns string, d adoptDoc, res *AdoptResult) (string, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	// Lock the rows and keep only those still loose (a concurrent writer may have
	// invalidated or adopted some since they were read).
	ids := make([]string, len(d.Mems))
	for i, m := range d.Mems {
		ids[i] = m.ID
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT id::text FROM memories WHERE `+unadoptedWhere+` AND id = ANY($2::text[]::uuid[]) FOR UPDATE`,
		ns, stringArray(ids))
	if err != nil {
		return "", err
	}
	live := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return "", err
		}
		live[id] = true
	}
	rows.Close()
	var mems []adoptMem
	for _, m := range d.Mems {
		if live[m.ID] && strings.TrimSpace(m.Content) != "" {
			mems = append(mems, m)
		}
	}
	if len(mems) == 0 {
		return "", tx.Commit()
	}

	n, err := scanNote(tx.QueryRowContext(ctx, `SELECT `+noteCols+` FROM notes WHERE namespace=$1 AND origin_ref=$2 FOR UPDATE`, ns, d.Key))
	switch {
	case errors.Is(err, sql.ErrNoRows):
		n, err = createAdoptedNote(ctx, tx, ns, d.Key, &mems, res)
		if err != nil || n == nil {
			return "", err
		}
	case err != nil:
		return "", err
	default:
		if n.Deleted || n.indexedVersion != n.Version {
			// Deleted: the user removed it. Mid-index: the next run merges.
			res.Skipped += len(mems)
			return "", tx.Commit()
		}
		if err := mergeIntoNote(ctx, tx, n, &mems, res); err != nil {
			return "", err
		}
		if len(mems) == 0 {
			return n.ID, tx.Commit()
		}
	}
	start := len(n.chunkHashes) - len(mems)
	if err := repointMemories(ctx, tx, ns, n.ID, mems, start); err != nil {
		return "", err
	}
	if err := setOriginParts(ctx, tx, n.ID, mems); err != nil {
		return "", err
	}
	if err := linkNoteMemoriesQ(ctx, tx, ns, n.ID, n.EntityID); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	res.Adopted++
	res.Memories += len(mems)
	return n.ID, nil
}

// capBody keeps the leading memories whose joined text fits the note size cap;
// the rest are counted as skipped (and stay loose for a later run).
func capBody(prefix string, mems []adoptMem, res *AdoptResult) (string, []adoptMem) {
	const sep = "\n\n"
	var b strings.Builder
	b.WriteString(prefix)
	kept := mems[:0:0]
	for _, m := range mems {
		part := strings.TrimSpace(m.Content)
		add := len(part)
		if b.Len() > 0 {
			add += len(sep)
		}
		if b.Len()+add > noteMaxBody {
			res.Skipped++
			continue
		}
		if b.Len() > 0 {
			b.WriteString(sep)
		}
		b.WriteString(part)
		kept = append(kept, m)
	}
	return b.String(), kept
}

func adoptedHashes(mems []adoptMem) []string {
	out := make([]string, len(mems))
	for i, m := range mems {
		out[i] = adoptedHash + chunkHash(m.Content)
	}
	return out
}

func createAdoptedNote(ctx context.Context, tx *sql.Tx, ns, key string, mems *[]adoptMem, res *AdoptResult) (*Note, error) {
	title, category, source, tags := adoptedNoteShape(adoptDoc{Key: key, Mems: *mems})
	body, kept := capBody("", *mems, res)
	*mems = kept
	if len(kept) == 0 {
		return nil, nil
	}
	n, err := scanNote(tx.QueryRowContext(ctx, `
		INSERT INTO notes (namespace, title, body, tags, source, category, origin_ref, chunk_hashes, indexed_version)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1)
		ON CONFLICT (namespace, origin_ref) WHERE origin_ref IS NOT NULL DO NOTHING
		RETURNING `+noteCols,
		ns, title, body, stringArray(tags), source, category, key, stringArray(adoptedHashes(kept))))
	if errors.Is(err, sql.ErrNoRows) {
		// A concurrent writer created it between our read and insert; the next
		// run merges.
		res.Skipped += len(kept)
		*mems = nil
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := syncNoteGraph(ctx, tx, n); err != nil {
		return nil, err
	}
	if err := insertNoteVersion(ctx, tx, n, NoteAuthor{Agent: adoptAgent, Source: source}); err != nil {
		return nil, err
	}
	res.Notes++
	return n, nil
}

// mergeIntoNote appends a document's new chunks to its existing note; chunks
// whose text the note already holds are invalidated as duplicates. On return
// *mems holds the memories to re-point (at the tail of n.chunkHashes).
func mergeIntoNote(ctx context.Context, tx *sql.Tx, n *Note, mems *[]adoptMem, res *AdoptResult) error {
	var fresh, dup []adoptMem
	for _, m := range *mems {
		if strings.Contains(n.Body, strings.TrimSpace(m.Content)) {
			dup = append(dup, m)
		} else {
			fresh = append(fresh, m)
		}
	}
	if len(dup) > 0 {
		ids := make([]string, len(dup))
		for i, m := range dup {
			ids[i] = m.ID
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE memories SET invalid_at = now(),
			       metadata = metadata || jsonb_build_object('forget_reason', 'already in note '||$2::text)
			WHERE namespace=$1 AND id = ANY($3::text[]::uuid[]) AND invalid_at IS NULL`,
			n.Namespace, n.ID, stringArray(ids)); err != nil {
			return err
		}
		res.Merged += len(dup)
	}
	*mems = nil
	if len(fresh) == 0 {
		return nil
	}
	body, kept := capBody(strings.TrimRight(n.Body, "\n"), fresh, res)
	if len(kept) == 0 {
		return nil
	}
	hashes := append(append([]string{}, n.chunkHashes...), adoptedHashes(kept)...)
	updated, err := scanNote(tx.QueryRowContext(ctx, `
		UPDATE notes SET body=$2, version=version+1, indexed_version=version+1, chunk_hashes=$3,
		       updated_at=clock_timestamp()
		WHERE id=$1 RETURNING `+noteCols, n.ID, body, stringArray(hashes)))
	if err != nil {
		return err
	}
	if err := syncNoteGraph(ctx, tx, updated); err != nil {
		return err
	}
	if err := insertNoteVersion(ctx, tx, updated, NoteAuthor{Agent: adoptAgent, Source: updated.Source}); err != nil {
		return err
	}
	*n = *updated
	*mems = kept
	return nil
}

// repointMemories makes the adopted memories the note's chunks start..start+n-1.
func repointMemories(ctx context.Context, tx *sql.Tx, ns, noteID string, mems []adoptMem, start int) error {
	ids := make([]string, len(mems))
	for i, m := range mems {
		ids[i] = m.ID
	}
	_, err := tx.ExecContext(ctx, `
		UPDATE memories m
		   SET source_kind = 'note',
		       source_ref  = 'note:' || $3::text || '#' || (u.ord - 1 + $4::int)::text,
		       metadata    = m.metadata || jsonb_strip_nulls(jsonb_build_object(
		           'origin_ref', NULLIF(m.source_ref, ''), 'origin_source_kind', NULLIF(m.source_kind, ''),
		           'noteId', $3::text, 'chunk', u.ord - 1 + $4::int, 'adopted', true))
		  FROM unnest($2::text[]::uuid[]) WITH ORDINALITY AS u(id, ord)
		 WHERE m.namespace = $1 AND m.id = u.id AND m.invalid_at IS NULL`,
		ns, stringArray(ids), noteID, start)
	return err
}

// setOriginParts remembers, per original chunk ref, the text the note holds for
// it — so a later retain of a new version of that chunk replaces it in the body.
func setOriginParts(ctx context.Context, q querier, noteID string, mems []adoptMem) error {
	parts := map[string]string{}
	for _, m := range mems {
		if r := strings.TrimSpace(m.Ref); r != "" {
			parts[r] = strings.TrimSpace(m.Content)
		}
	}
	if len(parts) == 0 {
		return nil
	}
	raw, _ := json.Marshal(parts)
	_, err := q.ExecContext(ctx, `UPDATE notes SET origin_parts = origin_parts || $2::jsonb WHERE id=$1`, noteID, string(raw))
	return err
}

// --- Store-level entry points -----------------------------------------------------

// AdoptDocuments runs adoption for a namespace and invalidates its recall cache.
func (s *Store) AdoptDocuments(ctx context.Context, ns string, wait bool) (*AdoptResult, error) {
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	res, err := AdoptDocuments(ctx, db, ns, wait)
	if res != nil && (res.Memories > 0 || res.Merged > 0) {
		s.bumpEpoch(ns)
		s.event(context.WithoutCancel(ctx), db, "adopt", ns, adoptAgent, "ok", nil, 0)
	}
	return res, err
}

// adoptedNoteFor finds the note a non-note source_ref's document was adopted as.
func adoptedNoteFor(ctx context.Context, q querier, ns, ref string) (id, body string, parts map[string]string, deleted, ok bool) {
	ref = strings.TrimSpace(ref)
	if ref == "" || strings.HasPrefix(ref, noteSourceRef) {
		return
	}
	key, _ := docKey(ref)
	var raw []byte
	var del sql.NullTime
	err := q.QueryRowContext(ctx, `SELECT id::text, body, origin_parts, deleted_at FROM notes WHERE namespace=$1 AND origin_ref=$2`,
		ns, key).Scan(&id, &body, &raw, &del)
	if err != nil {
		return "", "", nil, false, false
	}
	_ = json.Unmarshal(raw, &parts)
	return id, body, parts, del.Valid, true
}

func (s *Store) latestNoteMemory(ctx context.Context, db *sql.DB, ns, noteID, originRef string) string {
	var id string
	_ = db.QueryRowContext(ctx, `
		SELECT id::text FROM memories
		WHERE namespace=$1 AND source_kind='note' AND source_ref LIKE $2 AND invalid_at IS NULL
		ORDER BY (metadata->>'origin_ref' = $3) DESC NULLS LAST, ingested_at DESC LIMIT 1`,
		ns, noteSourceRef+noteID+"#%", originRef).Scan(&id)
	return id
}

// noteManaged: the write is not itself a note chunk, so it goes through notes.
func noteManaged(in MemoryInput) bool {
	return in.SourceKind != "note" && !strings.HasPrefix(strings.TrimSpace(in.SourceRef), noteSourceRef)
}

func retainAuthor(in MemoryInput) NoteAuthor {
	return NoteAuthor{Agent: in.OwnerAgentID, Source: "agent"}
}

// retainIntoAdoptedNote routes a retain whose source_ref belongs to an adopted
// document into that note. done=false: continue with the write-decision.
func (s *Store) retainIntoAdoptedNote(ctx context.Context, db *sql.DB, in MemoryInput) (res *RetainResult, done bool, err error) {
	noteID, body, parts, deleted, ok := adoptedNoteFor(ctx, db, in.Namespace, in.SourceRef)
	if !ok || deleted {
		return nil, false, nil
	}
	content := strings.TrimSpace(in.Content)
	ref := strings.TrimSpace(in.SourceRef)
	if content == "" {
		return nil, false, nil
	}
	if strings.Contains(body, content) {
		id := s.latestNoteMemory(ctx, db, in.Namespace, noteID, ref)
		s.event(ctx, db, "retain", in.Namespace, in.OwnerAgentID, "noop", nullStr(id), 0)
		return &RetainResult{ID: id, Decision: "noop", Importance: 0.5, NoteID: noteID}, true, nil
	}
	old := parts[ref]
	if old == "" || !strings.Contains(body, old) {
		return nil, false, nil
	}
	n, err := s.mutateNote(ctx, noteID, 0, retainAuthor(in), func(n *Note) error {
		if n.Deleted || !strings.Contains(n.Body, old) {
			return ErrConflict
		}
		n.Body = strings.Replace(n.Body, old, content, 1)
		return validateNote(n.Title, n.Body)
	})
	if errors.Is(err, ErrConflict) {
		return nil, false, nil // the note moved on: let the write-decision handle it
	}
	if err != nil {
		return nil, true, err
	}
	_ = setOriginParts(context.WithoutCancel(ctx), db, n.ID, []adoptMem{{Ref: ref, Content: content}})
	id := s.latestNoteMemory(ctx, db, in.Namespace, noteID, ref)
	return &RetainResult{ID: id, Decision: "update", Importance: 0.5, NoteID: n.ID}, true, nil
}

// memNote is the note a memory is a chunk of.
type memNote struct {
	NoteID  string
	Content string // the memory's text
}

// noteOfMemory returns the live note a memory is a chunk of (nil: none).
func (s *Store) noteOfMemory(ctx context.Context, db *sql.DB, memID string) *memNote {
	var ref, content string
	if err := db.QueryRowContext(ctx, `SELECT COALESCE(source_ref,''), content FROM memories WHERE id=$1 AND source_kind='note'`,
		memID).Scan(&ref, &content); err != nil || !strings.HasPrefix(ref, noteSourceRef) {
		return nil
	}
	id, _, _ := strings.Cut(strings.TrimPrefix(ref, noteSourceRef), "#")
	var live bool
	if err := db.QueryRowContext(ctx, `SELECT deleted_at IS NULL FROM notes WHERE id::text=$1`, id).Scan(&live); err != nil || !live {
		return nil
	}
	return &memNote{NoteID: id, Content: content}
}

// noteChunkBodyText strips the "title\n\n" a note chunk leads with.
func noteChunkBodyText(n *Note, content string) string {
	c := strings.TrimSpace(content)
	if t := strings.TrimSpace(n.Title); t != "" {
		c = strings.TrimPrefix(c, t+"\n\n")
	}
	return strings.TrimSpace(c)
}

// updateNoteFromRetain applies a write-decision UPDATE to the note the evolved
// memory belongs to: a single-chunk note takes the new text; a document has the
// chunk's text replaced (or the new text appended when it cannot be located).
func (s *Store) updateNoteFromRetain(ctx context.Context, rel *memNote, in MemoryInput) (*Note, error) {
	content := strings.TrimSpace(in.Content)
	return s.mutateNote(ctx, rel.NoteID, 0, retainAuthor(in), func(n *Note) error {
		if n.Deleted {
			return ErrNotFound
		}
		old := noteChunkBodyText(n, rel.Content)
		switch {
		case len(n.chunkHashes) <= 1:
			if n.Title == memoTitle(n.Body) {
				n.Title = memoTitle(content) // an auto-derived title follows the text
			}
			n.Body = content
		case old != "" && strings.Contains(n.Body, old):
			n.Body = strings.Replace(n.Body, old, content, 1)
		default:
			n.Body = strings.TrimRight(n.Body, "\n") + "\n\n" + content
		}
		return validateNote(n.Title, n.Body)
	})
}

var blankRunRE = regexp.MustCompile(`\n{3,}`)

// retractFromNote applies a write-decision INVALIDATE to the retired memory's
// note: its chunk's text is removed; a note left without text is tombstoned.
func (s *Store) retractFromNote(ctx context.Context, rel *memNote, in MemoryInput) {
	n, err := s.GetNote(ctx, rel.NoteID)
	if err != nil || n.Deleted {
		return
	}
	by := retainAuthor(in)
	old := noteChunkBodyText(n, rel.Content)
	found := old != "" && strings.Contains(n.Body, old)
	rest := ""
	if found {
		rest = strings.TrimSpace(blankRunRE.ReplaceAllString(strings.Replace(n.Body, old, "", 1), "\n\n"))
	}
	switch {
	case len(n.chunkHashes) <= 1 || (found && rest == ""):
		_, _ = s.DeleteNote(ctx, n.ID, 0, by)
	case found:
		_, _ = s.mutateNote(ctx, n.ID, 0, by, func(n *Note) error {
			if n.Deleted {
				return ErrNotFound
			}
			n.Body = rest
			return validateNote(n.Title, n.Body)
		})
	}
}

// adoptRetained makes a just-retained memory a note: its document's note for a
// chunked ref, else a new standalone note. Returns the note id.
func (s *Store) adoptRetained(ctx context.Context, db *sql.DB, in MemoryInput, memID string) string {
	ctx = context.WithoutCancel(ctx)
	m := adoptMem{ID: memID, Ref: in.SourceRef, Kind: in.SourceKind, Content: in.Content, Meta: in.Metadata, Chunk: -1}
	key := retainKey(in.SourceRef, memID)
	if _, n := docKey(in.SourceRef); n >= 0 {
		m.Chunk = n
	}
	res := &AdoptResult{}
	id, err := adoptOne(ctx, db, in.Namespace, adoptDoc{Key: key, Mems: []adoptMem{m}}, res)
	if err == nil && id == "" && res.Skipped > 0 && !isMemoryKey(key) {
		// The document's note is deleted or busy: the memory still gets a note.
		id, _ = adoptOne(ctx, db, in.Namespace, adoptDoc{Key: adoptKeyMemory + memID, Mems: []adoptMem{m}}, &AdoptResult{})
	}
	return id
}

// refreshAdoptedDocument: a data source re-delivered a document that is already a
// note. The note is updated with the new text. handled=false: not adopted.
func (s *Store) refreshAdoptedDocument(ctx context.Context, ns string, d Document) (handled bool, err error) {
	db, err := s.db(ctx)
	if err != nil {
		return false, err
	}
	noteID, body, _, deleted, ok := adoptedNoteFor(ctx, db, ns, d.SourceRef)
	if !ok {
		return false, nil
	}
	if deleted {
		return true, nil // the user deleted this document's note; do not resurrect it
	}
	norm := func(s string) string { return strings.TrimSpace(strings.ReplaceAll(s, "\r\n", "\n")) }
	if norm(body) == norm(d.Content) || strings.TrimSpace(d.Content) == "" {
		return true, nil
	}
	text := d.Content
	_, err = s.UpdateNote(ctx, noteID, 0, NotePatch{Body: &text}, NoteAuthor{Agent: "datasource", Source: "api"})
	return true, err
}

// --- the lazy trigger ------------------------------------------------------------

var (
	adoptChecked sync.Map // namespace → time.Time of the last check
	adoptRecheck = 10 * time.Minute
)

func autoAdoptEnabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("ZEKRA_NOTES_AUTO_ADOPT")))
	return v != "0" && v != "false" && v != "off"
}

// maybeAdoptAsync starts a background adoption for a namespace with loose
// memories. Non-blocking; at most one check per namespace per adoptRecheck;
// concurrent runs are excluded by the advisory lock.
func (s *Service) maybeAdoptAsync(ns string) {
	if ns == "" || !autoAdoptEnabled() {
		return
	}
	now := time.Now()
	if v, ok := adoptChecked.Load(ns); ok && now.Sub(v.(time.Time)) < adoptRecheck {
		return
	}
	adoptChecked.Store(ns, now)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()
		db, err := s.Store.db(ctx)
		if err != nil {
			return
		}
		if has, err := HasUnadoptedDocuments(ctx, db, ns); err != nil || !has {
			return
		}
		res, err := s.Store.AdoptDocuments(ctx, ns, false)
		if err != nil && !errors.Is(err, ErrAdoptBusy) && s.k != nil && s.k.Log != nil {
			s.k.Log.Warn("notes adopt", "namespace", ns, "err", err)
		}
		if res != nil && res.Adopted > 0 {
			s.hub.publish("note", map[string]any{"namespace": ns, "action": "adopt", "notes": res.Notes})
		}
	}()
}
