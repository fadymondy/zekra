package brain

/*
Who is calling, and which brains may they touch (Phase 1: notes + connect any AI
agent).

Three kinds of caller reach the notes endpoints and the remote MCP endpoint:

 1. An OAuth principal — an MCP client a signed-in user connected through the
    consent screen. It rides in the request context (never a header), set only by
    the in-process MCP dispatcher after the bearer token was verified. It may touch
    exactly the brains named in its grant, with read or read+write, and every call
    is re-checked against the approving user's CURRENT access: a user who loses a
    brain (or is disabled) takes every connected app with them.
 2. An X-Zekra-Token ACL token — unchanged: admin tokens see everything, others
    need a namespace_grants row.
 3. A signed-in user (session cookie / bearer session JWT). Admin/owner-role
    accounts see every brain; everyone else needs a brain_members row.

The brain plugin does not import the auth plugin. The harness publishes a
UserDirectory on the kernel (key "zekra.users") that resolves the session user
and re-reads a user's roles; without one we fall back to the `users` table.
*/

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"regexp"
	"strings"
)

// UserDirectory is implemented by the harness (internal/account) and published
// on the kernel under UserDirectoryKey. Structural, so neither side imports the
// other.
type UserDirectory interface {
	// SessionUser resolves the signed-in user behind a request, if any.
	SessionUser(r *http.Request) (userID string, roles []string, ok bool)
	// UserRoles re-reads a user's current roles; active=false for an unknown,
	// disabled or deleted account.
	UserRoles(ctx context.Context, userID string) (roles []string, active bool)
}

// UserDirectoryKey is the kernel service key for the UserDirectory.
const UserDirectoryKey = "zekra.users"

// Principal is an OAuth-authenticated MCP caller, carried in the context.
type Principal struct {
	UserID     string
	GrantID    string
	ClientID   string
	ClientName string
	Scopes     []string
	// Namespaces maps each granted brain to whether the grant allows writes.
	Namespaces map[string]bool
}

type principalKey struct{}

// WithPrincipal stores an OAuth principal in the context.
func WithPrincipal(ctx context.Context, p *Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, p)
}

// PrincipalFrom returns the OAuth principal in the context, if any.
func PrincipalFrom(ctx context.Context) *Principal {
	p, _ := ctx.Value(principalKey{}).(*Principal)
	return p
}

// agentLabel is how an OAuth principal appears in activity / owner_agent_id.
func (p *Principal) agentLabel() string {
	name := p.ClientName
	if name == "" {
		name = p.ClientID
	}
	return "oauth:" + oauthClip(name, 60)
}

const (
	ScopeRead  = "brains:read"
	ScopeWrite = "brains:write"
)

func (s *Service) directory() UserDirectory {
	if s.k == nil {
		return nil
	}
	v, ok := s.k.Get(UserDirectoryKey)
	if !ok {
		return nil
	}
	d, _ := v.(UserDirectory)
	return d
}

// sessionUser returns the signed-in user of a request, if any.
func (s *Service) sessionUser(r *http.Request) (string, []string, bool) {
	if d := s.directory(); d != nil {
		return d.SessionUser(r)
	}
	return "", nil, false
}

// userRoles re-reads a user's roles (directory first, users table fallback).
func (s *Service) userRoles(ctx context.Context, userID string) ([]string, bool) {
	if userID == "" {
		return nil, false
	}
	if d := s.directory(); d != nil {
		return d.UserRoles(ctx, userID)
	}
	db, err := s.Store.db(ctx)
	if err != nil {
		return nil, false
	}
	var csv string
	if err := db.QueryRowContext(ctx, `SELECT COALESCE(roles,'') FROM users WHERE id = $1`, userID).Scan(&csv); err != nil {
		return nil, false
	}
	return splitRoles(csv), true
}

func splitRoles(csv string) []string {
	var out []string
	for _, r := range strings.Split(csv, ",") {
		if r = strings.TrimSpace(r); r != "" {
			out = append(out, r)
		}
	}
	return out
}

func isAdminRole(roles []string) bool {
	for _, r := range roles {
		if r == "admin" || r == "owner" {
			return true
		}
	}
	return false
}

// userAccess is a user's access to one brain: admin-role → everything; otherwise
// their brain_members role.
func (s *Store) userAccess(ctx context.Context, userID string, roles []string, ns string) (read, write bool) {
	if userID == "" || ns == "" {
		return false, false
	}
	if isAdminRole(roles) {
		return true, true
	}
	role, err := s.MemberRole(ctx, ns, userID)
	if err != nil || role == "" {
		return false, false
	}
	return true, role == "owner" || role == "editor"
}

// oauthCan decides one OAuth call: the grant must name the brain (and allow
// writes for a write), the token must carry the scope, and the approving user
// must still hold that access today.
func (s *Service) oauthCan(ctx context.Context, p *Principal, ns string, write bool) bool {
	if p == nil || ns == "" {
		return false
	}
	grantWrite, ok := p.Namespaces[ns]
	if !ok {
		return false
	}
	if write && (!grantWrite || !hasScope(p.Scopes, ScopeWrite)) {
		return false
	}
	if !write && !hasScope(p.Scopes, ScopeRead) && !hasScope(p.Scopes, ScopeWrite) {
		return false
	}
	roles, active := s.userRoles(ctx, p.UserID)
	if !active {
		return false
	}
	r, w := s.Store.userAccess(ctx, p.UserID, roles, ns)
	if write {
		return w
	}
	return r
}

// readableNamespaces lists the brains a caller may read. all=true means "every
// brain" (admins), in which case the list is nil.
func (s *Service) readableNamespaces(r *http.Request) (all bool, list []string) {
	ctx := r.Context()
	c := s.identify(r)
	switch {
	case c.admin:
		return true, nil
	case c.principal != nil:
		for ns := range c.principal.Namespaces {
			if s.oauthCan(ctx, c.principal, ns, false) {
				list = append(list, ns)
			}
		}
	case c.session:
		ms, _ := s.Store.MembershipsFor(ctx, c.userID)
		for _, m := range ms {
			list = append(list, m.Namespace)
		}
	case c.valid && c.agent != "":
		gs, _ := s.Store.Grants(ctx, c.agent)
		for _, g := range gs {
			if g.CanRead {
				list = append(list, g.Namespace)
			}
		}
	}
	return false, list
}

// --- brain_members -------------------------------------------------------------

// Membership is one user's role on one brain.
type Membership struct {
	Namespace string `json:"namespace"`
	UserID    string `json:"userId"`
	Role      string `json:"role"`
}

var validMemberRole = map[string]bool{"owner": true, "editor": true, "viewer": true}

// namespaceRE is the shape of a NEW brain name (existing ones are grandfathered).
var namespaceRE = regexp.MustCompile(`^[a-z0-9][a-z0-9_.-]{0,62}$`)

// MemberRole returns a user's role on a brain ("" if none).
func (s *Store) MemberRole(ctx context.Context, ns, userID string) (string, error) {
	db, err := s.db(ctx)
	if err != nil {
		return "", err
	}
	var role string
	err = db.QueryRowContext(ctx, `SELECT role FROM brain_members WHERE namespace=$1 AND user_id=$2`, ns, userID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return role, err
}

// MembershipsFor lists a user's brains.
func (s *Store) MembershipsFor(ctx context.Context, userID string) ([]Membership, error) {
	return s.members(ctx, `SELECT namespace, user_id, role FROM brain_members WHERE user_id=$1 ORDER BY namespace`, userID)
}

// Members lists a brain's members.
func (s *Store) Members(ctx context.Context, ns string) ([]Membership, error) {
	return s.members(ctx, `SELECT namespace, user_id, role FROM brain_members WHERE namespace=$1 ORDER BY role, user_id`, ns)
}

func (s *Store) members(ctx context.Context, q string, arg string) ([]Membership, error) {
	out := []Membership{}
	db, err := s.db(ctx)
	if err != nil {
		return out, err
	}
	rows, err := db.QueryContext(ctx, q, arg)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var m Membership
		if rows.Scan(&m.Namespace, &m.UserID, &m.Role) == nil {
			out = append(out, m)
		}
	}
	return out, rows.Err()
}

// SetMember upserts a membership.
func (s *Store) SetMember(ctx context.Context, ns, userID, role, by string) error {
	if ns == "" || userID == "" || !validMemberRole[role] {
		return ErrInvalidInput
	}
	db, err := s.db(ctx)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO brain_members (namespace, user_id, role, created_by) VALUES ($1,$2,$3,$4)
		ON CONFLICT (namespace, user_id) DO UPDATE SET role = EXCLUDED.role`, ns, userID, role, nullStr(by))
	return err
}

// RemoveMember deletes a membership, refusing to remove a brain's last owner.
func (s *Store) RemoveMember(ctx context.Context, ns, userID string) error {
	db, err := s.db(ctx)
	if err != nil {
		return err
	}
	var owners int
	_ = db.QueryRowContext(ctx, `SELECT count(*) FROM brain_members WHERE namespace=$1 AND role='owner' AND user_id<>$2`, ns, userID).Scan(&owners)
	role, _ := s.MemberRole(ctx, ns, userID)
	if role == "owner" && owners == 0 {
		return ErrLastOwner
	}
	res, err := db.ExecContext(ctx, `DELETE FROM brain_members WHERE namespace=$1 AND user_id=$2`, ns, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ErrLastOwner refuses to leave a brain without an owner.
var ErrLastOwner = errors.New("a brain must keep at least one owner")

// ErrBrainTaken is returned when claiming a brain that already exists.
var ErrBrainTaken = errors.New("that brain already exists")

// ClaimBrain makes userID the owner of a NEW brain. A brain "exists" once it has
// a member, a live memory or a note — an existing shared namespace (flowos, …)
// can never be claimed this way; an admin grants it instead.
func (s *Store) ClaimBrain(ctx context.Context, ns, userID string) error {
	if !namespaceRE.MatchString(ns) || userID == "" {
		return ErrInvalidInput
	}
	db, err := s.db(ctx)
	if err != nil {
		return err
	}
	var taken bool
	err = db.QueryRowContext(ctx, `
		SELECT EXISTS (SELECT 1 FROM brain_members WHERE namespace=$1)
		    OR EXISTS (SELECT 1 FROM memories WHERE namespace=$1 AND invalid_at IS NULL)
		    OR EXISTS (SELECT 1 FROM notes WHERE namespace=$1)`, ns).Scan(&taken)
	if err != nil {
		return err
	}
	if taken {
		return ErrBrainTaken
	}
	res, err := db.ExecContext(ctx, `
		INSERT INTO brain_members (namespace, user_id, role, created_by) VALUES ($1,$2,'owner',$2)
		ON CONFLICT DO NOTHING`, ns, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrBrainTaken
	}
	return nil
}

// userIDByEmail resolves an account by email (for "add member by email").
func (s *Store) userIDByEmail(ctx context.Context, email string) (string, error) {
	db, err := s.db(ctx)
	if err != nil {
		return "", err
	}
	var id string
	err = db.QueryRowContext(ctx, `SELECT id::text FROM users WHERE lower(email) = lower($1) LIMIT 1`, strings.TrimSpace(email)).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return id, err
}

// CheckNewBrain validates a new brain name and that no brain of that name exists.
func (s *Store) CheckNewBrain(ctx context.Context, ns string) error {
	if !namespaceRE.MatchString(ns) {
		return ErrInvalidInput
	}
	db, err := s.db(ctx)
	if err != nil {
		return err
	}
	var taken bool
	if err := db.QueryRowContext(ctx, brainExistsSQL, ns).Scan(&taken); err != nil {
		return err
	}
	if taken {
		return ErrBrainTaken
	}
	return nil
}

const brainExistsSQL = `
	SELECT EXISTS (SELECT 1 FROM brain_members WHERE namespace=$1)
	    OR EXISTS (SELECT 1 FROM memories WHERE namespace=$1 AND invalid_at IS NULL)
	    OR EXISTS (SELECT 1 FROM notes WHERE namespace=$1)`
