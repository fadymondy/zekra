package account

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/togo-framework/auth"
	"github.com/togo-framework/togo"
	"golang.org/x/crypto/bcrypt"

	"github.com/fadymondy/zekra/internal/account/schema"
)

/*
End-to-end flows on a real Postgres, ported from fadymondy's signup_test.go and
twofactor_test.go. Skipped unless TEST_DATABASE_URL is set, e.g.

	TEST_DATABASE_URL='postgres://…/zekra_test?sslmode=disable' go test ./internal/account -run Flow

Use a throwaway database: the schema is applied and rows are created (and removed).
*/

var sixDigits = regexp.MustCompile(`\b(\d{6})\b`)

type mailbox struct {
	mu   sync.Mutex
	sent []Message
}

func (m *mailbox) send(_ context.Context, msg Message) error {
	m.mu.Lock()
	m.sent = append(m.sent, msg)
	m.mu.Unlock()
	return nil
}

func (m *mailbox) lastCode(t *testing.T) string {
	t.Helper()
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.sent) == 0 {
		t.Fatal("no email was sent")
	}
	c := sixDigits.FindStringSubmatch(strings.ReplaceAll(m.sent[len(m.sent)-1].Text, " ", ""))
	if c == nil {
		t.Fatalf("no code in %q", m.sent[len(m.sent)-1].Text)
	}
	return c[1]
}

func (m *mailbox) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sent)
}

// testService boots a kernel with only the auth plugin (and the mail plugin this
// package imports) against TEST_DATABASE_URL.
func testService(t *testing.T) (*Service, *mailbox, *auth.Service) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no database configured; set TEST_DATABASE_URL to run the end-to-end flows")
	}
	t.Setenv("DB_DRIVER", "pgx")
	t.Setenv("DATABASE_URL", dsn)
	t.Setenv("VAULT_KEY", strings.Repeat("ab", 32))
	t.Setenv("AUTH_SECRET", strings.Repeat("s", 40))
	k := togo.New()
	t.Cleanup(k.Close)
	db, err := k.SQL(context.Background())
	if err != nil {
		t.Skipf("database unavailable: %v", err)
	}
	for pass := 1; pass <= 2; pass++ {
		if err := schema.Migrate(context.Background(), db); err != nil {
			t.Fatalf("schema pass %d (must be idempotent): %v", pass, err)
		}
	}
	svc, ok := auth.FromKernel(k)
	if !ok {
		t.Skip("auth plugin not registered")
	}
	mb := &mailbox{}
	return &Service{DB: db, Log: slog.Default(), Auth: svc, Send: mb.send, Now: time.Now}, mb, svc
}

func postJSON(h http.Handler, path string, body any, mut ...func(*http.Request)) (*httptest.ResponseRecorder, map[string]any) {
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	for _, m := range mut {
		m(req)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

// Register -> no session and a code; sign-in refused until verified; the code
// verifies and signs in; forgot -> reset -> new password works, old does not,
// and earlier sessions are refused.
func TestFlowSignupVerifyAndReset(t *testing.T) {
	s, mb, _ := testService(t)
	stamp := time.Now().Format("150405.000000")
	email, userID := "zk-signup-"+stamp+"@example.test", "zk-signup-"+stamp
	t.Cleanup(func() { _, _ = s.PurgeUser(context.Background(), userID, email) })

	// Stands in for the auth plugin: register creates the user and sets a session
	// cookie; login answers 200 with the user.
	plugin := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth/register":
			hash, _ := bcrypt.GenerateFromPassword([]byte("first-password"), bcrypt.MinCost)
			if _, err := s.DB.Exec(`INSERT INTO users (id, email, password_hash, roles, permissions, created_at) VALUES ($1,$2,$3,'','',$4)`,
				userID, email, string(hash), time.Now().UTC().Format(time.RFC3339)); err != nil {
				t.Fatalf("plugin insert: %v", err)
			}
			http.SetCookie(w, &http.Cookie{Name: auth.SessionCookie, Value: "should-not-leak"})
			writeJSON(w, http.StatusCreated, map[string]any{"token": "should-not-leak", "user": map[string]string{"id": userID, "email": email}})
		default:
			writeJSON(w, http.StatusOK, map[string]any{"token": "session", "user": map[string]any{"id": userID, "email": email, "roles": []string{}}})
		}
	})
	h := s.SignupMiddleware(plugin)
	endpoints := http.NewServeMux()
	s.RegisterSignup(func(p string, fn http.HandlerFunc) { endpoints.HandleFunc(p, fn) })

	// 1. Register: 403 email_unverified, no token, the cookie cleared, a code sent.
	rec, body := postJSON(h, "/api/auth/register", map[string]string{"email": email, "password": "first-password"})
	if rec.Code != http.StatusForbidden || body["code"] != CodeEmailUnverified || strings.Contains(rec.Body.String(), "should-not-leak") {
		t.Fatalf("register: %d %s", rec.Code, rec.Body)
	}
	for _, c := range rec.Result().Cookies() {
		if c.Value == "should-not-leak" {
			t.Fatal("register leaked the session cookie")
		}
	}
	verifyCode := mb.lastCode(t)

	// 2. Sign-in before verifying: refused, and no second code within a minute.
	before := mb.count()
	if rec, _ := postJSON(h, "/api/auth/login", map[string]string{"email": strings.ToUpper(email), "password": "first-password"}); rec.Code != http.StatusForbidden {
		t.Fatalf("login before verifying: %d", rec.Code)
	}
	if mb.count() != before {
		t.Error("a second code was sent within the resend window")
	}

	// 3. A wrong code is refused; the right one verifies and signs in; it works once.
	if verifyCode != "000000" {
		if rec, _ := postJSON(endpoints, "/api/auth/verify-email", map[string]string{"email": email, "code": "000000"}); rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("wrong code: %d", rec.Code)
		}
	}
	rec, body = postJSON(endpoints, "/api/auth/verify-email", map[string]string{"email": email, "code": verifyCode})
	if rec.Code != http.StatusOK || body["status"] != "verified" || body["token"] == nil {
		t.Fatalf("verify: %d %s", rec.Code, rec.Body)
	}
	if rec, _ := postJSON(endpoints, "/api/auth/verify-email", map[string]string{"email": email, "code": verifyCode}); rec.Code == http.StatusOK {
		t.Error("the verification code worked twice")
	}

	// 4. Signed in normally now.
	if rec, _ := postJSON(h, "/api/auth/login", map[string]string{"email": email, "password": "first-password"}); rec.Code != http.StatusOK {
		t.Fatalf("login after verifying: %d %s", rec.Code, rec.Body)
	}

	// 5. Forgot: same answer for a stranger and for the account.
	stranger, _ := postJSON(endpoints, "/api/auth/password/forgot", map[string]string{"email": "nobody-" + stamp + "@example.test"})
	known, _ := postJSON(endpoints, "/api/auth/password/forgot", map[string]string{"email": email})
	if stranger.Code != known.Code || stranger.Body.String() != known.Body.String() {
		t.Errorf("forgot leaks registration: %d %q vs %d %q", stranger.Code, stranger.Body, known.Code, known.Body)
	}
	resetCode := mb.lastCode(t)

	// 6. Reset: short password refused; then set; earlier sessions cut off.
	if rec, _ := postJSON(endpoints, "/api/auth/password/reset", map[string]string{"email": email, "code": resetCode, "password": "short"}); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("short password: %d", rec.Code)
	}
	oldIat := time.Now().Add(-time.Hour).Unix()
	if rec, _ := postJSON(endpoints, "/api/auth/password/reset", map[string]string{"email": email, "code": resetCode, "password": "second-password"}); rec.Code != http.StatusOK {
		t.Fatalf("reset: %d %s", rec.Code, rec.Body)
	}
	var hash string
	_ = s.DB.QueryRow(`SELECT password_hash FROM users WHERE id = $1`, userID).Scan(&hash)
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte("second-password")) != nil ||
		bcrypt.CompareHashAndPassword([]byte(hash), []byte("first-password")) == nil {
		t.Error("the password was not replaced")
	}
	sawAuth := ""
	guard := s.RevokedSessions(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { sawAuth = r.Header.Get("Authorization") }))
	for _, tc := range []struct {
		iat  int64
		kept bool
	}{{oldIat, false}, {time.Now().Add(time.Minute).Unix(), true}} {
		sawAuth = ""
		req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
		req.Header.Set("Authorization", "Bearer "+fakeJWT(userID, tc.iat))
		guard.ServeHTTP(httptest.NewRecorder(), req)
		if (sawAuth != "") != tc.kept {
			t.Errorf("session iat=%d kept=%v, want %v", tc.iat, sawAuth != "", tc.kept)
		}
	}
}

// Enrol, get challenged at password sign-in and at code sign-in, finish with a
// TOTP code or a recovery code (once), disable.
func TestFlowTwoFactor(t *testing.T) {
	s, mb, svc := testService(t)
	clock := time.Now()
	s.Now = func() time.Time { return clock }
	stamp := time.Now().Format("150405.000000")
	userID, email := "zk-2fa-"+stamp, "zk-2fa-"+stamp+"@example.test"
	if _, err := s.DB.Exec(`INSERT INTO users (id, email, password_hash, roles, permissions, created_at) VALUES ($1,$2,'x','','',$3)`,
		userID, email, time.Now().UTC().Format(time.RFC3339)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = s.PurgeUser(context.Background(), userID, email) })

	mux := http.NewServeMux()
	s.RegisterTwoFactor(func(p string, h http.HandlerFunc) { mux.HandleFunc("POST "+p, h) }, func(p string, h http.HandlerFunc) { mux.HandleFunc("GET "+p, h) })
	token, err := svc.IssueToken(auth.Identity{ID: userID, Email: email, Guard: "api"})
	if err != nil {
		t.Fatal(err)
	}
	signedIn := func(method, path string, body any) (*httptest.ResponseRecorder, map[string]any) {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, bytes.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+token) // bearer: exempt from the cookie CSRF check
		rec := httptest.NewRecorder()
		svc.Middleware(mux).ServeHTTP(rec, req)
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec, out
	}
	anon := func(path string, body any) (*httptest.ResponseRecorder, map[string]any) {
		return postJSON(mux, path, body)
	}

	// A cookie write without the CSRF token is refused.
	req := httptest.NewRequest(http.MethodPost, "/api/me/2fa/enroll", nil)
	req.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: token})
	rec := httptest.NewRecorder()
	svc.Middleware(mux).ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cookie enroll without CSRF: %d", rec.Code)
	}

	rec, enrol := signedIn(http.MethodPost, "/api/me/2fa/enroll", nil)
	secret, _ := enrol["secret"].(string)
	if rec.Code != http.StatusOK || secret == "" || !strings.HasPrefix(enrol["qr"].(string), "data:image/png;base64,") {
		t.Fatalf("enroll: %d %v", rec.Code, enrol)
	}
	var sealed string
	_ = s.DB.QueryRow(`SELECT secret_sealed FROM account_totp WHERE user_id = $1`, userID).Scan(&sealed)
	if strings.Contains(sealed, secret) {
		t.Fatal("the secret is stored in the clear")
	}
	code := func() string { c, _ := totpCode(secret, clock.Unix()/totpStep); return c }

	if rec, _ := signedIn(http.MethodPost, "/api/me/2fa/confirm", map[string]string{"code": "000000"}); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("wrong confirm: %d", rec.Code)
	}
	rec, confirmed := signedIn(http.MethodPost, "/api/me/2fa/confirm", map[string]string{"code": code()})
	recovery, _ := confirmed["recovery_codes"].([]any)
	if rec.Code != http.StatusOK || len(recovery) != recoveryCount {
		t.Fatalf("confirm: %d %v", rec.Code, confirmed)
	}

	// Password sign-in now stops at a challenge.
	loginPlugin := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.SetCookie(w, &http.Cookie{Name: auth.SessionCookie, Value: "should-not-leak"})
		writeJSON(w, http.StatusOK, map[string]any{"token": "should-not-leak", "user": map[string]any{"id": userID, "email": email, "roles": []string{}}})
	})
	login := func() (*httptest.ResponseRecorder, map[string]any) {
		return postJSON(s.SignupMiddleware(loginPlugin), "/api/auth/login", map[string]string{"email": email, "password": "x"})
	}
	lrec, challenged := login()
	if lrec.Code != http.StatusUnauthorized || challenged["code"] != Code2FARequired || strings.Contains(lrec.Body.String(), "should-not-leak") {
		t.Fatalf("login with 2FA: %d %s", lrec.Code, lrec.Body)
	}
	challenge := challenged["challenge"].(string)

	// The code used to confirm cannot be replayed; a fresh step's code works, once.
	if rec, _ := anon("/api/auth/2fa/challenge", map[string]string{"challenge": challenge, "code": code()}); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("replayed code: %d", rec.Code)
	}
	clock = clock.Add(totpStep * time.Second)
	rec, done := anon("/api/auth/2fa/challenge", map[string]string{"challenge": challenge, "code": code()})
	if rec.Code != http.StatusOK || done["token"] == nil {
		t.Fatalf("challenge: %d %v", rec.Code, done)
	}
	if rec, _ := anon("/api/auth/2fa/challenge", map[string]string{"challenge": challenge, "code": code()}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("a finished challenge was accepted again: %d", rec.Code)
	}

	// Code sign-in: mailed code -> challenge -> a recovery code finishes it, once.
	if rec, _ := anon("/api/auth/code/request", map[string]string{"email": email}); rec.Code != http.StatusOK {
		t.Fatalf("code request: %d", rec.Code)
	}
	rec, challenged = anon("/api/auth/code/verify", map[string]string{"email": email, "code": mb.lastCode(t)})
	if rec.Code != http.StatusUnauthorized || challenged["code"] != Code2FARequired {
		t.Fatalf("code sign-in with 2FA: %d %v", rec.Code, challenged)
	}
	first := recovery[0].(string)
	rec, done = anon("/api/auth/2fa/challenge", map[string]string{"challenge": challenged["challenge"].(string), "recovery_code": strings.ToUpper(first)})
	if rec.Code != http.StatusOK {
		t.Fatalf("recovery code: %d %v", rec.Code, done)
	}
	if extra, _ := done["extra"].(map[string]any); extra["recovery_codes_left"] != float64(recoveryCount-1) {
		t.Errorf("recovery_codes_left: %v", done["extra"])
	}
	_, challenged = login()
	if rec, _ := anon("/api/auth/2fa/challenge", map[string]string{"challenge": challenged["challenge"].(string), "recovery_code": first}); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("a used recovery code worked again: %d", rec.Code)
	}

	// Status, then disable (needs a code).
	if _, st := signedIn(http.MethodGet, "/api/me/2fa", nil); st["enabled"] != true || st["recovery_codes_left"].(float64) != recoveryCount-1 || st["available"] != true {
		t.Errorf("status: %v", st)
	}
	if rec, _ := signedIn(http.MethodPost, "/api/me/2fa/disable", map[string]string{"code": "000000"}); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("disable without a code: %d", rec.Code)
	}
	clock = clock.Add(totpStep * time.Second)
	if rec, _ := signedIn(http.MethodPost, "/api/me/2fa/disable", map[string]string{"code": code()}); rec.Code != http.StatusOK {
		t.Fatalf("disable: %d", rec.Code)
	}
	if s.twoFactorOn(context.Background(), userID) {
		t.Error("two-factor is still on")
	}

	// A disabled account cannot finish a sign-in, and its sessions are stripped.
	if _, err := s.DB.Exec(`INSERT INTO account_disabled (user_id) VALUES ($1)`, userID); err != nil {
		t.Fatal(err)
	}
	if rec, body := login(); rec.Code != http.StatusForbidden || body["code"] != CodeAccountDisabled {
		t.Fatalf("disabled login: %d %v", rec.Code, body)
	}
	sawAuth := ""
	req = httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	s.RevokedSessions(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { sawAuth = r.Header.Get("Authorization") })).
		ServeHTTP(httptest.NewRecorder(), req)
	if sawAuth != "" {
		t.Error("a disabled account's session was kept")
	}
}
