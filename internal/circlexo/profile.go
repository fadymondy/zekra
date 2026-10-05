package circlexo

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	circlexo "github.com/circlexo/circlexo-go"
	"github.com/circlexo/circlexo-go/webhooks"
)

/*
Profile sync (MH-1149). The hub owns who a person is. A Zekra account is its e-mail address, so
Zekra copies the hub's address onto the linked account on every CircleXO sign-in (from the ID
token) and whenever the hub sends user.updated. A new address is taken only when the hub says it
is verified and no other Zekra account holds it.
*/

// SyncProfile overwrites userID's copy of their hub profile. Failures are logged: a sign-in never
// fails because of it.
func (s *Service) SyncProfile(ctx context.Context, userID string, p circlexo.Profile) {
	email := norm(p.Email)
	if email == "" || !p.EmailVerified {
		return
	}
	var cur string
	if err := s.DB.QueryRowContext(ctx, `SELECT coalesce(email, '') FROM users WHERE id = $1`, userID).Scan(&cur); err != nil || strings.EqualFold(cur, email) {
		return
	}
	var other string
	err := s.DB.QueryRowContext(ctx, `SELECT id FROM users WHERE lower(email) = $1 AND id <> $2`, email, userID).Scan(&other)
	if err == nil {
		s.Log.Warn("circlexo: the hub's address belongs to another Zekra account; keeping the old one", "user", userID)
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return
	}
	if _, err := s.DB.ExecContext(ctx, `UPDATE users SET email = $2 WHERE id = $1`, userID, email); err != nil {
		s.Log.Warn("circlexo: syncing the address", "user", userID, "err", err)
		return
	}
	_, _ = s.DB.ExecContext(ctx, `UPDATE circlexo_user_links SET email = $2 WHERE user_id = $1`, userID, email)
}

// onUserUpdated copies a person's hub profile onto their linked Zekra account. A person who has
// never signed in to Zekra with CircleXO has no link and nothing to update. The hub sends one
// event per org they belong to, so this runs (harmlessly) more than once per change.
func (s *Service) onUserUpdated(ctx context.Context, e *webhooks.Envelope) error {
	d, err := e.User()
	if err != nil || d.User.ID == "" {
		return nil // malformed: retrying will not fix it
	}
	userID, err := s.UserBySubject(ctx, d.User.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	u := d.User
	s.SyncProfile(ctx, userID, circlexo.Profile{
		Name: u.DisplayName, Email: u.Email, EmailVerified: u.EmailVerified, Picture: u.AvatarURL, Locale: u.Locale,
	})
	return nil
}
