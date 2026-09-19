/*
Package account is Zekra's account backend around the togo auth plugin, ported
from fadymondy.com-v2 (internal/account, internal/server/{google,apple,github,
identities,roles}.go, internal/rest/account_*.go) so the Next.js console can
reproduce fadymondy's auth cycle 1:1.

The auth plugin keeps owning the users table, passwords, JWTs, the session
cookie (togo_session), CSRF (togo_csrf), and its own routes. This package wraps
and extends it:

  - register/login: email verification (403 email_unverified), the 2FA
    challenge (401 2fa_required), disabled accounts (403 account_disabled);
  - emailed codes: verify-email, password forgot/reset, sign-in by code;
  - TOTP two-factor with recovery codes (/api/me/2fa*);
  - Sign in with Google, Apple and GitHub, and linked accounts (/api/me/identities);
  - the account area (/api/me/account/*), deletion (/api/me/delete*), data export;
  - admin user management (/api/admin/*), roles read fresh from the users table;
  - session revocation lists for stateless JWTs (password reset, deletion,
    admin "sign out everywhere", disable).

Postgres only (the SQL uses $n placeholders and now()), like the brain plugin.
*/
package account

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/togo-framework/auth"
)

// Service is the account runtime. Send and Now are replaceable in tests.
type Service struct {
	DB   *sql.DB
	Log  *slog.Logger
	Auth *auth.Service
	Send func(ctx context.Context, msg Message) error
	Now  func() time.Time
}

// ErrUnavailable is returned when the database or the auth service is missing.
var ErrUnavailable = errors.New("account service unavailable")

func (s *Service) now() time.Time {
	if s.Now == nil {
		return time.Now()
	}
	return s.Now()
}

func (s *Service) log() *slog.Logger {
	if s.Log == nil {
		return slog.Default()
	}
	return s.Log
}

func (s *Service) ready() bool { return s != nil && s.DB != nil }

// ---- environment ------------------------------------------------------------

func isProductionEnv() bool {
	for _, k := range []string{"APP_ENV", "ENV", "TOGO_ENV"} {
		switch strings.ToLower(os.Getenv(k)) {
		case "production", "prod":
			return true
		}
	}
	return false
}

// allowRegistration: open unless ALLOW_REGISTRATION is an explicit off value.
func allowRegistration() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("ALLOW_REGISTRATION"))) {
	case "false", "0", "no", "off":
		return false
	}
	return true
}

func minPassword() int {
	if v, err := strconv.Atoi(os.Getenv("AUTH_MIN_PASSWORD")); err == nil && v > 0 {
		return v
	}
	return 8
}

// publicURL is the public origin used for OAuth callbacks and links in email:
// AUTH_PUBLIC_URL, else APP_URL.
func publicURL() string {
	for _, k := range []string{"AUTH_PUBLIC_URL", "APP_URL"} {
		if v := strings.TrimRight(strings.TrimSpace(os.Getenv(k)), "/"); v != "" {
			return v
		}
	}
	return ""
}

// loginPath is the console's sign-in page; OAuth failures land on it with ?error=.
func loginPath() string {
	if p := strings.TrimSpace(os.Getenv("AUTH_LOGIN_PATH")); strings.HasPrefix(p, "/") {
		return p
	}
	return "/login"
}

func firstEnv(keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v
		}
	}
	return ""
}

// ---- HTTP helpers -------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeJSONErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func clientIP(r *http.Request) string {
	if ip := r.Header.Get("CF-Connecting-IP"); ip != "" {
		return ip
	}
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		return strings.TrimSpace(strings.Split(fwd, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// csrfOK is the auth plugin's double-submit rule for cookie-authenticated unsafe
// requests; bearer requests are not CSRF-prone.
func csrfOK(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}
	return csrfValues(r.Header.Get("Authorization"), r.Header.Get("X-CSRF-Token"), cookieValue(r, "togo_csrf"))
}

func csrfValues(authorization, header, cookie string) bool {
	if strings.HasPrefix(authorization, "Bearer ") && len(authorization) > 7 {
		return true
	}
	return header != "" && cookie != "" && subtle.ConstantTimeCompare([]byte(cookie), []byte(header)) == 1
}

// constantEq compares two non-empty secrets in constant time.
func constantEq(a, b string) bool {
	return a != "" && b != "" && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func cookieValue(r *http.Request, name string) string {
	if c, err := r.Cookie(name); err == nil {
		return c.Value
	}
	return ""
}

// ClearSessionCookie deletes the session cookie, mirroring the plugin's attributes.
func ClearSessionCookie(secure bool) *http.Cookie {
	return &http.Cookie{ //#nosec G124 -- deleting the session cookie; attributes mirror the auth plugin
		Name: auth.SessionCookie, Value: "", Path: "/",
		HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode, MaxAge: -1,
	}
}

func secureRequest(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func presentedToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(h[len("Bearer "):])
	}
	return cookieValue(r, auth.SessionCookie)
}

// sessionIdentity resolves the caller through the auth plugin's own middleware,
// so it can never be weaker than /api/auth/me.
func sessionIdentity(svc *auth.Service, r *http.Request) *auth.Identity {
	if svc == nil {
		return nil
	}
	var id *auth.Identity
	svc.Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		id, _ = auth.IdentityFrom(r.Context())
	})).ServeHTTP(discard{h: http.Header{}}, r)
	if id == nil || id.ID == "" {
		return nil
	}
	return id
}

type discard struct{ h http.Header }

func (d discard) Header() http.Header         { return d.h }
func (d discard) Write(b []byte) (int, error) { return len(b), nil }
func (d discard) WriteHeader(int)             {}

func withoutCredentials(r *http.Request) *http.Request {
	out := r.Clone(r.Context())
	out.Header.Del("Authorization")
	out.Header.Del("Cookie")
	for _, c := range r.Cookies() {
		if c.Name != auth.SessionCookie {
			out.AddCookie(c)
		}
	}
	return out
}

// ---- small helpers ------------------------------------------------------------

func normEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func emailHash(email string) string {
	sum := sha256.Sum256([]byte(normEmail(email)))
	return hex.EncodeToString(sum[:])
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic("account: no randomness available: " + err.Error())
	}
	return hex.EncodeToString(b)
}

func randToken() string { return randomHex(32) }

func splitCSV(s string) []string {
	out := []string{}
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func hasRole(roles []string, want ...string) bool {
	for _, r := range roles {
		for _, w := range want {
			if r == w {
				return true
			}
		}
	}
	return false
}

// isAdmin: the admin tier is `admin` or `owner`, as in fadymondy's roles.go.
func isAdmin(id *auth.Identity) bool {
	return id != nil && hasRole(id.Roles, "admin", "owner")
}

type tokenClaims struct {
	Sub string `json:"sub"`
	Iat int64  `json:"iat"`
}

// peekClaims reads a JWT's subject and issue time WITHOUT verifying it. Only call
// it on a token already verified by the auth middleware or read from our own
// session store.
func peekClaims(token string) (tokenClaims, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return tokenClaims{}, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return tokenClaims{}, false
	}
	var c tokenClaims
	if json.Unmarshal(raw, &c) != nil {
		return tokenClaims{}, false
	}
	return c, true
}

// tableExists guards the auth plugin's optional tables (auth_sessions only exists
// under SESSION_DRIVER=database).
func (s *Service) tableExists(ctx context.Context, name string) bool {
	var n int
	err := s.DB.QueryRowContext(ctx,
		`SELECT count(*) FROM information_schema.tables WHERE table_schema = ANY (current_schemas(false)) AND table_name = $1`, name).Scan(&n)
	return err == nil && n > 0
}

func (s *Service) execCount(ctx context.Context, query string, args ...any) (int, error) {
	res, err := s.DB.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, err
	}
	n, err := res.RowsAffected()
	return int(n), err
}

// ---- rate limiting ------------------------------------------------------------

type limiter struct {
	mu     sync.Mutex
	hits   map[string][]time.Time
	max    int
	window time.Duration
}

func newLimiter(max int, window time.Duration) *limiter {
	return &limiter{hits: map[string][]time.Time{}, max: max, window: window}
}

func (l *limiter) allow(key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.hits) > 10000 {
		for k, ts := range l.hits {
			if len(ts) == 0 || now.Sub(ts[len(ts)-1]) > l.window {
				delete(l.hits, k)
			}
		}
	}
	kept := l.hits[key][:0]
	for _, at := range l.hits[key] {
		if now.Sub(at) < l.window {
			kept = append(kept, at)
		}
	}
	if len(kept) >= l.max {
		l.hits[key] = kept
		return false
	}
	l.hits[key] = append(kept, now)
	return true
}

// ---- audit ----------------------------------------------------------------------

// Meta is who-and-where for the audit trail.
type Meta struct {
	RequestID string
	IP        string
}

// Entry is one account_audit row.
type Entry struct {
	Actor   string
	Action  string
	Subject string
	Meta    Meta
	Details map[string]any
}

// Audit writes an audit entry. A failed write is logged, never returned.
func (s *Service) Audit(ctx context.Context, e Entry) {
	if !s.ready() {
		return
	}
	details := []byte("{}")
	if e.Details != nil {
		if raw, err := json.Marshal(e.Details); err == nil {
			details = raw
		}
	}
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO account_audit (actor_id, action, subject, request_id, ip, details) VALUES ($1,$2,$3,$4,$5,$6)`,
		e.Actor, e.Action, e.Subject, e.Meta.RequestID, e.Meta.IP, string(details)); err != nil {
		s.log().Error("account audit entry not written", "action", e.Action, "subject", e.Subject, "err", err)
	}
}

func metaOf(r *http.Request) Meta {
	rid := strings.TrimSpace(r.Header.Get("X-Request-Id"))
	if rid == "" || len(rid) > 128 {
		rid = randomHex(12)
	}
	return Meta{RequestID: rid, IP: clientIP(r)}
}
