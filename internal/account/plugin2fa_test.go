package account

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

// Zekra replaces the auth plugin's POST /api/auth/2fa/challenge by registering
// the same route later; chi keeps the last registration. routeHandler must
// still find the plugin's original handler, with its route middleware, when
// called before the replacement.
func TestRouteHandlerKeepsTheReplacedRoute(t *testing.T) {
	r := chi.NewRouter()
	var trail []string
	mw := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) { trail = append(trail, "mw"); next.ServeHTTP(w, req) })
	}
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) { trail = append(trail, "global"); next.ServeHTTP(w, req) })
	})
	r.With(mw).Post("/api/auth/2fa/challenge", func(http.ResponseWriter, *http.Request) { trail = append(trail, "plugin") })

	plugin := routeHandler(r, http.MethodPost, "/api/auth/2fa/challenge")
	if plugin == nil {
		t.Fatal("the plugin route was not found")
	}
	if routeHandler(r, http.MethodGet, "/api/auth/2fa/challenge") != nil || routeHandler(r, http.MethodPost, "/nope") != nil {
		t.Fatal("found a route that is not registered")
	}
	r.Post("/api/auth/2fa/challenge", func(http.ResponseWriter, *http.Request) { trail = append(trail, "zekra") })

	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/api/auth/2fa/challenge", nil))
	plugin.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/api/auth/2fa/challenge", nil))
	if want := "global zekra mw plugin"; strings.Join(trail, " ") != want {
		t.Fatalf("calls: %v, want %q: the router serves Zekra's handler, the captured one the plugin's with its route middleware only", trail, want)
	}
}

// Since auth v0.9 the plugin answers a password login with its own challenge
// ({"mfa_required":true,"challenge":…}, no session) when the account has the
// plugin's TOTP or an auth-mfa factor. Zekra's account checks still apply.
func TestFlowPluginSecondFactor(t *testing.T) {
	s, _, svc := testService(t)
	stamp := time.Now().Format("150405.000000")
	userID, email := "zk-p2fa-"+stamp, "zk-p2fa-"+stamp+"@example.test"
	if _, err := s.DB.Exec(`INSERT INTO users (id, email, password_hash, roles, permissions, created_at) VALUES ($1,$2,'x','','',$3)`,
		userID, email, time.Now().UTC().Format(time.RFC3339)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = s.PurgeUser(context.Background(), userID, email) })

	// Stand-ins for the plugin's login and challenge handlers.
	var handedOff []string
	s.pluginChallenge = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		handedOff = append(handedOff, string(raw))
		writeJSON(w, http.StatusOK, map[string]any{"token": "plugin-session"})
	})
	mux := http.NewServeMux()
	s.RegisterTwoFactor(func(p string, h http.HandlerFunc) { mux.HandleFunc("POST "+p, h) }, func(p string, h http.HandlerFunc) { mux.HandleFunc("GET "+p, h) })
	var pluginChallenge string
	loginPlugin := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		c, err := svc.IssueLoginChallenge(userID)
		if err != nil {
			t.Fatal(err)
		}
		pluginChallenge = c
		writeJSON(w, http.StatusOK, map[string]any{"mfa_required": true, "challenge": c})
	})
	login := func() (*httptest.ResponseRecorder, map[string]any) {
		return postJSON(s.SignupMiddleware(loginPlugin), "/api/auth/login", map[string]string{"email": email, "password": "x"})
	}
	finish := func(challenge string) (*httptest.ResponseRecorder, map[string]any) {
		return postJSON(mux, "/api/auth/2fa/challenge", map[string]string{"challenge": challenge, "code": "123456"})
	}

	// Plugin factor only: its challenge passes through and is finished by the plugin.
	rec, body := login()
	if rec.Code != http.StatusOK || body["mfa_required"] != true || body["challenge"] != pluginChallenge {
		t.Fatalf("plugin challenge at login: %d %v", rec.Code, body)
	}
	rec, body = finish(pluginChallenge)
	if rec.Code != http.StatusOK || body["token"] != "plugin-session" || len(handedOff) != 1 {
		t.Fatalf("plugin challenge hand-off: %d %v", rec.Code, body)
	}
	var sent map[string]string
	if json.Unmarshal([]byte(handedOff[0]), &sent) != nil || sent["challenge"] != pluginChallenge || sent["code"] != "123456" {
		t.Fatalf("the plugin got a different body: %q", handedOff[0])
	}

	// Not every unknown challenge goes to the plugin: a forged one is just expired.
	if rec, body := finish("forged.challenge"); rec.Code != http.StatusUnauthorized || body["code"] != "challenge_expired" || len(handedOff) != 1 {
		t.Fatalf("forged challenge: %d %v", rec.Code, body)
	}

	// Zekra's two-factor on as well: login asks for Zekra's code, and the
	// plugin's challenge cannot be used to skip it.
	if _, err := s.DB.Exec(`INSERT INTO account_totp (user_id, secret_sealed, enabled) VALUES ($1,'x',TRUE)`, userID); err != nil {
		t.Fatal(err)
	}
	rec, body = login()
	if rec.Code != http.StatusUnauthorized || body["code"] != Code2FARequired || body["challenge"] == pluginChallenge {
		t.Fatalf("login with both factors: %d %v", rec.Code, body)
	}
	if rec, body := finish(pluginChallenge); rec.Code != http.StatusUnauthorized || len(handedOff) != 1 {
		t.Fatalf("plugin challenge with Zekra 2FA on: %d %v", rec.Code, body)
	}
	if _, err := s.DB.Exec(`DELETE FROM account_totp WHERE user_id = $1`, userID); err != nil {
		t.Fatal(err)
	}

	// A disabled account is refused at login and at the challenge.
	if _, err := s.DB.Exec(`INSERT INTO account_disabled (user_id) VALUES ($1)`, userID); err != nil {
		t.Fatal(err)
	}
	if rec, body := login(); rec.Code != http.StatusForbidden || body["code"] != CodeAccountDisabled {
		t.Fatalf("disabled login: %d %v", rec.Code, body)
	}
	if rec, body := finish(pluginChallenge); rec.Code != http.StatusForbidden || body["code"] != CodeAccountDisabled || len(handedOff) != 1 {
		t.Fatalf("disabled plugin challenge: %d %v", rec.Code, body)
	}
}
