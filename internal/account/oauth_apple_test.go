package account

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/togo-framework/auth"
)

/*
Apple's app (browser) flow, the token trade and revocation — against a fake
Apple: a JWKS (fakeIssuer) and a token + revoke endpoint that check the ES256
client secret. Resolving a user needs Postgres: see TestFlowApple* in
oauth_apple_flow_test.go.
*/

const (
	appleTestServices = "com.fadymondy.zekra.web"
	appleTestBundle   = "com.fadymondy.zekra"
	appleTestReturn   = "zekra://auth/apple"
)

// fakeApple is Apple's token and revoke endpoints. A code "a-code" (any client)
// answers an ID token for "a-sub" carrying `nonce`, and refresh token
// "rt-<client>"; revocations are recorded.
type fakeApple struct {
	t       *testing.T
	iss     *fakeIssuer
	pub     *ecdsa.PublicKey
	srv     *httptest.Server
	mu      sync.Mutex
	nonce   string
	sub     string
	email   string   // overrides baseClaims' address when set
	revoked []string // client|token
	trades  []url.Values
}

func newFakeApple(t *testing.T, pub *ecdsa.PublicKey) *fakeApple {
	t.Helper()
	f := &fakeApple{t: t, iss: newFakeIssuer(t), pub: pub, sub: "a-sub"}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		form := r.PostForm
		client := form.Get("client_id")
		if !f.secretOK(form.Get("client_secret"), client) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_client"})
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		switch r.URL.Path {
		case "/token":
			f.trades = append(f.trades, form)
			if form.Get("code") != "a-code" || form.Get("grant_type") != "authorization_code" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_grant"})
				return
			}
			claims := with(with(baseClaims(appleIssuer, client), "sub", f.sub), "nonce", f.nonce)
			if f.email != "" {
				claims = with(claims, "email", f.email)
			}
			writeJSON(w, http.StatusOK, map[string]string{"id_token": f.iss.sign(t, claims), "refresh_token": "rt-" + client, "access_token": "at"})
		case "/revoke":
			if form.Get("token_type_hint") != "refresh_token" || form.Get("token") == "" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			f.revoked = append(f.revoked, client+"|"+form.Get("token"))
			w.WriteHeader(http.StatusOK)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(f.srv.Close)
	return f
}

// secretOK: an ES256 JWT from our key, iss = team, sub = the client, aud = Apple.
func (f *fakeApple) secretOK(raw, client string) bool {
	var c jwt.RegisteredClaims
	tok, err := jwt.ParseWithClaims(raw, &c, func(*jwt.Token) (any, error) { return f.pub, nil },
		jwt.WithValidMethods([]string{"ES256"}), jwt.WithIssuer("TEAM123"), jwt.WithAudience(appleIssuer), jwt.WithExpirationRequired())
	return err == nil && tok.Header["kid"] == "KEY123" && c.Subject == client
}

func (f *fakeApple) setNonce(n string) {
	f.mu.Lock()
	f.nonce = n
	f.mu.Unlock()
}

func (f *fakeApple) revocations() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.revoked...)
}

func appleTestKey(t *testing.T) (*ecdsa.PrivateKey, string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return key, string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

// testApple: a fully configured Apple (web + native) against a fake Apple.
func testApple(t *testing.T, s *Service) (*appleAuth, *fakeApple) {
	t.Helper()
	key, _ := appleTestKey(t)
	f := newFakeApple(t, &key.PublicKey)
	cfg := appleConfig{servicesID: appleTestServices, teamID: "TEAM123", keyID: "KEY123", key: key,
		bundleIDs: []string{appleTestBundle}, redirectURL: "https://app.example/api/auth/apple/callback", appScheme: "zekra"}
	if s == nil {
		s = &Service{}
	}
	a := newAppleAuth(s, cfg, newJWKS(f.iss.srv.URL))
	a.tokens.tokenURL, a.tokens.revokeURL = f.srv.URL+"/token", f.srv.URL+"/revoke"
	s.appleTokens = a.tokens
	return a, f
}

func startAppleApp(a *appleAuth, extra string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "https://app.example/api/auth/apple?app=1&return="+url.QueryEscape(appleTestReturn)+extra, nil)
	rec := httptest.NewRecorder()
	a.start(rec, req)
	return rec
}

// appleCallback replays Apple's form_post with the cookies from start.
func appleCallback(a *appleAuth, cookies []*http.Cookie, form url.Values) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "https://app.example/api/auth/apple/callback", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for _, c := range cookies {
		if c.MaxAge >= 0 {
			req.AddCookie(c)
		}
	}
	rec := httptest.NewRecorder()
	a.callback(rec, req)
	return rec
}

// flowNonce reads the nonce the start put in the flow cookie (what Apple echoes in the ID token).
func flowNonce(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	c := cookieFrom(rec, appleFlowCookie)
	if c == nil {
		t.Fatal("no flow cookie")
	}
	return strings.Split(c.Value, ".")[1]
}

func TestAppleAppStartValidation(t *testing.T) {
	a, _ := testApple(t, nil)
	for _, ret := range []string{"https://evil.example/cb", "evil://auth/apple", "zekra:auth", "zekra://user@host/x", ""} {
		req := httptest.NewRequest(http.MethodGet, "https://app.example/api/auth/apple?app=1&return="+url.QueryEscape(ret), nil)
		rec := httptest.NewRecorder()
		a.start(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("return %q: status %d, want 400", ret, rec.Code)
		}
	}
	_, challenge := pkcePair()
	if rec := startAppleApp(a, "&code_challenge="+challenge+"&code_challenge_method=plain"); rec.Code != http.StatusBadRequest {
		t.Errorf("plain PKCE: %d", rec.Code)
	}
	rec := startAppleApp(a, "&code_challenge="+challenge+"&code_challenge_method=S256")
	if rec.Code != http.StatusFound || !strings.HasPrefix(rec.Header().Get("Location"), appleAuthURL) {
		t.Fatalf("start: %d %s", rec.Code, rec.Header().Get("Location"))
	}
	loc, _ := url.Parse(rec.Header().Get("Location"))
	if q := loc.Query(); q.Get("client_id") != appleTestServices || q.Get("response_mode") != "form_post" || q.Get("state") == "" || q.Get("nonce") == "" {
		t.Errorf("authorize URL: %s", loc)
	}
	c := cookieFrom(rec, appleFlowCookie)
	parts := strings.Split(c.Value, ".")
	if len(parts) != 5 || unb64(parts[3]) != appleTestReturn || parts[4] != challenge || !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteNoneMode {
		t.Fatalf("flow cookie: %+v", c)
	}
	// A web start carries no app return.
	web := httptest.NewRecorder()
	a.start(web, httptest.NewRequest(http.MethodGet, "https://app.example/api/auth/apple?redirect=/brains", nil))
	if p := strings.Split(cookieFrom(web, appleFlowCookie).Value, "."); len(p) != 5 || p[3] != "" || unb64(p[2]) != "/brains" {
		t.Errorf("web flow cookie: %v", p)
	}
	// The start bounces to the callback's host first (so the cookie lands there).
	other := httptest.NewRecorder()
	a.start(other, httptest.NewRequest(http.MethodGet, "https://zekra.example/api/auth/apple?app=1&return="+url.QueryEscape(appleTestReturn), nil))
	if loc := other.Header().Get("Location"); other.Code != http.StatusFound || !strings.HasPrefix(loc, "https://app.example/api/auth/apple?") || !strings.Contains(loc, "app=1") {
		t.Errorf("no bounce to the callback host: %d %s", other.Code, loc)
	}
}

func TestAppleAppCallbackFailuresGoBackToTheApp(t *testing.T) {
	a, f := testApple(t, nil)
	rec := startAppleApp(a, "")
	state := stateOf(t, rec)
	f.setNonce(flowNonce(t, rec))
	for name, tc := range map[string]struct {
		form url.Values
		want string
	}{
		"cancelled":   {url.Values{"error": {"user_cancelled_authorize"}, "state": {state}}, "cancelled"},
		"apple error": {url.Values{"error": {"invalid_request"}, "state": {state}}, "failed"},
		"wrong state": {url.Values{"code": {"a-code"}, "state": {"forged"}}, "state"},
		"bad code":    {url.Values{"code": {"nope"}, "state": {state}}, "failed"},
	} {
		got := appleCallback(a, rec.Result().Cookies(), tc.form)
		loc, _ := url.Parse(got.Header().Get("Location"))
		if got.Code != http.StatusSeeOther || !strings.HasPrefix(got.Header().Get("Location"), appleTestReturn) || loc.Query().Get("error") != tc.want {
			t.Errorf("%s: %d %s", name, got.Code, got.Header().Get("Location"))
		}
		if loc.Query().Get("code") != "" {
			t.Errorf("%s: a code was issued", name)
		}
	}
	// No flow cookie at all (a cookieless or forged POST): a web failure, never the app.
	got := appleCallback(a, nil, url.Values{"code": {"a-code"}, "state": {state}})
	if got.Code != http.StatusSeeOther || strings.HasPrefix(got.Header().Get("Location"), "zekra:") {
		t.Errorf("no cookie: %d %s", got.Code, got.Header().Get("Location"))
	}
}

func TestAppleAppLinkCodeIsBoundAndCarriesTheRefreshToken(t *testing.T) {
	a, f := testApple(t, nil)
	verifier, challenge := pkcePair()
	req := httptest.NewRequest(http.MethodGet, "https://app.example/api/auth/apple?link=1&app=1&return="+url.QueryEscape(appleTestReturn)+
		"&code_challenge="+challenge+"&code_challenge_method=S256", nil)
	rec := httptest.NewRecorder()
	a.start(rec, req)
	if rec.Code != http.StatusFound || cookieFrom(rec, linkCookie) == nil {
		t.Fatalf("link start: %d", rec.Code)
	}
	f.setNonce(flowNonce(t, rec))
	got := appleCallback(a, rec.Result().Cookies(), url.Values{"code": {"a-code"}, "state": {stateOf(t, rec)}})
	loc, _ := url.Parse(got.Header().Get("Location"))
	code := loc.Query().Get("code")
	if got.Code != http.StatusSeeOther || !strings.HasPrefix(got.Header().Get("Location"), appleTestReturn) || code == "" {
		t.Fatalf("link callback: %d %s", got.Code, got.Header().Get("Location"))
	}
	if a.codes.take(code) != nil {
		t.Fatal("a link code redeemed as a sign-in code")
	}
	// Sign-in and link codes are separate stores: the take above spent nothing here.
	grant := a.linkCodes.take(code)
	if grant == nil {
		t.Fatal("link code not found")
	}
	if grant.redeemableWith("") || grant.redeemableWith(strings.Repeat("z", 52)) || !grant.redeemableWith(verifier) {
		t.Error("link code not bound to the verifier")
	}
	if v := grant.V; v.Provider != "apple" || v.Subject != "a-sub" || v.RefreshToken != "rt-"+appleTestServices || v.TokenClient != appleTestServices {
		t.Errorf("link identity: %+v", v)
	}
	if a.linkCodes.take(code) != nil {
		t.Error("the link code worked twice")
	}
	// The web trade sends the Services ID and the callback as redirect_uri.
	if tr := f.trades[len(f.trades)-1]; tr.Get("client_id") != appleTestServices || tr.Get("redirect_uri") != a.cfg.redirectURL {
		t.Errorf("trade: %v", tr)
	}
}

func TestAppleExchangeCode(t *testing.T) {
	a, _ := testApple(t, nil)
	verifier, challenge := pkcePair()
	post := func(body map[string]string) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/api/auth/apple/exchange", strings.NewReader(string(raw)))
		req.RemoteAddr = "192.0.2.3:1234"
		rec := httptest.NewRecorder()
		a.exchangeCode(rec, req)
		return rec
	}
	if rec := post(map[string]string{}); rec.Code != http.StatusBadRequest {
		t.Errorf("no code: %d", rec.Code)
	}
	if rec := post(map[string]string{"code": "never-issued"}); rec.Code != http.StatusUnauthorized {
		t.Errorf("unknown code: %d", rec.Code)
	}
	bound := a.codes.put(appGrant[auth.Identity]{V: auth.Identity{ID: "u1"}, Challenge: challenge})
	if rec := post(map[string]string{"code": bound, "code_verifier": strings.Repeat("y", 52)}); rec.Code != http.StatusUnauthorized {
		t.Errorf("wrong verifier: %d", rec.Code)
	}
	if rec := post(map[string]string{"code": bound, "code_verifier": verifier}); rec.Code != http.StatusUnauthorized {
		t.Errorf("spent code: %d", rec.Code)
	}
	g := testGoogle(t)
	other := g.codes.put(appGrant[auth.Identity]{V: auth.Identity{ID: "u1"}})
	if rec := post(map[string]string{"code": other}); rec.Code != http.StatusUnauthorized {
		t.Errorf("a Google code redeemed at Apple: %d", rec.Code)
	}
}

func TestAppleAppReason(t *testing.T) {
	for key, want := range map[string]string{
		"apple_cancelled": "cancelled", "apple_state": "state", "apple_closed": "closed",
		"apple_disabled": "disabled", "apple": "failed", "apple_other": "failed",
	} {
		if got := appleAppReason(key); got != want {
			t.Errorf("%s -> %s, want %s", key, got, want)
		}
	}
}

func TestAppleNativeRefresh(t *testing.T) {
	a, f := testApple(t, nil)
	claims := &appleClaims{RegisteredClaims: jwt.RegisteredClaims{Subject: "a-sub", Audience: jwt.ClaimStrings{appleTestBundle}}}
	pid := ssoIdentity{Provider: "apple", Subject: "a-sub"}
	a.nativeRefresh(context.Background(), &pid, claims, "a-code")
	if pid.RefreshToken != "rt-"+appleTestBundle || pid.TokenClient != appleTestBundle {
		t.Fatalf("native trade: %+v", pid)
	}
	// The sheet's code is traded with the bundle id and no redirect_uri.
	if tr := f.trades[len(f.trades)-1]; tr.Get("client_id") != appleTestBundle || tr.Has("redirect_uri") {
		t.Errorf("trade: %v", tr)
	}
	// A code belonging to another Apple ID is ignored.
	f.mu.Lock()
	f.sub = "someone-else"
	f.mu.Unlock()
	other := ssoIdentity{Provider: "apple", Subject: "a-sub"}
	a.nativeRefresh(context.Background(), &other, claims, "a-code")
	if other.RefreshToken != "" {
		t.Error("a refresh token for another Apple ID was kept")
	}
	// No code, a bad code, or no signing key: nothing, and no error.
	for _, code := range []string{"", "bad"} {
		p := ssoIdentity{Provider: "apple", Subject: "a-sub"}
		a.nativeRefresh(context.Background(), &p, claims, code)
		if p.RefreshToken != "" {
			t.Errorf("code %q kept a token", code)
		}
	}
	a.tokens.cfg.key = nil
	p := ssoIdentity{Provider: "apple", Subject: "a-sub"}
	a.nativeRefresh(context.Background(), &p, claims, "a-code")
	if p.RefreshToken != "" {
		t.Error("traded without a signing key")
	}
}

func TestAppleRevoke(t *testing.T) {
	a, f := testApple(t, nil)
	now := time.Now()
	if err := a.tokens.revoke(context.Background(), appleTestBundle, "rt-1", now); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if got := f.revocations(); len(got) != 1 || got[0] != appleTestBundle+"|rt-1" {
		t.Errorf("revocations: %v", got)
	}
	unsigned := newAppleTokens(appleConfig{teamID: "TEAM123", keyID: "KEY123"})
	unsigned.revokeURL = f.srv.URL + "/revoke"
	if err := unsigned.revoke(context.Background(), appleTestBundle, "rt-1", now); err == nil {
		t.Error("revoked without a signing key")
	}
	if unverifiedSubject("garbage") != "" {
		t.Error("garbage has a subject")
	}
	if s := unverifiedSubject(f.iss.sign(t, baseClaims(appleIssuer, appleTestBundle))); s != "subject-1" {
		t.Errorf("subject: %q", s)
	}
}

func TestConfiguredProvidersAppleApp(t *testing.T) {
	for _, k := range []string{"APPLE_SERVICES_ID", "APPLE_SERVICE_ID", "APPLE_CLIENT_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID",
		"APPLE_PRIVATE_KEY_PATH", "APPLE_PRIVATE_KEY", "APPLE_BUNDLE_IDS"} {
		t.Setenv(k, "")
	}
	_, pemKey := appleTestKey(t)
	t.Setenv("APPLE_SERVICES_ID", appleTestServices)
	t.Setenv("APPLE_TEAM_ID", "TEAM123")
	t.Setenv("APPLE_KEY_ID", "KEY123")
	t.Setenv("APPLE_PRIVATE_KEY", strings.ReplaceAll(pemKey, "\n", `\n`))
	var apple *providerStatus
	for _, p := range configuredProviders() {
		if p.Name == "apple" {
			apple = &p
		}
	}
	if apple == nil || !apple.Web || !apple.App || apple.Native {
		t.Fatalf("apple, web only: %+v", apple)
	}
	t.Setenv("APPLE_BUNDLE_IDS", appleTestBundle)
	for _, p := range configuredProviders() {
		if p.Name == "apple" && (!p.Web || !p.App || !p.Native) {
			t.Errorf("apple, web + native: %+v", p)
		}
	}
}
