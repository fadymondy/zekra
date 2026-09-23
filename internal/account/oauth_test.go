package account

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/togo-framework/auth"
)

/*
Native sign-in verification (Google / Apple ID tokens against a JWKS) and the
GitHub and Google app flows' state and one-time-code handling. No database: the parts that
resolve a user are covered by the Postgres flows in flow_test.go.
*/

// fakeIssuer signs RS256 tokens with a local key and serves its JWKS.
type fakeIssuer struct {
	key *rsa.PrivateKey
	kid string
	srv *httptest.Server
}

func newFakeIssuer(t *testing.T) *fakeIssuer {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeIssuer{key: key, kid: "test-kid"}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		b64 := base64.RawURLEncoding.EncodeToString
		writeJSON(w, http.StatusOK, map[string]any{"keys": []map[string]string{{
			"kid": f.kid, "kty": "RSA", "alg": "RS256", "use": "sig",
			"n": b64(key.N.Bytes()), "e": b64(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeIssuer) sign(t *testing.T, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = f.kid
	s, err := tok.SignedString(f.key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func baseClaims(iss, aud string) jwt.MapClaims {
	now := time.Now()
	return jwt.MapClaims{
		"iss": iss, "aud": aud, "sub": "subject-1", "email": "Person@Example.com", "email_verified": true,
		"iat": now.Unix(), "exp": now.Add(10 * time.Minute).Unix(),
	}
}

func with(c jwt.MapClaims, k string, v any) jwt.MapClaims {
	out := jwt.MapClaims{}
	for kk, vv := range c {
		out[kk] = vv
	}
	if v == nil {
		delete(out, k)
	} else {
		out[k] = v
	}
	return out
}

func TestVerifyGoogleIDToken(t *testing.T) {
	f := newFakeIssuer(t)
	keys := newJWKS(f.srv.URL)
	ctx := context.Background()
	auds := []string{"web.apps.googleusercontent.com", "ios.apps.googleusercontent.com"}
	good := baseClaims("https://accounts.google.com", "web.apps.googleusercontent.com")

	c, err := keys.verifyGoogle(ctx, f.sign(t, good), auds)
	if err != nil || c.Subject != "subject-1" || c.Email != "Person@Example.com" {
		t.Fatalf("valid token refused: %v %+v", err, c)
	}
	if _, err := keys.verifyGoogle(ctx, f.sign(t, with(good, "iss", "accounts.google.com")), auds); err != nil {
		t.Errorf("the bare issuer is valid too: %v", err)
	}
	if _, err := keys.verifyGoogle(ctx, f.sign(t, with(good, "email_verified", "true")), auds); err != nil {
		t.Errorf("a string email_verified is accepted: %v", err)
	}

	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	forged := jwt.NewWithClaims(jwt.SigningMethodRS256, good)
	forged.Header["kid"] = f.kid
	forgedRaw, _ := forged.SignedString(other)
	hs := jwt.NewWithClaims(jwt.SigningMethodHS256, good)
	hsRaw, _ := hs.SignedString([]byte("secret"))

	for name, raw := range map[string]string{
		"wrong audience":     f.sign(t, with(good, "aud", "someone-else")),
		"wrong issuer":       f.sign(t, with(good, "iss", "https://evil.example")),
		"expired":            f.sign(t, with(good, "exp", time.Now().Add(-time.Hour).Unix())),
		"no expiry":          f.sign(t, with(good, "exp", nil)),
		"unverified email":   f.sign(t, with(good, "email_verified", false)),
		"no email":           f.sign(t, with(good, "email", nil)),
		"issued in future":   f.sign(t, with(good, "iat", time.Now().Add(time.Hour).Unix())),
		"foreign signature":  forgedRaw,
		"HS256 (alg switch)": hsRaw,
		"garbage":            "not.a.token",
	} {
		if _, err := keys.verifyGoogle(ctx, raw, auds); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if _, err := keys.verifyGoogle(ctx, f.sign(t, good), nil); err == nil {
		t.Error("no configured audience: accepted")
	}
}

func TestVerifyAppleIdentityToken(t *testing.T) {
	f := newFakeIssuer(t)
	keys := newJWKS(f.srv.URL)
	ctx := context.Background()
	auds := []string{"com.fadymondy.zekra"}
	raw := "raw-nonce-from-the-app"
	sum := sha256.Sum256([]byte(raw))
	hashed := hex.EncodeToString(sum[:])
	good := with(baseClaims(appleIssuer, "com.fadymondy.zekra"), "nonce", hashed)

	if _, err := keys.verifyApple(ctx, f.sign(t, good), auds, raw, nonceSHA256); err != nil {
		t.Fatalf("valid native token refused: %v", err)
	}
	// The claim is readable by whoever holds the token: presenting it as the
	// nonce must not pass, or a lifted token could be replayed.
	if _, err := keys.verifyApple(ctx, f.sign(t, good), auds, hashed, nonceSHA256); err == nil {
		t.Error("native: the claim itself was accepted as the nonce")
	}
	if _, err := keys.verifyApple(ctx, f.sign(t, good), auds, "", nonceSHA256); err == nil {
		t.Error("native: a missing nonce was accepted")
	}
	if _, err := keys.verifyApple(ctx, f.sign(t, good), auds, "another-nonce", nonceSHA256); err == nil {
		t.Error("native: a different nonce was accepted")
	}
	// Web: the server's own nonce went to Apple raw.
	web := with(baseClaims(appleIssuer, "com.fadymondy.zekra.web"), "nonce", raw)
	if _, err := keys.verifyApple(ctx, f.sign(t, web), []string{"com.fadymondy.zekra.web"}, raw, nonceRaw); err != nil {
		t.Errorf("valid web token refused: %v", err)
	}
	if _, err := keys.verifyApple(ctx, f.sign(t, web), []string{"com.fadymondy.zekra.web"}, "", nonceRaw); err == nil {
		t.Error("web: a missing nonce was accepted")
	}
	for name, claims := range map[string]jwt.MapClaims{
		"wrong audience":   with(good, "aud", "com.example.other"),
		"wrong issuer":     with(good, "iss", "https://accounts.google.com"),
		"expired":          with(good, "exp", time.Now().Add(-time.Hour).Unix()),
		"unverified email": with(good, "email_verified", "false"),
		"no nonce claim":   with(good, "nonce", nil),
	} {
		if _, err := keys.verifyApple(ctx, f.sign(t, claims), auds, raw, nonceSHA256); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestJWKSUnknownKidIsThrottled(t *testing.T) {
	f := newFakeIssuer(t)
	hits := 0
	inner := f.srv.Config.Handler
	f.srv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		inner.ServeHTTP(w, r)
	})
	keys := newJWKS(f.srv.URL)
	for i := 0; i < 5; i++ {
		if _, err := keys.key(context.Background(), "nope"); err == nil {
			t.Fatal("unknown kid resolved")
		}
	}
	if hits != 1 {
		t.Errorf("JWKS fetched %d times for garbage kids, want 1", hits)
	}
}

// ---- GitHub app flow ----------------------------------------------------------

func pkcePair() (verifier, challenge string) {
	verifier = strings.Repeat("v", 20) + randomHex(16) // 52 chars
	sum := sha256.Sum256([]byte(verifier))
	return verifier, base64.RawURLEncoding.EncodeToString(sum[:])
}

// fakeGitHub answers the token exchange, /user and /user/emails.
func fakeGitHub(t *testing.T, g *githubAuth) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			_ = r.ParseForm()
			if r.PostForm.Get("code") != "gh-code" || r.PostForm.Get("code_verifier") == "" {
				writeJSON(w, http.StatusOK, map[string]string{"error": "bad_verification_code"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]string{"access_token": "gho_x"})
		case "/user":
			writeJSON(w, http.StatusOK, map[string]any{"id": 4242})
		case "/emails":
			writeJSON(w, http.StatusOK, []githubEmail{{Email: "dev@example.com", Primary: true, Verified: true}})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	g.tokenURL, g.userURL, g.emailsURL = srv.URL+"/token", srv.URL+"/user", srv.URL+"/emails"
}

func testGitHub(t *testing.T) *githubAuth {
	t.Helper()
	g := &githubAuth{
		s:         &Service{},
		cfg:       githubConfig{clientID: "cid", clientSecret: "secret", redirectURL: "https://app.example/api/auth/github/callback", appScheme: "zekra"},
		codes:     newCodeStore[appGrant[auth.Identity]](githubCodeTTL),
		linkCodes: newCodeStore[appGrant[ssoIdentity]](githubCodeTTL),
	}
	fakeGitHub(t, g)
	return g
}

// startApp runs GET /api/auth/github?app=1… and returns the recorder.
func startApp(g *githubAuth, extra string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "https://app.example/api/auth/github?app=1&return="+url.QueryEscape("zekra://auth/github")+extra, nil)
	rec := httptest.NewRecorder()
	g.start(rec, req)
	return rec
}

func cookieFrom(rec *httptest.ResponseRecorder, name string) *http.Cookie {
	for _, c := range rec.Result().Cookies() {
		if c.Name == name && c.MaxAge >= 0 {
			return c
		}
	}
	return nil
}

func TestGitHubAppStartValidation(t *testing.T) {
	g := testGitHub(t)
	for _, ret := range []string{"https://evil.example/cb", "evil://auth/github", "zekra:auth", "zekra://user@host/x", ""} {
		req := httptest.NewRequest(http.MethodGet, "https://app.example/api/auth/github?app=1&return="+url.QueryEscape(ret), nil)
		rec := httptest.NewRecorder()
		g.start(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("return %q: status %d, want 400", ret, rec.Code)
		}
	}
	_, challenge := pkcePair()
	if rec := startApp(g, "&code_challenge="+challenge+"&code_challenge_method=plain"); rec.Code != http.StatusBadRequest {
		t.Errorf("plain PKCE: status %d, want 400", rec.Code)
	}
	if rec := startApp(g, "&code_challenge=short&code_challenge_method=S256"); rec.Code != http.StatusBadRequest {
		t.Errorf("malformed challenge: status %d, want 400", rec.Code)
	}
	rec := startApp(g, "&code_challenge="+challenge+"&code_challenge_method=S256")
	if rec.Code != http.StatusFound || !strings.HasPrefix(rec.Header().Get("Location"), githubAuthURL) {
		t.Fatalf("start: %d %s", rec.Code, rec.Header().Get("Location"))
	}
	c := cookieFrom(rec, githubFlowCookie)
	if c == nil || !strings.HasSuffix(c.Value, "."+challenge) || !c.HttpOnly {
		t.Fatalf("flow cookie does not carry the challenge: %+v", c)
	}
	loc, _ := url.Parse(rec.Header().Get("Location"))
	if loc.Query().Get("state") == "" || loc.Query().Get("code_challenge_method") != "S256" {
		t.Errorf("authorize URL lacks state / PKCE: %s", loc)
	}
}

// callback replays GitHub's redirect with the flow cookie from start.
func callback(g *githubAuth, cookies []*http.Cookie, state string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "https://app.example/api/auth/github/callback?code=gh-code&state="+url.QueryEscape(state), nil)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	g.callback(rec, req)
	return rec
}

func TestGitHubAppCallbackState(t *testing.T) {
	g := testGitHub(t)
	rec := startApp(g, "")
	flow := cookieFrom(rec, githubFlowCookie)
	loc, _ := url.Parse(rec.Header().Get("Location"))
	state := loc.Query().Get("state")

	// A forged or missing state goes back to the app with error=state, no code.
	for name, st := range map[string]string{"forged": "x" + state, "missing": ""} {
		out := callback(g, []*http.Cookie{flow}, st)
		back, _ := url.Parse(out.Header().Get("Location"))
		if back.Scheme != "zekra" || back.Query().Get("error") != "state" || back.Query().Get("code") != "" {
			t.Errorf("%s state: redirected to %s", name, back)
		}
	}
	// No flow cookie at all: there is no app target to trust, so the web login page.
	out := callback(g, nil, state)
	if l := out.Header().Get("Location"); !strings.HasPrefix(l, loginPath()+"?error=github_state") {
		t.Errorf("no cookie: redirected to %s", l)
	}
	// The callback always clears the flow cookie: a state works once.
	cleared := false
	for _, c := range out.Result().Cookies() {
		cleared = cleared || (c.Name == githubFlowCookie && c.MaxAge < 0)
	}
	if !cleared {
		t.Error("callback did not clear the flow cookie")
	}
}

func TestGitHubAppLinkCodeIsBoundAndSingleUse(t *testing.T) {
	g := testGitHub(t)
	verifier, challenge := pkcePair()
	rec := startApp(g, "&link=1&code_challenge="+challenge+"&code_challenge_method=S256")
	loc, _ := url.Parse(rec.Header().Get("Location"))
	out := callback(g, rec.Result().Cookies(), loc.Query().Get("state"))
	back, err := url.Parse(out.Header().Get("Location"))
	if err != nil || back.Scheme != "zekra" || back.Query().Get("code") == "" {
		t.Fatalf("link callback: %d %s", out.Code, out.Header().Get("Location"))
	}
	code := back.Query().Get("code")
	grant := g.linkCodes.take(code)
	if grant == nil || grant.V.Subject != "4242" || grant.V.Provider != "github" || grant.Challenge != challenge {
		t.Fatalf("link grant: %+v", grant)
	}
	if g.linkCodes.take(code) != nil {
		t.Error("a link code redeemed twice")
	}
	if g.codes.take(code) != nil {
		t.Error("a link code redeemed as a sign-in code")
	}
	if grant.redeemableWith("") || grant.redeemableWith(strings.Repeat("x", 52)) {
		t.Error("a bound code redeemed without its verifier")
	}
	if !grant.redeemableWith(verifier) {
		t.Error("the right verifier was refused")
	}
}

func TestGitHubExchangeCode(t *testing.T) {
	g := testGitHub(t)
	verifier, challenge := pkcePair()
	post := func(body map[string]string) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/api/auth/github/exchange", strings.NewReader(string(raw)))
		req.RemoteAddr = "192.0.2.1:1234"
		rec := httptest.NewRecorder()
		g.exchangeCode(rec, req)
		return rec
	}
	if rec := post(map[string]string{}); rec.Code != http.StatusBadRequest {
		t.Errorf("no code: %d", rec.Code)
	}
	if rec := post(map[string]string{"code": "never-issued"}); rec.Code != http.StatusUnauthorized {
		t.Errorf("unknown code: %d", rec.Code)
	}
	bound := g.codes.put(appGrant[auth.Identity]{V: auth.Identity{ID: "u1"}, Challenge: challenge})
	if rec := post(map[string]string{"code": bound}); rec.Code != http.StatusUnauthorized {
		t.Errorf("bound code without verifier: %d", rec.Code)
	}
	// That attempt spent the code: even the right verifier cannot use it now.
	if rec := post(map[string]string{"code": bound, "code_verifier": verifier}); rec.Code != http.StatusUnauthorized {
		t.Errorf("spent code: %d", rec.Code)
	}
	// Expired codes are refused.
	short := newCodeStore[appGrant[auth.Identity]](time.Nanosecond)
	old := short.put(appGrant[auth.Identity]{V: auth.Identity{ID: "u1"}})
	time.Sleep(time.Millisecond)
	if short.take(old) != nil {
		t.Error("an expired code redeemed")
	}
}

func TestValidChallenge(t *testing.T) {
	_, c := pkcePair()
	if !validChallenge(c) {
		t.Errorf("%q refused", c)
	}
	for _, bad := range []string{"", c[:42], c + "A", strings.Repeat("=", 43), strings.Repeat(".", 43)} {
		if validChallenge(bad) {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestConfiguredProviders(t *testing.T) {
	for _, k := range []string{"OAUTH_GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID", "OAUTH_GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET",
		"OAUTH_GOOGLE_AUDIENCES", "GOOGLE_AUDIENCES", "APPLE_SERVICES_ID", "APPLE_SERVICE_ID", "APPLE_CLIENT_ID", "APPLE_TEAM_ID",
		"APPLE_KEY_ID", "APPLE_PRIVATE_KEY_PATH", "APPLE_PRIVATE_KEY", "APPLE_BUNDLE_IDS",
		"OAUTH_GITHUB_CLIENT_ID", "GITHUB_CLIENT_ID", "OAUTH_GITHUB_CLIENT_SECRET", "GITHUB_CLIENT_SECRET"} {
		t.Setenv(k, "")
	}
	if got := configuredProviders(); len(got) != 0 {
		t.Fatalf("nothing configured: %+v", got)
	}
	t.Setenv("OAUTH_GOOGLE_AUDIENCES", "ios.apps.googleusercontent.com")
	t.Setenv("APPLE_SERVICES_ID", "com.fadymondy.zekra.web") // web-only audience: not native
	t.Setenv("OAUTH_GITHUB_CLIENT_ID", "cid")
	t.Setenv("OAUTH_GITHUB_CLIENT_SECRET", "secret")
	got := map[string]providerStatus{}
	for _, p := range configuredProviders() {
		got[p.Name] = p
	}
	if p := got["google"]; p.Web || !p.Native {
		t.Errorf("google: %+v", p)
	}
	if _, ok := got["apple"]; ok {
		t.Errorf("apple without bundle ids or a key: %+v", got["apple"])
	}
	t.Setenv("APPLE_BUNDLE_IDS", "com.fadymondy.zekra")
	for _, p := range configuredProviders() {
		got[p.Name] = p
	}
	if p := got["apple"]; p.Web || !p.Native {
		t.Errorf("apple: %+v", p)
	}
	if p := got["github"]; !p.Web || !p.App || !p.Native {
		t.Errorf("github: %+v", p)
	}
	if p := got["apple"]; p.App {
		t.Errorf("apple has no app (browser) flow: %+v", p)
	}
	if p := got["google"]; p.App {
		t.Errorf("google app flow without a web client: %+v", p)
	}
	// The web client turns Google's browser flow on for the web AND the app.
	t.Setenv("OAUTH_GOOGLE_CLIENT_ID", "web.apps.googleusercontent.com")
	t.Setenv("OAUTH_GOOGLE_CLIENT_SECRET", "secret")
	for _, p := range configuredProviders() {
		got[p.Name] = p
	}
	if p := got["google"]; !p.Web || !p.App || !p.Native {
		t.Errorf("google with a web client: %+v", p)
	}
}

func TestSafeAppReturn(t *testing.T) {
	for _, ok := range []string{"zekra://auth/google", "zekra://auth/github?x=1"} {
		if safeAppReturn("zekra", ok) != ok {
			t.Errorf("%q refused", ok)
		}
	}
	for _, bad := range []string{"", "https://evil.example/cb", "zekrax://auth", "zekra:auth", "zekra://user@host/x",
		"zekra://auth/\\evil", "zekra://auth/\ngoogle", "zekra://" + strings.Repeat("a", 260)} {
		if safeAppReturn("zekra", bad) != "" {
			t.Errorf("%q accepted", bad)
		}
	}
	if safeAppReturn("", "zekra://auth") != "" {
		t.Error("an empty scheme allowed a return")
	}
}

// ---- Google app flow -----------------------------------------------------------

const googleTestReturn = "zekra://auth/google"

// testGoogle: a web client "gcid", Google's token endpoint and JWKS faked. The
// token endpoint answers an ID token for the account "g-sub" when it gets the
// code "g-code" with a verifier.
func testGoogle(t *testing.T) *googleAuth {
	t.Helper()
	f := newFakeIssuer(t)
	cfg := googleConfig{clientID: "gcid", clientSecret: "secret", audiences: []string{"gcid"},
		redirectURL: "https://app.example/api/auth/google/callback", appScheme: "zekra"}
	g := newGoogleAuth(&Service{}, cfg, newJWKS(f.srv.URL))
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.PostForm.Get("code") != "g-code" || r.PostForm.Get("code_verifier") == "" || r.PostForm.Get("client_id") != "gcid" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_grant"})
			return
		}
		claims := with(baseClaims("https://accounts.google.com", "gcid"), "sub", "g-sub")
		writeJSON(w, http.StatusOK, map[string]string{"id_token": f.sign(t, claims)})
	}))
	t.Cleanup(srv.Close)
	g.tokenURL = srv.URL
	return g
}

func startGoogleApp(g *googleAuth, extra string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "https://app.example/api/auth/google?app=1&return="+url.QueryEscape(googleTestReturn)+extra, nil)
	rec := httptest.NewRecorder()
	g.start(rec, req)
	return rec
}

// googleCallback replays Google's redirect with the cookies from start.
func googleCallback(g *googleAuth, cookies []*http.Cookie, query string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "https://app.example/api/auth/google/callback?"+query, nil)
	for _, c := range cookies {
		if c.MaxAge >= 0 {
			req.AddCookie(c)
		}
	}
	rec := httptest.NewRecorder()
	g.callback(rec, req)
	return rec
}

func stateOf(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	loc, err := url.Parse(rec.Header().Get("Location"))
	if err != nil || loc.Query().Get("state") == "" {
		t.Fatalf("no state in %s", rec.Header().Get("Location"))
	}
	return loc.Query().Get("state")
}

func TestGoogleAppStartValidation(t *testing.T) {
	g := testGoogle(t)
	for _, ret := range []string{"https://evil.example/cb", "evil://auth/google", "zekra:auth", "zekra://user@host/x", ""} {
		req := httptest.NewRequest(http.MethodGet, "https://app.example/api/auth/google?app=1&return="+url.QueryEscape(ret), nil)
		rec := httptest.NewRecorder()
		g.start(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("return %q: status %d, want 400", ret, rec.Code)
		}
	}
	_, challenge := pkcePair()
	if rec := startGoogleApp(g, "&code_challenge="+challenge+"&code_challenge_method=plain"); rec.Code != http.StatusBadRequest {
		t.Errorf("plain PKCE: status %d, want 400", rec.Code)
	}
	if rec := startGoogleApp(g, "&code_challenge=short&code_challenge_method=S256"); rec.Code != http.StatusBadRequest {
		t.Errorf("malformed challenge: status %d, want 400", rec.Code)
	}
	rec := startGoogleApp(g, "&code_challenge="+challenge+"&code_challenge_method=S256")
	if rec.Code != http.StatusFound || !strings.HasPrefix(rec.Header().Get("Location"), googleAuthURL) {
		t.Fatalf("start: %d %s", rec.Code, rec.Header().Get("Location"))
	}
	c := cookieFrom(rec, googleAppCookie)
	if c == nil || !c.HttpOnly || c.Value != base64.RawURLEncoding.EncodeToString([]byte(googleTestReturn))+"."+challenge {
		t.Fatalf("app cookie: %+v", c)
	}
	loc, _ := url.Parse(rec.Header().Get("Location"))
	if loc.Query().Get("client_id") != "gcid" || loc.Query().Get("code_challenge_method") != "S256" || loc.Query().Get("state") == "" {
		t.Errorf("authorize URL: %s", loc)
	}
	// A web start clears any app flow left behind, and sets none.
	web := httptest.NewRecorder()
	g.start(web, httptest.NewRequest(http.MethodGet, "https://app.example/api/auth/google?redirect=/brains", nil))
	if web.Code != http.StatusFound || cookieFrom(web, googleAppCookie) != nil {
		t.Errorf("web start set an app cookie: %d %+v", web.Code, cookieFrom(web, googleAppCookie))
	}
}

func TestGoogleAppStartBouncesToCallbackHost(t *testing.T) {
	g := testGoogle(t)
	_, challenge := pkcePair()
	req := httptest.NewRequest(http.MethodGet, "https://other.example/api/auth/google?app=1&return="+url.QueryEscape(googleTestReturn)+
		"&code_challenge="+challenge+"&code_challenge_method=S256", nil)
	rec := httptest.NewRecorder()
	g.start(rec, req)
	loc, _ := url.Parse(rec.Header().Get("Location"))
	if rec.Code != http.StatusFound || loc.Host != "app.example" || loc.Query().Get("return") != googleTestReturn ||
		loc.Query().Get("code_challenge") != challenge || loc.Query().Get("app") != "1" {
		t.Errorf("bounce: %d %s", rec.Code, loc)
	}
}

func TestGoogleAppCallbackState(t *testing.T) {
	g := testGoogle(t)
	rec := startGoogleApp(g, "")
	state := stateOf(t, rec)
	cookies := rec.Result().Cookies()

	// A forged or missing state goes back to the app with error=state, no code.
	for name, st := range map[string]string{"forged": "x" + state, "missing": ""} {
		out := googleCallback(g, cookies, "code=g-code&state="+url.QueryEscape(st))
		back, _ := url.Parse(out.Header().Get("Location"))
		if back.Scheme != "zekra" || back.Path != "/google" || back.Query().Get("error") != "state" || back.Query().Get("code") != "" {
			t.Errorf("%s state: redirected to %s", name, back)
		}
	}
	// The user backed out on Google's page.
	out := googleCallback(g, cookies, "error=access_denied&state="+url.QueryEscape(state))
	if back, _ := url.Parse(out.Header().Get("Location")); back.Scheme != "zekra" || back.Query().Get("error") != "cancelled" {
		t.Errorf("cancel: redirected to %s", back)
	}
	// Google refusing the code is "failed", still to the app.
	out = googleCallback(g, cookies, "code=wrong&state="+url.QueryEscape(state))
	if back, _ := url.Parse(out.Header().Get("Location")); back.Scheme != "zekra" || back.Query().Get("error") != "failed" {
		t.Errorf("bad code: redirected to %s", back)
	}
	// No flow cookies at all: no app target to trust, so the web login page.
	out = googleCallback(g, nil, "code=g-code&state="+url.QueryEscape(state))
	if l := out.Header().Get("Location"); !strings.HasPrefix(l, loginPath()+"?error=google_state") {
		t.Errorf("no cookie: redirected to %s", l)
	}
	cleared := false
	for _, c := range out.Result().Cookies() {
		cleared = cleared || (c.Name == googleAppCookie && c.MaxAge < 0)
	}
	if !cleared {
		t.Error("callback did not clear the app cookie")
	}
	// A tampered app cookie (a foreign return) is ignored: the web answer, not a redirect off-app.
	evil := &http.Cookie{Name: googleAppCookie, Value: base64.RawURLEncoding.EncodeToString([]byte("https://evil.example/cb")) + "."}
	out = googleCallback(g, []*http.Cookie{evil}, "code=g-code&state=x")
	if l := out.Header().Get("Location"); !strings.HasPrefix(l, loginPath()) {
		t.Errorf("tampered app cookie: redirected to %s", l)
	}
}

func TestGoogleAppLinkCodeIsBoundAndSingleUse(t *testing.T) {
	g := testGoogle(t)
	verifier, challenge := pkcePair()
	rec := startGoogleApp(g, "&link=1&code_challenge="+challenge+"&code_challenge_method=S256")
	out := googleCallback(g, rec.Result().Cookies(), "code=g-code&state="+url.QueryEscape(stateOf(t, rec)))
	back, err := url.Parse(out.Header().Get("Location"))
	if err != nil || back.Scheme != "zekra" || back.Query().Get("code") == "" {
		t.Fatalf("link callback: %d %s", out.Code, out.Header().Get("Location"))
	}
	code := back.Query().Get("code")
	grant := g.linkCodes.take(code)
	if grant == nil || grant.V.Subject != "g-sub" || grant.V.Provider != "google" || grant.Challenge != challenge {
		t.Fatalf("link grant: %+v", grant)
	}
	if g.linkCodes.take(code) != nil {
		t.Error("a link code redeemed twice")
	}
	if g.codes.take(code) != nil {
		t.Error("a link code redeemed as a sign-in code")
	}
	if grant.redeemableWith("") || grant.redeemableWith(strings.Repeat("x", 52)) {
		t.Error("a bound code redeemed without its verifier")
	}
	if !grant.redeemableWith(verifier) {
		t.Error("the right verifier was refused")
	}
}

func TestGoogleExchangeCode(t *testing.T) {
	g := testGoogle(t)
	verifier, challenge := pkcePair()
	post := func(body map[string]string) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/api/auth/google/exchange", strings.NewReader(string(raw)))
		req.RemoteAddr = "192.0.2.2:1234"
		rec := httptest.NewRecorder()
		g.exchangeCode(rec, req)
		return rec
	}
	if rec := post(map[string]string{}); rec.Code != http.StatusBadRequest {
		t.Errorf("no code: %d", rec.Code)
	}
	if rec := post(map[string]string{"code": "never-issued", "code_verifier": verifier}); rec.Code != http.StatusUnauthorized {
		t.Errorf("unknown code: %d", rec.Code)
	}
	bound := g.codes.put(appGrant[auth.Identity]{V: auth.Identity{ID: "u1"}, Challenge: challenge})
	if rec := post(map[string]string{"code": bound, "code_verifier": strings.Repeat("y", 52)}); rec.Code != http.StatusUnauthorized {
		t.Errorf("bound code, wrong verifier: %d", rec.Code)
	}
	if rec := post(map[string]string{"code": bound, "code_verifier": verifier}); rec.Code != http.StatusUnauthorized {
		t.Errorf("spent code: %d", rec.Code)
	}
	// Sign-in codes are Google's own: a GitHub code store never answers here.
	gh := testGitHub(t)
	other := gh.codes.put(appGrant[auth.Identity]{V: auth.Identity{ID: "u1"}})
	if rec := post(map[string]string{"code": other}); rec.Code != http.StatusUnauthorized {
		t.Errorf("a GitHub code redeemed at Google: %d", rec.Code)
	}
	short := newCodeStore[appGrant[auth.Identity]](time.Nanosecond)
	old := short.put(appGrant[auth.Identity]{V: auth.Identity{ID: "u1"}})
	time.Sleep(time.Millisecond)
	if short.take(old) != nil {
		t.Error("an expired code redeemed")
	}
	if googleCodeTTL > 5*time.Minute {
		t.Errorf("google app codes live %s", googleCodeTTL)
	}
}

func TestGoogleAppReason(t *testing.T) {
	for key, want := range map[string]string{
		"google_cancelled": "cancelled", "google_state": "state", "google_closed": "closed",
		"google_disabled": "disabled", "google": "failed", "google_other": "failed",
	} {
		if got := googleAppReason(key); got != want {
			t.Errorf("%s -> %s, want %s", key, got, want)
		}
	}
}
