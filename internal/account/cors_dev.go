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
			// If-Match / If-None-Match are load-bearing, not optional: the
			// note routes use optimistic concurrency, and the desktop client
			// sends If-Match on delete. Omitting them made the preflight fail
			// and surfaced to the user as "Failed to fetch" — with no HTTP
			// status to look at, because the request never left the browser.
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, If-Match, If-None-Match, X-CSRF-Token, X-Agent-Id, X-Zekra-Token")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			// ETag has to be exposed explicitly or a cross-origin client cannot
			// read the version it must send back in If-Match.
			h.Set("Access-Control-Expose-Headers", "ETag")
			// Cache the preflight so a delete is not two round trips every time.
			h.Set("Access-Control-Max-Age", "600")
			h.Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
