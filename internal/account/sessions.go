package account

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/togo-framework/auth"

	"github.com/fadymondy/zekra/internal/account/schema"
)

/*
Session guards, installed as kernel middleware (outermost first).

RevokedSessions (fadymondy's RevokedSessions + ResetSessions, plus Zekra's
admin revoke/disable): under the default SESSION_DRIVER=cookie a session is a
signed JWT valid until it expires, and the auth plugin has no revocation list.
These tables are one. A credential is stripped — the request continues as
anonymous, the session cookie is cleared — when its user:

  - has a scheduled / purging / purged deletion request (any token), or a
    cancelled one and the token was issued at or before the revocation;
  - was disabled by an admin;
  - reset the password, or was signed out everywhere by an admin, after the
    token was issued.

A lookup failure lets the request through, logged at most once a minute: a
missing table or a database hiccup must not sign every user out.

RequireSession then authenticates /api/me/* and /api/admin/* through the auth
plugin's own middleware (401 otherwise), replaces the identity's roles with the
account's current ones (fadymondy's roles.go — a revoked admin loses the tier on
the next request), and gates /api/admin/* on the admin or owner role (403).
*/

// Deletion request statuses. "purging" is internal: a row claimed by a purge run.
const (
	StatusNone      = "none"
	StatusScheduled = "scheduled"
	StatusCancelled = "cancelled"
	StatusPurged    = "purged"
	statusPurging   = "purging"
)

type revocation struct {
	deletionStatus sql.NullString
	deletionAt     sql.NullTime
	disabled       bool
	resetAt        sql.NullTime // last password reset
	revokedAt      sql.NullTime // last admin "sign out everywhere" (or disable)
}

func (s *Service) revocationFor(ctx context.Context, userID string) (revocation, error) {
	var rv revocation
	err := s.DB.QueryRowContext(ctx, `
		SELECT
		  (SELECT status     FROM account_deletions WHERE user_id = $1 ORDER BY revoked_at DESC LIMIT 1),
		  (SELECT revoked_at FROM account_deletions WHERE user_id = $1 ORDER BY revoked_at DESC LIMIT 1),
		  EXISTS (SELECT 1 FROM account_disabled WHERE user_id = $1),
		  (SELECT reset_at   FROM account_password_resets WHERE user_id = $1),
		  (SELECT revoked_at FROM account_session_revocations WHERE user_id = $1)`, userID).
		Scan(&rv.deletionStatus, &rv.deletionAt, &rv.disabled, &rv.resetAt, &rv.revokedAt)
	return rv, err
}

// blocked decides whether a credential issued at iat (0 = unknown: a PAT or an
// unreadable token) must be refused.
func (rv revocation) blocked(iat int64) (bool, string) {
	if rv.deletionStatus.Valid {
		if rv.deletionStatus.String != StatusCancelled {
			return true, "deletion-" + rv.deletionStatus.String
		}
		// Cancelled: only what was issued at or before the revocation stays dead.
		if iat > 0 && rv.deletionAt.Valid && iat <= rv.deletionAt.Time.Unix() {
			return true, "deletion-cancelled"
		}
	}
	if rv.disabled {
		return true, "disabled"
	}
	// An admin sign-out is strict: everything issued at or before it dies (iat is
	// whole seconds, so a sign-in within that same second is refused too — the
	// safe side, as for a cancelled deletion).
	if iat > 0 && rv.revokedAt.Valid && iat <= rv.revokedAt.Time.Unix() {
		return true, "revoked"
	}
	// A password reset keeps a session from the reset's own second (the sign-in
	// right after it), as fadymondy's ResetSessions does.
	if iat > 0 && rv.resetAt.Valid && iat < rv.resetAt.Time.Unix() {
		return true, "revoked"
	}
	return false, ""
}

var lastLookupWarn atomic.Int64

func (s *Service) warnLookup(err error) {
	now := time.Now().Unix()
	last := lastLookupWarn.Load()
	if now-last >= 60 && lastLookupWarn.CompareAndSwap(last, now) {
		s.log().Warn("account revocation lookup failed; revoked sessions are NOT being refused",
			"err", err, "fix", "apply internal/account/schema/schema.sql (go run ./cmd/migrate)")
	}
}

// credentialSubject returns the user id and issue time behind a presented
// credential, without trusting it for anything but refusal.
func (s *Service) credentialSubject(r *http.Request, token string) (string, int64) {
	if c, ok := peekClaims(token); ok && c.Sub != "" {
		return c.Sub, c.Iat
	}
	// A server-side session id (SESSION_DRIVER=database): read the stored JWT.
	if !strings.HasPrefix(token, "togo_pat_") {
		var stored string
		if s.DB.QueryRowContext(r.Context(), `SELECT token FROM auth_sessions WHERE sid = $1`, token).Scan(&stored) == nil {
			if c, ok := peekClaims(stored); ok && c.Sub != "" {
				return c.Sub, c.Iat
			}
		}
	}
	// A personal access token, or another store: ask the plugin who it is.
	if id := sessionIdentity(s.Auth, r); id != nil {
		return id.ID, 0
	}
	return "", 0
}

// RevokedSessions strips credentials that must no longer work (see above).
func (s *Service) RevokedSessions(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := presentedToken(r)
		if token == "" || !s.ready() {
			next.ServeHTTP(w, r)
			return
		}
		userID, iat := s.credentialSubject(r, token)
		if userID == "" {
			next.ServeHTTP(w, r)
			return
		}
		rv, err := s.revocationFor(r.Context(), userID)
		if err != nil {
			s.warnLookup(err)
			next.ServeHTTP(w, r)
			return
		}
		if ok, why := rv.blocked(iat); ok {
			// Tells a client why it was signed out (fadymondy: "deletion-<status>").
			w.Header().Set("X-Account-Status", why)
			http.SetCookie(w, ClearSessionCookie(secureRequest(r)))
			next.ServeHTTP(w, withoutCredentials(r))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// freshRoles returns the account's current roles (and applies ADMIN_EMAILS);
// ok=false means "keep the token's" (no row, e.g. a dev login, or a DB error).
func (s *Service) freshRoles(ctx context.Context, id *auth.Identity) ([]string, bool) {
	if !s.ready() || id == nil || id.ID == "" || id.Guard == "pat" {
		return nil, false
	}
	qctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	var email, csv string
	if err := s.DB.QueryRowContext(qctx, `SELECT email, COALESCE(roles,'') FROM users WHERE id = $1`, id.ID).Scan(&email, &csv); err != nil {
		return nil, false
	}
	for _, e := range schema.AdminEmails() {
		if e == normEmail(email) {
			if updated := schema.AddRole(csv, "admin"); updated != csv {
				if _, err := s.DB.ExecContext(qctx, `UPDATE users SET roles = $1 WHERE id = $2`, updated, id.ID); err == nil {
					csv = updated
				}
			}
			break
		}
	}
	return splitCSV(csv), true
}

// isPublicMe: account routes that must work without a session.
func isPublicMe(r *http.Request) bool {
	p := strings.TrimRight(r.URL.Path, "/")
	return r.Method == http.MethodPost && p == "/api/me/delete/cancel"
}

// RequireSession authenticates /api/me/* and /api/admin/* and answers
// GET /api/auth/me with the account's current roles.
func (s *Service) RequireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		me := r.Method == http.MethodGet && strings.TrimRight(p, "/") == "/api/auth/me"
		admin := strings.HasPrefix(p, "/api/admin/") || p == "/api/admin"
		account := strings.HasPrefix(p, "/api/me/") || p == "/api/me"
		if s.Auth == nil || (!me && !admin && !account) || isPublicMe(r) || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		s.Auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id, _ := auth.IdentityFrom(r.Context())
			if roles, ok := s.freshRoles(r.Context(), id); ok {
				id.Roles = roles // the identity is a pointer in the context: downstream sees it
			}
			if me {
				if id.Roles == nil {
					id.Roles = []string{}
				}
				if id.Permissions == nil {
					id.Permissions = []string{}
				}
				w.Header().Set("Cache-Control", "no-store")
				writeJSON(w, http.StatusOK, id)
				return
			}
			if admin && !isAdmin(id) {
				writeJSONErr(w, http.StatusForbidden, "forbidden")
				return
			}
			next.ServeHTTP(w, r)
		})).ServeHTTP(w, r)
	})
}

// MethodsMiddleware rewrites GET /api/auth/methods so each of google / apple /
// github appears once, pointing at this package's flow, and only when it is
// configured here. (The togo auth-oauth plugin reads the same OAUTH_* env vars
// and would otherwise advertise a second entry pointing at /api/auth/oauth/…)
func (s *Service) MethodsMiddleware(configured func() []auth.LoginMethod) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet || strings.TrimRight(r.URL.Path, "/") != "/api/auth/methods" {
				next.ServeHTTP(w, r)
				return
			}
			rec := &captured{header: http.Header{}, status: http.StatusOK}
			next.ServeHTTP(rec, r)
			var body struct {
				Methods []auth.LoginMethod `json:"methods"`
			}
			if rec.status != http.StatusOK || json.Unmarshal(rec.body.Bytes(), &body) != nil {
				rec.replay(w)
				return
			}
			out := []auth.LoginMethod{}
			for _, m := range body.Methods {
				if knownProvider(m.Name) {
					continue
				}
				out = append(out, m)
			}
			out = append(out, configured()...)
			w.Header().Set("Cache-Control", "no-store")
			writeJSON(w, http.StatusOK, map[string]any{"methods": out})
		})
	}
}
