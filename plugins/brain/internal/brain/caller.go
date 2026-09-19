package brain

import (
	"context"
	"net/http"
	"os"
)

// caller is the resolved identity of a request.
type caller struct {
	agent string
	admin bool // admin bypasses grants and membership
	valid bool // a presented credential resolved (or no credential needed)

	principal *Principal // OAuth-connected MCP client (never admin)
	session   bool       // a signed-in user (cookie / bearer session JWT)
	userID    string
	roles     []string
}

type callerKey struct{}

// withCaller resolves the caller once per request and caches it in the context,
// so the many canRead/canWrite checks a handler makes cost one resolution.
func (s *Service) withCaller(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c := s.resolveCaller(r)
		h(w, r.WithContext(context.WithValue(r.Context(), callerKey{}, &c)))
	}
}

// identify returns the request's caller (cached by withCaller when present).
func (s *Service) identify(r *http.Request) caller {
	if c, ok := r.Context().Value(callerKey{}).(*caller); ok && c != nil {
		return *c
	}
	return s.resolveCaller(r)
}

// authRequiredEnv mirrors the plugin's ZEKRA_REQUIRE_AUTH gate.
func authRequiredEnv() bool {
	v := os.Getenv("ZEKRA_REQUIRE_AUTH")
	return v == "1" || v == "true"
}

// resolveCaller, in order:
//
//  1. an OAuth principal in the context (remote MCP; set in-process only);
//  2. the X-Zekra-Token ACL token (unchanged: admin tokens bypass grants, others
//     need namespace_grants rows; a bad token is denied);
//  3. a signed-in user: admin/owner-role accounts are admin, everyone else is
//     limited to the brains they are a member of (brain_members);
//  4. no credential: the trusted local console ONLY when neither ZEKRA_REQUIRE_AUTH
//     nor ZEKRA_REQUIRE_TOKEN is set. With either set, an anonymous caller gets
//     nothing (it previously got admin whenever ZEKRA_REQUIRE_TOKEN was unset,
//     which made every signed-in account an admin of every brain).
func (s *Service) resolveCaller(r *http.Request) caller {
	if p := PrincipalFrom(r.Context()); p != nil {
		return caller{agent: p.agentLabel(), valid: true, principal: p, userID: p.UserID}
	}
	if tok := TokenHeader(r.Header); tok != "" {
		if agent, admin, ok := s.Store.ResolveToken(r.Context(), tok); ok {
			return caller{agent: agent, admin: admin, valid: true}
		}
		return caller{valid: false} // bad/revoked token → deny
	}
	if uid, roles, ok := s.sessionUser(r); ok && uid != "" {
		agent := r.Header.Get("X-Agent-Id")
		if agent == "" {
			agent = "user:" + uid
		}
		return caller{agent: agent, admin: isAdminRole(roles), valid: true, session: true, userID: uid, roles: roles}
	}
	agent := r.Header.Get("X-Agent-Id")
	if authRequiredEnv() {
		return caller{} // auth is required and nothing authenticated: no access
	}
	// No credential, no enforcement: a bare X-Agent-Id is only an activity label,
	// not a credential, so the tokenless caller is the trusted local console/MCP.
	if os.Getenv("ZEKRA_REQUIRE_TOKEN") != "1" {
		return caller{agent: agent, admin: true, valid: true}
	}
	// Token enforcement ON + no token → must be a known, granted agent (never admin).
	return caller{agent: agent, valid: agent != ""}
}

// ValidToken reports whether a raw token resolves to a live (non-revoked) token.
// Used by the security gate to let MCP callers (who present X-Zekra-Token, not a
// login session) through when console auth enforcement is on.
func (s *Service) ValidToken(ctx context.Context, tok string) bool {
	_, _, ok := s.Store.ResolveToken(ctx, tok)
	return ok
}

func (s *Service) canRead(r *http.Request, ns string) bool {
	return s.can(r, ns, false)
}

func (s *Service) canWrite(r *http.Request, ns string) bool {
	return s.can(r, ns, true)
}

func (s *Service) can(r *http.Request, ns string, write bool) bool {
	if ns == "" {
		return false
	}
	c := s.identify(r)
	ctx := r.Context()
	switch {
	case c.admin:
		return true
	case c.principal != nil:
		return s.oauthCan(ctx, c.principal, ns, write)
	case c.session:
		rd, wr := s.Store.userAccess(ctx, c.userID, c.roles, ns)
		if write {
			return wr
		}
		return rd
	case !c.valid || c.agent == "":
		return false
	case write:
		ok, _ := s.Store.CanWrite(ctx, c.agent, ns)
		return ok
	default:
		ok, _ := s.Store.CanRead(ctx, c.agent, ns)
		return ok
	}
}

// canAdmin gates brain-level administration (delete the brain, share it, manage
// members): admins; a signed-in brain OWNER; a scoped ACL token keeps its
// existing rule (write grant). OAuth-connected apps never administer.
func (s *Service) canAdmin(r *http.Request, ns string) bool {
	if ns == "" {
		return false
	}
	c := s.identify(r)
	switch {
	case c.admin:
		return true
	case c.principal != nil:
		return false
	case c.session:
		role, _ := s.Store.MemberRole(r.Context(), ns, c.userID)
		return role == "owner"
	default:
		return s.canWrite(r, ns)
	}
}

// canWriteOrClaim is canWrite, except that a signed-in user writing into a brain
// that does not exist yet becomes its owner (creator = owner).
func (s *Service) canWriteOrClaim(r *http.Request, ns string) bool {
	if s.canWrite(r, ns) {
		return true
	}
	c := s.identify(r)
	if !c.session || c.userID == "" {
		return false
	}
	if err := s.Store.ClaimBrain(r.Context(), ns, c.userID); err != nil {
		return false
	}
	return s.canWrite(r, ns)
}
