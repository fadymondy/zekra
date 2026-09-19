package account

import (
	"context"
	"net/http"
	"time"

	"github.com/togo-framework/auth"
)

/*
BrainDirectory lets the brain plugin (which does not import the auth plugin)
resolve the signed-in user behind a request and re-read an account's roles. It
is published on the kernel under BrainDirectoryKey and satisfies the brain
plugin's UserDirectory interface structurally.

Session users are limited to the brains they are members of (brain_members);
admin/owner-role accounts see every brain. Personal access tokens are not a
session here: they carry their own abilities and are not a brain credential.
*/
type BrainDirectory struct{ s *Service }

// BrainDirectoryKey is the kernel key the brain plugin reads (brain.UserDirectoryKey).
const BrainDirectoryKey = "zekra.users"

// NewBrainDirectory wraps the account service.
func NewBrainDirectory(s *Service) *BrainDirectory { return &BrainDirectory{s: s} }

type discardWriter struct{ h http.Header }

func (d *discardWriter) Header() http.Header       { return d.h }
func (*discardWriter) Write(b []byte) (int, error) { return len(b), nil }
func (*discardWriter) WriteHeader(int)             {}

// SessionUser authenticates the request's session cookie or bearer session JWT
// through the auth plugin, and returns the account's CURRENT roles.
func (d *BrainDirectory) SessionUser(r *http.Request) (string, []string, bool) {
	if d == nil || d.s == nil || d.s.Auth == nil {
		return "", nil, false
	}
	var id *auth.Identity
	d.s.Auth.Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r2 *http.Request) {
		id, _ = auth.IdentityFrom(r2.Context())
	})).ServeHTTP(&discardWriter{h: http.Header{}}, r)
	if id == nil || id.ID == "" || id.Guard == "pat" {
		return "", nil, false
	}
	roles, active := d.UserRoles(r.Context(), id.ID)
	if !active {
		return "", nil, false
	}
	return id.ID, roles, true
}

// UserRoles re-reads an account's roles. active=false when the account does
// not exist, is disabled, or is being deleted.
func (d *BrainDirectory) UserRoles(ctx context.Context, userID string) ([]string, bool) {
	if d == nil || !d.s.ready() || userID == "" {
		return nil, false
	}
	qctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	roles, ok := d.s.freshRoles(qctx, &auth.Identity{ID: userID})
	if !ok {
		return nil, false
	}
	if rv, err := d.s.revocationFor(qctx, userID); err == nil {
		if blocked, _ := rv.blocked(0); blocked {
			return nil, false
		}
	}
	return roles, true
}
