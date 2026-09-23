package account

import (
	"context"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/togo-framework/auth"
)

/*
Sign in with Google (ported from fadymondy's internal/server/google.go).

	GET  /api/auth/google                            web — start (?redirect=/path, ?link=1)
	GET  /api/auth/google?app=1&return=<scheme>://…  app — start (auth session in a system browser)
	     [&code_challenge=<S256>&code_challenge_method=S256]
	GET  /api/auth/google/callback                   Google sends the browser back here
	POST /api/auth/google/exchange {code, code_verifier?}  app — one-time code -> {token, user}
	POST /api/auth/google/token {id_token}           native SDK ID token -> {token, user} (no cookie)
	POST /api/me/identities/google {id_token}        native link
	POST /api/me/identities/google {code, code_verifier?}  app link — redeem a one-time link code

PKCE (S256), state in an HttpOnly cookie, ID token verified against Google's
JWKS (RS256, issuer, expiry, audience, email_verified). Accounts link by
verified email, case-insensitively.

The app flow is GitHub's (oauth_github.go), on the WEB client: the app opens
the start URL in an auth session, the callback redirects to <return>?code=…
(or ?error=cancelled|state|closed|disabled|failed), and the app trades the
single-use, two-minute code at /exchange. The code may be bound to the app
with PKCE (a challenge on start, the verifier on redemption). It needs no
native Google SDK and no iOS/Android OAuth client — only the web client, which
the browser flow already uses.

Env (fadymondy's names; the short aliases are accepted too):
	OAUTH_GOOGLE_CLIENT_ID     | GOOGLE_CLIENT_ID
	OAUTH_GOOGLE_CLIENT_SECRET | GOOGLE_CLIENT_SECRET
	OAUTH_GOOGLE_AUDIENCES     extra accepted ID-token audiences (native client ids)
	OAUTH_GOOGLE_REDIRECT_URL  default AUTH_PUBLIC_URL (or APP_URL) + /api/auth/google/callback
	GOOGLE_APP_SCHEME          the native app's return scheme (default "zekra", as GITHUB_APP_SCHEME)
*/

const (
	googleAuthURL    = "https://accounts.google.com/o/oauth2/v2/auth"
	googleTokenURL   = "https://oauth2.googleapis.com/token"
	googleCertsURL   = "https://www.googleapis.com/oauth2/v3/certs"
	googleCookiePath = "/api/auth/google"
	googleFlowTTL    = 10 * time.Minute
	googleCodeTTL    = 2 * time.Minute
	// googleAppCookie carries an app flow's return target and PKCE challenge:
	// base64url(return) + "." + challenge. Absent = a web flow (as before it existed).
	googleAppCookie = "g_app"
)

var oauthHTTP = &http.Client{Timeout: 15 * time.Second}

type googleConfig struct {
	clientID, clientSecret string
	audiences              []string
	redirectURL, appScheme string
}

func loadGoogleConfig() googleConfig {
	c := googleConfig{
		clientID:     firstEnv("OAUTH_GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID"),
		clientSecret: firstEnv("OAUTH_GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"),
		redirectURL:  firstEnv("OAUTH_GOOGLE_REDIRECT_URL", "GOOGLE_REDIRECT_URL"),
		appScheme:    firstEnv("GOOGLE_APP_SCHEME"),
	}
	if c.appScheme == "" {
		c.appScheme = "zekra"
	}
	if c.clientID != "" {
		c.audiences = append(c.audiences, c.clientID)
	}
	c.audiences = append(c.audiences, splitCSV(firstEnv("OAUTH_GOOGLE_AUDIENCES", "GOOGLE_AUDIENCES"))...)
	if c.redirectURL == "" {
		c.redirectURL = publicURL() + "/api/auth/google/callback"
	}
	return c
}

func (c googleConfig) webReady() bool { return c.clientID != "" && c.clientSecret != "" }

type googleAuth struct {
	s         *Service
	cfg       googleConfig
	keys      *jwks
	codes     *codeStore[appGrant[auth.Identity]]
	linkCodes *codeStore[appGrant[ssoIdentity]]
	tokenURL  string
}

func (g *googleAuth) secure() bool { return strings.HasPrefix(g.cfg.redirectURL, "https://") }

// mountGoogle registers the routes only when Google is configured (otherwise they
// 404) and reports the login method the console should show.
func (s *Service) mountGoogle(router chi.Router) *auth.LoginMethod {
	cfg := loadGoogleConfig()
	if !cfg.webReady() && len(cfg.audiences) == 0 {
		return nil
	}
	g := newGoogleAuth(s, cfg, newJWKS(googleCertsURL))
	router.Post("/api/auth/google/token", g.idToken)
	router.Post("/api/me/identities/google", g.linkNative)
	if !cfg.webReady() {
		return nil // native-only: no button on the web, no app flow
	}
	router.Get("/api/auth/google", g.start)
	router.Get("/api/auth/google/callback", g.callback)
	router.Post("/api/auth/google/exchange", g.exchangeCode)
	return &auth.LoginMethod{Name: "google", Label: "Continue with Google", Type: "oauth", URL: "/api/auth/google"}
}

func newGoogleAuth(s *Service, cfg googleConfig, keys *jwks) *googleAuth {
	return &googleAuth{
		s: s, cfg: cfg, keys: keys, tokenURL: googleTokenURL,
		codes:     newCodeStore[appGrant[auth.Identity]](googleCodeTTL),
		linkCodes: newCodeStore[appGrant[ssoIdentity]](googleCodeTTL),
	}
}

func (g *googleAuth) start(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	ret := safeReturnPath(q.Get("redirect"))
	app, challenge, ok := appStartParams(w, q, g.cfg.appScheme)
	if !ok {
		return
	}
	link := q.Get("link") == "1"
	params := url.Values{}
	if ret != "" {
		params.Set("redirect", ret)
	}
	if app != "" {
		params.Set("app", "1")
		params.Set("return", app)
		if challenge != "" {
			params.Set("code_challenge", challenge)
			params.Set("code_challenge_method", "S256")
		}
	}
	if link {
		params.Set("link", "1")
	}
	if bounceToCallbackOrigin(w, r, g.cfg.redirectURL, googleCookiePath, params, app != "") {
		return
	}
	state, verifier := randToken(), randToken()
	g.setFlowCookie(w, "g_state", state)
	g.setFlowCookie(w, "g_verifier", verifier)
	g.setFlowCookie(w, "g_return", ret)
	if app != "" {
		// A challenge is base64url, so it never contains the "." separator.
		g.setFlowCookie(w, googleAppCookie, base64.RawURLEncoding.EncodeToString([]byte(app))+"."+challenge)
	} else {
		g.clearFlowCookie(w, googleAppCookie) // a web flow never inherits an abandoned app flow
	}
	if link {
		if !g.s.startLink(w, r, "google", state, ret, g.secure(), app != "") {
			g.clearFlowCookies(w)
			return
		}
	} else {
		setLinkCookie(w, "", g.secure()) // a plain sign-in never inherits an abandoned link
	}
	sum := sha256.Sum256([]byte(verifier))
	authQ := url.Values{
		"client_id":             {g.cfg.clientID},
		"redirect_uri":          {g.cfg.redirectURL},
		"response_type":         {"code"},
		"scope":                 {"openid email profile"},
		"state":                 {state},
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(sum[:])},
		"code_challenge_method": {"S256"},
		"prompt":                {"select_account"},
	}
	http.Redirect(w, r, googleAuthURL+"?"+authQ.Encode(), http.StatusFound)
}

// appFlow reads the g_app cookie: the app's return target and its PKCE
// challenge, or "", "" for a web flow.
func (g *googleAuth) appFlow(r *http.Request) (app, challenge string) {
	c, err := r.Cookie(googleAppCookie)
	if err != nil {
		return "", ""
	}
	p := strings.Split(c.Value, ".")
	if len(p) != 2 {
		return "", ""
	}
	if app = safeAppReturn(g.cfg.appScheme, unb64(p[0])); app != "" && validChallenge(p[1]) {
		challenge = p[1]
	}
	return app, challenge
}

// googleAppReason maps a web failure key (google_cancelled, google, …) to the
// reason an app flow reports: cancelled | state | email | closed | disabled | failed.
func googleAppReason(key string) string {
	switch r := strings.TrimPrefix(key, "google_"); r {
	case "cancelled", "state", "email", "closed", "disabled":
		return r
	}
	return "failed"
}

func (g *googleAuth) callback(w http.ResponseWriter, r *http.Request) {
	ret := ""
	if c, err := r.Cookie("g_return"); err == nil {
		ret = safeReturnPath(c.Value)
	}
	app, challenge := g.appFlow(r)
	var link *linkTicket
	if st, err := r.Cookie("g_state"); err == nil {
		link = readLink(r, "google", st.Value)
	}
	setLinkCookie(w, "", g.secure())
	fail := func(reason string) {
		g.clearFlowCookies(w)
		if app != "" {
			http.Redirect(w, r, withQueryParam(app, "error", googleAppReason(reason)), http.StatusFound)
			return
		}
		if link != nil {
			linkDone(w, r, ret, "google", linkFailReason("google", reason), http.StatusFound)
			return
		}
		http.Redirect(w, r, failRedirect(reason), http.StatusFound)
	}
	q := r.URL.Query()
	if q.Get("error") != "" {
		fail("google_cancelled")
		return
	}
	st, err := r.Cookie("g_state")
	if err != nil || !constantEq(st.Value, q.Get("state")) {
		fail("google_state")
		return
	}
	ver, err := r.Cookie("g_verifier")
	if err != nil || ver.Value == "" {
		fail("google_state")
		return
	}
	rawID, err := g.exchange(r.Context(), q.Get("code"), ver.Value)
	if err != nil {
		fail("google")
		return
	}
	claims, err := g.keys.verifyGoogle(r.Context(), rawID, []string{g.cfg.clientID})
	if err != nil {
		fail("google")
		return
	}
	pid := ssoIdentity{Provider: "google", Subject: claims.Subject, Email: claims.Email}
	if link != nil {
		if link.App {
			if app == "" {
				fail("google_state")
				return
			}
			g.clearFlowCookies(w)
			http.Redirect(w, r, withQueryParam(app, "code", g.linkCodes.put(appGrant[ssoIdentity]{V: pid, Challenge: challenge})), http.StatusFound)
			return
		}
		g.clearFlowCookies(w)
		g.s.finishWebLink(w, r, link, pid, ret, true, http.StatusFound)
		return
	}
	id, _, err := g.s.resolveProviderUser(r.Context(), pid)
	switch {
	case errors.Is(err, errRegistrationClosed):
		fail("google_closed")
		return
	case errors.Is(err, errAccountDisabled):
		fail("google_disabled")
		return
	case err != nil:
		fail("google")
		return
	}
	g.clearFlowCookies(w)
	if app != "" {
		http.Redirect(w, r, withQueryParam(app, "code", g.codes.put(appGrant[auth.Identity]{V: *id, Challenge: challenge})), http.StatusFound)
		return
	}
	if _, err := g.s.Auth.IssueSession(w, *id); err != nil {
		fail("google")
		return
	}
	if ret == "" {
		ret = afterSignIn(id)
	}
	http.Redirect(w, r, ret, http.StatusFound)
}

func (g *googleAuth) exchange(ctx context.Context, code, verifier string) (string, error) {
	if code == "" {
		return "", errors.New("missing code")
	}
	form := url.Values{
		"client_id": {g.cfg.clientID}, "client_secret": {g.cfg.clientSecret},
		"code": {code}, "code_verifier": {verifier},
		"redirect_uri": {g.cfg.redirectURL}, "grant_type": {"authorization_code"},
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, g.tokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := oauthHTTP.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var out struct {
		IDToken string `json:"id_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || out.IDToken == "" {
		return "", fmt.Errorf("token exchange failed (%d)", resp.StatusCode)
	}
	return out.IDToken, nil
}

func (g *googleAuth) setFlowCookie(w http.ResponseWriter, name, value string) {
	http.SetCookie(w, &http.Cookie{ //#nosec G124 -- short-lived HttpOnly flow cookie; Secure follows the callback scheme
		Name: name, Value: value, Path: googleCookiePath, HttpOnly: true,
		Secure: g.secure(), SameSite: http.SameSiteLaxMode, MaxAge: int(googleFlowTTL.Seconds()),
	})
}

func (g *googleAuth) clearFlowCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{ //#nosec G124 -- deleting a flow cookie
		Name: name, Value: "", Path: googleCookiePath, HttpOnly: true, MaxAge: -1,
		Secure: g.secure(), SameSite: http.SameSiteLaxMode,
	})
}

func (g *googleAuth) clearFlowCookies(w http.ResponseWriter) {
	for _, n := range []string{"g_state", "g_verifier", "g_return", googleAppCookie} {
		g.clearFlowCookie(w, n)
	}
}

// exchangeCode redeems an app flow's one-time code: POST /api/auth/google/exchange.
func (g *googleAuth) exchangeCode(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code     string `json:"code"`
		Verifier string `json:"code_verifier"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body) != nil || body.Code == "" {
		writeJSONErr(w, http.StatusBadRequest, "code required")
		return
	}
	if !oauthLimit.allow("google:" + clientIP(r)) {
		writeJSONErr(w, http.StatusTooManyRequests, "too many requests")
		return
	}
	grant := g.codes.take(body.Code)
	if grant == nil || !grant.redeemableWith(body.Verifier) {
		writeJSONErr(w, http.StatusUnauthorized, "invalid or expired code")
		return
	}
	g.s.nativeAnswer(w, &grant.V, nil)
}

func (g *googleAuth) idToken(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDToken string `json:"id_token"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body) != nil || body.IDToken == "" {
		writeJSONErr(w, http.StatusBadRequest, "id_token required")
		return
	}
	if !oauthLimit.allow("google:" + clientIP(r)) {
		writeJSONErr(w, http.StatusTooManyRequests, "too many requests")
		return
	}
	claims, err := g.keys.verifyGoogle(r.Context(), body.IDToken, g.cfg.audiences)
	if err != nil {
		writeJSONErr(w, http.StatusUnauthorized, "invalid google token")
		return
	}
	id, _, err := g.s.resolveProviderUser(r.Context(), ssoIdentity{Provider: "google", Subject: claims.Subject, Email: claims.Email})
	g.s.nativeAnswer(w, id, err)
}

func (g *googleAuth) linkNative(w http.ResponseWriter, r *http.Request) {
	if !linkPreflight(w, r) {
		return
	}
	var body struct {
		IDToken  string `json:"id_token"`
		Code     string `json:"code"`
		Verifier string `json:"code_verifier"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body) != nil || (body.IDToken == "" && body.Code == "") {
		writeJSONErr(w, http.StatusBadRequest, "id_token or code required")
		return
	}
	if body.IDToken == "" { // an app link: redeem the one-time code the callback minted
		grant := g.linkCodes.take(body.Code)
		if grant == nil || !grant.redeemableWith(body.Verifier) {
			writeJSONErr(w, http.StatusUnauthorized, "invalid or expired code")
			return
		}
		g.s.linkForRequest(w, r, grant.V)
		return
	}
	claims, err := g.keys.verifyGoogle(r.Context(), body.IDToken, g.cfg.audiences)
	if err != nil {
		writeJSONErr(w, http.StatusUnauthorized, "invalid google token")
		return
	}
	g.s.linkForRequest(w, r, ssoIdentity{Provider: "google", Subject: claims.Subject, Email: claims.Email})
}

var oauthLimit = newLimiter(30, 5*time.Minute)

// nativeAnswer answers a native sign-in exactly as POST /api/auth/login does,
// {token, user}, without a cookie.
func (s *Service) nativeAnswer(w http.ResponseWriter, id *auth.Identity, err error) {
	switch {
	case errors.Is(err, errRegistrationClosed):
		writeJSONErr(w, http.StatusForbidden, "registration is closed on this site")
		return
	case errors.Is(err, errAccountDisabled):
		disabledResponse(w)
		return
	case err != nil || id == nil:
		writeJSONErr(w, http.StatusInternalServerError, "login failed")
		return
	}
	token, err := s.Auth.IssueToken(*id)
	if err != nil {
		writeJSONErr(w, http.StatusInternalServerError, "login failed")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": id})
}

// ---- JWKS verification (Google and Apple, RS256) ----------------------------------

type jwks struct {
	url     string
	mu      sync.Mutex
	keys    map[string]*rsa.PublicKey
	fetched time.Time
}

func newJWKS(u string) *jwks { return &jwks{url: u} }

func (k *jwks) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if pk, ok := k.keys[kid]; ok && time.Since(k.fetched) < time.Hour {
		return pk, nil
	}
	if time.Since(k.fetched) < 30*time.Second && k.keys != nil { // throttle garbage kids
		if pk, ok := k.keys[kid]; ok {
			return pk, nil
		}
		return nil, errors.New("unknown signing key")
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, k.url, nil)
	resp, err := oauthHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var set struct {
		Keys []struct{ Kid, Kty, N, E string } `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&set); err != nil {
		return nil, err
	}
	m := map[string]*rsa.PublicKey{}
	for _, j := range set.Keys {
		if j.Kty != "RSA" {
			continue
		}
		n, err1 := base64.RawURLEncoding.DecodeString(j.N)
		e, err2 := base64.RawURLEncoding.DecodeString(j.E)
		if err1 != nil || err2 != nil {
			continue
		}
		m[j.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
	}
	k.keys, k.fetched = m, time.Now()
	if pk, ok := m[kid]; ok {
		return pk, nil
	}
	return nil, errors.New("unknown signing key")
}

type googleClaims struct {
	Email         string `json:"email"`
	EmailVerified any    `json:"email_verified"`
	jwt.RegisteredClaims
}

func boolish(v any) bool {
	switch b := v.(type) {
	case bool:
		return b
	case string:
		return strings.EqualFold(b, "true")
	}
	return false
}

func audienceOK(got jwt.ClaimStrings, want []string) bool {
	for _, a := range got {
		for _, w := range want {
			if a == w {
				return true
			}
		}
	}
	return false
}

func (k *jwks) verifyGoogle(ctx context.Context, raw string, audiences []string) (*googleClaims, error) {
	if len(audiences) == 0 {
		return nil, errors.New("no audiences configured")
	}
	var c googleClaims
	_, err := jwt.ParseWithClaims(raw, &c, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		return k.key(ctx, kid)
	}, jwt.WithValidMethods([]string{"RS256"}), jwt.WithExpirationRequired(), jwt.WithIssuedAt(), jwt.WithLeeway(30*time.Second))
	if err != nil {
		return nil, err
	}
	if c.Issuer != "accounts.google.com" && c.Issuer != "https://accounts.google.com" {
		return nil, errors.New("wrong issuer")
	}
	if !audienceOK(c.Audience, audiences) {
		return nil, errors.New("wrong audience")
	}
	if c.Email == "" || !boolish(c.EmailVerified) {
		return nil, errors.New("email not verified")
	}
	return &c, nil
}
