package account

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/togo-framework/auth"
)

/*
Connected accounts: which Google / Apple / GitHub identities sign in as a user
(ported from fadymondy's internal/server/identities.go).

	GET    /api/me/identities                 list — provider, email, created_at, last_used_at, can_unlink
	POST   /api/me/identities/{provider}      native link — Google id_token, Apple identity_token+nonce, GitHub one-time code
	DELETE /api/me/identities/{provider|id}   unlink — refused (409 last_method) when it is the last way to sign in

	GET /api/auth/{provider}?link=1&redirect=/…   web link — the provider's own flow in "link" mode;
	    returns to redirect with ?connected=<provider> or ?connect_error=<reason>&provider=<provider>

Sign-in resolution (resolveProviderUser), in order:
 1. the identity (provider, subject) is linked → that user;
 2. else the verified email matches a user → link it;
 3. else a new account, only while registration is open → link it.

A web link is bound to the session that started it by an HMAC-sealed ticket in
the sso_link cookie (key derived from AUTH_SECRET).
*/

const (
	linkCookie     = "sso_link"
	linkCookiePath = "/api/auth"
	linkTTL        = 10 * time.Minute
)

var ssoProviders = []string{"google", "apple", "github"}

var (
	errIdentityTaken      = errors.New("this account is already connected to a different user")
	errProviderLinked     = errors.New("a different account of this provider is already connected; disconnect it first")
	errLastMethod         = errors.New("this is your only way to sign in; set a password or connect another account first")
	errNoIdentity         = errors.New("not connected")
	errRegistrationClosed = errors.New("registration closed")
	errAccountDisabled    = errors.New("account disabled")
)

// ssoIdentity is what a provider proved: its stable id and the address it reported.
type ssoIdentity struct{ Provider, Subject, Email string }

func knownProvider(p string) bool {
	for _, x := range ssoProviders {
		if x == p {
			return true
		}
	}
	return false
}

// ---- store ----------------------------------------------------------------------

func (s *Service) identityOwner(ctx context.Context, provider, subject string) (string, bool, error) {
	var uid string
	err := s.DB.QueryRowContext(ctx, `SELECT user_id FROM auth_identities WHERE provider = $1 AND subject = $2`, provider, subject).Scan(&uid)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return uid, err == nil, err
}

func (s *Service) identityTouch(ctx context.Context, id ssoIdentity) {
	_, _ = s.DB.ExecContext(ctx, `UPDATE auth_identities SET last_used_at = $1, email = $2 WHERE provider = $3 AND subject = $4`,
		s.now().UTC(), id.Email, id.Provider, id.Subject)
}

func (s *Service) identityDrop(ctx context.Context, provider, subject string) {
	_, _ = s.DB.ExecContext(ctx, `DELETE FROM auth_identities WHERE provider = $1 AND subject = $2`, provider, subject)
}

// link attaches id to userID. Idempotent for the same user; errIdentityTaken when
// another user owns it; errProviderLinked when the user already has a different
// identity of the same provider.
func (s *Service) link(ctx context.Context, userID string, id ssoIdentity) error {
	if userID == "" || id.Subject == "" || !knownProvider(id.Provider) {
		return errors.New("incomplete identity")
	}
	owner, found, err := s.identityOwner(ctx, id.Provider, id.Subject)
	if err != nil {
		return err
	}
	if found {
		if owner != userID {
			return errIdentityTaken
		}
		s.identityTouch(ctx, id)
		return nil
	}
	var other string
	err = s.DB.QueryRowContext(ctx, `SELECT subject FROM auth_identities WHERE user_id = $1 AND provider = $2`, userID, id.Provider).Scan(&other)
	switch {
	case err == nil:
		return errProviderLinked
	case !errors.Is(err, sql.ErrNoRows):
		return err
	}
	now := s.now().UTC()
	_, insErr := s.DB.ExecContext(ctx, `
		INSERT INTO auth_identities (id, user_id, provider, subject, email, created_at, last_used_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (provider, subject) DO NOTHING`,
		randToken()[:32], userID, id.Provider, id.Subject, id.Email, now, now)
	// Re-read rather than trusting the insert: a concurrent link may have won.
	owner, found, err = s.identityOwner(ctx, id.Provider, id.Subject)
	switch {
	case err != nil:
		return err
	case found && owner == userID:
		return nil
	case found:
		return errIdentityTaken
	case insErr != nil:
		return insErr
	}
	return errors.New("link not stored")
}

type identityView struct {
	Provider   string  `json:"provider"`
	Email      string  `json:"email"`
	CreatedAt  string  `json:"created_at"`
	LastUsedAt *string `json:"last_used_at"`
	CanUnlink  bool    `json:"can_unlink"`
}

type identityRow struct {
	id, provider, email string
	created, lastUsed   sql.NullTime
}

func (s *Service) identityRows(ctx context.Context, userID string) ([]identityRow, error) {
	rs, err := s.DB.QueryContext(ctx,
		`SELECT id, provider, email, created_at, last_used_at FROM auth_identities WHERE user_id = $1 ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rs.Close()
	var out []identityRow
	for rs.Next() {
		var r identityRow
		if err := rs.Scan(&r.id, &r.provider, &r.email, &r.created, &r.lastUsed); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rs.Err()
}

// hasPassword: SSO-created accounts carry the "!sso" marker, never a bcrypt hash.
func (s *Service) hasPassword(ctx context.Context, userID string) (bool, error) {
	var hash string
	if err := s.DB.QueryRowContext(ctx, `SELECT password_hash FROM users WHERE id = $1`, userID).Scan(&hash); err != nil {
		return false, err
	}
	return strings.HasPrefix(hash, "$2"), nil
}

// listIdentities never selects the subject, so it cannot leak it.
func (s *Service) listIdentities(ctx context.Context, userID string) ([]identityView, error) {
	rows, err := s.identityRows(ctx, userID)
	if err != nil {
		return nil, err
	}
	pw, err := s.hasPassword(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]identityView, 0, len(rows))
	for _, r := range rows {
		v := identityView{Provider: r.provider, Email: r.email, CanUnlink: pw || len(rows) > 1}
		if r.created.Valid {
			v.CreatedAt = r.created.Time.UTC().Format(time.RFC3339)
		}
		if r.lastUsed.Valid {
			t := r.lastUsed.Time.UTC().Format(time.RFC3339)
			v.LastUsedAt = &t
		}
		out = append(out, v)
	}
	return out, nil
}

func (s *Service) unlink(ctx context.Context, userID, ref string) error {
	rows, err := s.identityRows(ctx, userID)
	if err != nil {
		return err
	}
	target := ""
	for _, r := range rows {
		if r.provider == ref || r.id == ref {
			target = r.id
		}
	}
	if target == "" {
		return errNoIdentity
	}
	if len(rows) < 2 {
		pw, err := s.hasPassword(ctx, userID)
		if err != nil {
			return err
		}
		if !pw {
			return errLastMethod
		}
	}
	_, err = s.DB.ExecContext(ctx, `DELETE FROM auth_identities WHERE id = $1 AND user_id = $2`, target, userID)
	return err
}

// ---- sign-in resolution ------------------------------------------------------------

// resolveSSOUser links by email, case-insensitively, and never creates a second
// user for an address that already exists in any case. created reports a new account.
func (s *Service) resolveSSOUser(ctx context.Context, email string) (*auth.Identity, bool, error) {
	email = strings.TrimSpace(email)
	if email == "" {
		return nil, false, errors.New("no email")
	}
	created := false
	var stored string
	err := s.DB.QueryRowContext(ctx, `SELECT email FROM users WHERE lower(email) = lower($1) ORDER BY created_at LIMIT 1`, email).Scan(&stored)
	switch {
	case err == nil:
		email = stored // the existing row's exact spelling, so FindOrCreate finds it
	case errors.Is(err, sql.ErrNoRows):
		if !allowRegistration() {
			return nil, false, errRegistrationClosed
		}
		email = strings.ToLower(email)
		created = true
	default:
		return nil, false, err
	}
	// Existing: returns it with its roles. New: passwordless ("!sso"), roles "".
	id, err := s.Auth.FindOrCreateByEmail(ctx, email)
	return id, created, err
}

// resolveProviderUser: identity link, then verified email (and link), then a new
// account while registration is open (and link). A store error on the identity
// lookup falls back to the email match rather than breaking sign-in.
func (s *Service) resolveProviderUser(ctx context.Context, pid ssoIdentity) (*auth.Identity, bool, error) {
	if s.Auth == nil {
		return nil, false, ErrUnavailable
	}
	var id *auth.Identity
	created := false
	if pid.Subject != "" {
		if uid, ok, err := s.identityOwner(ctx, pid.Provider, pid.Subject); err == nil && ok {
			if g := s.Auth.Guard(""); g != nil {
				if u, err := g.Auth.ByID(ctx, uid); err == nil && u != nil && u.ID != "" {
					s.identityTouch(ctx, pid)
					id = u
				}
			}
			if id == nil {
				s.identityDrop(ctx, pid.Provider, pid.Subject) // its user is gone
			}
		}
	}
	if id == nil {
		var err error
		id, created, err = s.resolveSSOUser(ctx, pid.Email)
		if err != nil {
			return nil, false, err
		}
		if pid.Subject != "" {
			_ = s.link(ctx, id.ID, pid) // best effort; errProviderLinked still signs in by email
		}
	}
	if s.disabled(ctx, id.ID) {
		return nil, false, errAccountDisabled
	}
	if roles, ok := s.freshRoles(ctx, id); ok {
		id.Roles = roles
	}
	return id, created, nil
}

// ---- web link flow -------------------------------------------------------------

type linkTicket struct {
	Provider, State, UserID string
	App                     bool
}

var (
	linkKeyOnce sync.Once
	linkKeyVal  []byte
)

func linkKey() []byte {
	linkKeyOnce.Do(func() {
		secret := firstEnv("AUTH_SECRET", "JWT_SECRET")
		if secret == "" { // dev without a secret: valid for this process only
			b := make([]byte, 32)
			_, _ = rand.Read(b)
			secret = hex.EncodeToString(b)
		}
		sum := sha256.Sum256([]byte("zekra/identity-link\x00" + secret))
		linkKeyVal = sum[:]
	})
	return linkKeyVal
}

func sealTicket(t linkTicket) string {
	app := "0"
	if t.App {
		app = "1"
	}
	payload := t.Provider + "|" + t.State + "|" + t.UserID + "|" + app
	m := hmac.New(sha256.New, linkKey())
	m.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + hex.EncodeToString(m.Sum(nil))
}

func openTicket(v string) (linkTicket, bool) {
	i := strings.LastIndexByte(v, '.')
	if i <= 0 {
		return linkTicket{}, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(v[:i])
	if err != nil {
		return linkTicket{}, false
	}
	m := hmac.New(sha256.New, linkKey())
	m.Write(raw)
	if !hmac.Equal([]byte(hex.EncodeToString(m.Sum(nil))), []byte(v[i+1:])) {
		return linkTicket{}, false
	}
	p := strings.Split(string(raw), "|")
	if len(p) != 4 {
		return linkTicket{}, false
	}
	return linkTicket{Provider: p[0], State: p[1], UserID: p[2], App: p[3] == "1"}, true
}

func setLinkCookie(w http.ResponseWriter, value string, secure bool) {
	maxAge := int(linkTTL.Seconds())
	if value == "" {
		maxAge = -1
	}
	sameSite := http.SameSiteLaxMode
	if secure {
		sameSite = http.SameSiteNoneMode // must survive Apple's cross-site form_post
	}
	http.SetCookie(w, &http.Cookie{ //#nosec G124 -- HttpOnly, path-scoped, HMAC-sealed; SameSite=None only with Secure
		Name: linkCookie, Value: value, Path: linkCookiePath, HttpOnly: true,
		Secure: secure, SameSite: sameSite, MaxAge: maxAge,
	})
}

// readLink returns the ticket only when it opens and belongs to this provider's
// flow with this state.
func readLink(r *http.Request, provider, state string) *linkTicket {
	c, err := r.Cookie(linkCookie)
	if err != nil || state == "" {
		return nil
	}
	t, ok := openTicket(c.Value)
	if !ok || t.Provider != provider || subtle.ConstantTimeCompare([]byte(t.State), []byte(state)) != 1 {
		return nil
	}
	return &t
}

// startLink is called by a provider's start handler in link mode. It requires a
// session (web) and sets the sealed ticket; false means it already answered.
func (s *Service) startLink(w http.ResponseWriter, r *http.Request, provider, state, ret string, secure, app bool) bool {
	t := linkTicket{Provider: provider, State: state, App: app}
	if !app {
		me := sessionIdentity(s.Auth, r)
		if me == nil {
			linkDone(w, r, ret, provider, "signin", http.StatusFound)
			return false
		}
		t.UserID = me.ID
	}
	setLinkCookie(w, sealTicket(t), secure)
	return true
}

// finishWebLink attaches pid to the ticket's user and returns to ret.
func (s *Service) finishWebLink(w http.ResponseWriter, r *http.Request, t *linkTicket, pid ssoIdentity, ret string, requireSession bool, status int) {
	cur := sessionIdentity(s.Auth, r)
	if (requireSession && cur == nil) || (cur != nil && cur.ID != t.UserID) {
		linkDone(w, r, ret, pid.Provider, "session", status)
		return
	}
	linkDone(w, r, ret, pid.Provider, linkErrReason(s.link(r.Context(), t.UserID, pid)), status)
}

func linkErrReason(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, errIdentityTaken):
		return "conflict"
	case errors.Is(err, errProviderLinked):
		return "taken"
	}
	return "failed"
}

// linkFailReason maps a sign-in failure key (google_cancelled, apple_state, …) to
// the link reason the profile page shows.
func linkFailReason(provider, key string) string {
	switch strings.TrimPrefix(strings.TrimPrefix(key, provider), "_") {
	case "cancelled":
		return "cancelled"
	case "state":
		return "state"
	case "email":
		return "email"
	}
	return "failed"
}

func linkDone(w http.ResponseWriter, r *http.Request, ret, provider, reason string, status int) {
	if ret == "" {
		ret = "/"
	}
	u := ret
	if reason == "" {
		u = withQueryParam(u, "connected", provider)
	} else {
		u = withQueryParam(withQueryParam(u, "connect_error", reason), "provider", provider)
	}
	http.Redirect(w, r, u, status)
}

// ---- /api/me/identities ---------------------------------------------------------

// RegisterIdentities mounts list and unlink (the link legs live in the providers).
func (s *Service) RegisterIdentities(router chi.Router) {
	router.Get("/api/me/identities", s.handleIdentityList)
	router.Delete("/api/me/identities/{ref}", s.handleUnlink)
}

func (s *Service) handleIdentityList(w http.ResponseWriter, r *http.Request) {
	me, ok := auth.IdentityFrom(r.Context())
	if !ok || me == nil || me.ID == "" {
		writeJSONErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	list, err := s.listIdentities(r.Context(), me.ID)
	if err != nil {
		writeJSONErr(w, http.StatusInternalServerError, "could not load connected accounts")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, list)
}

func (s *Service) handleUnlink(w http.ResponseWriter, r *http.Request) {
	me, ok := auth.IdentityFrom(r.Context())
	if !ok || me == nil || me.ID == "" {
		writeJSONErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if !csrfOK(r) {
		writeJSONErr(w, http.StatusForbidden, "invalid csrf token")
		return
	}
	switch err := s.unlink(r.Context(), me.ID, chi.URLParam(r, "ref")); {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, errNoIdentity):
		writeJSONErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, errLastMethod):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error(), "code": "last_method"})
	default:
		writeJSONErr(w, http.StatusInternalServerError, "could not disconnect")
	}
}

// linkForRequest attaches pid to the caller (bearer, or cookie + CSRF).
func (s *Service) linkForRequest(w http.ResponseWriter, r *http.Request, pid ssoIdentity) {
	me, ok := auth.IdentityFrom(r.Context())
	if !ok || me == nil || me.ID == "" {
		writeJSONErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	switch err := s.link(r.Context(), me.ID, pid); {
	case err == nil:
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, map[string]string{"provider": pid.Provider, "email": pid.Email})
	case errors.Is(err, errIdentityTaken):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error(), "code": "conflict"})
	case errors.Is(err, errProviderLinked):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error(), "code": "taken"})
	default:
		writeJSONErr(w, http.StatusInternalServerError, "could not connect the account")
	}
}

// linkPreflight runs before a native link handler verifies anything.
func linkPreflight(w http.ResponseWriter, r *http.Request) bool {
	if me, ok := auth.IdentityFrom(r.Context()); !ok || me == nil || me.ID == "" {
		writeJSONErr(w, http.StatusUnauthorized, "unauthorized")
		return false
	}
	if !csrfOK(r) {
		writeJSONErr(w, http.StatusForbidden, "invalid csrf token")
		return false
	}
	return true
}

// ---- helpers ----------------------------------------------------------------------

// safeReturnPath accepts only a same-origin absolute path.
func safeReturnPath(p string) string {
	if p == "" || len(p) > 512 || p[0] != '/' {
		return ""
	}
	if strings.HasPrefix(p, "//") || strings.HasPrefix(p, "/\\") {
		return ""
	}
	for _, c := range p {
		if c < 0x20 || c == 0x7f || c == '\\' {
			return ""
		}
	}
	if u, err := url.Parse(p); err != nil || u.Scheme != "" || u.Host != "" {
		return ""
	}
	return p
}

func withQueryParam(raw, k, v string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	q := u.Query()
	q.Set(k, v)
	u.RawQuery = q.Encode()
	return u.String()
}

func forwardedHost(r *http.Request) string {
	h := r.Header.Get("X-Forwarded-Host")
	if i := strings.IndexByte(h, ','); i >= 0 {
		h = h[:i]
	}
	return strings.TrimSpace(h)
}

// bounceToCallbackOrigin sends a visitor who started on another host once to the
// callback's origin, so the flow cookie lands on the host the provider returns to.
func bounceToCallbackOrigin(w http.ResponseWriter, r *http.Request, callbackURL, startPath string, params url.Values, hostFallback bool) bool {
	cb, err := url.Parse(callbackURL)
	if err != nil || cb.Host == "" || r.URL.Query().Get("b") != "" {
		return false
	}
	h := forwardedHost(r)
	if h == "" && hostFallback {
		h = r.Host
	}
	if h == "" || strings.EqualFold(h, cb.Host) {
		return false
	}
	q := url.Values{"b": {"1"}}
	for k, v := range params {
		q[k] = v
	}
	http.Redirect(w, r, cb.Scheme+"://"+cb.Host+startPath+"?"+q.Encode(), http.StatusFound)
	return true
}

func unb64(s string) string {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return ""
	}
	return string(b)
}

// afterSignIn is where a completed OAuth sign-in lands when no redirect was asked
// for (fadymondy: admins/owners to /dashboard, everyone else to /).
func afterSignIn(id *auth.Identity) string {
	if isAdmin(id) {
		if p := firstEnv("AUTH_ADMIN_HOME"); strings.HasPrefix(p, "/") {
			return p
		}
		return "/dashboard"
	}
	if p := firstEnv("AUTH_HOME"); strings.HasPrefix(p, "/") {
		return p
	}
	return "/"
}

func failRedirect(reason string) string {
	return loginPath() + "?error=" + url.QueryEscape(reason)
}
