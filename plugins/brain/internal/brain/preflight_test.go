package brain

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// MH-459: the public MCP/OAuth preflights are answered before any CORS middleware, with the
// headers browser MCP clients send; everything else goes on untouched.
func TestPublicPreflight(t *testing.T) {
	reached := false
	h := PublicPreflight(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusTeapot)
	}))
	for _, p := range []string{"/api/mcp", "/api/oauth/token", "/api/oauth/register", "/.well-known/oauth-authorization-server"} {
		reached = false
		req := httptest.NewRequest(http.MethodOptions, p, nil)
		req.Header.Set("Origin", "https://client.example")
		req.Header.Set("Access-Control-Request-Method", "POST")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if reached || rec.Code != http.StatusNoContent {
			t.Fatalf("%s: code %d, reached next %v", p, rec.Code, reached)
		}
		if rec.Header().Get("Access-Control-Allow-Origin") != "*" {
			t.Fatalf("%s: Allow-Origin %q", p, rec.Header().Get("Access-Control-Allow-Origin"))
		}
		for _, want := range []string{"Authorization", "Content-Type", "Mcp-Session-Id", "X-Zekra-Token", "X-Agent-Id"} {
			if !strings.Contains(rec.Header().Get("Access-Control-Allow-Headers"), want) {
				t.Fatalf("%s: Allow-Headers %q lacks %s", p, rec.Header().Get("Access-Control-Allow-Headers"), want)
			}
		}
	}
	for _, c := range []struct{ method, path string }{
		{http.MethodOptions, "/api/brains"}, // session routes keep the allowlisted, credentialed CORS
		{http.MethodPost, "/api/mcp"},
		{http.MethodOptions, "/api/mcp/tools"},
	} {
		reached = false
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(c.method, c.path, nil))
		if !reached || rec.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Fatalf("%s %s should pass through untouched (reached %v, headers %v)", c.method, c.path, reached, rec.Header())
		}
	}
}
