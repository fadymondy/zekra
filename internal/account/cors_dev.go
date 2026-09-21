package account

import (
	"net/http"
	"os"
	"strings"
)

// allowedCORSOrigins reads CORS_ORIGINS (comma-separated, documented in
// .env.example, empty by default = same-origin only).
func allowedCORSOrigins() map[string]bool {
	raw := os.Getenv("CORS_ORIGINS")
	if raw == "" {
		return nil
	}
	out := make(map[string]bool)
	for _, o := range strings.Split(raw, ",") {
		if o = strings.TrimSpace(o); o != "" {
			out[o] = true
		}
	}
	return out
}

// CORSMiddleware allows the exact origins listed in CORS_ORIGINS to send
// credentialed requests to the account API (dev tunnels, alternate clients).
// It is a no-op unless CORS_ORIGINS is set, so production is unaffected by
// default, and it never falls back to a wildcard since these routes set/read
// the session cookie.
func CORSMiddleware(next http.Handler) http.Handler {
	allowed := allowedCORSOrigins()
	if len(allowed) == 0 {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); allowed[origin] {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Credentials", "true")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, X-CSRF-Token, X-Agent-Id, X-Zekra-Token")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			h.Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
