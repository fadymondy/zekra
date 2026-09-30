package circlexo

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// All queries run on the shared pool. The brain tables (brain_members) are in public, ours in the
// account schema; the app's search_path reaches both, exactly as internal/account relies on.

// OrgLink is a hub org and the brain that serves as its tenant.
type OrgLink struct {
	OrgID            string
	OrgSlug          string
	PrimaryNamespace string
	Active           bool
}

const orgLinkSQL = `SELECT org_id, org_slug, primary_namespace, status = 'active' FROM circlexo_org_links`

func scanOrgLink(row *sql.Row) (*OrgLink, error) {
	var l OrgLink
	if err := row.Scan(&l.OrgID, &l.OrgSlug, &l.PrimaryNamespace, &l.Active); err != nil {
		return nil, err
	}
	return &l, nil
}

// OrgByID returns the link for a hub org (any status); sql.ErrNoRows when there is none.
func (s *Service) OrgByID(ctx context.Context, orgID string) (*OrgLink, error) {
	return scanOrgLink(s.DB.QueryRowContext(ctx, orgLinkSQL+` WHERE org_id = $1`, orgID))
}

// UserBySubject returns the Zekra user linked to a hub subject; sql.ErrNoRows when unlinked.
func (s *Service) UserBySubject(ctx context.Context, subject string) (string, error) {
	var id string
	err := s.DB.QueryRowContext(ctx, `SELECT user_id FROM circlexo_user_links WHERE subject = $1`, subject).Scan(&id)
	return id, err
}

// linkUser records subject -> user and reports the user the subject ends up linked to, which is
// not userID when another request linked it first or when the user already has another hub
// account: the caller must compare, never assume.
func (s *Service) linkUser(ctx context.Context, subject, userID, email, via string) (string, error) {
	if _, err := s.DB.ExecContext(ctx, `
		INSERT INTO circlexo_user_links (subject, user_id, email, linked_via) VALUES ($1, $2, $3, $4)
		ON CONFLICT DO NOTHING`, subject, userID, email, via); err != nil {
		return "", err
	}
	got, err := s.UserBySubject(ctx, subject)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil // the user is linked to a different subject: the caller sees "" != userID
	}
	return got, err
}

// userByEmail finds a Zekra user by e-mail, ignoring case. usable says whether the account may be
// linked on the strength of an address alone: it must have proved it can read the address (no
// account_unverified row) or have no password at all (created by SSO or a hub sync), so nobody can
// register someone else's address with a password and wait for that person to sign in with the hub.
func (s *Service) userByEmail(ctx context.Context, email string) (id string, usable bool, err error) {
	var passwordless, unverified bool
	err = s.DB.QueryRowContext(ctx, `
		SELECT u.id, coalesce(u.password_hash, '') = '!sso',
		       EXISTS (SELECT 1 FROM account_unverified au WHERE au.user_id = u.id)
		FROM users u WHERE lower(u.email) = lower($1) ORDER BY u.created_at LIMIT 1`, email).Scan(&id, &passwordless, &unverified)
	return id, passwordless || !unverified, err
}

func norm(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if strings.TrimSpace(s) != "" {
			return s
		}
	}
	return ""
}

// dedupe is the webhooks.Deduper over circlexo_webhook_events. Done runs only after the handler
// succeeded, so a failed event is retried.
type dedupe struct{ db *sql.DB }

func (d dedupe) Seen(ctx context.Context, id string) (bool, error) {
	if id == "" {
		return false, nil
	}
	var ok bool
	err := d.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM circlexo_webhook_events WHERE webhook_id = $1)`, id).Scan(&ok)
	return ok, err
}

func (d dedupe) Done(ctx context.Context, id string) error {
	if id == "" {
		return nil
	}
	_, err := d.db.ExecContext(ctx, `INSERT INTO circlexo_webhook_events (webhook_id) VALUES ($1) ON CONFLICT DO NOTHING`, id)
	if err == nil {
		// Old ids only matter inside the hub's retry window (days at most).
		_, _ = d.db.ExecContext(ctx, `DELETE FROM circlexo_webhook_events WHERE received_at < now() - interval '30 days'`)
	}
	return err
}
