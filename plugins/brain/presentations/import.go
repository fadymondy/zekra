package presentations

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

/*
Importing fadymondy.com's presentations (zekractl presentations-import).

The source is READ ONLY: either a JSON export of its two tables, or a DSN that
is only ever read inside a READ ONLY transaction (SELECT only). Nothing is
written to the source, and its own links keep being served by fadymondy.com.

Rows are copied as they are: ids, content, translations, status, counters,
timestamps, created_by, and for shares token_hash / token_sealed / token_hint,
label, locale, expiry, revocation and counters. The destination adds the brain
(namespace) and the owning account (owner_user_id).

Why links keep working on the new host: the public view matches
sha256(token) = token_hash, the same scheme on both sides, so an existing token
opens at {PRESENTATIONS_SHARE_BASE}/{locale}/p/{token} as soon as its row is
here. The owner can COPY an imported link again only if token_sealed opens,
i.e. fadymondy.com's VAULT_KEY is configured here (seal.go tries every key).

Idempotent: a row whose id is already here is skipped (never overwritten), and
so is a share whose token_hash is already taken.

JSON export format (what psql produces with json_agg over each table):

	{"presentations": [{"id": …, "kind": …, …}], "presentation_shares": [{…}]}

for example, read-only:

	psql "$FADYMONDY_DSN" -Atc "SELECT json_build_object(
	  'presentations', (SELECT COALESCE(json_agg(p), '[]') FROM presentations p),
	  'presentation_shares', (SELECT COALESCE(json_agg(s), '[]') FROM presentation_shares s))" > fm-presentations.json
*/

// SourcePresentation is one fadymondy.com presentations row. Timestamps are
// kept as Postgres text ('epoch' / 'infinity' included) and cast on insert.
type SourcePresentation struct {
	ID              string          `json:"id"`
	Kind            string          `json:"kind"`
	Title           string          `json:"title"`
	CustomerName    string          `json:"customer_name"`
	CustomerCompany string          `json:"customer_company"`
	CustomerEmail   string          `json:"customer_email"`
	Locale          string          `json:"locale"`
	Status          string          `json:"status"`
	Style           string          `json:"style"`
	Content         json.RawMessage `json:"content"`
	Translations    json.RawMessage `json:"translations"`
	ViewCount       int64           `json:"view_count"`
	DownloadCount   int64           `json:"download_count"`
	LastViewedAt    string          `json:"last_viewed_at"`
	CreatedBy       string          `json:"created_by"`
	CreatedAt       string          `json:"created_at"`
	UpdatedAt       string          `json:"updated_at"`
}

// SourceShare is one fadymondy.com presentation_shares row.
type SourceShare struct {
	ID             string `json:"id"`
	PresentationID string `json:"presentation_id"`
	TokenHash      string `json:"token_hash"`
	TokenSealed    string `json:"token_sealed"`
	TokenHint      string `json:"token_hint"`
	Label          string `json:"label"`
	Locale         string `json:"locale"`
	ExpiresAt      string `json:"expires_at"`
	RevokedAt      string `json:"revoked_at"`
	ViewCount      int64  `json:"view_count"`
	DownloadCount  int64  `json:"download_count"`
	LastViewedAt   string `json:"last_viewed_at"`
	CreatedBy      string `json:"created_by"`
	CreatedAt      string `json:"created_at"`
}

// SourceExport is both tables.
type SourceExport struct {
	Presentations []SourcePresentation `json:"presentations"`
	Shares        []SourceShare        `json:"presentation_shares"`
}

// ParseExport reads the JSON export format.
func ParseExport(raw []byte) (*SourceExport, error) {
	var e SourceExport
	if err := json.Unmarshal(raw, &e); err != nil {
		return nil, fmt.Errorf("not a presentations export: %w", err)
	}
	if e.Presentations == nil {
		return nil, errors.New(`not a presentations export: no "presentations" array`)
	}
	return &e, nil
}

// ReadSource reads both tables from a fadymondy.com database inside a READ
// ONLY transaction (SELECT only; it is rolled back, nothing is written).
func ReadSource(ctx context.Context, src *sql.DB) (*SourceExport, error) {
	tx, err := src.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	e := &SourceExport{Presentations: []SourcePresentation{}, Shares: []SourceShare{}}
	rows, err := tx.QueryContext(ctx, `SELECT id, kind, title, customer_name, customer_company, customer_email,
		locale, status, style, content::text, translations::text, view_count, download_count,
		last_viewed_at::text, created_by, created_at::text, updated_at::text
		FROM presentations ORDER BY created_at, id`)
	if err != nil {
		return nil, fmt.Errorf("read presentations: %w", err)
	}
	for rows.Next() {
		var p SourcePresentation
		var content, tr string
		if err := rows.Scan(&p.ID, &p.Kind, &p.Title, &p.CustomerName, &p.CustomerCompany, &p.CustomerEmail,
			&p.Locale, &p.Status, &p.Style, &content, &tr, &p.ViewCount, &p.DownloadCount,
			&p.LastViewedAt, &p.CreatedBy, &p.CreatedAt, &p.UpdatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		p.Content, p.Translations = json.RawMessage(content), json.RawMessage(tr)
		e.Presentations = append(e.Presentations, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows, err = tx.QueryContext(ctx, `SELECT id, presentation_id, token_hash, token_sealed, token_hint, label, locale,
		expires_at::text, revoked_at::text, view_count, download_count, last_viewed_at::text, created_by, created_at::text
		FROM presentation_shares ORDER BY created_at, id`)
	if err != nil {
		return nil, fmt.Errorf("read presentation_shares: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var s SourceShare
		if err := rows.Scan(&s.ID, &s.PresentationID, &s.TokenHash, &s.TokenSealed, &s.TokenHint, &s.Label, &s.Locale,
			&s.ExpiresAt, &s.RevokedAt, &s.ViewCount, &s.DownloadCount, &s.LastViewedAt, &s.CreatedBy, &s.CreatedAt); err != nil {
			return nil, err
		}
		e.Shares = append(e.Shares, s)
	}
	return e, rows.Err()
}

// ImportResult counts what an import did.
type ImportResult struct {
	Presentations        int `json:"presentations"`
	PresentationsSkipped int `json:"presentations_skipped"`
	Shares               int `json:"shares"`
	SharesSkipped        int `json:"shares_skipped"`
	// Recoverable counts imported active shares whose sealed token opens with
	// a key configured here (their links can be copied again by the owner).
	Recoverable int      `json:"recoverable"`
	Notes       []string `json:"notes,omitempty"`
}

func orText(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

func orJSON(v json.RawMessage) string {
	if len(v) == 0 || string(v) == "null" {
		return "{}"
	}
	return string(v)
}

// Import copies an export into one brain, owned by ownerUserID ("" = none),
// in a single transaction. dryRun rolls it back after counting.
func (s *Store) Import(ctx context.Context, e *SourceExport, ns, ownerUserID string, dryRun bool) (*ImportResult, error) {
	d, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	ns = strings.TrimSpace(ns)
	if ns == "" {
		return nil, InvalidError{"namespace is required"}
	}
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	res := &ImportResult{}
	imported := map[string]bool{}
	for _, p := range e.Presentations {
		if !contains(Kinds, p.Kind) || strings.TrimSpace(p.ID) == "" {
			res.PresentationsSkipped++
			res.Notes = append(res.Notes, fmt.Sprintf("presentation %q: not a deck/report/page, skipped", p.ID))
			continue
		}
		var existing string
		switch err := tx.QueryRowContext(ctx, `SELECT namespace FROM presentations WHERE id = $1`, p.ID).Scan(&existing); {
		case err == nil:
			res.PresentationsSkipped++
			if existing != ns {
				res.Notes = append(res.Notes, fmt.Sprintf("presentation %s already exists in brain %q, skipped", p.ID, existing))
			}
			continue
		case !errors.Is(err, sql.ErrNoRows):
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO presentations
			(id, namespace, owner_user_id, kind, title, customer_name, customer_company, customer_email, locale, status, style,
			 content, translations, view_count, download_count, last_viewed_at, created_by, created_at, updated_at)
			VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16::timestamptz,$17,$18::timestamptz,$19::timestamptz)`,
			p.ID, ns, ownerUserID, p.Kind, p.Title, p.CustomerName, p.CustomerCompany, p.CustomerEmail,
			orText(p.Locale, "en"), orText(p.Status, "draft"), p.Style, orJSON(p.Content), orJSON(p.Translations),
			p.ViewCount, p.DownloadCount, orText(p.LastViewedAt, "epoch"), p.CreatedBy,
			orText(p.CreatedAt, "now"), orText(p.UpdatedAt, "now")); err != nil {
			return nil, fmt.Errorf("presentation %s: %w", p.ID, err)
		}
		imported[p.ID] = true
		res.Presentations++
	}
	sealer := s.sealer()
	for _, sh := range e.Shares {
		if !imported[sh.PresentationID] {
			res.SharesSkipped++
			continue
		}
		if len(sh.TokenHash) != 64 {
			res.SharesSkipped++
			res.Notes = append(res.Notes, fmt.Sprintf("share %s: token_hash is not a sha256 hex, skipped", sh.ID))
			continue
		}
		r, err := tx.ExecContext(ctx, `INSERT INTO presentation_shares
			(id, presentation_id, token_hash, token_sealed, token_hint, label, locale, expires_at, revoked_at,
			 view_count, download_count, last_viewed_at, created_by, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10,$11,$12::timestamptz,$13,$14::timestamptz)
			ON CONFLICT DO NOTHING`,
			sh.ID, sh.PresentationID, sh.TokenHash, sh.TokenSealed, sh.TokenHint, sh.Label, orText(sh.Locale, "en"),
			orText(sh.ExpiresAt, "infinity"), orText(sh.RevokedAt, "epoch"), sh.ViewCount, sh.DownloadCount,
			orText(sh.LastViewedAt, "epoch"), sh.CreatedBy, orText(sh.CreatedAt, "now"))
		if err != nil {
			return nil, fmt.Errorf("share %s: %w", sh.ID, err)
		}
		if n, _ := r.RowsAffected(); n == 0 {
			res.SharesSkipped++
			continue
		}
		res.Shares++
		// Revoking clears token_sealed, so a sealed token is a live-or-expired link.
		if sh.TokenSealed != "" {
			if _, err := sealer.Open(sh.TokenSealed); err == nil {
				res.Recoverable++
			}
		}
	}
	if dryRun {
		return res, nil // the deferred rollback discards it
	}
	return res, tx.Commit()
}
