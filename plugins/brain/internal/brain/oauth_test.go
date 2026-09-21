package brain

/*
OAuth 2.1 for /api/mcp, ported from fadymondy.com (internal/mcp/oauth_test.go)
and adapted to Zekra's per-user, per-brain consent. Database-backed: set
TEST_DATABASE_URL (see harness_test.go).
*/

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

const testIssuer = "https://p1.zekra.example.test"
const redirect = "https://client.example.test/callback"

type oauthFix struct {
	*fix
	s       *oauthServer
	clock   time.Time
	owner   string // a member (owner) of f.brain, no admin role
	visitor string // signed in, no brains
	brain   string // alice's brain
	other   string // a brain alice cannot reach
}

func newOAuthFix(t *testing.T) *oauthFix {
	base := newFix(t)
	f := &oauthFix{fix: base, s: base.svc.oauth, owner: "u-alice", visitor: "u-carol",
		brain: base.ns("alice"), other: base.ns("bob")}
	f.clock = time.Now().UTC()
	f.s.now = func() time.Time { return f.clock }
	f.s.fetchCIMD = func(context.Context, string) ([]byte, error) { return nil, errors.New("no network in tests") }
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner'), ($2,'u-bob','owner')`, f.brain, f.other)
	t.Cleanup(func() {
		db, _ := f.svc.Store.db(context.Background())
		_, _ = db.Exec(`DELETE FROM mcp_oauth_clients WHERE id LIKE 'https://fm283-%' OR id LIKE 'https://p1-%' OR client_name LIKE 'p1 %' OR client_name = ''`)
		_, _ = db.Exec(`DELETE FROM mcp_oauth_grants WHERE user_id LIKE 'u-%'`)
		_, _ = db.Exec(`DELETE FROM mcp_oauth_codes WHERE user_id LIKE 'u-%'`)
	})
	return f
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any { return decodeMap(t, rec) }

func pkcePair() (verifier, challenge string) {
	verifier = randomToken(48)
	sum := sha256.Sum256([]byte(verifier))
	return verifier, base64.RawURLEncoding.EncodeToString(sum[:])
}

func (f *oauthFix) do(r *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	f.router.ServeHTTP(rec, r)
	return rec
}

func (f *oauthFix) register(body string) (string, *httptest.ResponseRecorder) {
	req := httptest.NewRequest(http.MethodPost, "/api/oauth/register", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := f.do(req)
	id, _ := decode(f.t, rec)["client_id"].(string)
	return id, rec
}

func (f *oauthFix) client() string {
	f.t.Helper()
	id, rec := f.register(`{"client_name":"p1 client","redirect_uris":["` + redirect + `"]}`)
	if rec.Code != http.StatusCreated || id == "" {
		f.t.Fatalf("register: %d %s", rec.Code, rec.Body)
	}
	return id
}

func authzQuery(clientID, challenge, scope string) url.Values {
	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", clientID)
	q.Set("redirect_uri", redirect)
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	q.Set("state", "st-1")
	q.Set("scope", scope)
	q.Set("resource", testIssuer+"/api/mcp")
	return q
}

// withSession signs a request in as user (the test directory reads X-Test-User)
// and adds the CSRF double-submit pair.
func withSession(r *http.Request, user string) *http.Request {
	if user != "" {
		r.Header.Set("X-Test-User", user)
	}
	r.AddCookie(&http.Cookie{Name: "togo_csrf", Value: "csrf-1"})
	r.Header.Set("X-CSRF-Token", "csrf-1")
	return r
}

func (f *oauthFix) authorizeRequest(user string, q url.Values) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/api/oauth/authorize/request?"+q.Encode(), nil)
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	return f.do(req)
}

// decide posts the consent decision. Each brain is "ns" (read) or "ns+w" (read+write).
func (f *oauthFix) decide(user string, q url.Values, approve bool, brains []string) *httptest.ResponseRecorder {
	body := map[string]any{"approve": approve}
	var list []map[string]any
	for _, b := range brains {
		ns, w := strings.CutSuffix(b, "+w")
		list = append(list, map[string]any{"namespace": ns, "write": w})
	}
	body["namespaces"] = list
	for k := range q {
		body[k] = q.Get(k)
	}
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/oauth/authorize/decision", strings.NewReader(string(raw)))
	req.Header.Set("Content-Type", "application/json")
	return f.do(withSession(req, user))
}

func (f *oauthFix) readNS() []string  { return []string{f.brain} }
func (f *oauthFix) writeNS() []string { return []string{f.brain + "+w"} }

// code runs consent as the owner and returns the code from the redirect.
func (f *oauthFix) code(clientID, challenge, scope string, brains []string) string {
	f.t.Helper()
	rec := f.decide(f.owner, authzQuery(clientID, challenge, scope), true, brains)
	if rec.Code != http.StatusOK {
		f.t.Fatalf("decision: %d %s", rec.Code, rec.Body)
	}
	to, _ := url.Parse(decode(f.t, rec)["redirect_to"].(string))
	if to.Query().Get("state") != "st-1" || to.Query().Get("iss") != OAuthIssuer() {
		f.t.Fatalf("redirect lacks state/iss: %s", to)
	}
	if !strings.HasPrefix(to.String(), redirect+"?") {
		f.t.Fatalf("redirected somewhere else: %s", to)
	}
	return to.Query().Get("code")
}

func (f *oauthFix) token(form url.Values) (*httptest.ResponseRecorder, map[string]any) {
	req := httptest.NewRequest(http.MethodPost, "/api/oauth/token", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := f.do(req)
	return rec, decode(f.t, rec)
}

func codeForm(clientID, code, verifier string) url.Values {
	return url.Values{
		"grant_type": {"authorization_code"}, "client_id": {clientID}, "code": {code},
		"redirect_uri": {redirect}, "code_verifier": {verifier}, "resource": {testIssuer + "/api/mcp"},
	}
}

// fullFlow returns an access and refresh token for the given scope and brains.
func (f *oauthFix) fullFlow(scope string, brains []string) (clientID, access, refresh string) {
	f.t.Helper()
	clientID = f.client()
	verifier, challenge := pkcePair()
	code := f.code(clientID, challenge, scope, brains)
	rec, body := f.token(codeForm(clientID, code, verifier))
	if rec.Code != http.StatusOK {
		f.t.Fatalf("token: %d %s", rec.Code, rec.Body)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		f.t.Error("token response must be no-store")
	}
	return clientID, body["access_token"].(string), body["refresh_token"].(string)
}

// mcp calls /api/mcp with a bearer token.
func (f *oauthFix) mcp(token, method string, params any) (int, map[string]any) {
	body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	req := httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := f.do(req)
	return rec.Code, decode(f.t, rec)
}

// call runs tools/call and returns the tool's decoded payload and isError.
func (f *oauthFix) call(token, tool string, args map[string]any) (map[string]any, bool) {
	f.t.Helper()
	code, body := f.mcp(token, "tools/call", map[string]any{"name": tool, "arguments": args})
	if code != http.StatusOK {
		f.t.Fatalf("tools/call %s: %d %v", tool, code, body)
	}
	res, _ := body["result"].(map[string]any)
	isErr, _ := res["isError"].(bool)
	content, _ := res["content"].([]any)
	payload := map[string]any{}
	if len(content) > 0 {
		text, _ := content[0].(map[string]any)["text"].(string)
		_ = json.Unmarshal([]byte(text), &payload)
	}
	return payload, isErr
}

func (f *oauthFix) toolNames(token string) (int, map[string]bool) {
	code, body := f.mcp(token, "tools/list", map[string]any{})
	names := map[string]bool{}
	if res, ok := body["result"].(map[string]any); ok {
		for _, tl := range res["tools"].([]any) {
			names[tl.(map[string]any)["name"].(string)] = true
		}
	}
	return code, names
}

func oauthJSON(v any) []byte { b, _ := json.Marshal(v); return b }

func TestOAuthToleratesChatGPTAuxiliaryScopesWithoutGrantingThem(t *testing.T) {
	scopes, unknown := validateScopes(strings.Fields("openid profile email brains:write offline_access brains:read"))
	if unknown != "" {
		t.Fatalf("ChatGPT auxiliary scope rejected: %s", unknown)
	}
	want := []string{ScopeRead, ScopeWrite}
	if len(scopes) != len(want) || scopes[0] != want[0] || scopes[1] != want[1] {
		t.Fatalf("auxiliary scopes leaked into the grant: got %v, want %v", scopes, want)
	}
	if _, unknown := validateScopes([]string{"admin"}); unknown != "admin" {
		t.Fatalf("unrecognized scope was tolerated: %q", unknown)
	}
}

// ─────────────────────────────────────────────────────────────────────────────

func TestOAuthMetadataAndChallenge(t *testing.T) {
	f := newOAuthFix(t)
	t.Setenv("ZEKRA_OAUTH_AUTHORIZE_PATH", "/en/oauth/authorize")

	rec := f.do(httptest.NewRequest(http.MethodGet, "/.well-known/oauth-authorization-server", nil))
	md := decode(t, rec)
	if md["issuer"] != testIssuer || md["token_endpoint"] != testIssuer+"/api/oauth/token" ||
		md["authorization_endpoint"] != testIssuer+"/en/oauth/authorize" ||
		md["registration_endpoint"] != testIssuer+"/api/oauth/register" {
		t.Fatalf("metadata: %s", rec.Body)
	}
	if m, _ := md["code_challenge_methods_supported"].([]any); len(m) != 1 || m[0] != "S256" {
		t.Fatalf("code_challenge_methods_supported must be exactly [S256]: %v", md["code_challenge_methods_supported"])
	}
	if md["authorization_response_iss_parameter_supported"] != true {
		t.Fatal("iss parameter (RFC 9207) not advertised")
	}
	for _, p := range []string{"/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"} {
		pr := decode(t, f.do(httptest.NewRequest(http.MethodGet, p, nil)))
		if pr["resource"] != testIssuer+"/api/mcp" {
			t.Fatalf("%s: %v", p, pr)
		}
		if as, _ := pr["authorization_servers"].([]any); len(as) != 1 || as[0] != testIssuer {
			t.Fatalf("%s authorization_servers: %v", p, pr)
		}
	}

	req := httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	res := f.do(req)
	www := res.Header().Get("WWW-Authenticate")
	if res.Code != http.StatusUnauthorized || !strings.Contains(www, `resource_metadata="`+testIssuer+`/.well-known/oauth-protected-resource/api/mcp"`) {
		t.Fatalf("401 must point at the resource metadata: %d %q", res.Code, www)
	}
	// A bad bearer is invalid_token.
	req = httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(`{}`))
	req.Header.Set("Authorization", "Bearer zko_at_nope")
	if res := f.do(req); res.Code != http.StatusUnauthorized || !strings.Contains(res.Header().Get("WWW-Authenticate"), `error="invalid_token"`) {
		t.Fatalf("bad bearer: %d %q", res.Code, res.Header().Get("WWW-Authenticate"))
	}
}

func TestOAuthDoesNotAdvertiseOpenIDDiscovery(t *testing.T) {
	f := newOAuthFix(t)
	res := f.do(httptest.NewRequest(http.MethodGet, "/.well-known/openid-configuration", nil))
	if res.Code != http.StatusNotFound {
		t.Fatalf("openid discovery status = %d, want 404", res.Code)
	}
}

func TestOAuthPKCERequiredAndPlainRejected(t *testing.T) {
	f := newOAuthFix(t)
	client := f.client()
	_, challenge := pkcePair()

	for name, mutate := range map[string]func(url.Values){
		"missing challenge": func(q url.Values) { q.Del("code_challenge"); q.Del("code_challenge_method") },
		"plain method":      func(q url.Values) { q.Set("code_challenge_method", "plain") },
		"no method":         func(q url.Values) { q.Del("code_challenge_method") },
		"malformed":         func(q url.Values) { q.Set("code_challenge", "short") },
	} {
		q := authzQuery(client, challenge, ScopeRead)
		mutate(q)
		for _, rec := range []*httptest.ResponseRecorder{
			f.authorizeRequest(f.owner, q),
			f.decide(f.owner, q, true, f.readNS()),
		} {
			body := decode(t, rec)
			if rec.Code != http.StatusBadRequest || body["error"] != "invalid_request" {
				t.Errorf("%s: want 400 invalid_request, got %d %s", name, rec.Code, rec.Body)
			}
		}
	}
	if n := f.count(`SELECT count(*) FROM mcp_oauth_codes WHERE client_id = $1`, client); n != 0 {
		t.Fatalf("a code was issued without PKCE: %d", n)
	}

	verifier, challenge := pkcePair()
	code := f.code(client, challenge, ScopeRead, f.readNS())
	form := codeForm(client, code, verifier)
	form.Del("code_verifier")
	if rec, body := f.token(form); rec.Code != http.StatusBadRequest || body["error"] != "invalid_request" {
		t.Fatalf("redeemed without a verifier: %d %s", rec.Code, rec.Body)
	}
}

func TestOAuthWrongVerifierRefused(t *testing.T) {
	f := newOAuthFix(t)
	client := f.client()
	_, challenge := pkcePair()
	other, _ := pkcePair()
	code := f.code(client, challenge, ScopeRead, f.readNS())
	rec, body := f.token(codeForm(client, code, other))
	if rec.Code != http.StatusBadRequest || body["error"] != "invalid_grant" || body["access_token"] != nil {
		t.Fatalf("wrong verifier: %d %s", rec.Code, rec.Body)
	}
	if n := f.count(`SELECT count(*) FROM mcp_oauth_grants g WHERE g.client_id = $1`, client); n != 0 {
		t.Fatalf("a grant was created for a wrong verifier")
	}
}

func TestOAuthCodeIsSingleUseAndExpires(t *testing.T) {
	f := newOAuthFix(t)
	client := f.client()
	verifier, challenge := pkcePair()
	code := f.code(client, challenge, ScopeRead, f.readNS())

	rec, body := f.token(codeForm(client, code, verifier))
	if rec.Code != http.StatusOK {
		t.Fatalf("first redemption: %d %s", rec.Code, rec.Body)
	}
	access := body["access_token"].(string)
	if c, _ := f.mcp(access, "tools/list", nil); c != http.StatusOK {
		t.Fatalf("fresh access token refused: %d", c)
	}

	rec, body = f.token(codeForm(client, code, verifier))
	if rec.Code != http.StatusBadRequest || body["error"] != "invalid_grant" {
		t.Fatalf("second redemption: %d %s", rec.Code, rec.Body)
	}
	if c, _ := f.mcp(access, "tools/list", nil); c != http.StatusUnauthorized {
		t.Fatalf("access token survived a replayed code: %d", c)
	}

	verifier, challenge = pkcePair()
	code = f.code(client, challenge, ScopeRead, f.readNS())
	f.clock = f.clock.Add(oauthCodeTTL + time.Second)
	rec, body = f.token(codeForm(client, code, verifier))
	if rec.Code != http.StatusBadRequest || body["error"] != "invalid_grant" {
		t.Fatalf("expired code redeemed: %d %s", rec.Code, rec.Body)
	}
}

func TestOAuthRedirectURIMustMatchExactly(t *testing.T) {
	f := newOAuthFix(t)
	client := f.client()
	_, challenge := pkcePair()

	for _, bad := range []string{
		redirect + "/", redirect + "?x=1", strings.ToUpper(redirect), "https://client.example.test/callbac",
		redirect + "#frag", "https://evil.example.test/callback", "",
	} {
		q := authzQuery(client, challenge, ScopeRead)
		q.Set("redirect_uri", bad)
		for _, rec := range []*httptest.ResponseRecorder{f.authorizeRequest(f.owner, q), f.decide(f.owner, q, true, f.readNS())} {
			body := decode(t, rec)
			if rec.Code != http.StatusBadRequest || body["redirect_to"] != nil {
				t.Errorf("redirect_uri %q: want 400 with no redirect, got %d %s", bad, rec.Code, rec.Body)
			}
		}
	}

	verifier, challenge := pkcePair()
	code := f.code(client, challenge, ScopeRead, f.readNS())
	form := codeForm(client, code, verifier)
	form.Set("redirect_uri", redirect+"/")
	if rec, body := f.token(form); rec.Code != http.StatusBadRequest || body["error"] != "invalid_grant" {
		t.Fatalf("token with a different redirect_uri: %d %s", rec.Code, rec.Body)
	}

	for _, uri := range []string{"http://client.example.test/cb", "https://x.test/cb#f", "javascript:alert(1)", "cursor://x/cb", "/relative"} {
		if _, rec := f.register(`{"client_name":"p1 bad","redirect_uris":["` + uri + `"]}`); rec.Code != http.StatusBadRequest {
			t.Errorf("registered redirect %q: %d", uri, rec.Code)
		}
	}
	if _, rec := f.register(`{"client_name":"p1 loop","redirect_uris":["http://127.0.0.1:33418/cb"]}`); rec.Code != http.StatusCreated {
		t.Errorf("loopback redirect refused: %d %s", rec.Code, rec.Body)
	}
}

func TestOAuthLoopbackRedirectAllowsDynamicPort(t *testing.T) {
	for _, registered := range []string{
		"http://127.0.0.1/callback",
		"http://localhost/callback",
		"http://[::1]/callback",
	} {
		client := &oauthClient{RedirectURIs: []string{registered}}
		u, err := url.Parse(registered)
		if err != nil {
			t.Fatal(err)
		}
		u.Host = net.JoinHostPort(u.Hostname(), "50722")
		if !client.allowsRedirect(u.String()) {
			t.Errorf("dynamic loopback port rejected: registered %q, requested %q", registered, u.String())
		}
	}

	client := &oauthClient{RedirectURIs: []string{"http://127.0.0.1/callback?client=codex"}}
	for _, bad := range []string{
		"http://127.0.0.1:50722/other?client=codex",
		"http://127.0.0.1:50722/callback?client=other",
		"http://localhost:50722/callback?client=codex",
		"http://127.0.0.1:0/callback?client=codex",
		"http://127.0.0.1:65536/callback?client=codex",
		"https://127.0.0.1:50722/callback?client=codex",
	} {
		if client.allowsRedirect(bad) {
			t.Errorf("unsafe loopback redirect accepted: %q", bad)
		}
	}

	fixed := &oauthClient{RedirectURIs: []string{"http://127.0.0.1:33418/callback"}}
	if fixed.allowsRedirect("http://127.0.0.1:50722/callback") {
		t.Error("a registered fixed port was treated as an ephemeral port")
	}
}

func TestOAuthConsentIsPerUserAndPerBrain(t *testing.T) {
	f := newOAuthFix(t)
	client := f.client()
	_, challenge := pkcePair()
	q := authzQuery(client, challenge, ScopeRead+" "+ScopeWrite)

	// Any signed-in user may open the consent page; it lists THEIR brains only.
	rec := f.authorizeRequest(f.owner, q)
	body := decode(t, rec)
	if rec.Code != http.StatusOK || !strings.Contains(string(oauthJSON(body["brains"])), f.brain) ||
		strings.Contains(string(oauthJSON(body["brains"])), f.other) {
		t.Fatalf("consent request brains: %d %s", rec.Code, rec.Body)
	}
	if body["write_requested"] != true {
		t.Fatalf("write_requested: %v", body)
	}
	if rec := f.authorizeRequest("", q); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous consent request: %d", rec.Code)
	}
	// A user cannot hand out a brain they cannot reach…
	if rec := f.decide(f.owner, q, true, []string{f.other}); rec.Code != http.StatusForbidden {
		t.Errorf("granted someone else's brain: %d %s", rec.Code, rec.Body)
	}
	// …nor write to a brain they only view…
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','viewer')`, f.ns("viewonly"))
	if rec := f.decide(f.owner, q, true, []string{f.ns("viewonly") + "+w"}); rec.Code != http.StatusForbidden {
		t.Errorf("granted write on a view-only brain: %d %s", rec.Code, rec.Body)
	}
	// …nor grant write when the app only asked to read.
	qr := authzQuery(client, challenge, ScopeRead)
	if rec := f.decide(f.owner, qr, true, f.writeNS()); rec.Code != http.StatusBadRequest {
		t.Errorf("widened to write at consent: %d %s", rec.Code, rec.Body)
	}
	// Approval needs at least one brain, a session and the CSRF echo.
	if rec := f.decide(f.owner, q, true, nil); rec.Code != http.StatusBadRequest {
		t.Errorf("approved with no brains: %d", rec.Code)
	}
	if rec := f.decide("", q, true, f.readNS()); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous approval: %d", rec.Code)
	}
	raw, _ := json.Marshal(map[string]any{"approve": true, "client_id": client})
	req := httptest.NewRequest(http.MethodPost, "/api/oauth/authorize/decision", strings.NewReader(string(raw)))
	req.Header.Set("X-Test-User", f.owner)
	if rec := f.do(req); rec.Code != http.StatusForbidden {
		t.Errorf("approval without CSRF: %d", rec.Code)
	}
	if n := f.count(`SELECT count(*) FROM mcp_oauth_codes WHERE client_id = $1`, client); n != 0 {
		t.Fatalf("refused decisions produced %d codes", n)
	}
	// Denial goes back to the client as access_denied.
	rec = f.decide(f.owner, q, false, nil)
	to, _ := url.Parse(decode(t, rec)["redirect_to"].(string))
	if to.Query().Get("error") != "access_denied" || to.Query().Get("state") != "st-1" {
		t.Fatalf("denial redirect: %s", to)
	}
	// Unknown scopes go back to the client.
	if rec := f.authorizeRequest(f.owner, authzQuery(client, challenge, "brains:read root")); decode(t, rec)["error"] != "invalid_scope" {
		t.Fatalf("unknown scope: %s", rec.Body)
	}
}

func TestOAuthGrantEnforcedOnEveryCall(t *testing.T) {
	f := newOAuthFix(t)
	f.seedMemory(f.brain, "alice's brain remembers the launch date is March")
	f.seedMemory(f.other, "bob's secret plan")

	// Read-only connection to alice's brain.
	_, access, refresh := f.fullFlow(ScopeRead+" "+ScopeWrite, f.readNS())
	code, names := f.toolNames(access)
	if code != http.StatusOK || !names["memory_recall"] || !names["note_list"] {
		t.Fatalf("tools/list: %d %v", code, names)
	}
	for _, hidden := range []string{"brain_delete", "brain_create_token", "brain_grant", "secret_reveal", "datasource_create"} {
		if names[hidden] {
			t.Errorf("an OAuth app is offered %s", hidden)
		}
	}
	// The approval narrowed to read, so no write tools either.
	if names["memory_retain"] || names["note_create"] {
		t.Errorf("a read-only grant lists write tools: %v", names)
	}
	if payload, isErr := f.call(access, "memory_get", map[string]any{"namespace": f.other, "id": "00000000-0000-0000-0000-000000000000"}); !isErr {
		t.Fatalf("read another user's brain: %v", payload)
	}
	if payload, isErr := f.call(access, "memory_retain", map[string]any{"namespace": f.brain, "content": "x", "source_kind": "manual"}); !isErr ||
		!strings.Contains(string(oauthJSON(payload)), "not available") {
		t.Fatalf("a read grant wrote: %v", payload)
	}
	list, isErr := f.call(access, "brain_list", nil)
	if isErr || !strings.Contains(string(oauthJSON(list)), f.brain) || strings.Contains(string(oauthJSON(list)), f.other) {
		t.Fatalf("brain_list must show only granted brains: %v", list)
	}

	// Removing the user from the brain cuts the app off at once, token unchanged.
	f.exec(`DELETE FROM brain_members WHERE namespace=$1 AND user_id='u-alice'`, f.brain)
	if payload, isErr := f.call(access, "note_list", map[string]any{"namespace": f.brain}); !isErr {
		t.Fatalf("the app outlived the user's membership: %v", payload)
	}
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner')`, f.brain)

	// A disabled account's tokens stop working and cannot refresh.
	f.dir.mu.Lock()
	f.dir.gone["u-alice"] = true
	f.dir.mu.Unlock()
	if c, _ := f.mcp(access, "tools/list", nil); c != http.StatusUnauthorized {
		t.Fatalf("a disabled user's token still works: %d", c)
	}
	f.dir.mu.Lock()
	delete(f.dir.gone, "u-alice")
	f.dir.mu.Unlock()
	_ = refresh
}

func TestOAuthWriteGrantCanCreateNotes(t *testing.T) {
	f := newOAuthFix(t)
	_, access, _ := f.fullFlow(ScopeRead+" "+ScopeWrite, f.writeNS())
	_, names := f.toolNames(access)
	if !names["note_create"] || !names["memory_retain"] {
		t.Fatalf("write grant lacks write tools: %v", names)
	}
	note, isErr := f.call(access, "note_create", map[string]any{"namespace": f.brain, "title": "From Claude", "body": "Remember the Q3 plan."})
	if isErr || note["id"] == nil || note["source"] != "agent" || note["ownerUserId"] != "u-alice" {
		t.Fatalf("note_create: %v", note)
	}
	if _, isErr := f.call(access, "note_create", map[string]any{"namespace": f.other, "title": "x"}); !isErr {
		t.Fatal("wrote a note into a brain outside the grant")
	}
	app, isErr := f.call(access, "note_append", map[string]any{"id": note["id"], "text": "Also: hire."})
	if isErr || !strings.Contains(app["body"].(string), "Also: hire.") {
		t.Fatalf("note_append: %v", app)
	}
	if n := f.count(`SELECT count(*) FROM memories WHERE namespace=$1 AND source_kind='note' AND invalid_at IS NULL AND owner_agent_id LIKE 'oauth:%'`, f.brain); n == 0 {
		t.Fatal("the app's note was not indexed under its oauth identity")
	}
}

func TestOAuthExpiredOrRevokedAccessTokenRefused(t *testing.T) {
	f := newOAuthFix(t)

	_, access, _ := f.fullFlow(ScopeRead, f.readNS())
	if c, _ := f.mcp(access, "tools/list", nil); c != http.StatusOK {
		t.Fatalf("fresh token refused: %d", c)
	}
	f.exec(`UPDATE mcp_oauth_tokens SET expires_at = $2 WHERE token_hash = $1`, HashToken(access), f.clock.Add(-time.Second))
	if c, _ := f.mcp(access, "tools/list", nil); c != http.StatusUnauthorized {
		t.Fatalf("expired token accepted: %d", c)
	}

	// Revoked from the connected-apps list — only by its own user.
	_, access, refresh := f.fullFlow(ScopeRead, f.readNS())
	var grantID string
	db, _ := f.svc.Store.db(context.Background())
	if err := db.QueryRow(`SELECT grant_id FROM mcp_oauth_tokens WHERE token_hash = $1`, HashToken(access)).Scan(&grantID); err != nil {
		t.Fatal(err)
	}
	list := decode(t, f.do(withSession(httptest.NewRequest(http.MethodGet, "/api/oauth/grants", nil), f.owner)))
	if !strings.Contains(string(oauthJSON(list)), grantID) || !strings.Contains(string(oauthJSON(list)), f.brain) {
		t.Fatalf("grant (with its brains) missing from my connected apps: %v", list)
	}
	other := decode(t, f.do(withSession(httptest.NewRequest(http.MethodGet, "/api/oauth/grants", nil), f.visitor)))
	if strings.Contains(string(oauthJSON(other)), grantID) {
		t.Fatalf("another user sees my connection: %v", other)
	}
	if rec := f.do(withSession(httptest.NewRequest(http.MethodPost, "/api/oauth/grants/"+grantID+"/revoke", nil), f.visitor)); rec.Code != http.StatusNotFound {
		t.Fatalf("another user revoked my grant: %d", rec.Code)
	}
	if rec := f.do(withSession(httptest.NewRequest(http.MethodPost, "/api/oauth/grants/"+grantID+"/revoke", nil), f.owner)); rec.Code != http.StatusOK {
		t.Fatalf("owner revoke: %d %s", rec.Code, rec.Body)
	}
	if c, _ := f.mcp(access, "tools/list", nil); c != http.StatusUnauthorized {
		t.Fatalf("revoked grant's token accepted: %d", c)
	}
	if rec, _ := f.token(url.Values{"grant_type": {"refresh_token"}, "client_id": {f.clientOf(grantID)}, "refresh_token": {refresh}}); rec.Code != http.StatusBadRequest {
		t.Fatalf("revoked grant refreshed: %d", rec.Code)
	}

	// Revoked through RFC 7009 by the client itself.
	client, access, _ := f.fullFlow(ScopeRead, f.readNS())
	req := httptest.NewRequest(http.MethodPost, "/api/oauth/revoke", strings.NewReader(url.Values{"token": {access}, "client_id": {client}}.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if rec := f.do(req); rec.Code != http.StatusOK {
		t.Fatalf("revoke endpoint: %d", rec.Code)
	}
	if c, _ := f.mcp(access, "tools/list", nil); c != http.StatusUnauthorized {
		t.Fatalf("self-revoked token accepted: %d", c)
	}

	// A token issued for another resource is not accepted here (audience).
	_, access, _ = f.fullFlow(ScopeRead, f.readNS())
	f.exec(`UPDATE mcp_oauth_grants SET resource = 'https://other.example.test/api/mcp'
		WHERE id = (SELECT grant_id FROM mcp_oauth_tokens WHERE token_hash = $1)`, HashToken(access))
	if c, _ := f.mcp(access, "tools/list", nil); c != http.StatusUnauthorized {
		t.Fatalf("token for another audience accepted: %d", c)
	}
}

func (f *oauthFix) clientOf(grantID string) string {
	var id string
	db, _ := f.svc.Store.db(context.Background())
	_ = db.QueryRow(`SELECT client_id FROM mcp_oauth_grants WHERE id = $1`, grantID).Scan(&id)
	return id
}

func TestOAuthRefreshRotation(t *testing.T) {
	f := newOAuthFix(t)
	client, access1, refresh1 := f.fullFlow(ScopeRead, f.readNS())

	rec, body := f.token(url.Values{"grant_type": {"refresh_token"}, "client_id": {client}, "refresh_token": {refresh1}})
	if rec.Code != http.StatusOK {
		t.Fatalf("refresh: %d %s", rec.Code, rec.Body)
	}
	access2, refresh2 := body["access_token"].(string), body["refresh_token"].(string)
	if refresh2 == refresh1 || access2 == access1 || body["scope"] != ScopeRead {
		t.Fatalf("refresh did not rotate: %v", body)
	}
	if c, _ := f.mcp(access2, "tools/list", nil); c != http.StatusOK {
		t.Fatalf("rotated access token refused: %d", c)
	}
	// A refresh cannot widen the scope.
	if rec, body := f.token(url.Values{"grant_type": {"refresh_token"}, "client_id": {client}, "refresh_token": {refresh2},
		"scope": {ScopeRead + " " + ScopeWrite}}); rec.Code != http.StatusBadRequest || body["error"] != "invalid_scope" {
		t.Fatalf("refresh widened scopes: %d %s", rec.Code, rec.Body)
	}

	// The old refresh token is spent, and presenting it again revokes the grant.
	rec, body = f.token(url.Values{"grant_type": {"refresh_token"}, "client_id": {client}, "refresh_token": {refresh1}})
	if rec.Code != http.StatusBadRequest || body["error"] != "invalid_grant" {
		t.Fatalf("old refresh token reused: %d %s", rec.Code, rec.Body)
	}
	if c, _ := f.mcp(access2, "tools/list", nil); c != http.StatusUnauthorized {
		t.Fatalf("refresh reuse did not revoke the grant: %d", c)
	}

	// A refresh token is bound to its client.
	_, _, refresh := f.fullFlow(ScopeRead, f.readNS())
	other := f.client()
	if rec, _ := f.token(url.Values{"grant_type": {"refresh_token"}, "client_id": {other}, "refresh_token": {refresh}}); rec.Code != http.StatusBadRequest {
		t.Fatalf("another client used the refresh token: %d", rec.Code)
	}
}

func TestOAuthConfidentialClientSecret(t *testing.T) {
	f := newOAuthFix(t)
	_, rec := f.register(`{"client_name":"p1 conf","redirect_uris":["` + redirect + `"],"token_endpoint_auth_method":"client_secret_post"}`)
	body := decode(t, rec)
	client, secret := body["client_id"].(string), body["client_secret"].(string)
	if n := f.count(`SELECT count(*) FROM mcp_oauth_clients WHERE id = $1 AND secret_hash = $2`, client, HashToken(secret)); n != 1 {
		t.Fatal("client secret not stored hashed")
	}
	verifier, challenge := pkcePair()
	code := f.code(client, challenge, ScopeRead, f.readNS())
	form := codeForm(client, code, verifier)
	form.Set("client_secret", "wrong")
	if rec, body := f.token(form); rec.Code != http.StatusUnauthorized || body["error"] != "invalid_client" {
		t.Fatalf("wrong client secret: %d %s", rec.Code, rec.Body)
	}
	verifier, challenge = pkcePair()
	code = f.code(client, challenge, ScopeRead, f.readNS())
	form = codeForm(client, code, verifier)
	form.Set("client_secret", secret)
	if rec, _ := f.token(form); rec.Code != http.StatusOK {
		t.Fatalf("right client secret: %d %s", rec.Code, rec.Body)
	}
	// Nothing usable is stored in the clear.
	if n := f.count(`SELECT count(*) FROM mcp_oauth_tokens WHERE token_hash LIKE 'zko_%'`); n != 0 {
		t.Fatal("a plaintext token was stored")
	}
}

func TestOAuthClientMetadataDocument(t *testing.T) {
	f := newOAuthFix(t)
	id := "https://p1-client.example.test/oauth/client.json"
	doc := map[string]any{"client_id": id, "client_name": "P1 Published", "redirect_uris": []string{redirect}, "token_endpoint_auth_method": "none"}
	f.s.fetchCIMD = func(_ context.Context, u string) ([]byte, error) {
		if u != id {
			return nil, errors.New("unexpected fetch")
		}
		return json.Marshal(doc)
	}
	verifier, challenge := pkcePair()
	rec := f.authorizeRequest(f.owner, authzQuery(id, challenge, ScopeRead))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "P1 Published") {
		t.Fatalf("CIMD consent request: %d %s", rec.Code, rec.Body)
	}
	code := f.code(id, challenge, ScopeRead, f.readNS())
	if rec, _ := f.token(codeForm(id, code, verifier)); rec.Code != http.StatusOK {
		t.Fatalf("CIMD token: %d %s", rec.Code, rec.Body)
	}

	doc["client_id"] = "https://p1-other.example.test/client.json"
	rec = f.authorizeRequest(f.owner, authzQuery(id, challenge, ScopeRead))
	if rec.Code != http.StatusBadRequest || decode(t, rec)["error"] != "invalid_client" {
		t.Fatalf("mismatched CIMD accepted: %d %s", rec.Code, rec.Body)
	}

	for _, ip := range []string{"127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "0.0.0.0"} {
		if isPublicIP(net.ParseIP(ip)) {
			t.Errorf("%s treated as public", ip)
		}
	}
	if _, err := fetchClientMetadata(context.Background(), "https://127.0.0.1/client.json"); err == nil {
		t.Error("fetched client metadata from loopback")
	}
}

func TestOAuthRegistrationRateLimited(t *testing.T) {
	f := newOAuthFix(t)
	f.s.register = newIPLimiter(2, time.Hour)
	for i := 0; i < 2; i++ {
		if _, rec := f.register(`{"client_name":"p1 rl","redirect_uris":["` + redirect + `"]}`); rec.Code != http.StatusCreated {
			t.Fatalf("registration %d: %d", i, rec.Code)
		}
	}
	if _, rec := f.register(`{"client_name":"p1 rl","redirect_uris":["` + redirect + `"]}`); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("third registration: %d", rec.Code)
	}
	f.s.tokenRate = newIPLimiter(1, time.Minute)
	f.token(url.Values{"grant_type": {"refresh_token"}})
	if rec, _ := f.token(url.Values{"grant_type": {"refresh_token"}}); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("token endpoint not rate limited: %d", rec.Code)
	}
}

func TestACLTokensStillWorkOnRemoteMCP(t *testing.T) {
	f := newOAuthFix(t)
	agent := f.ns("agent")
	tok, err := f.svc.Store.CreateToken(context.Background(), agent, "p1", false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Store.Share(context.Background(), f.brain, agent, true, true); err != nil {
		t.Fatal(err)
	}
	// Bearer form…
	code, names := f.toolNames(tok.Token)
	if code != http.StatusOK || !names["brain_tokens"] {
		t.Fatalf("ACL token via bearer: %d (ACL tokens keep the full tool list)", code)
	}
	// …and the X-Zekra-Token header form.
	body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 7, "method": "tools/call",
		"params": map[string]any{"name": "note_create", "arguments": map[string]any{"namespace": f.brain, "title": "via token"}}})
	req := httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(string(body)))
	req.Header.Set("X-Zekra-Token", tok.Token)
	rec := f.do(req)
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), `"isError":true`) {
		t.Fatalf("ACL token note_create: %d %s", rec.Code, rec.Body)
	}
	// Its grant still binds it.
	req = httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(strings.Replace(string(body), f.brain, f.other, 1)))
	req.Header.Set("X-Zekra-Token", tok.Token)
	if rec := f.do(req); !strings.Contains(rec.Body.String(), `"isError":true`) {
		t.Fatalf("ACL token wrote outside its grant: %s", rec.Body)
	}
	// Notifications get 202; batches get an array.
	req = httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(`{"jsonrpc":"2.0","method":"notifications/initialized"}`))
	req.Header.Set("X-Zekra-Token", tok.Token)
	if rec := f.do(req); rec.Code != http.StatusAccepted {
		t.Fatalf("notification: %d", rec.Code)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(`[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}]`))
	req.Header.Set("X-Zekra-Token", tok.Token)
	rec = f.do(req)
	var arr []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &arr); err != nil || len(arr) != 2 || rec.Header().Get("Mcp-Session-Id") == "" {
		t.Fatalf("batch: %d %s", rec.Code, rec.Body)
	}
	if v := arr[1]["result"].(map[string]any)["protocolVersion"]; v != "2025-03-26" {
		t.Fatalf("protocol negotiation: %v", v)
	}
}
