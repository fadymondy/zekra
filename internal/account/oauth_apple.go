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

	GET  /api/auth/apple            web — start (state + nonce, response_mode=form_post)
	POST /api/auth/apple/callback   Apple POSTs the form here
	POST /api/auth/apple/token      native identity token {identity_token, nonce?, full_name?} -> {token, user}
	POST /api/me/identities/apple   native link {identity_token, nonce}

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
*/

const (
	appleAuthURL    = "https://appleid.apple.com/auth/authorize"
	appleTokenURL   = "https://appleid.apple.com/auth/token"
	appleKeysURL    = "https://appleid.apple.com/auth/keys"
	appleIssuer     = "https://appleid.apple.com"
	appleCookiePath = "/api/auth/apple"
	appleFlowCookie = "a_flow"
	appleFlowTTL    = 10 * time.Minute
)

type appleConfig struct {
	servicesID, teamID, keyID string
	key                       *ecdsa.PrivateKey
	bundleIDs                 []string
	redirectURL               string
}

func loadAppleConfig() (appleConfig, error) {
	c := appleConfig{
		servicesID:  firstEnv("APPLE_SERVICES_ID", "APPLE_SERVICE_ID", "APPLE_CLIENT_ID"),
		teamID:      firstEnv("APPLE_TEAM_ID"),
		keyID:       firstEnv("APPLE_KEY_ID"),
		redirectURL: firstEnv("APPLE_REDIRECT_URL"),
		bundleIDs:   splitCSV(os.Getenv("APPLE_BUNDLE_IDS")),
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

// clientSecret is the ES256 JWT Apple takes in place of a static secret.
func (c appleConfig) clientSecret(now time.Time) (string, error) {
	tok := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{
		"iss": c.teamID, "sub": c.servicesID, "aud": appleIssuer,
		"iat": now.Unix(), "exp": now.Add(5 * time.Minute).Unix(),
	})
	tok.Header["kid"] = c.keyID
	return tok.SignedString(c.key)
}

type appleAuth struct {
	s    *Service
	cfg  appleConfig
	keys *jwks
}

func (a *appleAuth) secure() bool { return strings.HasPrefix(a.cfg.redirectURL, "https://") }

func (s *Service) mountApple(router chi.Router) *auth.LoginMethod {
	cfg, err := loadAppleConfig()
	if err != nil {
		s.log().Warn(fmt.Sprintf("apple sign-in: cannot load the private key (%v) — web flow disabled", err))
	}
	if !cfg.webReady() && len(cfg.nativeAudiences()) == 0 {
		return nil
	}
	a := &appleAuth{s: s, cfg: cfg, keys: newJWKS(appleKeysURL)}
	router.Post("/api/auth/apple/token", a.nativeToken)
	router.Post("/api/me/identities/apple", a.linkNative)
	if !cfg.webReady() {
		return nil
	}
	router.Get("/api/auth/apple", a.start)
	router.Post("/api/auth/apple/callback", a.callback)
	return &auth.LoginMethod{Name: "apple", Label: "Continue with Apple", Type: "oauth", URL: "/api/auth/apple"}
}

func (a *appleAuth) start(w http.ResponseWriter, r *http.Request) {
	ret := safeReturnPath(r.URL.Query().Get("redirect"))
	link := r.URL.Query().Get("link") == "1"
	params := url.Values{}
	if ret != "" {
		params.Set("redirect", ret)
	}
	if link {
		params.Set("link", "1")
	}
	if bounceToCallbackOrigin(w, r, a.cfg.redirectURL, appleCookiePath, params, false) {
		return
	}
	state, nonce := randToken(), randToken()
	if link {
		if !a.s.startLink(w, r, "apple", state, ret, a.secure(), false) {
			return
		}
	} else {
		setLinkCookie(w, "", a.secure())
	}
	http.SetCookie(w, a.flowCookie(state+"."+nonce+"."+base64.RawURLEncoding.EncodeToString([]byte(ret)), int(appleFlowTTL.Seconds())))
	q := url.Values{
		"client_id":     {a.cfg.servicesID},
		"redirect_uri":  {a.cfg.redirectURL},
		"response_type": {"code"},
		"response_mode": {"form_post"},
		"scope":         {"name email"},
		"state":         {state},
		"nonce":         {nonce},
	}
	// Apple wants the scope space as %20; url.Values writes "+".
	http.Redirect(w, r, appleAuthURL+"?"+strings.ReplaceAll(q.Encode(), "+", "%20"), http.StatusFound)
}

func (a *appleAuth) callback(w http.ResponseWriter, r *http.Request) {
	var parts []string
	if c, err := r.Cookie(appleFlowCookie); err == nil {
		parts = strings.SplitN(c.Value, ".", 3)
	}
	ret := ""
	var link *linkTicket
	if len(parts) == 3 {
		ret = safeReturnPath(unb64(parts[2]))
		link = readLink(r, "apple", parts[0])
	}
	setLinkCookie(w, "", a.secure())
	// 303 so the browser follows with a GET, not a re-POST.
	fail := func(reason string) {
		http.SetCookie(w, a.flowCookie("", -1))
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
	if len(parts) != 3 || parts[1] == "" || !constantEq(parts[0], form.Get("state")) {
		fail("apple_state")
		return
	}
	nonce := parts[1]
	rawID, err := a.exchange(r.Context(), form.Get("code"))
	if err != nil {
		fail("apple")
		return
	}
	claims, err := a.keys.verifyApple(r.Context(), rawID, []string{a.cfg.servicesID}, nonce)
	if err != nil {
		fail("apple")
		return
	}
	pid := ssoIdentity{Provider: "apple", Subject: claims.Subject, Email: claims.Email}
	if link != nil {
		// Apple's cross-site POST never carries the Lax session cookie: the sealed
		// ticket + state are the binding.
		http.SetCookie(w, a.flowCookie("", -1))
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
	if _, err := a.s.Auth.IssueSession(w, *id); err != nil {
		fail("apple")
		return
	}
	if ret == "" {
		ret = afterSignIn(id)
	}
	http.Redirect(w, r, ret, http.StatusSeeOther)
}

func (a *appleAuth) exchange(ctx context.Context, code string) (string, error) {
	if code == "" {
		return "", errors.New("missing code")
	}
	secret, err := a.cfg.clientSecret(a.s.now())
	if err != nil {
		return "", err
	}
	form := url.Values{
		"client_id": {a.cfg.servicesID}, "client_secret": {secret},
		"code": {code}, "grant_type": {"authorization_code"}, "redirect_uri": {a.cfg.redirectURL},
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, appleTokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := oauthHTTP.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var out struct {
		IDToken string `json:"id_token"`
		Error   string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || out.IDToken == "" {
		return "", fmt.Errorf("apple token exchange failed (%d %s)", resp.StatusCode, out.Error)
	}
	return out.IDToken, nil
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

func (a *appleAuth) nativeToken(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IdentityToken string `json:"identity_token"`
		Nonce         string `json:"nonce"`
		FullName      string `json:"full_name"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body) != nil || body.IdentityToken == "" {
		writeJSONErr(w, http.StatusBadRequest, "identity_token required")
		return
	}
	if !oauthLimit.allow("apple:" + clientIP(r)) {
		writeJSONErr(w, http.StatusTooManyRequests, "too many requests")
		return
	}
	claims, err := a.keys.verifyApple(r.Context(), body.IdentityToken, a.cfg.nativeAudiences(), body.Nonce)
	if err != nil {
		writeJSONErr(w, http.StatusUnauthorized, "invalid apple token")
		return
	}
	id, created, err := a.s.resolveProviderUser(r.Context(), ssoIdentity{Provider: "apple", Subject: claims.Subject, Email: claims.Email})
	if err == nil && created {
		a.s.saveName(r.Context(), id.ID, body.FullName)
	}
	a.s.nativeAnswer(w, id, err)
}

// linkNative requires the nonce: a lifted identity token cannot be replayed to
// attach someone's Apple ID to another account.
func (a *appleAuth) linkNative(w http.ResponseWriter, r *http.Request) {
	if !linkPreflight(w, r) {
		return
	}
	var body struct {
		IdentityToken string `json:"identity_token"`
		Nonce         string `json:"nonce"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body) != nil || body.IdentityToken == "" || body.Nonce == "" {
		writeJSONErr(w, http.StatusBadRequest, "identity_token and nonce required")
		return
	}
	claims, err := a.keys.verifyApple(r.Context(), body.IdentityToken, a.cfg.nativeAudiences(), body.Nonce)
	if err != nil {
		writeJSONErr(w, http.StatusUnauthorized, "invalid apple token")
		return
	}
	a.s.linkForRequest(w, r, ssoIdentity{Provider: "apple", Subject: claims.Subject, Email: claims.Email})
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

// verifyApple checks signature (RS256, Apple's JWKS), issuer, expiry, audience,
// nonce (raw or its SHA-256 hex) and a verified email.
func (k *jwks) verifyApple(ctx context.Context, raw string, audiences []string, nonce string) (*appleClaims, error) {
	if len(audiences) == 0 {
		return nil, errors.New("no audiences configured")
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
	if nonce != "" {
		sum := sha256.Sum256([]byte(nonce))
		if !constantEq(c.Nonce, nonce) && !constantEq(c.Nonce, hex.EncodeToString(sum[:])) {
			return nil, errors.New("nonce mismatch")
		}
	}
	if c.Email == "" || !boolish(c.EmailVerified) {
		return nil, errors.New("email not verified")
	}
	return &c, nil
}
