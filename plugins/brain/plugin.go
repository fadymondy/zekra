// Package brain is the Zekra memory-organ togo plugin (a mini-app). It
// self-registers on blank-import via `togo install`. Backend logic lives in
// internal/brain; UI in web/. Provider integrations (TEI embeddings/rerank,
// the Cognee cognify engine, the object-store cold tier) plug in behind
// interfaces as their own driver plugins (brain-tei, brain-cognee, …).
package brain

import (
	"context"
	"net/http"
	"os"

	"github.com/togo-framework/togo"

	"github.com/togo-framework/brain/internal/brain"
)

const Name = "brain"

// consoleAuthGuard is the shape of the togo auth service we need: its session
// middleware. We depend on it STRUCTURALLY (no import of the auth package) so
// the brain plugin stays decoupled from the auth plugin — *auth.Service already
// satisfies this. The service is resolved lazily off the kernel at request time,
// so provider boot-order never matters.
type consoleAuthGuard interface {
	Middleware(next http.Handler) http.Handler
}

// authRequired reports whether the human console login gate is enforced. Off by
// default so local/dev and the running instance stay reachable unauthenticated;
// set ZEKRA_REQUIRE_AUTH=1 (or true) to enforce.
func authRequired() bool {
	v := os.Getenv("ZEKRA_REQUIRE_AUTH")
	return v == "1" || v == "true"
}

// consoleAuth wraps a console admin/management handler with the human login gate.
// When ZEKRA_REQUIRE_AUTH is set, the auth plugin's JWT/session middleware must
// pass (valid Bearer token or session cookie) before the handler runs; otherwise
// the handler is served as-is. This is COMPLEMENTARY to the MCP token ACL
// (X-Zekra-Token) enforced inside the handlers — that governs MCP agents and is
// left untouched. Fails closed (503) if enforcement is on but auth isn't active.
func consoleAuth(k *togo.Kernel, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authRequired() {
			h(w, r)
			return
		}
		if v, ok := k.Get("auth"); ok {
			if g, ok := v.(consoleAuthGuard); ok {
				g.Middleware(h).ServeHTTP(w, r)
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":{"code":"auth_unavailable","message":"ZEKRA_REQUIRE_AUTH is set but the auth plugin is not active"}}`))
	}
}

// secure authenticates EVERY brain endpoint when ZEKRA_REQUIRE_AUTH is on:
// the caller must present either a valid login session (browser — via the auth
// plugin's cookie/JWT middleware) OR a valid X-Zekra-Token (MCP/programmatic).
// Anything else gets 401 from the auth middleware, so the public URL is no longer
// open. Per-brain authorization (canRead/canWrite/adminOnly) still runs inside the
// handlers. When enforcement is off, endpoints are served as-is (local/dev).
func secure(k *togo.Kernel, svc interface {
	ValidToken(ctx context.Context, tok string) bool
}, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authRequired() {
			h(w, r)
			return
		}
		if brain.PrincipalFrom(r.Context()) != nil {
			h(w, r) // remote MCP: an OAuth connection verified by /api/mcp (in-process only)
			return
		}
		if tok := brain.TokenHeader(r.Header); tok != "" && svc.ValidToken(r.Context(), tok) {
			h(w, r) // MCP: authenticated by token; handler checks its grants
			return
		}
		if v, ok := k.Get("auth"); ok {
			if g, ok := v.(consoleAuthGuard); ok {
				g.Middleware(h).ServeHTTP(w, r) // browser: require a login session
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":{"code":"auth_unavailable","message":"ZEKRA_REQUIRE_AUTH is set but the auth plugin is not active"}}`))
	}
}

func init() {
	// PriorityLate+10 (100) so this plugin's routes mount AFTER the auth plugin
	// (PriorityLate+5) has installed its global chi middleware via Router.Use() —
	// chi forbids Use() once any route exists, so every route-registering plugin
	// must run after auth. brain still stays "late" (after db/cache/realtime).
	togo.RegisterProviderFunc(Name, togo.PriorityLate+10, func(k *togo.Kernel) error {
		svc := brain.New(k)
		// secured authenticates a request (valid login session OR valid token) when
		// ZEKRA_REQUIRE_AUTH is on; per-brain authorization still runs in-handler.
		secured := func(h http.HandlerFunc) http.HandlerFunc { return secure(k, svc, h) }

		// Health stays fully open (liveness probe). EVERY other endpoint is secured:
		// with enforcement on, the public URL demands a session or a token; with it
		// off, they're served as-is for local/dev. In-handler canRead/canWrite/
		// adminOnly (X-Zekra-Token ACL) is unchanged.
		svc.RegisterRoutes(k.Router, secured)
		k.Set(Name, svc)
		if k.Log != nil {
			k.Log.Info("plugin active", "plugin", Name, "consoleAuth", authRequired())
		}
		return nil
	})
}
