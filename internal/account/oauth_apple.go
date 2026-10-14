package account

import (
	"context"
	"crypto/ecdsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/togo-framework/auth"
)

/*
Sign in with Apple (ported from fadymondy's internal/server/apple.go).

	GET  /api/auth/apple                             web — start (state + nonce, response_mode=form_post)
	GET  /api/auth/apple?app=1&return=<scheme>://…   app — start (Android, or any app without the sheet)
	     [&code_challenge=<S256>&code_challenge_method=S256]
	POST /api/auth/apple/callback                    Apple POSTs the form here
	POST /api/auth/apple/exchange {code, code_verifier?}  app — one-time code -> {token, user}
	POST /api/auth/apple/token      native identity token {identity_token, nonce, full_name?, authorization_code?} -> {token, user}
	POST /api/me/identities/apple   native link {identity_token, nonce, authorization_code?}
	POST /api/me/identities/apple   app link — redeem a one-time link code {code, code_verifier?}

The app flow is GitHub's and Google's (oauth_github.go): the app opens the start
URL in the system browser, Apple form-posts to the callback, and the callback
redirects (303) to <return>?code=… (or ?error=cancelled|state|closed|disabled|failed);
the app trades the single-use, two-minute code at /exchange, PKCE-bound when it
sent a challenge. It runs on the web client (the Services ID), so it needs no
Android OAuth client and no native module — it is how Android signs in with Apple.

Every authorization code the server sees (web, app, and the iOS sheet's
authorizationCode) is traded for a refresh token that is kept, sealed, so it can
be revoked when the identity is disconnected or the account deleted
(apple_tokens.go).

Apple's form_post is a cross-site POST, so the flow cookie is SameSite=None;
Secure (Lax over plain http, where Apple never redirects anyway). Apple sends the
user's name once, on the first authorization; it is stored on the new account's
profile.

Env (fadymondy's names; aliases accepted):
	APPLE_SERVICES_ID | APPLE_SERVICE_ID   the Services ID (web client_id)
	APPLE_TEAM_ID, APPLE_KEY_ID
	APPLE_PRIVATE_KEY_PATH                 the .p8 key file, or
	APPLE_PRIVATE_KEY                      the .p8 PEM inline (literal "\n" allowed)
	APPLE_BUNDLE_IDS                       native audiences, comma-separated (optional)
	APPLE_REDIRECT_URL                     default AUTH_PUBLIC_URL (or APP_URL) + /api/auth/apple/callback
	APPLE_APP_SCHEME                       the native app's return scheme (default "zekra", as GITHUB_APP_SCHEME)
*/

const (
	appleAuthURL    = "https://appleid.apple.com/auth/authorize"
	appleTokenURL   = "https://appleid.apple.com/auth/token"
	appleKeysURL    = "https://appleid.apple.com/auth/keys"
	appleIssuer     = "https://appleid.apple.com"
	appleCookiePath = "/api/auth/apple"
	appleFlowCookie = "a_flow"
	appleFlowTTL    = 10 * time.Minute
	appleCodeTTL    = 2 * time.Minute
)

type appleConfig struct {
	servicesID, teamID, keyID string
	key                       *ecdsa.PrivateKey
	bundleIDs                 []string
	redirectURL, appScheme    string
}

func loadAppleConfig() (appleConfig, error) {
	c := appleConfig{
		servicesID:  firstEnv("APPLE_SERVICES_ID", "APPLE_SERVICE_ID", "APPLE_CLIENT_ID"),
		teamID:      firstEnv("APPLE_TEAM_ID"),
		keyID:       firstEnv("APPLE_KEY_ID"),
		redirectURL: firstEnv("APPLE_REDIRECT_URL"),
		bundleIDs:   splitCSV(os.Getenv("APPLE_BUNDLE_IDS")),
		appScheme:   firstEnv("APPLE_APP_SCHEME"),
	}
	if c.appScheme == "" {
		c.appScheme = "zekra"
	}
	if c.redirectURL == "" {
		c.redirectURL = publicURL() + "/api/auth/apple/callback"
	}
	var pemBytes []byte
	if p := firstEnv("APPLE_PRIVATE_KEY_PATH"); p != "" {
		b, err := os.ReadFile(p) //#nosec G304 -- operator-supplied key path from the environment
		if err != nil {
			return c, err
		}
		pemBytes = b
	} else if inline := firstEnv("APPLE_PRIVATE_KEY"); inline != "" {
		pemBytes = []byte(strings.ReplaceAll(inline, `\n`, "\n"))
	}
	if len(pemBytes) == 0 {
		return c, nil
	}
	var err error
	c.key, err = jwt.ParseECPrivateKeyFromPEM(pemBytes)
	return c, err
}

func (c appleConfig) webReady() bool {
	return c.servicesID != "" && c.teamID != "" && c.keyID != "" && c.key != nil
}

// nativeAudiences: the app's bundle ids, plus the Services ID.
func (c appleConfig) nativeAudiences() []string {
	a := append([]string(nil), c.bundleIDs...)
	if c.servicesID != "" {
		a = append(a, c.servicesID)
	}
	return a
}

type appleAuth struct {
	s         *Service
	cfg       appleConfig
	keys      *jwks
	tokens    *appleTokens
	codes     *codeStore[appGrant[auth.Identity]]
	linkCodes *codeStore[appGrant[ssoIdentity]]
}

func newAppleAuth(s *Service, cfg appleConfig, keys *jwks) *appleAuth {
	return &appleAuth{
		s: s, cfg: cfg, keys: keys, tokens: newAppleTokens(cfg),
		codes:     newCodeStore[appGrant[auth.Identity]](appleCodeTTL),
		linkCodes: newCodeStore[appGrant[ssoIdentity]](appleCodeTTL),
	}
}

func (a *appleAuth) secure() bool { return strings.HasPrefix(a.cfg.redirectURL, "https://") }

func (s *Service) mountApple(router chi.Router) *auth.LoginMethod {
	cfg, err := loadAppleConfig()
	if err != nil {
		s.log().Warn(fmt.Sprintf("apple sign-in: cannot load the private key (%v) — web flow disabled", err))
	}
	a := newAppleAuth(s, cfg, newJWKS(appleKeysURL))
	// Purge and unlink revoke Apple tokens even when sign-in is off now.
	s.appleTokens = a.tokens
	if !cfg.webReady() && len(cfg.nativeAudiences()) == 0 {
		return nil
	}
	router.Post("/api/auth/apple/token", a.nativeToken)
	router.Post("/api/me/identities/apple", a.linkNative)
	if !cfg.webReady() {
		return nil
	}
	router.Get("/api/auth/apple", a.start)
	router.Post("/api/auth/apple/callback", a.callback)
	router.Post("/api/auth/apple/exchange", a.exchangeCode)
	return &auth.LoginMethod{Name: "apple", Label: "Continue with Apple", Type: "oauth", URL: "/api/auth/apple"}
}

func (a *appleAuth) start(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	ret := safeReturnPath(q.Get("redirect"))
	app, challenge, ok := appStartParams(w, q, a.cfg.appScheme)
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
	if bounceToCallbackOrigin(w, r, a.cfg.redirectURL, appleCookiePath, params, app != "") {
		return
	}
	state, nonce := randToken(), randToken()
	if link {
		if !a.s.startLink(w, r, "apple", state, ret, a.secure(), app != "") {
			return
		}
	} else {
		setLinkCookie(w, "", a.secure())
	}
	// state.nonce.b64(redirect).b64(app return).challenge — a challenge is
	// base64url, so no part contains the "." separator.
	b64 := base64.RawURLEncoding.EncodeToString
	http.SetCookie(w, a.flowCookie(state+"."+nonce+"."+b64([]byte(ret))+"."+b64([]byte(app))+"."+challenge, int(appleFlowTTL.Seconds())))
	authQ := url.Values{
		"client_id":     {a.cfg.servicesID},
		"redirect_uri":  {a.cfg.redirectURL},
		"response_type": {"code"},
		"response_mode": {"form_post"},
		"scope":         {"name email"},
		"state":         {state},
		"nonce":         {nonce},
	}
	// Apple wants the scope space as %20; url.Values writes "+".
	http.Redirect(w, r, appleAuthURL+"?"+strings.ReplaceAll(authQ.Encode(), "+", "%20"), http.StatusFound)
}

// appleFlow is the flow cookie, parsed. Three parts come from a flow started
// before the app flow existed (a web flow).
type appleFlow struct{ state, nonce, ret, app, challenge string }

func (a *appleAuth) readFlow(r *http.Request) (appleFlow, bool) {
	c, err := r.Cookie(appleFlowCookie)
	if err != nil {
		return appleFlow{}, false
	}
	p := strings.Split(c.Value, ".")
	if len(p) != 3 && len(p) != 5 {
		return appleFlow{}, false
	}
	f := appleFlow{state: p[0], nonce: p[1], ret: safeReturnPath(unb64(p[2]))}
	if len(p) == 5 {
		f.app = safeAppReturn(a.cfg.appScheme, unb64(p[3]))
		if f.app != "" && validChallenge(p[4]) {
			f.challenge = p[4]
		}
	}
	return f, true
}

// appleAppReason maps a web failure key (apple_cancelled, apple, …) to the
// reason an app flow reports: cancelled | state | closed | disabled | failed.
func appleAppReason(key string) string {
	switch r := strings.TrimPrefix(key, "apple_"); r {
	case "cancelled", "state", "closed", "disabled":
		return r
	}
	return "failed"
}

func (a *appleAuth) callback(w http.ResponseWriter, r *http.Request) {
	flow, hasFlow := a.readFlow(r)
	var link *linkTicket
	if hasFlow {
		link = readLink(r, "apple", flow.state)
	}
	ret, app := flow.ret, flow.app
	setLinkCookie(w, "", a.secure())
	// 303 so the browser follows with a GET, not a re-POST.
	fail := func(reason string) {
		http.SetCookie(w, a.flowCookie("", -1))
		if app != "" {
			http.Redirect(w, r, withQueryParam(app, "error", appleAppReason(reason)), http.StatusSeeOther)
			return
		}
		if link != nil {
			linkDone(w, r, ret, "apple", linkFailReason("apple", reason), http.StatusSeeOther)
			return
		}
		http.Redirect(w, r, failRedirect(reason), http.StatusSeeOther)
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := r.ParseForm(); err != nil {
		fail("apple")
		return
	}
	form := r.PostForm
	if e := form.Get("error"); e != "" {
		if e == "user_cancelled_authorize" {
			fail("apple_cancelled")
		} else {
			fail("apple")
		}
		return
	}
	if !hasFlow || flow.nonce == "" || !constantEq(flow.state, form.Get("state")) {
		fail("apple_state")
		return
	}
	set, err := a.tokens.exchange(r.Context(), a.cfg.servicesID, form.Get("code"), a.cfg.redirectURL, a.s.now())
	if err != nil {
		fail("apple")
		return
	}
	// Web: the nonce is the server's own (from the flow cookie) and went to Apple raw.
	claims, err := a.keys.verifyApple(r.Context(), set.IDToken, []string{a.cfg.servicesID}, flow.nonce, nonceRaw)
	if err != nil {
		fail("apple")
		return
	}
	pid := ssoIdentity{Provider: "apple", Subject: claims.Subject, Email: claims.Email,
		RefreshToken: set.RefreshToken, TokenClient: a.cfg.servicesID}
	if link != nil {
		http.SetCookie(w, a.flowCookie("", -1))
		if link.App {
			if app == "" {
				fail("apple_state")
				return
			}
			http.Redirect(w, r, withQueryParam(app, "code", a.linkCodes.put(appGrant[ssoIdentity]{V: pid, Challenge: flow.challenge})), http.StatusSeeOther)
			return
		}
		// Apple's cross-site POST never carries the Lax session cookie: the sealed
		// ticket + state are the binding.
		a.s.finishWebLink(w, r, link, pid, ret, false, http.StatusSeeOther)
		return
	}
	id, created, err := a.s.resolveProviderUser(r.Context(), pid)
	switch {
	case errors.Is(err, errRegistrationClosed):
		fail("apple_closed")
		return
	case errors.Is(err, errAccountDisabled):
		fail("apple_disabled")
		return
	case err != nil:
		fail("apple")
		return
	}
	if created {
		a.s.saveName(r.Context(), id.ID, appleFormName(form.Get("user")))
	}
	http.SetCookie(w, a.flowCookie("", -1))
	if app != "" {
		http.Redirect(w, r, withQueryParam(app, "code", a.codes.put(appGrant[auth.Identity]{V: *id, Challenge: flow.challenge})), http.StatusSeeOther)
		return
	}
	if _, err := a.s.Auth.IssueSession(w, *id); err != nil {
		fail("apple")
		return
	}
	if ret == "" {
		ret = afterSignIn(id)
	}
	http.Redirect(w, r, ret, http.StatusSeeOther)
}

// exchangeCode redeems an app flow's one-time code: POST /api/auth/apple/exchange.
func (a *appleAuth) exchangeCode(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code     string `json:"code"`
		Verifier string `json:"code_verifier"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body) != nil || body.Code == "" {
		writeJSONErr(w, http.StatusBadRequest, "code required")
		return
	}
	if !oauthLimit.allow("apple:" + clientIP(r)) {
		writeJSONErr(w, http.StatusTooManyRequests, "too many requests")
		return
	}
	grant := a.codes.take(body.Code)
	if grant == nil || !grant.redeemableWith(body.Verifier) {
		writeJSONErr(w, http.StatusUnauthorized, "invalid or expired code")
		return
	}
	a.s.nativeAnswer(w, &grant.V, nil)
}

// nativeRefresh trades the iOS sheet's authorizationCode for a refresh token
// (client_id = the identity token's audience, the bundle id). Best effort: a
// sign-in never fails on it, and a code for another Apple ID is ignored.
func (a *appleAuth) nativeRefresh(ctx context.Context, pid *ssoIdentity, claims *appleClaims, code string) {
	if code == "" || !a.tokens.canSign() {
		return
	}
	client := ""
	for _, aud := range claims.Audience {
		for _, want := range a.cfg.nativeAudiences() {
			if aud == want {
				client = aud
			}
		}
	}
	if client == "" {
		return
	}
	redirect := ""
	if client == a.cfg.servicesID {
		redirect = a.cfg.redirectURL
	}
	set, err := a.tokens.exchange(ctx, client, code, redirect, a.s.now())
	if err != nil {
		a.s.log().Warn("apple: authorization code not exchanged", "err", err)
		return
	}
	if unverifiedSubject(set.IDToken) != claims.Subject || set.RefreshToken == "" {
		return
	}
	pid.RefreshToken, pid.TokenClient = set.RefreshToken, client
}

func (a *appleAuth) flowCookie(value string, maxAge int) *http.Cookie {
	sameSite := http.SameSiteLaxMode
	if a.secure() {
		sameSite = http.SameSiteNoneMode // must survive Apple's cross-site form POST
	}
	return &http.Cookie{ //#nosec G124 -- short-lived HttpOnly flow cookie; SameSite=None only with Secure
		Name: appleFlowCookie, Value: value, Path: appleCookiePath, HttpOnly: true,
		Secure: a.secure(), SameSite: sameSite, MaxAge: maxAge,
	}
}

// nativeToken signs in with an identity token from the app's Apple sheet. The
// nonce is required and must hash to the token's claim (see nonceSHA256), so a
// token lifted from one sign-in cannot be replayed.
func (a *appleAuth) nativeToken(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IdentityToken     string `json:"identity_token"`
		Nonce             string `json:"nonce"`
		FullName          string `json:"full_name"`
		AuthorizationCode string `json:"authorization_code"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body) != nil || body.IdentityToken == "" || body.Nonce == "" {
		writeJSONErr(w, http.StatusBadRequest, "identity_token and nonce required")
		return
	}
	if !oauthLimit.allow("apple:" + clientIP(r)) {
		writeJSONErr(w, http.StatusTooManyRequests, "too many requests")
		return
	}
	claims, err := a.keys.verifyApple(r.Context(), body.IdentityToken, a.cfg.nativeAudiences(), body.Nonce, nonceSHA256)
	if err != nil {
		writeJSONErr(w, http.StatusUnauthorized, "invalid apple token")
		return
	}
	pid := ssoIdentity{Provider: "apple", Subject: claims.Subject, Email: claims.Email}
	a.nativeRefresh(r.Context(), &pid, claims, body.AuthorizationCode)
	id, created, err := a.s.resolveProviderUser(r.Context(), pid)
	if err == nil && created {
		a.s.saveName(r.Context(), id.ID, body.FullName)
	}
	a.s.nativeAnswer(w, id, err)
}

// linkNative links the caller's Apple ID: an identity token from the sheet
// (the nonce is required, so a lifted token cannot be replayed to attach
// someone's Apple ID to another account), or an app flow's one-time link code.
func (a *appleAuth) linkNative(w http.ResponseWriter, r *http.Request) {
	if !linkPreflight(w, r) {
		return
	}
	var body struct {
		IdentityToken     string `json:"identity_token"`
		Nonce             string `json:"nonce"`
		AuthorizationCode string `json:"authorization_code"`
		Code              string `json:"code"`
		Verifier          string `json:"code_verifier"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body) != nil ||
		((body.IdentityToken == "" || body.Nonce == "") && body.Code == "") {
		writeJSONErr(w, http.StatusBadRequest, "identity_token and nonce, or code, required")
		return
	}
	if body.IdentityToken == "" { // an app link: redeem the one-time code the callback minted
		grant := a.linkCodes.take(body.Code)
		if grant == nil || !grant.redeemableWith(body.Verifier) {
			writeJSONErr(w, http.StatusUnauthorized, "invalid or expired code")
			return
		}
		a.s.linkForRequest(w, r, grant.V)
		return
	}
	claims, err := a.keys.verifyApple(r.Context(), body.IdentityToken, a.cfg.nativeAudiences(), body.Nonce, nonceSHA256)
	if err != nil {
		writeJSONErr(w, http.StatusUnauthorized, "invalid apple token")
		return
	}
	pid := ssoIdentity{Provider: "apple", Subject: claims.Subject, Email: claims.Email}
	a.nativeRefresh(r.Context(), &pid, claims, body.AuthorizationCode)
	a.s.linkForRequest(w, r, pid)
}

// appleFormName reads the web flow's `user` field.
func appleFormName(raw string) string {
	if raw == "" {
		return ""
	}
	var u struct {
		Name struct {
			FirstName string `json:"firstName"`
			LastName  string `json:"lastName"`
		} `json:"name"`
	}
	if json.Unmarshal([]byte(raw), &u) != nil {
		return ""
	}
	return strings.TrimSpace(strings.TrimSpace(u.Name.FirstName) + " " + strings.TrimSpace(u.Name.LastName))
}

// saveName puts the provider's name on a brand-new account's profile. Best effort.
func (s *Service) saveName(ctx context.Context, userID, name string) {
	name = strings.TrimSpace(name)
	if name == "" || userID == "" {
		return
	}
	if rs := []rune(name); len(rs) > 80 {
		name = string(rs[:80])
	}
	_, _ = s.DB.ExecContext(ctx, `INSERT INTO account_profiles (user_id, name) VALUES ($1,$2) ON CONFLICT (user_id) DO NOTHING`, userID, name)
}

type appleClaims struct {
	Email         string `json:"email"`
	EmailVerified any    `json:"email_verified"`
	Nonce         string `json:"nonce"`
	jwt.RegisteredClaims
}

// nonceMode says how the token's nonce claim relates to the nonce presented.
type nonceMode int

const (
	// nonceRaw: the web flow. The nonce is the server's own, kept in the flow
	// cookie, and was sent to Apple as is.
	nonceRaw nonceMode = iota
	// nonceSHA256: native sign-in and link. The app sent Apple the SHA-256 (hex)
	// of a random value and gives the server the value itself. Only the hash is
	// accepted: the claim is readable by anyone holding the token, so accepting
	// it raw would let a lifted token be replayed with its own claim as the nonce.
	nonceSHA256
)

// verifyApple checks signature (RS256, Apple's JWKS), issuer, expiry, audience,
// the nonce (required; compared as mode says) and a verified email.
func (k *jwks) verifyApple(ctx context.Context, raw string, audiences []string, nonce string, mode nonceMode) (*appleClaims, error) {
	if len(audiences) == 0 {
		return nil, errors.New("no audiences configured")
	}
	if nonce == "" {
		return nil, errors.New("nonce required")
	}
	var c appleClaims
	_, err := jwt.ParseWithClaims(raw, &c, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		return k.key(ctx, kid)
	}, jwt.WithValidMethods([]string{"RS256"}), jwt.WithExpirationRequired(), jwt.WithIssuedAt(),
		jwt.WithLeeway(30*time.Second), jwt.WithIssuer(appleIssuer))
	if err != nil {
		return nil, err
	}
	if !audienceOK(c.Audience, audiences) {
		return nil, errors.New("wrong audience")
	}
	want := nonce
	if mode == nonceSHA256 {
		sum := sha256.Sum256([]byte(nonce))
		want = hex.EncodeToString(sum[:])
	}
	if !constantEq(c.Nonce, want) {
		return nil, errors.New("nonce mismatch")
	}
	if c.Email == "" || !boolish(c.EmailVerified) {
		return nil, errors.New("email not verified")
	}
	return &c, nil
}
