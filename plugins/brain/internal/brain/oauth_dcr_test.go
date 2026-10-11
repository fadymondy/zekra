package brain

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

// The pure validation rules run without a database.

func TestRedirectURIRules(t *testing.T) {
	for _, ok := range []string{
		"https://claude.ai/api/mcp/auth_callback",
		"https://client.example.test/callback?x=1",
		"https://client.example.test:8443/cb",
		"https://203.0.113.7/cb",
		"http://127.0.0.1/callback",
		"http://127.0.0.1:33418/callback",
		"http://localhost:6274/oauth/callback",
		"http://[::1]:50722/callback",
	} {
		if p := redirectURIProblem(ok); p != "" {
			t.Errorf("%q refused: %s", ok, p)
		}
	}
	for _, bad := range []string{
		"",
		"javascript:alert(1)",
		"JavaScript://client.example.test/%0aalert(1)",
		"data:text/html,<script>alert(1)</script>",
		"file:///etc/passwd",
		"cursor://anysphere.cursor-retrieval/oauth/callback",
		"http://client.example.test/cb",
		"http://127.0.0.1.evil.example/cb",
		"http://localhost.evil.example/cb",
		"https://*.evil.example/cb",
		"https://evil.example/*",
		"https://evil.example/cb#frag",
		"https://evil.example/cb#",
		"https://user:pass@evil.example/cb",
		"https://user@evil.example/cb",
		"http://user@127.0.0.1:3000/cb",
		"https://evil.example/c b",
		"https://evil.example/cb\n",
		"https://evil.example\\@good.example/cb",
		"https://evil%2eexample/cb",
		"https://evil_host.example/cb",
		"https://-evil.example/cb",
		"https://evil..example/cb",
		"https:///cb",
		"https:evil.example/cb",
		"/relative/cb",
		"https://evil.example:99999/cb",
		"https://evil.example:0/cb",
		"https://evil.example/" + strings.Repeat("a", 2001),
	} {
		if redirectURIProblem(bad) == "" {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestClientNameRules(t *testing.T) {
	for _, ok := range []string{"", "Claude", "Claude Code (zekra)", "ChatGPT", "Cursor", "ذكرى", strings.Repeat("a", 120)} {
		if p := clientNameProblem(ok); p != "" {
			t.Errorf("%q refused: %s", ok, p)
		}
	}
	for _, bad := range []string{
		strings.Repeat("a", 121),
		"Claude‮edoc",  // right-to-left override
		"Zekra​ Admin", // zero-width space
		"line\nbreak",
		"nul\x00",
	} {
		if clientNameProblem(bad) == "" {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestRegisterLimitsPerIPAndGlobal(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	l := &registerLimits{perIP: newIPLimiter(2, time.Hour), global: newIPLimiter(3, time.Hour)}
	for i := 0; i < 2; i++ {
		if ok, _ := l.take("198.51.100.1", now); !ok {
			t.Fatalf("registration %d refused", i)
		}
	}
	ok, wait := l.take("198.51.100.1", now.Add(10*time.Minute))
	if ok || wait != 50*time.Minute {
		t.Fatalf("third registration from one address: ok=%v wait=%v", ok, wait)
	}
	if ok, _ := l.take("198.51.100.2", now); !ok {
		t.Fatal("another address refused before the global cap")
	}
	if ok, wait := l.take("198.51.100.3", now.Add(30*time.Minute)); ok || wait != 30*time.Minute {
		t.Fatalf("global cap not enforced: ok=%v wait=%v", ok, wait)
	}
	if ok, _ := l.take("198.51.100.1", now.Add(61*time.Minute)); !ok {
		t.Fatal("window did not reset")
	}
	if got := retryAfterSeconds(1500 * time.Millisecond); got != "2" {
		t.Errorf("retryAfterSeconds rounds up: got %s", got)
	}
	if got := retryAfterSeconds(0); got != "1" {
		t.Errorf("retryAfterSeconds floor: got %s", got)
	}
}

// Database-backed: the HTTP surface.

func (f *oauthFix) registerFrom(ip, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/oauth/register", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = ip + ":40000"
	return f.do(req)
}

// TestOAuthDCREndToEnd runs registration → consent → token → MCP call for the
// redirect shapes real MCP clients use: Claude Code / Cursor style loopback
// (fixed and ephemeral port, IPv4, IPv6, localhost) and hosted https callbacks.
func TestOAuthDCREndToEnd(t *testing.T) {
	f := newOAuthFix(t)
	for _, tc := range []struct{ registered, used string }{
		{"https://client.example.test/callback", "https://client.example.test/callback"},
		{"http://127.0.0.1:33418/callback", "http://127.0.0.1:33418/callback"},
		{"http://127.0.0.1/callback", "http://127.0.0.1:50722/callback"},
		{"http://localhost:6274/oauth/callback", "http://localhost:6274/oauth/callback"},
		{"http://[::1]/callback", "http://[::1]:50723/callback"},
	} {
		id, rec := f.register(`{"client_name":"p1 e2e","redirect_uris":["` + tc.registered + `"],"grant_types":["authorization_code","refresh_token"],"response_types":["code"],"token_endpoint_auth_method":"none"}`)
		if rec.Code != http.StatusCreated || id == "" {
			t.Fatalf("%s: register %d %s", tc.registered, rec.Code, rec.Body)
		}
		verifier, challenge := pkcePair()
		q := authzQuery(id, challenge, ScopeRead+" "+ScopeWrite)
		q.Set("redirect_uri", tc.used)

		page := f.authorizeRequest(f.owner, q)
		if page.Code != http.StatusOK {
			t.Fatalf("%s: consent request %d %s", tc.used, page.Code, page.Body)
		}
		info := decode(t, page)
		u, _ := url.Parse(tc.used)
		if info["redirect_hostname"] != u.Hostname() {
			t.Errorf("%s: redirect_hostname = %v", tc.used, info["redirect_hostname"])
		}
		client := info["client"].(map[string]any)
		if client["name"] != "p1 e2e" || client["new"] != true || client["verified"] != false || client["registered_at"] == "" {
			t.Errorf("%s: consent client = %v", tc.used, client)
		}

		dec := f.decide(f.owner, q, true, f.writeNS())
		if dec.Code != http.StatusOK {
			t.Fatalf("%s: decision %d %s", tc.used, dec.Code, dec.Body)
		}
		to, _ := url.Parse(decode(t, dec)["redirect_to"].(string))
		if !strings.HasPrefix(to.String(), tc.used+"?") || to.Query().Get("state") != "st-1" {
			t.Fatalf("%s: redirected to %s", tc.used, to)
		}
		form := codeForm(id, to.Query().Get("code"), verifier)
		form.Set("redirect_uri", tc.used)
		tok, body := f.token(form)
		if tok.Code != http.StatusOK || body["access_token"] == nil || body["refresh_token"] == nil {
			t.Fatalf("%s: token %d %s", tc.used, tok.Code, tok.Body)
		}
		if code, names := f.toolNames(body["access_token"].(string)); code != http.StatusOK || !names["memory_recall"] {
			t.Fatalf("%s: tools/list with the token: %d %v", tc.used, code, names)
		}
	}
}

func TestOAuthDCRRejectsAbusiveRegistrations(t *testing.T) {
	f := newOAuthFix(t)
	long := strings.Repeat("A", 121)
	tenURIs := make([]string, 11)
	for i := range tenURIs {
		tenURIs[i] = `"https://client.example.test/cb` + strconv.Itoa(i) + `"`
	}
	for name, body := range map[string]string{
		"javascript":    `{"client_name":"p1 bad","redirect_uris":["javascript:alert(1)"]}`,
		"data":          `{"client_name":"p1 bad","redirect_uris":["data:text/html,hi"]}`,
		"wildcard":      `{"client_name":"p1 bad","redirect_uris":["https://*.evil.example/cb"]}`,
		"fragment":      `{"client_name":"p1 bad","redirect_uris":["https://evil.example/cb#x"]}`,
		"userinfo":      `{"client_name":"p1 bad","redirect_uris":["https://a:b@evil.example/cb"]}`,
		"plain http":    `{"client_name":"p1 bad","redirect_uris":["http://evil.example/cb"]}`,
		"one bad of 2":  `{"client_name":"p1 bad","redirect_uris":["https://ok.example/cb","javascript:x"]}`,
		"too many URIs": `{"client_name":"p1 bad","redirect_uris":[` + strings.Join(tenURIs, ",") + `]}`,
		"no URIs":       `{"client_name":"p1 bad","redirect_uris":[]}`,
		"long name":     `{"client_name":"` + long + `","redirect_uris":["https://ok.example/cb"]}`,
		"bidi name":     `{"client_name":"p1 ‮evil","redirect_uris":["https://ok.example/cb"]}`,
		"not JSON":      `client_name=x`,
	} {
		if _, rec := f.register(body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: want 400, got %d %s", name, rec.Code, rec.Body)
		}
	}
}

func TestOAuthDCRRateLimitAnswers429WithRetryAfter(t *testing.T) {
	f := newOAuthFix(t)
	f.s.register = &registerLimits{perIP: newIPLimiter(3, time.Hour), global: newIPLimiter(5, time.Hour)}
	body := `{"client_name":"p1 burst","redirect_uris":["https://client.example.test/callback"]}`
	for i := 0; i < 3; i++ {
		if rec := f.registerFrom("203.0.113.10", body); rec.Code != http.StatusCreated {
			t.Fatalf("registration %d: %d %s", i, rec.Code, rec.Body)
		}
	}
	f.clock = f.clock.Add(15 * time.Minute)
	rec := f.registerFrom("203.0.113.10", body)
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") != "2700" || decode(t, rec)["error"] != "slow_down" {
		t.Fatalf("burst: want 429 + Retry-After 2700, got %d %q %s", rec.Code, rec.Header().Get("Retry-After"), rec.Body)
	}
	// Other addresses still register until the server-wide cap is spent.
	for _, ip := range []string{"203.0.113.11", "203.0.113.12"} {
		if rec := f.registerFrom(ip, body); rec.Code != http.StatusCreated {
			t.Fatalf("%s: %d", ip, rec.Code)
		}
	}
	if rec := f.registerFrom("203.0.113.13", body); rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("global cap: %d %q", rec.Code, rec.Header().Get("Retry-After"))
	}
	// A new window lets the address register again.
	f.clock = f.clock.Add(time.Hour)
	if rec := f.registerFrom("203.0.113.10", body); rec.Code != http.StatusCreated {
		t.Fatalf("after the window: %d %s", rec.Code, rec.Body)
	}
}

func TestOAuthConsentFlagsOnlyNewClients(t *testing.T) {
	f := newOAuthFix(t)
	id := f.client()
	f.exec(`UPDATE mcp_oauth_clients SET created_at = now() - interval '3 days' WHERE id = $1`, id)
	_, challenge := pkcePair()
	info := decode(t, f.authorizeRequest(f.owner, authzQuery(id, challenge, ScopeRead)))
	if c := info["client"].(map[string]any); c["new"] != false {
		t.Errorf("a 3-day-old client is flagged new: %v", c)
	}
}

func TestOAuthPrunesStaleUnusedClients(t *testing.T) {
	f := newOAuthFix(t)
	stale, fresh := f.client(), f.client()
	used, _, _ := f.fullFlow(ScopeRead, f.readNS())
	f.exec(`UPDATE mcp_oauth_clients SET created_at = now() - interval '40 days' WHERE id IN ($1, $2)`, stale, used)

	n, err := f.s.pruneStaleClients(context.Background(), time.Now().Add(-30*24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if n < 1 {
		t.Fatalf("pruned %d", n)
	}
	for id, want := range map[string]bool{stale: false, fresh: true, used: true} {
		_, err := f.s.loadClient(context.Background(), id, false)
		if got := err == nil; got != want {
			t.Errorf("client %s exists=%v, want %v", id, got, want)
		}
	}
}
