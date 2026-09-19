package presentations

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"time"
)

/*
Managing a link after it exists: edit (label, expiry, pinned domain) and
reissue (a new token for a link whose sealed token this server cannot open).
*/

// PresentationSharePatch edits a link; nil fields are left alone.
type PresentationSharePatch struct {
	Label *string `json:"label"`
	// 0 = never. Counted from now.
	ExpiresInDays *int `json:"expires_in_days"`
	// RFC 3339, in the future; "" or "never" = no expiry. Ignored when expires_in_days is given.
	ExpiresAt *string `json:"expires_at"`
	// A verified domain of the brain (id); "" unpins the link.
	DomainID *string `json:"domain_id"`
	// The same by host or id.
	Domain *string `json:"domain"`
}

func checkLabel(raw string) (string, error) {
	label := strings.TrimSpace(raw)
	if len([]rune(label)) > 80 {
		return "", InvalidError{"label is at most 80 characters"}
	}
	return label, nil
}

type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// insertShare stores a new link and returns its id and token. expires is
// 'infinity' or RFC 3339; domainID "" = not pinned.
func (s *Store) insertShare(ctx context.Context, x execer, docID, label, locale, expires, domainID, by string) (id, token string, recoverable bool, err error) {
	if token, err = NewToken(); err != nil {
		return "", "", false, err
	}
	sealed := ""
	if sl := s.sealer(); sl.Configured() {
		if sealed, err = sl.Seal(token); err != nil {
			sealed = ""
		}
	}
	id = newID()
	_, err = x.ExecContext(ctx, `INSERT INTO presentation_shares
		(id, presentation_id, token_hash, token_sealed, token_hint, label, locale, expires_at, created_by, domain_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9,NULLIF($10,''))`,
		id, docID, HashToken(token), sealed, token[:4], label, locale, expires, by, domainID)
	return id, token, sealed != "", err
}

// created builds the creation answer: the stored row, with the URL of the
// token just made (which a list cannot show when no sealing key is set).
func (s *Store) created(ctx context.Context, docID, shareID, token string, recoverable bool) (*PresentationShareCreated, error) {
	sh, err := s.share(ctx, docID, shareID)
	if err != nil {
		return nil, err
	}
	out := &PresentationShareCreated{Share: *sh, Token: token, Recoverable: recoverable}
	host := sh.Domain
	if sh.builtin {
		host = ""
	}
	out.URL = ShareURLOn(host, sh.Locale, token)
	out.Share.URL = out.URL
	return out, nil
}

func (s *Store) share(ctx context.Context, docID, shareID string) (*PresentationShare, error) {
	shares, err := s.ListShares(ctx, docID)
	if err != nil {
		return nil, err
	}
	for i := range shares {
		if shares[i].ID == shareID {
			return &shares[i], nil
		}
	}
	return nil, ErrNotFound
}

// UpdateShare edits a link's label, expiry and pinned domain. The token does
// not change (the host its URL is built on may). A revoked link is not found.
func (s *Store) UpdateShare(ctx context.Context, id, shareID string, in PresentationSharePatch) (*PresentationShare, error) {
	d, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	doc, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	sets, args := []string{}, []any{shareID, doc.ID}
	add := func(expr string, v any) {
		args = append(args, v)
		sets = append(sets, strings.Replace(expr, "?", "$"+strconv.Itoa(len(args)), 1))
	}
	if in.Label != nil {
		label, err := checkLabel(*in.Label)
		if err != nil {
			return nil, err
		}
		add("label = ?", label)
	}
	switch {
	case in.ExpiresInDays != nil:
		n := *in.ExpiresInDays
		if n < 0 || n > 3650 {
			return nil, InvalidError{"expires_in_days must be between 0 (never) and 3650"}
		}
		if n == 0 {
			add("expires_at = ?::timestamptz", "infinity")
		} else {
			add("expires_at = ?::timestamptz", time.Now().UTC().Add(time.Duration(n)*24*time.Hour).Format(time.RFC3339))
		}
	case in.ExpiresAt != nil:
		v := strings.TrimSpace(*in.ExpiresAt)
		if v == "" || v == "never" {
			add("expires_at = ?::timestamptz", "infinity")
			break
		}
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			return nil, InvalidError{"expires_at must be an RFC 3339 time, e.g. 2027-01-31T00:00:00Z"}
		}
		if !t.After(time.Now()) {
			return nil, InvalidError{"expires_at must be in the future; revoke the link to stop it now"}
		}
		add("expires_at = ?::timestamptz", t.UTC().Format(time.RFC3339))
	}
	if in.DomainID != nil || in.Domain != nil {
		ref := in.DomainID
		if ref == nil {
			ref = in.Domain
		}
		domainID, err := s.resolveDomainRef(ctx, doc.Namespace, *ref)
		if err != nil {
			return nil, err
		}
		add("domain_id = NULLIF(?,'')", domainID)
	}
	if len(sets) == 0 {
		return nil, InvalidError{"nothing to change: send label, expires_in_days, expires_at or domain_id"}
	}
	res, err := d.ExecContext(ctx, `UPDATE presentation_shares SET `+strings.Join(sets, ", ")+`
		WHERE id = $1 AND presentation_id = $2 AND revoked_at = 'epoch'`, args...)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return s.share(ctx, doc.ID, shareID)
}

// ReissueShare revokes a link and creates a new one with the same label,
// locale, expiry and domain: for imported links whose sealed token this
// server's key cannot open, so the owner gets a URL to send again. The old
// token stops working; the counters start over on the new link.
func (s *Store) ReissueShare(ctx context.Context, id, shareID, by string) (*PresentationShareCreated, error) {
	d, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	doc, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	var label, locale, expires, domainID string
	var live, revoked bool
	err = d.QueryRowContext(ctx, `SELECT label, locale,
		CASE WHEN expires_at = 'infinity' THEN 'infinity'
		     ELSE to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
		COALESCE(domain_id, ''), expires_at > now(), revoked_at <> 'epoch'
		FROM presentation_shares WHERE id = $1 AND presentation_id = $2`, shareID, doc.ID).
		Scan(&label, &locale, &expires, &domainID, &live, &revoked)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if revoked || !live {
		return nil, InvalidError{"this link is revoked or expired; create a new link instead"}
	}
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	newShare, token, recoverable, err := s.insertShare(ctx, tx, doc.ID, label, locale, expires, domainID, by)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE presentation_shares SET revoked_at = now(), token_sealed = ''
		WHERE id = $1`, shareID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.created(ctx, doc.ID, newShare, token, recoverable)
}
