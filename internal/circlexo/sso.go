package circlexo

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strings"

	circlexo "github.com/circlexo/circlexo-go"
	"github.com/circlexo/circlexo-go/oidc"

	"github.com/fadymondy/zekra/internal/account"
)

/*
Sign in with CircleXO, next to (not instead of) Zekra's own login.

Callback rules, in order:
 1. a hub subject already linked to a Zekra user signs in as that user;
 2. otherwise the hub must vouch for the e-mail (email_verified): an unverified address is refused;
 3. a Zekra account with that address is linked, but only a "usable" one (see userByEmail:
    passwordless, or an address Zekra itself verified), so nobody can squat someone's address with
    a password and inherit their hub sign-in; anything else is refused;
 4. otherwise a passwordless Zekra account is created and linked.

A disabled or deleted account is refused in every case. The session is Zekra's normal one
(auth.IssueSession), so every existing login method keeps working alongside. Two things Zekra's own
sign-in enforces are deliberately not asked of a hub sign-in: ALLOW_REGISTRATION (the hub decides
who may use the app; a closed Zekra registration is about Zekra's own sign-up form) and Zekra's 2FA
(the hub is the identity provider and owns second factors).
*/

// Errors the login page can show, by code (?error=circlexo_<code>).
const (
	errFailed      = "failed"
	errUnverified  = "email_unverified"
	errUnlinkable  = "account_conflict"
	errSuspended   = "suspended"
	errNoEmail     = "no_email"
	errUnavailable = "unavailable"
)

// loginErr is a refusal with a code for the page.
type loginErr struct {
	code string
	err  error
}

func (e *loginErr) Error() string { return e.code + ": " + e.err.Error() }

// Code is the short refusal code the login page translates.
func (e *loginErr) Code() string { return e.code }

// LoginError is a refused sign-in, exported so callers and tests can read its code.
type LoginError = loginErr

func refuse(code, msg string) *loginErr { return &loginErr{code, errors.New(msg)} }

// launchHint is the pseudo local path /sso/circlexo hands the OIDC round trip so the org named by
// the hub's launch link survives it; the callback reads the org slug off it.
const launchHint = "/__cxo"

// Login starts the sign-in (GET /auth/circlexo/login[?return_to=/local/path]).
func (s *Service) Login(w http.ResponseWriter, r *http.Request) { s.RP.Login(w, r) }

// Launch is the hub's app launch URL (GET /sso/circlexo?org=<slug>): the hub sends people here from
// its dashboard. They are signed in at the hub already, so the round trip is silent.
func (s *Service) Launch(w http.ResponseWriter, r *http.Request) {
	q := url.Values{}
	if org := strings.TrimSpace(r.URL.Query().Get("org")); org != "" {
		q.Set("return_to", launchHint+"?org="+url.QueryEscape(org))
	}
	http.Redirect(w, r, LoginPath+"?"+q.Encode(), http.StatusFound)
}

// Callback completes the sign-in (GET /auth/circlexo/callback).
func (s *Service) Callback(w http.ResponseWriter, r *http.Request) {
	login, err := s.RP.Exchange(w, r)
	if err != nil {
		s.Log.Warn("circlexo: sign-in failed", "err", err)
		s.fail(w, r, errFailed)
		return
	}
	to, lerr := s.FinishLogin(r.Context(), w, login)
	if lerr != nil {
		s.Log.Warn("circlexo: sign-in refused", "code", lerr.code, "err", lerr.err)
		s.fail(w, r, lerr.code)
		return
	}
	http.Redirect(w, r, to, http.StatusFound)
}

func (s *Service) fail(w http.ResponseWriter, r *http.Request, code string) {
	http.Redirect(w, r, account.LoginPath()+"?error="+url.QueryEscape("circlexo_"+code), http.StatusFound)
}

func rawString(c *circlexo.Claims, key string) string {
	if c == nil {
		return ""
	}
	v, _ := c.Raw[key].(string)
	return v
}

func rawBool(c *circlexo.Claims, key string) bool {
	if c == nil {
		return false
	}
	switch v := c.Raw[key].(type) {
	case bool:
		return v
	case string:
		return v == "true"
	}
	return false
}

// FinishLogin turns a verified hub sign-in into a Zekra session and says where to land.
func (s *Service) FinishLogin(ctx context.Context, w http.ResponseWriter, l *oidc.Login) (string, *loginErr) {
	id := l.IDClaims
	if id == nil || id.Subject == "" {
		return "", refuse(errFailed, "no subject")
	}
	userID, lerr := s.linkedUser(ctx, l)
	if lerr != nil {
		return "", lerr
	}
	if !s.Acct.UserActive(ctx, userID) {
		return "", refuse(errSuspended, "the account is disabled or being deleted")
	}
	// The hub owns the person's address (MH-1149).
	s.SyncProfile(ctx, userID, id.Profile())

	to := s.landing(ctx, l, userID)

	email, err := s.emailOf(ctx, userID)
	if err != nil {
		return "", &loginErr{errUnavailable, err}
	}
	ident, err := s.Acct.Auth.FindOrCreateByEmail(ctx, email)
	if err != nil || ident.ID != userID {
		return "", refuse(errFailed, "could not start the session")
	}
	token, err := s.Acct.Auth.IssueSession(w, *ident)
	if err != nil {
		return "", refuse(errFailed, "could not start the session")
	}
	sid := l.AccessClaims.SessionID
	if sid == "" {
		sid = id.SessionID
	}
	s.recordSession(ctx, sid, userID, token)
	return to, nil
}

func (s *Service) emailOf(ctx context.Context, userID string) (string, error) {
	var email string
	err := s.DB.QueryRowContext(ctx, `SELECT email FROM users WHERE id = $1`, userID).Scan(&email)
	return email, err
}

// linkedUser is rules 1-4 of the header comment.
func (s *Service) linkedUser(ctx context.Context, l *oidc.Login) (string, *loginErr) {
	id := l.IDClaims
	if uid, err := s.UserBySubject(ctx, id.Subject); err == nil {
		return uid, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return "", &loginErr{errUnavailable, err}
	}

	email := norm(firstNonEmpty(rawString(id, "email"), rawString(l.AccessClaims, "email")))
	if email == "" {
		return "", refuse(errNoEmail, "the hub sent no e-mail address")
	}
	if !rawBool(id, "email_verified") && !rawBool(l.AccessClaims, "email_verified") {
		return "", refuse(errUnverified, "the hub has not verified this address")
	}

	uid, usable, err := s.userByEmail(ctx, email)
	switch {
	case err == nil:
		if !usable {
			return "", refuse(errUnlinkable, "an account with this address exists but has not confirmed it")
		}
		got, err := s.linkUser(ctx, id.Subject, uid, email, "email")
		if err != nil {
			return "", &loginErr{errUnavailable, err}
		}
		if got != uid {
			return "", refuse(errUnlinkable, "the account is already linked to another CircleXO user")
		}
		return uid, nil
	case !errors.Is(err, sql.ErrNoRows):
		return "", &loginErr{errUnavailable, err}
	}

	// A new passwordless account. The hub vouched for the address, so it counts as verified (there
	// is no account_unverified row for it).
	ident, err := s.Acct.Auth.FindOrCreateByEmail(ctx, email)
	if err != nil {
		return "", &loginErr{errUnavailable, err}
	}
	got, err := s.linkUser(ctx, id.Subject, ident.ID, email, "created")
	if err != nil {
		return "", &loginErr{errUnavailable, err}
	}
	if got != ident.ID {
		return "", refuse(errUnlinkable, "the account is already linked to another CircleXO user")
	}
	return got, nil
}

// landing joins the user to the org named by the token (or the launch link) and returns the page to
// open. It never fails the sign-in: a problem with the org side leaves the person signed in at
// Zekra's home, with the error logged.
func (s *Service) landing(ctx context.Context, l *oidc.Login, userID string) string {
	ac := l.AccessClaims
	orgID := ac.OrgID
	slugHint := ""
	if strings.HasPrefix(l.ReturnTo, launchHint) {
		v, _ := url.ParseQuery(strings.TrimPrefix(l.ReturnTo, launchHint+"?"))
		slugHint = v.Get("org")
	} else if l.ReturnTo != "" && orgID == "" {
		return account.SafeReturnPath(l.ReturnTo)
	}
	if orgID == "" && slugHint != "" {
		_ = s.DB.QueryRowContext(ctx, `SELECT org_id FROM circlexo_org_links WHERE org_slug = $1 AND status = 'active'`, slugHint).Scan(&orgID)
	}
	home := s.Acct.Landing(ctx, userID)
	if orgID == "" {
		return home
	}
	link, err := s.OrgByID(ctx, orgID)
	if errors.Is(err, sql.ErrNoRows) {
		// The hub installed the app but the webhook has not (or did not) arrive: provision now if
		// the hub confirms the org has the app and is still provisioning it. Once the install is
		// active, a missing link means the org was deleted in Zekra: tell the hub (it then shows
		// the app as not installed) instead of making a new one (MH-1149).
		t, terr := s.Client.TenantByOrg(ctx, orgID)
		if terr != nil {
			return home
		}
		if t.Status != "provisioning" {
			if t.ProductTenantID != "" {
				if _, err := s.Client.ReleaseTenant(ctx, orgID, t.ProductTenantID); err != nil {
					s.Log.Warn("circlexo: releasing a deleted org's tenant", "org", orgID, "err", err)
				}
			}
			return home
		}
		if link, err = s.Provision(ctx, ProvisionInput{OrgID: orgID, Slug: slugHint}); err != nil {
			s.Log.Error("circlexo: provisioning at sign-in", "org", orgID, "err", err)
			return home
		}
	} else if err != nil {
		s.Log.Error("circlexo: reading the org link", "org", orgID, "err", err)
		return home
	}
	if !link.Active {
		return home
	}
	if err := s.setMember(ctx, link, userID, ac.OrgRole); err != nil {
		s.Log.Error("circlexo: adding the member at sign-in", "org", orgID, "err", err)
	}
	return home
}

// Logout clears Zekra's session and continues to the hub's end-session, then back to the login
// page. Zekra's session is a stateless token, so this ends it in this browser only; a copy of the
// token stays valid until it expires or the user is signed out everywhere.
func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, account.ClearSessionCookie(account.SecureRequest(r)))
	s.RP.Logout(account.PublicURL()+account.LoginPath())(w, r)
}
