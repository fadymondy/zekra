package brain

/*
OAuth 2.1 for the remote MCP endpoint (/api/mcp).

claude.ai, Claude Desktop and ChatGPT connectors add a remote MCP server by URL
and sign in with OAuth; they cannot paste a token. This is the authorization
server they talk to, ported from fadymondy.com (internal/mcp/oauth.go) and
implemented against the MCP authorization specification:

  - protected-resource metadata (RFC 9728) at both well-known forms, and a
    WWW-Authenticate resource_metadata pointer on every 401 from /api/mcp;
  - authorization-server metadata (RFC 8414);
  - client registration by Client ID Metadata Document and by dynamic
    registration (RFC 7591);
  - authorization code + PKCE, S256 only, exact redirect-URI matching except
    for RFC 8252's dynamic loopback port, the `iss` response parameter
    (RFC 9207) and `resource` binding (RFC 8707);
  - short-lived access tokens, rotating refresh tokens with reuse detection,
    and revocation (RFC 7009);
  - private_key_jwt client authentication (RFC 7523) for ChatGPT.

Differences from fadymondy (a single-owner site): ANY signed-in user may
connect an app, and consents per brain. A grant is user x client, and names the
brains it may touch (read, or read+write) in mcp_oauth_grant_namespaces. Every
MCP call is re-checked against the grant, the token's scope, and the user's
CURRENT access to that brain (brain_members / admin role) — so removing a user
from a brain, or disabling the account, cuts off their connected apps at once.

Every secret — codes, access and refresh tokens, client secrets — is stored as
its sha256 (HashToken).

The consent screen is a web page (<AUTH_PUBLIC_URL>/<locale>/oauth/authorize);
it calls the session-only endpoints below (authorize/request, authorize/decision,
grants, grants/{id}/revoke).
*/

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
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
)

const (
	oauthAccessTTL  = time.Hour
	oauthRefreshTTL = 30 * 24 * time.Hour
	oauthCodeTTL    = 2 * time.Minute

	accessPrefix  = "zko_at_"
	refreshPrefix = "zko_rt_"
	codePrefix    = "zko_ac_"
	clientPrefix  = "zkc_"
	secretPrefix  = "zkcs_"
)

// scopeInfo describes a scope for the metadata and the consent screen.
type scopeInfo struct {
	Scope       string `json:"scope"`
	Write       bool   `json:"write"`
	Description string `json:"description"`
}

var knownScopes = []scopeInfo{
	{Scope: ScopeRead, Description: "Read memories and notes in the brains you choose"},
	{Scope: ScopeWrite, Write: true, Description: "Add and edit memories and notes in the brains you choose"},
}

// toleratedClientScopes are interoperability hints sent by some OAuth clients,
// notably ChatGPT. Zekra is an OAuth authorization server, not an OpenID
// Provider, so these scopes are deliberately neither advertised nor granted.
// Accepting and dropping them lets the client complete OAuth while ensuring
// that only the explicit brains:* scopes can authorize MCP operations.
var toleratedClientScopes = map[string]bool{
	"openid":         true,
	"profile":        true,
	"email":          true,
	"offline_access": true,
}

func scopeNames() []string {
	out := make([]string, 0, len(knownScopes))
	for _, s := range knownScopes {
		out = append(out, s.Scope)
	}
	return out
}

// validateScopes normalises a requested scope list and reports the first
// unknown entry. Duplicates collapse; order is sorted.
func validateScopes(in []string) (scopes []string, unknown string) {
	known := map[string]bool{}
	for _, s := range knownScopes {
		known[s.Scope] = true
	}
	seen := map[string]bool{}
	for _, raw := range in {
		s := strings.TrimSpace(raw)
		if s == "" || seen[s] {
			continue
		}
		if !known[s] {
			if toleratedClientScopes[s] {
				continue
			}
			return nil, s
		}
		seen[s] = true
		scopes = append(scopes, s)
	}
	sort.Strings(scopes)
	return scopes, ""
}

func hasScope(scopes []string, want string) bool {
	for _, s := range scopes {
		if s == want {
			return true
		}
	}
	return false
}

func intersectScopes(a, b []string) []string {
	var out []string
	for _, s := range a {
		if hasScope(b, s) {
			out = append(out, s)
		}
	}
	return out
}

func subsetOf(sub, of []string) bool {
	for _, s := range sub {
		if !hasScope(of, s) {
			return false
		}
	}
	return true
}

// HashToken is the sha256 hex digest stored for a credential.
func HashToken(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

func urlEnv(keys ...string) string {
	for _, key := range keys {
		if v := strings.TrimSpace(os.Getenv(key)); v != "" {
			// .env values sometimes carry trailing comments.
			if i := strings.IndexAny(v, " \t"); i > 0 {
				v = v[:i]
			}
			return strings.TrimRight(v, "/")
		}
	}
	return ""
}

/*
Public URLs. All configured, never taken from a request's Host header on their
own: the issuer and the resource are what a client pins, and a value an
attacker can steer is not an identifier. (The Host only CHOOSES between the
configured values, below.)

  - AUTH_PUBLIC_URL (fallback APP_URL): the web app, e.g. https://app.zekra.dev —
    the consent page lives there, and the legacy MCP URL <app>/api/mcp.
  - MCP_PUBLIC_URL: the canonical MCP URL users paste, e.g. https://mcp.zekra.dev
    (NPM rewrites its "/" to /api/mcp and passes /.well-known/* through). It is
    the protected-resource identifier (RFC 9728) and the token audience (RFC 8707).
    Unset → <app>/api/mcp.
  - The issuer is ZEKRA_OAUTH_ISSUER, else MCP_PUBLIC_URL, else the app URL. With
    MCP_PUBLIC_URL set the issuer is the MCP host, whose every path already reaches
    this API, so /.well-known/oauth-authorization-server resolves without extra
    proxy rules; the RFC 9207 `iss` response parameter is the same value.
*/

// appPublicURL is the web app's public origin.
func appPublicURL() string { return urlEnv("AUTH_PUBLIC_URL", "APP_URL") }

// MCPPublicURL is the canonical MCP server URL (also the token audience).
func MCPPublicURL() string {
	if u := urlEnv("MCP_PUBLIC_URL"); u != "" {
		return u
	}
	return appPublicURL() + "/api/mcp"
}

// OAuthIssuer is this authorization server's issuer identifier.
func OAuthIssuer() string {
	return urlEnv("ZEKRA_OAUTH_ISSUER", "MCP_PUBLIC_URL", "AUTH_PUBLIC_URL", "APP_URL")
}

// MCPResourceURL is the canonical protected-resource identifier.
func MCPResourceURL() string { return MCPPublicURL() }

func canonResource(u string) string { return strings.TrimRight(strings.TrimSpace(u), "/") }

// allowedResources are every URL this MCP server answers at; a token bound to
// any of them is accepted (the MCP host root, its /api/mcp, and <app>/api/mcp).
func allowedResources() []string {
	set := []string{canonResource(MCPPublicURL())}
	if urlEnv("MCP_PUBLIC_URL") != "" {
		set = append(set, canonResource(urlEnv("MCP_PUBLIC_URL")+"/api/mcp"))
	}
	if app := appPublicURL(); app != "" {
		set = append(set, canonResource(app+"/api/mcp"))
	}
	set = append(set, canonResource(OAuthIssuer()+"/api/mcp"))
	return set
}

func allowedResource(u string) bool {
	c := canonResource(u)
	for _, a := range allowedResources() {
		if c == a {
			return true
		}
	}
	return false
}

func hostOf(u string) string {
	p, err := url.Parse(u)
	if err != nil {
		return ""
	}
	return strings.ToLower(p.Hostname())
}

func requestHost(r *http.Request) string {
	h := r.Host
	if xf := r.Header.Get("X-Forwarded-Host"); xf != "" {
		h = strings.TrimSpace(strings.Split(xf, ",")[0])
	}
	if hh, _, err := net.SplitHostPort(h); err == nil {
		h = hh
	}
	return strings.ToLower(h)
}

// onMCPHost reports whether the request arrived on the MCP_PUBLIC_URL host.
func onMCPHost(r *http.Request) bool {
	m := urlEnv("MCP_PUBLIC_URL")
	return m != "" && requestHost(r) == hostOf(m)
}

// resourceFor is the protected-resource identifier for the URL a client used:
// the MCP host's root (or its /api/mcp for the path-suffixed document), else
// the app's /api/mcp.
func resourceFor(r *http.Request, suffixed bool) string {
	if onMCPHost(r) {
		if suffixed {
			return urlEnv("MCP_PUBLIC_URL") + "/api/mcp"
		}
		return urlEnv("MCP_PUBLIC_URL")
	}
	if app := appPublicURL(); app != "" {
		return app + "/api/mcp"
	}
	return MCPResourceURL()
}

// protectedResourceMetadataURL is the resource_metadata pointer for a 401.
func protectedResourceMetadataURL(r *http.Request) string {
	if onMCPHost(r) {
		return urlEnv("MCP_PUBLIC_URL") + "/.well-known/oauth-protected-resource"
	}
	base := appPublicURL()
	if base == "" {
		base = OAuthIssuer()
	}
	return base + "/.well-known/oauth-protected-resource/api/mcp"
}

// authorizePageURL is the consent web page (the authorization_endpoint), on the
// web app: <AUTH_PUBLIC_URL>/en/oauth/authorize (the page handles the locale).
func authorizePageURL() string {
	p := urlEnv("ZEKRA_OAUTH_AUTHORIZE_PATH")
	if p == "" {
		p = "/en/oauth/authorize"
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	base := appPublicURL()
	if base == "" {
		base = OAuthIssuer()
	}
	return base + p
}

type oauthServer struct {
	svc *Service
	now func() time.Time
	// fetchCIMD fetches a Client ID Metadata Document. Replaced in tests; the
	// real one refuses anything but public https (cimd.go).
	fetchCIMD func(ctx context.Context, clientID string) ([]byte, error)
	// fetchJWKS fetches a private_key_jwt client's jwks_uri (same guard).
	fetchJWKS func(ctx context.Context, uri string) ([]byte, error)
	jwks      *jwksCache
	register  *ipLimiter
	tokenRate *ipLimiter
}

func newOAuthServer(svc *Service) *oauthServer {
	return &oauthServer{
		svc:       svc,
		now:       func() time.Time { return time.Now().UTC() },
		fetchCIMD: fetchClientMetadata,
		fetchJWKS: fetchClientMetadata, // same SSRF-guarded https fetch
		jwks:      newJWKSCache(),
		register:  newIPLimiter(20, time.Hour),
		tokenRate: newIPLimiter(120, time.Minute),
	}
}

func (s *oauthServer) db(ctx context.Context) (*sql.DB, error) { return s.svc.Store.db(ctx) }

func (s *oauthServer) warn(msg string, args ...any) {
	if s.svc != nil && s.svc.k != nil && s.svc.k.Log != nil {
		s.svc.k.Log.Warn(msg, args...)
	}
}

func (s *oauthServer) mount(r chi.Router) {
	// Public by specification, served on ANY host (app and MCP): the root form and
	// the path-suffixed forms for "/" and "/api/mcp". The well-known paths are
	// outside /api: the app host's proxy must route /.well-known/oauth-* here
	// (the MCP host already passes every path through).
	root := func(w http.ResponseWriter, r *http.Request) { s.protectedResource(w, r, false) }
	suffixed := func(w http.ResponseWriter, r *http.Request) { s.protectedResource(w, r, true) }
	r.Get("/.well-known/oauth-protected-resource", root)
	r.Get("/.well-known/oauth-protected-resource/", root)
	r.Get("/.well-known/oauth-protected-resource/api/mcp", suffixed)
	r.Get("/.well-known/oauth-authorization-server", s.serverMetadata)
	// Zekra is an OAuth authorization server, not an OpenID Provider. Return an
	// explicit 404 so the frontend fallback cannot masquerade as OIDC discovery.
	r.Get("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		writeJSONNoStore(w, http.StatusNotFound, map[string]string{"error": "not_found"})
	})
	for _, p := range []string{"/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/",
		"/.well-known/oauth-protected-resource/api/mcp", "/.well-known/oauth-authorization-server",
		"/api/oauth/register", "/api/oauth/token", "/api/oauth/revoke"} {
		r.Options(p, s.preflight)
	}
	r.Post("/api/oauth/register", s.registerClient)
	r.Post("/api/oauth/token", s.token)
	r.Post("/api/oauth/revoke", s.revoke)

	// A signed-in user (session): the consent page and "connected apps".
	r.Get("/api/oauth/authorize/request", s.svc.withCaller(s.authorizeRequest))
	r.Post("/api/oauth/authorize/decision", s.svc.withCaller(s.authorizeDecision))
	r.Get("/api/oauth/grants", s.svc.withCaller(s.listGrants))
	r.Post("/api/oauth/grants/{id}/revoke", s.svc.withCaller(s.revokeGrant))
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

func (s *oauthServer) protectedResource(w http.ResponseWriter, r *http.Request, suffixed bool) {
	allowAnyOrigin(w)
	writeJSONNoStore(w, http.StatusOK, map[string]any{
		"resource":                 resourceFor(r, suffixed),
		"authorization_servers":    []string{OAuthIssuer()},
		"scopes_supported":         scopeNames(),
		"bearer_methods_supported": []string{"header"},
		"resource_name":            "Zekra",
		"resource_documentation":   appPublicURL() + "/docs/mcp",
	})
}

func (s *oauthServer) serverMetadata(w http.ResponseWriter, _ *http.Request) {
	allowAnyOrigin(w)
	iss := OAuthIssuer()
	writeJSONNoStore(w, http.StatusOK, map[string]any{
		"issuer": iss,
		// A web page, not an API route: the user signs in and consents there.
		"authorization_endpoint":                                authorizePageURL(),
		"token_endpoint":                                        iss + "/api/oauth/token",
		"registration_endpoint":                                 iss + "/api/oauth/register",
		"revocation_endpoint":                                   iss + "/api/oauth/revoke",
		"response_types_supported":                              []string{"code"},
		"response_modes_supported":                              []string{"query"},
		"grant_types_supported":                                 []string{"authorization_code", "refresh_token"},
		"code_challenge_methods_supported":                      []string{"S256"},
		"token_endpoint_auth_methods_supported":                 []string{"none", "client_secret_post", "client_secret_basic", "private_key_jwt"},
		"token_endpoint_auth_signing_alg_values_supported":      assertionAlgs,
		"revocation_endpoint_auth_methods_supported":            []string{"none", "client_secret_post", "client_secret_basic", "private_key_jwt"},
		"revocation_endpoint_auth_signing_alg_values_supported": assertionAlgs,
		"scopes_supported":                                      scopeNames(),
		"client_id_metadata_document_supported":                 true,
		"authorization_response_iss_parameter_supported":        true,
		"service_documentation":                                 appPublicURL() + "/docs/mcp",
	})
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

type oauthClient struct {
	ID           string
	Name         string
	URI          string
	RedirectURIs []string
	AuthMethod   string
	SecretHash   string
	// private_key_jwt clients: where their public keys are (one of the two).
	JWKSURI string
	JWKS    string
	// Metadata document client (client_id is an https URL).
	CIMD bool
}

var errUnknownClient = errors.New("unknown client")

// loadClient resolves a client_id. A URL-shaped id is a metadata document and
// is fetched fresh when `fetch` is true (the authorization step); otherwise the
// copy stored at authorization is used (the token step).
func (s *oauthServer) loadClient(ctx context.Context, clientID string, fetch bool) (*oauthClient, error) {
	if clientID == "" || len(clientID) > 2000 {
		return nil, errUnknownClient
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	if isCIMDClientID(clientID) && fetch {
		c, err := s.resolveCIMD(ctx, clientID)
		if err != nil {
			return nil, err
		}
		redirects, _ := json.Marshal(c.RedirectURIs)
		_, err = db.ExecContext(ctx, `
			INSERT INTO mcp_oauth_clients (id, client_name, client_uri, redirect_uris, token_endpoint_auth_method, jwks_uri, jwks)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (id) DO UPDATE SET client_name = EXCLUDED.client_name,
				client_uri = EXCLUDED.client_uri, redirect_uris = EXCLUDED.redirect_uris,
				token_endpoint_auth_method = EXCLUDED.token_endpoint_auth_method,
				jwks_uri = EXCLUDED.jwks_uri, jwks = EXCLUDED.jwks,
				updated_at = now()`,
			c.ID, c.Name, c.URI, string(redirects), c.AuthMethod, c.JWKSURI, c.JWKS)
		if err != nil {
			return nil, err
		}
		return c, nil
	}

	var c oauthClient
	var redirects string
	err = db.QueryRowContext(ctx, `
		SELECT id, client_name, client_uri, redirect_uris, token_endpoint_auth_method, secret_hash, jwks_uri, jwks
		FROM mcp_oauth_clients WHERE id = $1`, clientID).
		Scan(&c.ID, &c.Name, &c.URI, &redirects, &c.AuthMethod, &c.SecretHash, &c.JWKSURI, &c.JWKS)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errUnknownClient
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(redirects), &c.RedirectURIs)
	c.CIMD = isCIMDClientID(c.ID)
	return &c, nil
}

func (c *oauthClient) allowsRedirect(uri string) bool {
	for _, r := range c.RedirectURIs {
		// Exact string comparison — no normalisation, no prefix, no wildcard.
		if subtle.ConstantTimeCompare([]byte(r), []byte(uri)) == 1 {
			return true
		}

		// RFC 8252 section 7.3 requires authorization servers to allow native
		// clients to choose an ephemeral port for an HTTP loopback redirect.
		// Codex publishes http://127.0.0.1/callback and supplies the selected
		// port in each authorization request. Only substitute a missing port;
		// the host, path, query, and every other byte must still match.
		registered, err := url.Parse(r)
		if err != nil || registered.Scheme != "http" || registered.Port() != "" || !isLoopbackRedirect(r) {
			continue
		}
		requested, err := url.Parse(uri)
		if err != nil || requested.Scheme != "http" || requested.Hostname() != registered.Hostname() || requested.Port() == "" {
			continue
		}
		port, err := strconv.Atoi(requested.Port())
		if err != nil || port < 1 || port > 65535 {
			continue
		}
		normalized := *requested
		normalized.Host = registered.Host
		if subtle.ConstantTimeCompare([]byte(r), []byte(normalized.String())) == 1 {
			return true
		}
	}
	return false
}

/*
validRedirectURI is the registration-time rule from the spec's communication
security section: https, or http on a loopback host. No fragment, no
credentials, absolute.
*/
func validRedirectURI(raw string) bool {
	if raw == "" || len(raw) > 2000 {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || !u.IsAbs() || u.Fragment != "" || strings.Contains(raw, "#") || u.User != nil || u.Host == "" {
		return false
	}
	switch u.Scheme {
	case "https":
		return true
	case "http":
		host := u.Hostname()
		return host == "localhost" || host == "127.0.0.1" || host == "::1"
	}
	return false
}

func isLoopbackRedirect(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	h := u.Hostname()
	return h == "localhost" || h == "127.0.0.1" || h == "::1"
}

func (s *oauthServer) registerClient(w http.ResponseWriter, r *http.Request) {
	allowAnyOrigin(w)
	if !s.register.allow(clientIPOf(r), s.now()) {
		oauthError(w, http.StatusTooManyRequests, "slow_down", "too many registrations from this address")
		return
	}
	var in struct {
		RedirectURIs            []string `json:"redirect_uris"`
		ClientName              string   `json:"client_name"`
		ClientURI               string   `json:"client_uri"`
		TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
		GrantTypes              []string `json:"grant_types"`
		ResponseTypes           []string `json:"response_types"`
		Scope                   string   `json:"scope"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in) != nil {
		oauthError(w, http.StatusBadRequest, "invalid_client_metadata", "body must be a JSON object")
		return
	}
	if len(in.RedirectURIs) == 0 || len(in.RedirectURIs) > 10 {
		oauthError(w, http.StatusBadRequest, "invalid_redirect_uri", "between 1 and 10 redirect_uris are required")
		return
	}
	for _, u := range in.RedirectURIs {
		if !validRedirectURI(u) {
			oauthError(w, http.StatusBadRequest, "invalid_redirect_uri", "redirect URIs must be https, or http on localhost, with no fragment")
			return
		}
	}
	method := in.TokenEndpointAuthMethod
	if method == "" {
		method = "none"
	}
	if method != "none" && method != "client_secret_post" && method != "client_secret_basic" {
		oauthError(w, http.StatusBadRequest, "invalid_client_metadata", "unsupported token_endpoint_auth_method")
		return
	}
	for _, g := range in.GrantTypes {
		if g != "authorization_code" && g != "refresh_token" {
			oauthError(w, http.StatusBadRequest, "invalid_client_metadata", "unsupported grant_type "+g)
			return
		}
	}
	for _, rt := range in.ResponseTypes {
		if rt != "code" {
			oauthError(w, http.StatusBadRequest, "invalid_client_metadata", "unsupported response_type "+rt)
			return
		}
	}
	if in.ClientURI != "" {
		if u, err := url.Parse(in.ClientURI); err != nil || u.Scheme != "https" || len(in.ClientURI) > 500 {
			in.ClientURI = ""
		}
	}

	id := clientPrefix + randomToken(18)
	secret, secretHash := "", ""
	if method != "none" {
		secret = secretPrefix + randomToken(32)
		secretHash = HashToken(secret)
	}
	name := oauthClip(strings.TrimSpace(in.ClientName), 120)
	redirects, _ := json.Marshal(in.RedirectURIs)
	db, err := s.db(r.Context())
	if err == nil {
		_, err = db.ExecContext(r.Context(), `
			INSERT INTO mcp_oauth_clients (id, client_name, client_uri, redirect_uris, token_endpoint_auth_method, secret_hash, ip)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			id, name, in.ClientURI, string(redirects), method, secretHash, oauthClip(clientIPOf(r), 64))
	}
	if err != nil {
		oauthError(w, http.StatusInternalServerError, "server_error", "registration failed")
		return
	}

	out := map[string]any{
		"client_id":                  id,
		"client_id_issued_at":        s.now().Unix(),
		"client_name":                name,
		"redirect_uris":              in.RedirectURIs,
		"grant_types":                []string{"authorization_code", "refresh_token"},
		"response_types":             []string{"code"},
		"token_endpoint_auth_method": method,
	}
	if in.ClientURI != "" {
		out["client_uri"] = in.ClientURI
	}
	if secret != "" {
		out["client_secret"] = secret
		out["client_secret_expires_at"] = 0
	}
	writeJSONNoStore(w, http.StatusCreated, out)
}

// ---------------------------------------------------------------------------
// Authorization (consent)
// ---------------------------------------------------------------------------

type authzParams struct {
	ResponseType        string `json:"response_type"`
	ClientID            string `json:"client_id"`
	RedirectURI         string `json:"redirect_uri"`
	CodeChallenge       string `json:"code_challenge"`
	CodeChallengeMethod string `json:"code_challenge_method"`
	State               string `json:"state"`
	Scope               string `json:"scope"`
	Resource            string `json:"resource"`
}

// authzProblem is a validation failure. Redirectable ones are sent back to the
// client; the others are shown on the page, because the redirect URI itself is
// not trusted yet.
type authzProblem struct {
	status       int
	code         string
	desc         string
	redirectable bool
}

var challengeRE = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
var verifierRE = regexp.MustCompile(`^[A-Za-z0-9._~-]{43,128}$`)

func (s *oauthServer) validateAuthz(ctx context.Context, p authzParams, fetch bool) (*oauthClient, []string, *authzProblem) {
	client, err := s.loadClient(ctx, p.ClientID, fetch)
	if err != nil {
		desc := "unknown client"
		if !errors.Is(err, errUnknownClient) {
			desc = "the client's metadata could not be used: " + err.Error()
		}
		return nil, nil, &authzProblem{http.StatusBadRequest, "invalid_client", desc, false}
	}
	if p.RedirectURI == "" || !client.allowsRedirect(p.RedirectURI) {
		return nil, nil, &authzProblem{http.StatusBadRequest, "invalid_request", "redirect_uri does not exactly match a registered URI", false}
	}
	// From here on the redirect URI is trusted, so errors go back to the client.
	if p.ResponseType != "code" {
		return client, nil, &authzProblem{http.StatusBadRequest, "unsupported_response_type", "only response_type=code is supported", true}
	}
	if p.CodeChallenge == "" {
		return client, nil, &authzProblem{http.StatusBadRequest, "invalid_request", "PKCE is required: send code_challenge with code_challenge_method=S256", true}
	}
	if p.CodeChallengeMethod != "S256" {
		return client, nil, &authzProblem{http.StatusBadRequest, "invalid_request", "code_challenge_method must be S256", true}
	}
	if !challengeRE.MatchString(p.CodeChallenge) {
		return client, nil, &authzProblem{http.StatusBadRequest, "invalid_request", "code_challenge is not a base64url SHA-256 digest", true}
	}
	if p.Resource != "" && !allowedResource(p.Resource) {
		return client, nil, &authzProblem{http.StatusBadRequest, "invalid_target", "this server only issues tokens for " + MCPResourceURL(), true}
	}
	requested := strings.Fields(p.Scope)
	if len(requested) == 0 {
		requested = scopeNames()
	}
	scopes, unknown := validateScopes(requested)
	if unknown != "" {
		return client, nil, &authzProblem{http.StatusBadRequest, "invalid_scope", "unknown scope " + unknown, true}
	}
	if len(scopes) == 0 {
		return client, nil, &authzProblem{http.StatusBadRequest, "invalid_scope", "request at least one supported brain scope", true}
	}
	return client, scopes, nil
}

// requireUser answers 401 unless the request carries a signed-in user (a login
// session — never an ACL token or an OAuth token: an app cannot consent for itself).
func (s *oauthServer) requireUser(w http.ResponseWriter, r *http.Request) (caller, bool) {
	c := s.svc.identify(r)
	if !c.session || c.userID == "" {
		writeJSONNoStore(w, http.StatusUnauthorized, map[string]string{"error": "sign in first"})
		return c, false
	}
	return c, true
}

// csrfOK: a cookie-authenticated unsafe request must echo togo_csrf. Bearer
// requests are not cookie-driven and are exempt, as in the auth plugin.
func csrfOK(r *http.Request) bool {
	if h := r.Header.Get("Authorization"); len(h) > 7 && strings.EqualFold(h[:7], "Bearer ") {
		return true
	}
	return csrfMatches(r)
}

func paramsFromQuery(q url.Values) authzParams {
	return authzParams{
		ResponseType:        q.Get("response_type"),
		ClientID:            q.Get("client_id"),
		RedirectURI:         q.Get("redirect_uri"),
		CodeChallenge:       q.Get("code_challenge"),
		CodeChallengeMethod: q.Get("code_challenge_method"),
		State:               q.Get("state"),
		Scope:               q.Get("scope"),
		Resource:            q.Get("resource"),
	}
}

func redirectWith(base string, params map[string]string) string {
	u, err := url.Parse(base)
	if err != nil {
		return ""
	}
	q := u.Query()
	for k, v := range params {
		if v != "" {
			q.Set(k, v)
		}
	}
	u.RawQuery = q.Encode()
	return u.String()
}

func (s *oauthServer) errorRedirect(p authzParams, code, desc string) string {
	return redirectWith(p.RedirectURI, map[string]string{
		"error": code, "error_description": desc, "state": p.State, "iss": OAuthIssuer(),
	})
}

func problemBody(s *oauthServer, p authzParams, problem *authzProblem) map[string]any {
	body := map[string]any{"error": problem.code, "error_description": problem.desc}
	if problem.redirectable {
		body["redirect_to"] = s.errorRedirect(p, problem.code, problem.desc)
	}
	return body
}

// authorizeRequest validates an authorization request for the consent page and
// returns what the page needs to render it.
func (s *oauthServer) authorizeRequest(w http.ResponseWriter, r *http.Request) {
	c, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	p := paramsFromQuery(r.URL.Query())
	client, scopes, problem := s.validateAuthz(r.Context(), p, true)
	if problem != nil {
		writeJSONNoStore(w, problem.status, problemBody(s, p, problem))
		return
	}
	redirect, _ := url.Parse(p.RedirectURI)
	offered := []scopeInfo{}
	for _, sc := range knownScopes {
		if hasScope(scopes, sc.Scope) {
			offered = append(offered, sc)
		}
	}
	brains, _ := s.svc.brainsForUser(r, c)
	writeJSONNoStore(w, http.StatusOK, map[string]any{
		"client": map[string]any{
			"id":                client.ID,
			"name":              client.Name,
			"uri":               client.URI,
			"metadata_document": client.CIMD,
		},
		"redirect_uri":       p.RedirectURI,
		"redirect_host":      redirect.Host,
		"loopback_redirect":  isLoopbackRedirect(p.RedirectURI),
		"requested_scopes":   offered,
		"write_requested":    hasScope(scopes, ScopeWrite),
		"brains":             brains,
		"user":               map[string]any{"id": c.userID, "admin": c.admin},
		"resource":           p.resourceOrDefault(),
		"access_ttl_seconds": int(oauthAccessTTL.Seconds()),
	})
}

// grantedBrain is one brain approved on the consent screen.
type grantedBrain struct {
	Namespace string `json:"namespace"`
	Write     bool   `json:"write"`
}

func (s *oauthServer) authorizeDecision(w http.ResponseWriter, r *http.Request) {
	c, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if !csrfOK(r) {
		writeJSONNoStore(w, http.StatusForbidden, map[string]string{"error": "invalid csrf token"})
		return
	}
	var in struct {
		authzParams
		Approve    bool           `json:"approve"`
		Namespaces []grantedBrain `json:"namespaces"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&in) != nil {
		writeJSONNoStore(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	p := in.authzParams
	// Re-validated in full: the page is not trusted to have shown what it was sent.
	_, requested, problem := s.validateAuthz(r.Context(), p, false)
	if problem != nil {
		writeJSONNoStore(w, problem.status, problemBody(s, p, problem))
		return
	}
	if !in.Approve {
		writeJSONNoStore(w, http.StatusOK, map[string]string{
			"redirect_to": s.errorRedirect(p, "access_denied", "the user declined the request"),
		})
		return
	}
	// Each brain must be one the user can reach right now; write needs the
	// write scope AND the user's own write access. Consent narrows, never widens.
	if len(in.Namespaces) == 0 || len(in.Namespaces) > 100 {
		writeJSONNoStore(w, http.StatusBadRequest, map[string]string{"error": "choose between 1 and 100 brains"})
		return
	}
	approved := map[string]bool{}
	anyWrite := false
	for _, b := range in.Namespaces {
		ns := strings.TrimSpace(b.Namespace)
		rd, wr := s.svc.Store.userAccess(r.Context(), c.userID, c.roles, ns)
		switch {
		case ns == "" || !rd:
			writeJSONNoStore(w, http.StatusForbidden, map[string]string{"error": "you have no access to brain " + ns})
			return
		case b.Write && !hasScope(requested, ScopeWrite):
			writeJSONNoStore(w, http.StatusBadRequest, map[string]string{"error": "the app did not ask for write access"})
			return
		case b.Write && !wr:
			writeJSONNoStore(w, http.StatusForbidden, map[string]string{"error": "you cannot write to brain " + ns})
			return
		}
		approved[ns] = approved[ns] || b.Write
		anyWrite = anyWrite || b.Write
	}
	granted := []string{ScopeRead}
	if anyWrite {
		granted = append(granted, ScopeWrite)
	}
	granted = intersectScopes(granted, requested)
	if len(granted) == 0 {
		// Only brains:write was requested; read is implied by write.
		granted = []string{ScopeWrite}
	}
	list := make([]grantedBrain, 0, len(approved))
	for ns, wr := range approved {
		list = append(list, grantedBrain{Namespace: ns, Write: wr})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Namespace < list[j].Namespace })
	nsJSON, _ := json.Marshal(list)

	code := codePrefix + randomToken(32)
	db, err := s.db(r.Context())
	if err == nil {
		_, err = db.ExecContext(r.Context(), `
			INSERT INTO mcp_oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scopes, namespaces, resource, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			HashToken(code), p.ClientID, c.userID, p.RedirectURI, p.CodeChallenge,
			strings.Join(granted, " "), string(nsJSON), p.resourceOrDefault(), s.now().Add(oauthCodeTTL))
	}
	if err != nil {
		writeJSONNoStore(w, http.StatusInternalServerError, map[string]string{"error": "could not issue a code"})
		return
	}
	writeJSONNoStore(w, http.StatusOK, map[string]string{
		"redirect_to": redirectWith(p.RedirectURI, map[string]string{
			"code": code, "state": p.State, "iss": OAuthIssuer(),
		}),
	})
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

// authenticateClient applies the client's registered token endpoint auth.
func (s *oauthServer) authenticateClient(r *http.Request) (*oauthClient, bool) {
	clientID := r.PostForm.Get("client_id")
	secret := r.PostForm.Get("client_secret")
	basic := false
	if u, p, ok := r.BasicAuth(); ok {
		if uu, err := url.QueryUnescape(u); err == nil {
			u = uu
		}
		if pp, err := url.QueryUnescape(p); err == nil {
			p = pp
		}
		if clientID != "" && clientID != u {
			return nil, false
		}
		clientID, secret, basic = u, p, true
	}
	assertionType := r.PostForm.Get("client_assertion_type")
	assertion := r.PostForm.Get("client_assertion")
	if assertion != "" && clientID == "" && !basic {
		// RFC 7523 lets client_id be omitted; the assertion's sub names the
		// client. Unverified here — verifyClientAssertion checks it.
		clientID = assertionSubject(assertion)
	}
	client, err := s.loadClient(r.Context(), clientID, false)
	if err != nil {
		return nil, false
	}
	switch client.AuthMethod {
	case "none":
		return client, true
	case "private_key_jwt":
		if basic || secret != "" || assertionType != clientAssertionType || assertion == "" {
			return nil, false
		}
		if err := s.verifyClientAssertion(r.Context(), client, assertion); err != nil {
			s.warn("oauth client assertion refused", "client_id", client.ID, "reason", err.Error())
			return nil, false
		}
		return client, true
	case "client_secret_post", "client_secret_basic":
		if client.AuthMethod == "client_secret_basic" && !basic {
			return nil, false
		}
		if client.AuthMethod == "client_secret_post" && basic {
			return nil, false
		}
		if secret == "" || subtle.ConstantTimeCompare([]byte(HashToken(secret)), []byte(client.SecretHash)) != 1 {
			return nil, false
		}
		return client, true
	}
	return nil, false
}

func (s *oauthServer) token(w http.ResponseWriter, r *http.Request) {
	allowAnyOrigin(w)
	if !s.tokenRate.allow(clientIPOf(r), s.now()) {
		oauthError(w, http.StatusTooManyRequests, "slow_down", "too many requests")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	if err := r.ParseForm(); err != nil {
		oauthError(w, http.StatusBadRequest, "invalid_request", "body must be application/x-www-form-urlencoded")
		return
	}
	client, ok := s.authenticateClient(r)
	if !ok {
		s.logRefusedClient(r)
		w.Header().Set("WWW-Authenticate", `Basic realm="oauth"`)
		oauthError(w, http.StatusUnauthorized, "invalid_client", "client authentication failed")
		return
	}
	if res := r.PostForm.Get("resource"); res != "" && !allowedResource(res) {
		oauthError(w, http.StatusBadRequest, "invalid_target", "this server only issues tokens for "+MCPResourceURL())
		return
	}
	switch r.PostForm.Get("grant_type") {
	case "authorization_code":
		s.redeemCode(w, r, client)
	case "refresh_token":
		s.redeemRefresh(w, r, client)
	default:
		oauthError(w, http.StatusBadRequest, "unsupported_grant_type", "grant_type must be authorization_code or refresh_token")
	}
}

func (s *oauthServer) redeemCode(w http.ResponseWriter, r *http.Request, client *oauthClient) {
	ctx := r.Context()
	code := r.PostForm.Get("code")
	verifier := r.PostForm.Get("code_verifier")
	redirectURI := r.PostForm.Get("redirect_uri")
	if code == "" {
		oauthError(w, http.StatusBadRequest, "invalid_request", "code is required")
		return
	}
	if verifier == "" {
		oauthError(w, http.StatusBadRequest, "invalid_request", "code_verifier is required (PKCE)")
		return
	}
	db, err := s.db(ctx)
	if err != nil {
		oauthError(w, http.StatusInternalServerError, "server_error", "could not redeem the code")
		return
	}

	// Consumed atomically before anything else is checked: a code is spent by
	// its first presentation, right or wrong.
	var (
		clientID, userID, storedRedirect, challenge, scopes, namespaces, resource string
		expires                                                                   time.Time
	)
	err = db.QueryRowContext(ctx, `
		UPDATE mcp_oauth_codes SET used_at = $2
		WHERE code_hash = $1 AND used_at IS NULL
		RETURNING client_id, user_id, redirect_uri, code_challenge, scopes, namespaces, resource, expires_at`,
		HashToken(code), s.now()).
		Scan(&clientID, &userID, &storedRedirect, &challenge, &scopes, &namespaces, &resource, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		// A replayed code: whatever the first redemption produced is now
		// suspect, so it goes (RFC 6749 section 4.1.2).
		_, _ = db.ExecContext(ctx, `
			UPDATE mcp_oauth_grants SET revoked_at = now(), updated_at = now()
			WHERE revoked_at IS NULL AND id = (SELECT grant_id FROM mcp_oauth_codes WHERE code_hash = $1 AND grant_id <> '')`,
			HashToken(code))
		oauthError(w, http.StatusBadRequest, "invalid_grant", "the code is invalid or has already been used")
		return
	}
	if err != nil {
		oauthError(w, http.StatusInternalServerError, "server_error", "could not redeem the code")
		return
	}
	switch {
	case !s.now().Before(expires):
		oauthError(w, http.StatusBadRequest, "invalid_grant", "the code has expired")
		return
	case clientID != client.ID:
		oauthError(w, http.StatusBadRequest, "invalid_grant", "the code was issued to another client")
		return
	case redirectURI != storedRedirect:
		oauthError(w, http.StatusBadRequest, "invalid_grant", "redirect_uri does not match the authorization request")
		return
	case r.PostForm.Get("resource") != "" && canonResource(r.PostForm.Get("resource")) != canonResource(resource):
		oauthError(w, http.StatusBadRequest, "invalid_target", "resource does not match the authorization request")
		return
	case !verifierRE.MatchString(verifier) || !pkceMatches(verifier, challenge):
		oauthError(w, http.StatusBadRequest, "invalid_grant", "code_verifier does not match the code_challenge")
		return
	}
	if _, active := s.svc.userRoles(ctx, userID); !active {
		oauthError(w, http.StatusBadRequest, "invalid_grant", "the approving account can no longer authorize access")
		return
	}
	var brains []grantedBrain
	if json.Unmarshal([]byte(namespaces), &brains) != nil || len(brains) == 0 {
		oauthError(w, http.StatusBadRequest, "invalid_grant", "the approval names no brains")
		return
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		oauthError(w, http.StatusInternalServerError, "server_error", "could not record the grant")
		return
	}
	defer tx.Rollback()
	var grantID string
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO mcp_oauth_grants (client_id, user_id, scopes, resource) VALUES ($1, $2, $3, $4) RETURNING id`,
		client.ID, userID, scopes, resource).Scan(&grantID); err != nil {
		oauthError(w, http.StatusInternalServerError, "server_error", "could not record the grant")
		return
	}
	for _, b := range brains {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO mcp_oauth_grant_namespaces (grant_id, namespace, can_write) VALUES ($1, $2, $3)
			ON CONFLICT (grant_id, namespace) DO UPDATE SET can_write = EXCLUDED.can_write`,
			grantID, b.Namespace, b.Write); err != nil {
			oauthError(w, http.StatusInternalServerError, "server_error", "could not record the grant")
			return
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE mcp_oauth_codes SET grant_id = $1 WHERE code_hash = $2`, grantID, HashToken(code)); err != nil {
		oauthError(w, http.StatusInternalServerError, "server_error", "could not record the grant")
		return
	}
	if err := tx.Commit(); err != nil {
		oauthError(w, http.StatusInternalServerError, "server_error", "could not record the grant")
		return
	}
	s.issueTokens(w, r, grantID, strings.Fields(scopes), brains)
}

func pkceMatches(verifier, challenge string) bool {
	sum := sha256.Sum256([]byte(verifier))
	got := base64.RawURLEncoding.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(got), []byte(challenge)) == 1
}

func (s *oauthServer) grantBrains(ctx context.Context, db *sql.DB, grantID string) []grantedBrain {
	out := []grantedBrain{}
	rows, err := db.QueryContext(ctx, `SELECT namespace, can_write FROM mcp_oauth_grant_namespaces WHERE grant_id = $1 ORDER BY namespace`, grantID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var b grantedBrain
		if rows.Scan(&b.Namespace, &b.Write) == nil {
			out = append(out, b)
		}
	}
	return out
}

func (s *oauthServer) redeemRefresh(w http.ResponseWriter, r *http.Request, client *oauthClient) {
	ctx := r.Context()
	refresh := r.PostForm.Get("refresh_token")
	if refresh == "" {
		oauthError(w, http.StatusBadRequest, "invalid_request", "refresh_token is required")
		return
	}
	db, err := s.db(ctx)
	if err != nil {
		oauthError(w, http.StatusInternalServerError, "server_error", "could not redeem the refresh token")
		return
	}
	var (
		grantID, tokenScopes string
		expires              time.Time
	)
	err = db.QueryRowContext(ctx, `
		UPDATE mcp_oauth_tokens SET used_at = $2
		WHERE token_hash = $1 AND kind = 'refresh' AND used_at IS NULL
		RETURNING grant_id, scopes, expires_at`, HashToken(refresh), s.now()).
		Scan(&grantID, &tokenScopes, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		// Rotation means a refresh token is good once. Seeing a spent one again
		// means two parties hold it, so the whole connection is revoked.
		_, _ = db.ExecContext(ctx, `
			UPDATE mcp_oauth_grants SET revoked_at = now(), updated_at = now()
			WHERE revoked_at IS NULL AND id = (SELECT grant_id FROM mcp_oauth_tokens WHERE token_hash = $1 AND kind = 'refresh')`,
			HashToken(refresh))
		oauthError(w, http.StatusBadRequest, "invalid_grant", "the refresh token is invalid or has already been used")
		return
	}
	if err != nil {
		oauthError(w, http.StatusInternalServerError, "server_error", "could not redeem the refresh token")
		return
	}
	var (
		grantClient, userID, grantScopes string
		revoked                          sql.NullTime
	)
	if err := db.QueryRowContext(ctx,
		`SELECT client_id, user_id, scopes, revoked_at FROM mcp_oauth_grants WHERE id = $1`, grantID).
		Scan(&grantClient, &userID, &grantScopes, &revoked); err != nil {
		oauthError(w, http.StatusBadRequest, "invalid_grant", "the connection no longer exists")
		return
	}
	switch {
	case revoked.Valid:
		oauthError(w, http.StatusBadRequest, "invalid_grant", "the connection has been revoked")
		return
	case grantClient != client.ID:
		oauthError(w, http.StatusBadRequest, "invalid_grant", "the refresh token was issued to another client")
		return
	case !s.now().Before(expires):
		oauthError(w, http.StatusBadRequest, "invalid_grant", "the refresh token has expired")
		return
	}
	if _, active := s.svc.userRoles(ctx, userID); !active {
		oauthError(w, http.StatusBadRequest, "invalid_grant", "the approving account can no longer authorize access")
		return
	}
	scopes := intersectScopes(strings.Fields(tokenScopes), strings.Fields(grantScopes))
	if requested := strings.Fields(r.PostForm.Get("scope")); len(requested) > 0 {
		if !subsetOf(requested, scopes) {
			oauthError(w, http.StatusBadRequest, "invalid_scope", "a refresh cannot widen the approved scopes")
			return
		}
		scopes = requested
	}
	s.issueTokens(w, r, grantID, scopes, s.grantBrains(ctx, db, grantID))
}

func (s *oauthServer) issueTokens(w http.ResponseWriter, r *http.Request, grantID string, scopes []string, brains []grantedBrain) {
	access := accessPrefix + randomToken(32)
	refresh := refreshPrefix + randomToken(32)
	now := s.now()
	joined := strings.Join(scopes, " ")
	db, err := s.db(r.Context())
	if err == nil {
		_, err = db.ExecContext(r.Context(), `
			INSERT INTO mcp_oauth_tokens (token_hash, grant_id, kind, scopes, expires_at) VALUES
			($1, $3, 'access', $4, $5), ($2, $3, 'refresh', $4, $6)`,
			HashToken(access), HashToken(refresh), grantID, joined,
			now.Add(oauthAccessTTL), now.Add(oauthRefreshTTL))
	}
	if err != nil {
		oauthError(w, http.StatusInternalServerError, "server_error", "could not issue tokens")
		return
	}
	names := make([]string, 0, len(brains))
	for _, b := range brains {
		names = append(names, b.Namespace)
	}
	writeJSONNoStore(w, http.StatusOK, map[string]any{
		"access_token":  access,
		"token_type":    "Bearer",
		"expires_in":    int(oauthAccessTTL.Seconds()),
		"refresh_token": refresh,
		"scope":         joined,
		// Informational (not an OAuth field): the brains this connection may use.
		"namespaces": names,
	})
}

// revoke implements RFC 7009. It always answers 200 for a well-formed request,
// whether or not the token existed, so it reveals nothing.
func (s *oauthServer) revoke(w http.ResponseWriter, r *http.Request) {
	allowAnyOrigin(w)
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	if err := r.ParseForm(); err != nil {
		oauthError(w, http.StatusBadRequest, "invalid_request", "form body required")
		return
	}
	client, ok := s.authenticateClient(r)
	if !ok {
		oauthError(w, http.StatusUnauthorized, "invalid_client", "client authentication failed")
		return
	}
	token := r.PostForm.Get("token")
	if token == "" {
		oauthError(w, http.StatusBadRequest, "invalid_request", "token is required")
		return
	}
	ctx := r.Context()
	if db, err := s.db(ctx); err == nil {
		var kind, grantID string
		err := db.QueryRowContext(ctx, `
			SELECT t.kind, t.grant_id FROM mcp_oauth_tokens t JOIN mcp_oauth_grants g ON g.id = t.grant_id
			WHERE t.token_hash = $1 AND g.client_id = $2`, HashToken(token), client.ID).Scan(&kind, &grantID)
		if err == nil {
			if kind == "refresh" {
				_, _ = db.ExecContext(ctx,
					`UPDATE mcp_oauth_grants SET revoked_at = now(), updated_at = now() WHERE id = $1 AND revoked_at IS NULL`, grantID)
			} else {
				_, _ = db.ExecContext(ctx, `DELETE FROM mcp_oauth_tokens WHERE token_hash = $1`, HashToken(token))
			}
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
}

// ---------------------------------------------------------------------------
// Connected apps (the signed-in user's own)
// ---------------------------------------------------------------------------

type grantView struct {
	ID         string         `json:"id"`
	ClientID   string         `json:"client_id"`
	ClientName string         `json:"client_name"`
	ClientURI  string         `json:"client_uri"`
	Scopes     []string       `json:"scopes"`
	Namespaces []grantedBrain `json:"namespaces"`
	LastUsedAt *time.Time     `json:"last_used_at"`
	RevokedAt  *time.Time     `json:"revoked_at"`
	CreatedAt  time.Time      `json:"created_at"`
}

func (s *oauthServer) listGrants(w http.ResponseWriter, r *http.Request) {
	c, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	db, err := s.db(r.Context())
	var rows *sql.Rows
	if err == nil {
		rows, err = db.QueryContext(r.Context(), `
			SELECT g.id, g.client_id, c.client_name, c.client_uri, g.scopes, g.last_used_at, g.revoked_at, g.created_at
			FROM mcp_oauth_grants g JOIN mcp_oauth_clients c ON c.id = g.client_id
			WHERE g.user_id = $1
			ORDER BY g.revoked_at IS NOT NULL, g.created_at DESC LIMIT 200`, c.userID)
	}
	if err != nil {
		writeJSONNoStore(w, http.StatusInternalServerError, map[string]string{"error": "list failed"})
		return
	}
	defer rows.Close()
	out := []grantView{}
	for rows.Next() {
		var g grantView
		var scopes string
		var last, revoked sql.NullTime
		if err := rows.Scan(&g.ID, &g.ClientID, &g.ClientName, &g.ClientURI, &scopes, &last, &revoked, &g.CreatedAt); err != nil {
			continue
		}
		g.Scopes = strings.Fields(scopes)
		if g.Scopes == nil {
			g.Scopes = []string{}
		}
		if last.Valid {
			g.LastUsedAt = &last.Time
		}
		if revoked.Valid {
			g.RevokedAt = &revoked.Time
		}
		out = append(out, g)
	}
	rows.Close()
	for i := range out {
		out[i].Namespaces = s.grantBrains(r.Context(), db, out[i].ID)
	}
	writeJSONNoStore(w, http.StatusOK, map[string]any{"grants": out})
}

func (s *oauthServer) revokeGrant(w http.ResponseWriter, r *http.Request) {
	c, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if !csrfOK(r) {
		writeJSONNoStore(w, http.StatusForbidden, map[string]string{"error": "invalid csrf token"})
		return
	}
	id := chi.URLParam(r, "id")
	db, err := s.db(r.Context())
	var res sql.Result
	if err == nil {
		// Your own connections only; an admin may revoke anyone's.
		res, err = db.ExecContext(r.Context(), `
			UPDATE mcp_oauth_grants SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
			WHERE id = $1 AND (user_id = $2 OR $3)`, id, c.userID, c.admin)
	}
	if err != nil {
		writeJSONNoStore(w, http.StatusInternalServerError, map[string]string{"error": "revoke failed"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeJSONNoStore(w, http.StatusNotFound, map[string]string{"error": "connection not found"})
		return
	}
	// Tokens are useless once the grant is revoked; deleting them is tidiness.
	_, _ = db.ExecContext(r.Context(), `DELETE FROM mcp_oauth_tokens WHERE grant_id = $1`, id)
	writeJSONNoStore(w, http.StatusOK, map[string]string{"status": "revoked"})
}

// ---------------------------------------------------------------------------
// Resource-server side: used by the /api/mcp endpoint
// ---------------------------------------------------------------------------

// authenticateOAuth resolves an OAuth access token presented to /api/mcp. The
// principal's per-brain access is still re-checked on every call (oauthCan).
func (s *oauthServer) authenticateOAuth(ctx context.Context, token string) (*Principal, bool) {
	if !strings.HasPrefix(token, accessPrefix) {
		return nil, false
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, false
	}
	var grantID, userID, grantScopes, tokenScopes, resource, clientName, clientID string
	err = db.QueryRowContext(ctx, `
		SELECT g.id, g.user_id, g.scopes, t.scopes, g.resource, c.client_name, c.id
		FROM mcp_oauth_tokens t
		JOIN mcp_oauth_grants g ON g.id = t.grant_id
		JOIN mcp_oauth_clients c ON c.id = g.client_id
		WHERE t.token_hash = $1 AND t.kind = 'access'
		  AND t.expires_at > $2 AND g.revoked_at IS NULL`,
		HashToken(token), s.now()).
		Scan(&grantID, &userID, &grantScopes, &tokenScopes, &resource, &clientName, &clientID)
	if err != nil {
		return nil, false
	}
	// Audience: a token is only good for the resource it was issued for.
	if !allowedResource(resource) {
		return nil, false
	}
	if _, active := s.svc.userRoles(ctx, userID); !active {
		return nil, false
	}
	_, _ = db.ExecContext(ctx, `UPDATE mcp_oauth_grants SET last_used_at = $1 WHERE id = $2`, s.now(), grantID)
	p := &Principal{
		UserID: userID, GrantID: grantID, ClientID: clientID, ClientName: clientName,
		Scopes:     intersectScopes(strings.Fields(tokenScopes), strings.Fields(grantScopes)),
		Namespaces: map[string]bool{},
	}
	for _, b := range s.grantBrains(ctx, db, grantID) {
		p.Namespaces[b.Namespace] = b.Write
	}
	return p, true
}

// bearerChallenge is the WWW-Authenticate value for a 401 from /api/mcp.
func bearerChallenge(r *http.Request, invalid bool) string {
	v := `Bearer realm="mcp", resource_metadata="` + protectedResourceMetadataURL(r) + `"`
	v += `, scope="` + strings.Join(scopeNames(), " ") + `"`
	if invalid {
		v += `, error="invalid_token"`
	}
	return v
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func oauthClip(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// clientIPOf is the address rate limits key on. X-Real-IP (set by the reverse
// proxy) is trusted only when the connection itself comes from a private or
// loopback address — i.e. from the proxy — so a client cannot pick its own key.
func clientIPOf(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsPrivate()) {
		if real := strings.TrimSpace(r.Header.Get("X-Real-IP")); real != "" && net.ParseIP(real) != nil {
			return real
		}
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			if last := strings.TrimSpace(parts[len(parts)-1]); net.ParseIP(last) != nil {
				return last
			}
		}
	}
	return host
}

func writeJSONNoStore(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func oauthError(w http.ResponseWriter, status int, code, desc string) {
	writeJSONNoStore(w, status, map[string]string{"error": code, "error_description": desc})
}

// allowAnyOrigin: the public OAuth endpoints use no cookies, so a wildcard
// origin grants a browser-based client nothing a server could not already do.
func allowAnyOrigin(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
}

func (s *oauthServer) preflight(w http.ResponseWriter, _ *http.Request) {
	allowAnyOrigin(w)
	w.WriteHeader(http.StatusNoContent)
}

// ipLimiter is a fixed-window counter per address, in memory.
type ipLimiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	seen   map[string]*ipWindow
}

type ipWindow struct {
	start time.Time
	n     int
}

func newIPLimiter(max int, window time.Duration) *ipLimiter {
	return &ipLimiter{max: max, window: window, seen: map[string]*ipWindow{}}
}

func (l *ipLimiter) allow(ip string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.seen) > 10000 {
		for k, v := range l.seen {
			if now.Sub(v.start) > l.window {
				delete(l.seen, k)
			}
		}
	}
	w := l.seen[ip]
	if w == nil || now.Sub(w.start) > l.window {
		l.seen[ip] = &ipWindow{start: now, n: 1}
		return true
	}
	w.n++
	return w.n <= l.max
}

// logRefusedClient records the shape of a token request whose client could not
// be authenticated: which fields were present, never their values.
func (s *oauthServer) logRefusedClient(r *http.Request) {
	basicUser, _, hasBasic := r.BasicAuth()
	clientID := r.PostForm.Get("client_id")
	stored := ""
	if clientID != "" {
		if c, err := s.loadClient(r.Context(), clientID, false); err == nil {
			stored = c.AuthMethod
		} else {
			stored = "lookup failed: " + err.Error()
		}
	}
	keys := make([]string, 0, len(r.PostForm))
	for k := range r.PostForm {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	s.warn("oauth client authentication refused",
		"client_id", clientID,
		"stored_auth_method", stored,
		"has_basic", hasBasic,
		"basic_user", basicUser,
		"has_secret", r.PostForm.Get("client_secret") != "",
		"assertion_type", r.PostForm.Get("client_assertion_type"),
		"has_assertion", r.PostForm.Get("client_assertion") != "",
		"assertion_sub", assertionSubject(r.PostForm.Get("client_assertion")),
		"grant_type", r.PostForm.Get("grant_type"),
		"content_type", r.Header.Get("Content-Type"),
		"form_keys", strings.Join(keys, ","))
}

// resourceOrDefault is the resource the authorization is bound to (RFC 8707):
// the one the client asked for (already validated), else the canonical one.
func (p authzParams) resourceOrDefault() string {
	if p.Resource != "" {
		return canonResource(p.Resource)
	}
	return MCPResourceURL()
}
