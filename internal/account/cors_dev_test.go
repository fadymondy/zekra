package account

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

/*
The CORS allow-lists are a contract with every non-same-origin client (the
desktop app, the previews). A method or header the client sends but the server
does not list makes the browser refuse the request BEFORE it is sent, which
reaches the user as "Failed to fetch" with no status code to debug — exactly
how the desktop delete bug presented.

These tests pin the lists against what those clients actually send.
*/

func corsPreflight(t *testing.T, origin, method, headers string) *httptest.ResponseRecorder {
	t.Helper()
	h := CORSMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	r := httptest.NewRequest(http.MethodOptions, "/api/notes/abc", nil)
	r.Header.Set("Origin", origin)
	r.Header.Set("Access-Control-Request-Method", method)
	if headers != "" {
		r.Header.Set("Access-Control-Request-Headers", headers)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

func allows(rec *httptest.ResponseRecorder, header, value string) bool {
	for _, v := range strings.Split(rec.Header().Get(header), ",") {
		if strings.EqualFold(strings.TrimSpace(v), value) {
			return true
		}
	}
	return false
}

// Every method and header the desktop client sends must be allowed. The
// desktop uses PUT to update a note and DELETE with If-Match to remove one.
func TestCORSAllowsWhatTheDesktopClientSends(t *testing.T) {
	t.Setenv("CORS_ORIGINS", "https://desktop.zekra.dev")
	const origin = "https://desktop.zekra.dev"

	for _, method := range []string{"GET", "POST", "PUT", "PATCH", "DELETE"} {
		rec := corsPreflight(t, origin, method, "")
		if !allows(rec, "Access-Control-Allow-Methods", method) {
			t.Errorf("method %s not allowed: %q", method, rec.Header().Get("Access-Control-Allow-Methods"))
		}
	}

	// If-Match is the one that broke delete: optimistic concurrency means the
	// client MUST send it, so the server must permit it.
	for _, header := range []string{"Authorization", "Content-Type", "Accept", "If-Match", "If-None-Match", "X-CSRF-Token", "X-Agent-Id"} {
		rec := corsPreflight(t, origin, "DELETE", strings.ToLower(header))
		if !allows(rec, "Access-Control-Allow-Headers", header) {
			t.Errorf("header %s not allowed: %q", header, rec.Header().Get("Access-Control-Allow-Headers"))
		}
	}
}

// A cross-origin client cannot read ETag unless it is exposed, and without
// ETag it has no version to put in If-Match.
func TestCORSExposesETag(t *testing.T) {
	t.Setenv("CORS_ORIGINS", "https://desktop.zekra.dev")
	rec := corsPreflight(t, "https://desktop.zekra.dev", "GET", "")
	if !allows(rec, "Access-Control-Expose-Headers", "ETag") {
		t.Errorf("ETag not exposed: %q", rec.Header().Get("Access-Control-Expose-Headers"))
	}
}

func TestCORSRejectsUnlistedOrigins(t *testing.T) {
	t.Setenv("CORS_ORIGINS", "https://desktop.zekra.dev")
	for _, origin := range []string{"https://evil.example", "null", ""} {
		rec := corsPreflight(t, origin, "DELETE", "if-match")
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("origin %q was allowed: %q", origin, got)
		}
	}
}

// These routes read and set the session cookie, so a wildcard would let any
// site act as the signed-in user.
func TestCORSNeverWildcards(t *testing.T) {
	t.Setenv("CORS_ORIGINS", "https://desktop.zekra.dev")
	rec := corsPreflight(t, "https://desktop.zekra.dev", "GET", "")
	if rec.Header().Get("Access-Control-Allow-Origin") == "*" {
		t.Error("wildcard origin with credentials allowed")
	}
	if rec.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Error("credentials not allowed, so the session cookie will not be sent")
	}
}

// Unset CORS_ORIGINS must leave behaviour exactly as it was: same-origin only.
func TestCORSDisabledByDefault(t *testing.T) {
	t.Setenv("CORS_ORIGINS", "")
	rec := corsPreflight(t, "https://desktop.zekra.dev", "DELETE", "if-match")
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Error("CORS headers emitted with no CORS_ORIGINS set")
	}
}

func TestCORSOriginListIsTrimmed(t *testing.T) {
	t.Setenv("CORS_ORIGINS", " https://a.example , https://b.example ")
	for _, origin := range []string{"https://a.example", "https://b.example"} {
		rec := corsPreflight(t, origin, "GET", "")
		if rec.Header().Get("Access-Control-Allow-Origin") != origin {
			t.Errorf("origin %q not allowed after trimming", origin)
		}
	}
}
