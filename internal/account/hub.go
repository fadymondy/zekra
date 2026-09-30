package account

import (
	"context"
	"net/http"

	"github.com/togo-framework/auth"
)

/*
What the CircleXO integration (internal/circlexo) needs from the account
service, kept here so the rules stay in one place: whether an account may act at
all, where a completed sign-in lands, and the public origin. The integration
reuses the auth plugin for the session itself (Service.Auth.IssueSession), so a
hub sign-in is an ordinary Zekra session and every guard in sessions.go applies.
*/

// UserActive reports whether the account exists and is not disabled or being
// deleted (the same test the brain directory applies to every request).
func (s *Service) UserActive(ctx context.Context, userID string) bool {
	_, ok := NewBrainDirectory(s).UserRoles(ctx, userID)
	return ok
}

// Landing is where a completed sign-in with no redirect of its own lands (the
// account's roles decide: admins to the dashboard, everyone else home).
func (s *Service) Landing(ctx context.Context, userID string) string {
	id := &auth.Identity{ID: userID}
	if roles, ok := s.freshRoles(ctx, id); ok {
		id.Roles = roles
	}
	return afterSignIn(id)
}

// SafeReturnPath keeps a sign-in redirect on this site.
func SafeReturnPath(p string) string { return safeReturnPath(p) }

// PublicURL is the public origin of the console (AUTH_PUBLIC_URL, else APP_URL).
func PublicURL() string { return publicURL() }

// LoginPath is the console's sign-in page.
func LoginPath() string { return loginPath() }

// SecureRequest reports whether r arrived over HTTPS (directly or via the proxy).
func SecureRequest(r *http.Request) bool { return secureRequest(r) }
