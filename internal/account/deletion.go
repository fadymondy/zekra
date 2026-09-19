package account

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/togo-framework/auth"
)

/*
Deleting your own account (ported from fadymondy's account.go / purge.go, FM-50).

 1. Schedule — re-authenticate with the password (a session alone is never
    enough), record a deletion request 14 days out, and revoke every credential
    the user holds, immediately.
 2. Cancel — during those 14 days. Takes email + password (the user was signed
    out everywhere), and answers an unknown email and a wrong password the same.
 3. Purge — once the grace window has passed, delete the account and everything
    the account area holds. The request row and the audit trail keep only the
    user id and a SHA-256 of the email.

Zekra's brains are not owned by a user (they are namespaces governed by brain
tokens and grants), so a purge does not touch memories; fadymondy's
"testimonials" choice is accepted for contract parity and recorded, nothing more.
*/

const (
	TestimonialsAnonymise = "anonymise"
	TestimonialsWithdraw  = "withdraw"
)

// GracePeriod is how long a deletion can still be cancelled.
const GracePeriod = 14 * 24 * time.Hour

var (
	ErrWrongPassword  = errors.New("password is incorrect")
	ErrBadCredentials = errors.New("invalid email or password")
	ErrRateLimited    = errors.New("too many attempts, try again later")
	ErrNoPending      = errors.New("no account deletion is pending")
	ErrGraceOver      = errors.New("the grace period has ended and the account is being deleted")
	ErrBadMode        = errors.New(`testimonials must be "anonymise" or "withdraw"`)
)

var (
	accountAttempts = newLimiter(5, 15*time.Minute)
	ipAttempts      = newLimiter(20, 15*time.Minute)
)

// Deletion is one account_deletions row.
type Deletion struct {
	ID           string
	UserID       string
	Status       string
	Testimonials string
	ScheduledFor time.Time
	RevokedAt    time.Time
	CancelledAt  *time.Time
}

// Latest returns the user's most recent deletion request, or nil.
func (s *Service) Latest(ctx context.Context, userID string) (*Deletion, error) {
	var d Deletion
	var cancelled sql.NullTime
	err := s.DB.QueryRowContext(ctx, `
		SELECT id, user_id, status, testimonials, scheduled_for, revoked_at, cancelled_at
		  FROM account_deletions WHERE user_id = $1 ORDER BY revoked_at DESC LIMIT 1`, userID).
		Scan(&d.ID, &d.UserID, &d.Status, &d.Testimonials, &d.ScheduledFor, &d.RevokedAt, &cancelled)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if cancelled.Valid {
		d.CancelledAt = &cancelled.Time
	}
	return &d, nil
}

// Schedule records a deletion request after re-checking the password, and
// revokes every credential the user holds.
func (s *Service) Schedule(ctx context.Context, userID, password, testimonials string, meta Meta) (*Deletion, error) {
	if !s.ready() || s.Auth == nil {
		return nil, ErrUnavailable
	}
	if testimonials == "" {
		testimonials = TestimonialsAnonymise
	}
	if testimonials != TestimonialsAnonymise && testimonials != TestimonialsWithdraw {
		return nil, ErrBadMode
	}
	if !accountAttempts.allow("delete:"+userID) || !ipAttempts.allow("delete:"+meta.IP) {
		return nil, ErrRateLimited
	}
	email, err := s.verifyPassword(ctx, userID, password)
	if err != nil {
		if errors.Is(err, ErrWrongPassword) {
			s.Audit(ctx, Entry{Actor: userID, Action: "account.delete.denied", Subject: "user:" + userID, Meta: meta,
				Details: map[string]any{"reason": "wrong password"}})
		}
		return nil, err
	}
	latest, err := s.Latest(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("could not read deletion requests: %w", err)
	}
	row := latest
	if latest == nil || latest.Status != StatusScheduled {
		now := s.now().UTC()
		var id string
		if err := s.DB.QueryRowContext(ctx, `
			INSERT INTO account_deletions (user_id, email, status, testimonials, request_id, scheduled_for, revoked_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
			userID, normEmail(email), StatusScheduled, testimonials, meta.RequestID, now.Add(GracePeriod), now).Scan(&id); err != nil {
			return nil, fmt.Errorf("could not record the deletion request: %w", err)
		}
		row = &Deletion{ID: id, UserID: userID, Status: StatusScheduled, Testimonials: testimonials, ScheduledFor: now.Add(GracePeriod), RevokedAt: now}
	}
	// After the row: the row alone already blocks every stateless token.
	revoked := s.revokeCredentials(ctx, userID)
	s.Audit(ctx, Entry{Actor: userID, Action: "account.delete.requested", Subject: "user:" + userID, Meta: meta,
		Details: map[string]any{
			"deletion_id": row.ID, "scheduled_for": row.ScheduledFor.UTC().Format(time.RFC3339),
			"testimonials": row.Testimonials, "email_sha256": emailHash(email), "revoked": revoked,
		}})
	return row, nil
}

// Cancel withdraws a pending deletion, proven by email + password.
func (s *Service) Cancel(ctx context.Context, email, password string, meta Meta) error {
	if !s.ready() || s.Auth == nil {
		return ErrUnavailable
	}
	email = strings.TrimSpace(email)
	if !ipAttempts.allow("cancel:"+meta.IP) || !accountAttempts.allow("cancel:"+normEmail(email)) {
		return ErrRateLimited
	}
	guard := s.Auth.Guard("")
	if guard == nil || guard.Auth == nil {
		return ErrUnavailable
	}
	// The guard compares against a dummy hash for an unknown email: same cost.
	stored := email
	_ = s.DB.QueryRowContext(ctx, `SELECT email FROM users WHERE lower(email) = $1 ORDER BY created_at LIMIT 1`, normEmail(email)).Scan(&stored)
	id, err := guard.Auth.Attempt(ctx, stored, password)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			return ErrBadCredentials
		}
		return fmt.Errorf("could not verify credentials: %w", err)
	}
	if id == nil || id.ID == "" {
		return ErrBadCredentials
	}
	latest, err := s.Latest(ctx, id.ID)
	if err != nil {
		return fmt.Errorf("could not read deletion requests: %w", err)
	}
	switch {
	case latest == nil:
		return ErrNoPending
	case latest.Status == statusPurging:
		return ErrGraceOver
	case latest.Status != StatusScheduled:
		return ErrNoPending
	}
	now := s.now().UTC()
	if !now.Before(latest.ScheduledFor) {
		return ErrGraceOver
	}
	// Conditional on the status, so a purge that claimed the row wins cleanly.
	n, err := s.execCount(ctx, `UPDATE account_deletions SET status = $1, cancelled_at = $2, updated_at = $2 WHERE id = $3 AND status = $4`,
		StatusCancelled, now, latest.ID, StatusScheduled)
	if err != nil {
		return fmt.Errorf("could not cancel: %w", err)
	}
	if n != 1 {
		return ErrGraceOver
	}
	s.Audit(ctx, Entry{Actor: id.ID, Action: "account.delete.cancelled", Subject: "user:" + id.ID, Meta: meta,
		Details: map[string]any{"deletion_id": latest.ID}})
	return nil
}

// verifyPassword checks password against userID's own hash and returns its email.
func (s *Service) verifyPassword(ctx context.Context, userID, password string) (string, error) {
	guard := s.Auth.Guard("")
	if guard == nil || guard.Auth == nil {
		return "", ErrUnavailable
	}
	var email string
	err := s.DB.QueryRowContext(ctx, `SELECT email FROM users WHERE id = $1`, userID).Scan(&email)
	if errors.Is(err, sql.ErrNoRows) {
		_, _ = guard.Auth.Attempt(ctx, "", password) // same answer, same bcrypt cost
		return "", ErrWrongPassword
	}
	if err != nil {
		return "", fmt.Errorf("could not load the account: %w", err)
	}
	id, err := guard.Auth.Attempt(ctx, email, password)
	switch {
	case errors.Is(err, auth.ErrInvalidCredentials):
		return "", ErrWrongPassword
	case err != nil:
		return "", fmt.Errorf("could not verify the password: %w", err)
	case id == nil || id.ID != userID:
		return "", ErrWrongPassword
	}
	return email, nil
}

// revokeCredentials deletes every server-side credential the user holds.
// Stateless JWTs are refused by RevokedSessions for as long as the rows say so.
func (s *Service) revokeCredentials(ctx context.Context, userID string) map[string]int {
	out := map[string]int{}
	for _, t := range []struct{ key, table string }{
		{"access_tokens", "personal_access_tokens"},
		{"data_exports", "account_exports"},
	} {
		if !s.tableExists(ctx, t.table) {
			continue
		}
		// Table names are the constants above, never input.
		n, err := s.execCount(ctx, "DELETE FROM "+t.table+" WHERE user_id = $1", userID) //#nosec G202 -- constant table names
		if err != nil {
			s.log().Warn("could not revoke credentials", "table", t.table, "err", err)
			continue
		}
		out[t.key] = n
	}
	out["sessions"] = s.sweepSessions(ctx, userID)
	return out
}

// sweepSessions deletes the user's server-side sessions (SESSION_DRIVER=database).
func (s *Service) sweepSessions(ctx context.Context, userID string) int {
	n := 0
	for _, sid := range s.sessionIDs(ctx, userID) {
		if _, err := s.DB.ExecContext(ctx, `DELETE FROM auth_sessions WHERE sid = $1`, sid.SID); err == nil {
			n++
		}
	}
	return n
}

// SessionInfo is one server-side session (never the token itself).
type SessionInfo struct {
	SID       string    `json:"-"`
	ID        string    `json:"id"` // a SHA-256 prefix of the sid, safe to show and to revoke by
	IssuedAt  time.Time `json:"issued_at"`
	ExpiresAt string    `json:"expires_at"`
}

func (s *Service) sessionIDs(ctx context.Context, userID string) []SessionInfo {
	if !s.tableExists(ctx, "auth_sessions") {
		return nil
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT sid, token, expires_at FROM auth_sessions`)
	if err != nil {
		s.log().Warn("could not read sessions", "err", err)
		return nil
	}
	defer rows.Close()
	var out []SessionInfo
	for rows.Next() {
		var sid, token, exp string
		if rows.Scan(&sid, &token, &exp) != nil {
			continue
		}
		if c, ok := peekClaims(token); ok && c.Sub == userID {
			out = append(out, SessionInfo{SID: sid, ID: emailHash(sid)[:16], IssuedAt: time.Unix(c.Iat, 0).UTC(), ExpiresAt: exp})
		}
	}
	return out
}

// ---- purge -----------------------------------------------------------------------

// StartPurger runs PurgeDue on a ticker until ctx ends.
func (s *Service) StartPurger(ctx context.Context, every time.Duration) {
	if !s.ready() || every <= 0 {
		return
	}
	go func() {
		timer := time.NewTimer(time.Minute) // first run a minute after boot, not during it
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				n, err := s.PurgeDue(ctx, time.Now().UTC())
				if err != nil {
					s.log().Error("account purge failed", "err", err)
				}
				if n > 0 {
					s.log().Info("accounts purged", "count", n)
				}
				timer.Reset(every)
			}
		}
	}()
}

// PurgeDue purges every scheduled request whose grace window ended at or before now.
func (s *Service) PurgeDue(ctx context.Context, now time.Time) (int, error) {
	if !s.ready() {
		return 0, ErrUnavailable
	}
	// Rows a crashed run left claimed for over an hour go back to scheduled.
	_, _ = s.DB.ExecContext(ctx, `UPDATE account_deletions SET status = $1, updated_at = now()
		WHERE status = $2 AND updated_at < $3`, StatusScheduled, statusPurging, now.Add(-time.Hour))
	rows, err := s.DB.QueryContext(ctx, `SELECT id, user_id, email FROM account_deletions
		WHERE status = $1 AND scheduled_for <= $2 ORDER BY scheduled_for LIMIT 200`, StatusScheduled, now)
	if err != nil {
		return 0, fmt.Errorf("could not read deletion requests: %w", err)
	}
	type due struct{ id, user, email string }
	var list []due
	for rows.Next() {
		var d due
		if rows.Scan(&d.id, &d.user, &d.email) == nil {
			list = append(list, d)
		}
	}
	rows.Close()
	done := 0
	var errs []error
	for _, d := range list {
		// Claim it, so a concurrent cancel or another run cannot race us.
		n, err := s.execCount(ctx, `UPDATE account_deletions SET status = $1, updated_at = now() WHERE id = $2 AND status = $3`,
			statusPurging, d.id, StatusScheduled)
		if err != nil || n != 1 {
			continue
		}
		summary, err := s.PurgeUser(ctx, d.user, d.email)
		if err != nil {
			_, _ = s.DB.ExecContext(ctx, `UPDATE account_deletions SET status = $1, updated_at = now() WHERE id = $2`, StatusScheduled, d.id)
			errs = append(errs, err)
			continue
		}
		raw, _ := json.Marshal(summary)
		_, _ = s.DB.ExecContext(ctx, `UPDATE account_deletions SET status = $1, purged_at = now(), updated_at = now(), email = '', summary = $2 WHERE id = $3`,
			StatusPurged, string(raw), d.id)
		s.Audit(ctx, Entry{Actor: "system", Action: "account.purged", Subject: "user:" + d.user,
			Details: map[string]any{"deletion_id": d.id, "email_sha256": emailHash(d.email), "summary": summary}})
		done++
	}
	return done, errors.Join(errs...)
}

// PurgeUser deletes an account and everything the account area holds, now.
// Used by the purge and by the admin delete. Tables that do not exist are skipped.
func (s *Service) PurgeUser(ctx context.Context, userID, email string) (map[string]int, error) {
	if email == "" {
		_ = s.DB.QueryRowContext(ctx, `SELECT email FROM users WHERE id = $1`, userID).Scan(&email)
	}
	summary := s.revokeCredentials(ctx, userID)
	byUser := []struct{ table, col string }{
		{"auth_identities", "user_id"}, {"account_totp", "user_id"}, {"account_recovery_codes", "user_id"},
		{"account_challenges", "user_id"}, {"account_unverified", "user_id"}, {"account_profiles", "user_id"},
		{"account_prefs", "user_id"}, {"account_password_resets", "user_id"}, {"account_session_revocations", "user_id"},
		{"account_disabled", "user_id"}, {"auth_totp", "subject"}, {"auth_pins", "subject"},
	}
	for _, t := range byUser {
		if !s.tableExists(ctx, t.table) {
			continue
		}
		n, err := s.execCount(ctx, "DELETE FROM "+t.table+" WHERE "+t.col+" = $1", userID) //#nosec G202 -- constant identifiers
		if err != nil {
			return summary, fmt.Errorf("purge %s: %w", t.table, err)
		}
		summary[t.table] = n
	}
	if email != "" {
		_, _ = s.DB.ExecContext(ctx, `DELETE FROM account_codes WHERE email = $1`, normEmail(email))
		if s.tableExists(ctx, "otp_codes") {
			_, _ = s.DB.ExecContext(ctx, `DELETE FROM otp_codes WHERE lower(subject) = $1`, normEmail(email))
		}
	}
	n, err := s.execCount(ctx, `DELETE FROM users WHERE id = $1`, userID)
	if err != nil {
		return summary, fmt.Errorf("purge users: %w", err)
	}
	summary["users"] = n
	return summary, nil
}
