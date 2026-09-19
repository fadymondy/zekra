package account

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/togo-framework/auth"
)

/*
Sign in with GitHub (ported from fadymondy's internal/server/github.go). The
client may be a GitHub App or an OAuth App; PKCE (S256) either way. The address
is the primary AND verified one from GET /user/emails; the account id (numeric,
stable across renames) is the identity. The GitHub token is used for those two
calls and dropped.

	GET  /api/auth/github?redirect=/path            web — start (?link=1 to connect)
	GET  /api/auth/github?app=1&return=<scheme>://…  app — start (auth session in a system browser)
	GET  /api/auth/github/callback                  GitHub sends the browser back here
	POST /api/auth/github/exchange {code}           app — one-time code -> {token, user}
	POST /api/me/identities/github {code}           app link — redeem a one-time link code

Env (fadymondy's names; aliases accepted):
	OAUTH_GITHUB_CLIENT_ID     | GITHUB_CLIENT_ID
	OAUTH_GITHUB_CLIENT_SECRET | GITHUB_CLIENT_SECRET
	OAUTH_GITHUB_REDIRECT_URL  default AUTH_PUBLIC_URL (or APP_URL) + /api/auth/github/callback
	GITHUB_APP_SCHEME          the native app's return scheme (default "zekra")
*/

const (
	githubAuthURL    = "https://github.com/login/oauth/authorize"
	githubTokenURL   = "https://github.com/login/oauth/access_token"
	githubEmailsURL  = "https://api.github.com/user/emails"
	githubUserURL    = "https://api.github.com/user"
	githubCookiePath = "/api/auth/github"
	githubFlowCookie = "gh_flow"
	githubFlowTTL    = 10 * time.Minute
	githubCodeTTL    = 2 * time.Minute
)

var (
	errGitHubNoEmail  = errors.New("no primary verified email")
	errGitHubEmailAPI = errors.New("email api refused")
)

type githubConfig struct{ clientID, clientSecret, redirectURL, appScheme string }

func loadGitHubConfig() githubConfig {
	c := githubConfig{
		clientID:     firstEnv("OAUTH_GITHUB_CLIENT_ID", "GITHUB_CLIENT_ID"),
		clientSecret: firstEnv("OAUTH_GITHUB_CLIENT_SECRET", "GITHUB_CLIENT_SECRET"),
		redirectURL:  firstEnv("OAUTH_GITHUB_REDIRECT_URL", "GITHUB_REDIRECT_URL"),
		appScheme:    firstEnv("GITHUB_APP_SCHEME"),
	}
	if c.redirectURL == "" {
		c.redirectURL = publicURL() + "/api/auth/github/callback"
	}
	if c.appScheme == "" {
		c.appScheme = "zekra"
	}
	return c
}

func (c githubConfig) ready() bool { return c.clientID != "" && c.clientSecret != "" }

type githubAuth struct {
	s                            *Service
	cfg                          githubConfig
	codes                        *codeStore[auth.Identity]
	linkCodes                    *codeStore[ssoIdentity]
	tokenURL, emailsURL, userURL string
}

func (g *githubAuth) secure() bool { return strings.HasPrefix(g.cfg.redirectURL, "https://") }

func (s *Service) mountGitHub(router chi.Router) *auth.LoginMethod {
	cfg := loadGitHubConfig()
	if !cfg.ready() {
		return nil
	}
	g := &githubAuth{
		s: s, cfg: cfg,
		codes:     newCodeStore[auth.Identity](githubCodeTTL),
		linkCodes: newCodeStore[ssoIdentity](githubCodeTTL),
		tokenURL:  githubTokenURL, emailsURL: githubEmailsURL, userURL: githubUserURL,
	}
	router.Get("/api/auth/github", g.start)
	router.Get("/api/auth/github/callback", g.callback)
	router.Post("/api/auth/github/exchange", g.exchangeCode)
	router.Post("/api/me/identities/github", g.linkExchange)
	return &auth.LoginMethod{Name: "github", Label: "Continue with GitHub", Type: "oauth", URL: "/api/auth/github"}
}

func (g *githubAuth) start(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	ret := safeReturnPath(q.Get("redirect"))
	app := ""
	if q.Get("app") == "1" {
		if app = g.safeAppReturn(q.Get("return")); app == "" {
			writeJSONErr(w, http.StatusBadRequest, "invalid app return target")
			return
		}
	}
	link := q.Get("link") == "1"
	params := url.Values{}
	if ret != "" {
		params.Set("redirect", ret)
	}
	if app != "" {
		params.Set("app", "1")
		params.Set("return", app)
	}
	if link {
		params.Set("link", "1")
	}
	if bounceToCallbackOrigin(w, r, g.cfg.redirectURL, githubCookiePath, params, app != "") {
		return
	}
	state, verifier := randToken(), randToken()
	if link {
		if !g.s.startLink(w, r, "github", state, ret, g.secure(), app != "") {
			return
		}
	} else {
		setLinkCookie(w, "", g.secure())
	}
	b64 := base64.RawURLEncoding.EncodeToString
	http.SetCookie(w, g.flowCookie(state+"."+verifier+"."+b64([]byte(ret))+"."+b64([]byte(app)), int(githubFlowTTL.Seconds())))
	sum := sha256.Sum256([]byte(verifier))
	authQ := url.Values{
		"client_id":             {g.cfg.clientID},
		"redirect_uri":          {g.cfg.redirectURL},
		"state":                 {state},
		"scope":                 {"read:user user:email"}, // ignored by GitHub Apps; needed by OAuth Apps
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(sum[:])},
		"code_challenge_method": {"S256"},
	}
	http.Redirect(w, r, githubAuthURL+"?"+authQ.Encode(), http.StatusFound)
}

func (g *githubAuth) callback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var state, verifier, ret, app string
	if c, err := r.Cookie(githubFlowCookie); err == nil {
		if p := strings.Split(c.Value, "."); len(p) == 4 {
			state, verifier = p[0], p[1]
			ret = safeReturnPath(unb64(p[2]))
			app = g.safeAppReturn(unb64(p[3]))
		}
	}
	http.SetCookie(w, g.flowCookie("", -1))
	link := readLink(r, "github", state)
	setLinkCookie(w, "", g.secure())

	// reason: cancelled | state | email | closed | disabled | failed
	fail := func(reason string) {
		if app != "" {
			http.Redirect(w, r, withQueryParam(app, "error", reason), http.StatusFound)
			return
		}
		if link != nil {
			linkDone(w, r, ret, "github", linkFailReason("github", reason), http.StatusFound)
			return
		}
		key := "github_" + reason
		if reason == "failed" {
			key = "github"
		}
		http.Redirect(w, r, failRedirect(key), http.StatusFound)
	}
	if q.Get("error") != "" {
		fail("cancelled")
		return
	}
	if verifier == "" || !constantEq(state, q.Get("state")) {
		fail("state")
		return
	}
	tok, err := g.exchange(r.Context(), q.Get("code"), verifier)
	if err != nil {
		fail("failed")
		return
	}
	subject, err := g.accountID(r.Context(), tok)
	if err != nil {
		fail("failed")
		return
	}
	email, err := g.primaryEmail(r.Context(), tok)
	if link != nil {
		if err != nil {
			email = "" // a link does not need the address: the numeric id is the identity
		}
		pid := ssoIdentity{Provider: "github", Subject: subject, Email: email}
		if link.App {
			if app == "" {
				fail("state")
				return
			}
			http.Redirect(w, r, withQueryParam(app, "code", g.linkCodes.put(pid)), http.StatusFound)
			return
		}
		g.s.finishWebLink(w, r, link, pid, ret, true, http.StatusFound)
		return
	}
	if errors.Is(err, errGitHubNoEmail) || errors.Is(err, errGitHubEmailAPI) {
		fail("email")
		return
	}
	if err != nil {
		fail("failed")
		return
	}
	id, _, err := g.s.resolveProviderUser(r.Context(), ssoIdentity{Provider: "github", Subject: subject, Email: email})
	switch {
	case errors.Is(err, errRegistrationClosed):
		fail("closed")
		return
	case errors.Is(err, errAccountDisabled):
		fail("disabled")
		return
	case err != nil:
		fail("failed")
		return
	}
	if app != "" {
		http.Redirect(w, r, withQueryParam(app, "code", g.codes.put(*id)), http.StatusFound)
		return
	}
	if _, err := g.s.Auth.IssueSession(w, *id); err != nil {
		fail("failed")
		return
	}
	if ret == "" {
		ret = afterSignIn(id)
	}
	http.Redirect(w, r, ret, http.StatusFound)
}

func (g *githubAuth) exchange(ctx context.Context, code, verifier string) (string, error) {
	if code == "" {
		return "", errors.New("missing code")
	}
	form := url.Values{
		"client_id": {g.cfg.clientID}, "client_secret": {g.cfg.clientSecret},
		"code": {code}, "redirect_uri": {g.cfg.redirectURL}, "code_verifier": {verifier},
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
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || out.AccessToken == "" {
		return "", fmt.Errorf("github token exchange failed (%d %s)", resp.StatusCode, out.Error)
	}
	return out.AccessToken, nil
}

type githubEmail struct {
	Email    string `json:"email"`
	Primary  bool   `json:"primary"`
	Verified bool   `json:"verified"`
}

func (g *githubAuth) githubGET(ctx context.Context, u, token string) (*http.Response, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "zekra")
	return oauthHTTP.Do(req)
}

func (g *githubAuth) primaryEmail(ctx context.Context, token string) (string, error) {
	resp, err := g.githubGET(ctx, g.emailsURL, token)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusNotFound {
		return "", errGitHubEmailAPI
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("github emails: %d", resp.StatusCode)
	}
	var list []githubEmail
	if err := json.NewDecoder(http.MaxBytesReader(nil, resp.Body, 256<<10)).Decode(&list); err != nil {
		return "", err
	}
	return pickGitHubEmail(list)
}

// pickGitHubEmail: the primary address, and only if GitHub has verified it.
func pickGitHubEmail(list []githubEmail) (string, error) {
	for _, e := range list {
		if e.Primary && e.Verified && strings.TrimSpace(e.Email) != "" {
			return strings.TrimSpace(e.Email), nil
		}
	}
	return "", errGitHubNoEmail
}

func (g *githubAuth) accountID(ctx context.Context, token string) (string, error) {
	resp, err := g.githubGET(ctx, g.userURL, token)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("github user: %d", resp.StatusCode)
	}
	var me struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(nil, resp.Body, 256<<10)).Decode(&me); err != nil {
		return "", err
	}
	if me.ID <= 0 {
		return "", errors.New("github user: no id")
	}
	return strconv.FormatInt(me.ID, 10), nil
}

func (g *githubAuth) flowCookie(value string, maxAge int) *http.Cookie {
	return &http.Cookie{ //#nosec G124 -- short-lived HttpOnly flow cookie; Secure follows the callback scheme
		Name: githubFlowCookie, Value: value, Path: githubCookiePath, HttpOnly: true,
		Secure: g.secure(), SameSite: http.SameSiteLaxMode, MaxAge: maxAge,
	}
}

func (g *githubAuth) exchangeCode(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code string `json:"code"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body) != nil || body.Code == "" {
		writeJSONErr(w, http.StatusBadRequest, "code required")
		return
	}
	if !oauthLimit.allow("github:" + clientIP(r)) {
		writeJSONErr(w, http.StatusTooManyRequests, "too many requests")
		return
	}
	id := g.codes.take(body.Code)
	if id == nil {
		writeJSONErr(w, http.StatusUnauthorized, "invalid or expired code")
		return
	}
	g.s.nativeAnswer(w, id, nil)
}

func (g *githubAuth) linkExchange(w http.ResponseWriter, r *http.Request) {
	if !linkPreflight(w, r) {
		return
	}
	var body struct {
		Code string `json:"code"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body) != nil || body.Code == "" {
		writeJSONErr(w, http.StatusBadRequest, "code required")
		return
	}
	pid := g.linkCodes.take(body.Code)
	if pid == nil {
		writeJSONErr(w, http.StatusUnauthorized, "invalid or expired code")
		return
	}
	g.s.linkForRequest(w, r, *pid)
}

// safeAppReturn accepts only the app's own scheme (zekra://…).
func (g *githubAuth) safeAppReturn(p string) string {
	if p == "" || len(p) > 256 || !strings.HasPrefix(p, g.cfg.appScheme+"://") {
		return ""
	}
	for _, c := range p {
		if c < 0x20 || c == 0x7f || c == '\\' {
			return ""
		}
	}
	if u, err := url.Parse(p); err != nil || u.Scheme != g.cfg.appScheme || u.User != nil {
		return ""
	}
	return p
}

// codeStore: random, single-use, short-lived codes -> a value. Sign-in and link
// codes are separate stores, so one can never be redeemed as the other.
type codeStore[T any] struct {
	mu  sync.Mutex
	m   map[string]codeEntry[T]
	ttl time.Duration
}

type codeEntry[T any] struct {
	v   T
	exp time.Time
}

func newCodeStore[T any](ttl time.Duration) *codeStore[T] {
	return &codeStore[T]{m: map[string]codeEntry[T]{}, ttl: ttl}
}

func (e *codeStore[T]) put(v T) string {
	e.mu.Lock()
	defer e.mu.Unlock()
	now := time.Now()
	for k, en := range e.m {
		if now.After(en.exp) {
			delete(e.m, k)
		}
	}
	code := randToken()
	e.m[code] = codeEntry[T]{v: v, exp: now.Add(e.ttl)}
	return code
}

func (e *codeStore[T]) take(code string) *T {
	e.mu.Lock()
	defer e.mu.Unlock()
	en, ok := e.m[code]
	delete(e.m, code) // single use, even when expired
	if !ok || time.Now().After(en.exp) {
		return nil
	}
	return &en.v
}
