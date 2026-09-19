package account

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/togo-framework/auth"
)

// Pure-logic tests: no database needed. The end-to-end flows are in flow_test.go.

// RFC 6238 appendix B, SHA-1, truncated to six digits (ported from fadymondy).
func TestTOTPMatchesRFC6238(t *testing.T) {
	secret := totpEncoding.EncodeToString([]byte("12345678901234567890"))
	for _, tc := range []struct {
		unix int64
		want string
	}{{59, "287082"}, {1111111109, "081804"}, {1234567890, "005924"}, {2000000000, "279037"}} {
		got, err := totpCode(secret, tc.unix/totpStep)
		if err != nil || got != tc.want {
			t.Errorf("t=%d: got %s (%v), want %s", tc.unix, got, err, tc.want)
		}
	}
	now := time.Unix(1234567890, 0)
	if matchTOTP(secret, "005924", now, 0) == 0 {
		t.Error("the current code was refused")
	}
	if matchTOTP(secret, "005924", now, now.Unix()/totpStep) != 0 {
		t.Error("a used step was accepted again")
	}
	if matchTOTP(secret, "005924", now.Add(2*time.Minute), 0) != 0 {
		t.Error("a two-minute-old code was accepted")
	}
	if matchTOTP(secret, "05924", now, 0) != 0 || matchTOTP(secret, "", now, 0) != 0 {
		t.Error("a malformed code was accepted")
	}
	// One step either side is accepted (clock skew).
	prev, _ := totpCode(secret, now.Unix()/totpStep-1)
	if matchTOTP(secret, prev, now, 0) == 0 {
		t.Error("the previous step was refused")
	}
}

func TestRecoveryCodes(t *testing.T) {
	c, err := newRecoveryCode()
	if err != nil || len(c) != 9 || c[4] != '-' {
		t.Fatalf("recovery code %q (%v)", c, err)
	}
	// Case and the dash do not matter; the hash is not the code.
	if hashRecovery(c) != hashRecovery(strings.ToUpper(strings.ReplaceAll(c, "-", ""))) {
		t.Error("recovery hash is not normalised")
	}
	if strings.Contains(hashRecovery(c), strings.ReplaceAll(c, "-", "")) {
		t.Error("the hash contains the code")
	}
}

func TestSixDigitCodes(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 200; i++ {
		c, err := newCode()
		if err != nil || len(c) != 6 || strings.Trim(c, "0123456789") != "" {
			t.Fatalf("code %q (%v)", c, err)
		}
		seen[c] = true
	}
	if len(seen) < 150 {
		t.Errorf("codes are not random enough: %d distinct of 200", len(seen))
	}
}

func TestVaultRoundTrip(t *testing.T) {
	t.Setenv("VAULT_KEY", strings.Repeat("ab", 32))
	sealed, err := vaultSeal("JBSWY3DPEHPK3PXP")
	if err != nil || !strings.HasPrefix(sealed, vaultPrefix) || strings.Contains(sealed, "JBSWY3DPEHPK3PXP") {
		t.Fatalf("seal: %q %v", sealed, err)
	}
	if got, err := vaultOpen(sealed); err != nil || got != "JBSWY3DPEHPK3PXP" {
		t.Fatalf("open: %q %v", got, err)
	}
	t.Setenv("VAULT_KEY", strings.Repeat("cd", 32))
	if _, err := vaultOpen(sealed); err == nil {
		t.Error("opened with the wrong key")
	}
	// Without VAULT_KEY/ZEKRA_SECRETS_KEY, AUTH_SECRET derives a key; with none, no vault.
	t.Setenv("VAULT_KEY", "")
	t.Setenv("ZEKRA_SECRETS_KEY", "")
	t.Setenv("AUTH_SECRET", strings.Repeat("x", 40))
	if !vaultConfigured() {
		t.Error("AUTH_SECRET should derive a vault key")
	}
	t.Setenv("AUTH_SECRET", "")
	t.Setenv("JWT_SECRET", "")
	if vaultConfigured() {
		t.Error("a vault with no key at all")
	}
}

func TestLinkTicket(t *testing.T) {
	v := sealTicket(linkTicket{Provider: "google", State: "st", UserID: "u1"})
	got, ok := openTicket(v)
	if !ok || got.Provider != "google" || got.State != "st" || got.UserID != "u1" || got.App {
		t.Fatalf("round trip: %+v %v", got, ok)
	}
	i := strings.LastIndexByte(v, '.')
	forged := base64.RawURLEncoding.EncodeToString([]byte("google|st|someone-else|0")) + v[i:]
	if _, ok := openTicket(forged); ok {
		t.Error("a forged ticket opened")
	}
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.AddCookie(&http.Cookie{Name: linkCookie, Value: v})
	if readLink(r, "google", "st") == nil {
		t.Error("the right provider+state was refused")
	}
	if readLink(r, "apple", "st") != nil || readLink(r, "google", "other") != nil {
		t.Error("a ticket for another provider/state was accepted")
	}
}

func TestSafeReturnPath(t *testing.T) {
	for in, want := range map[string]string{
		"/account":            "/account",
		"/en/account?tab=sec": "/en/account?tab=sec",
		"":                    "",
		"account":             "",
		"//evil.com":          "",
		"/\\evil.com":         "",
		"https://evil.com/":   "",
		"/a\nb":               "",
	} {
		if got := safeReturnPath(in); got != want {
			t.Errorf("safeReturnPath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRevocationBlocked(t *testing.T) {
	at := time.Unix(1_700_000_000, 0)
	nt := func(t time.Time) sql.NullTime { return sql.NullTime{Time: t, Valid: true} }
	ns := func(s string) sql.NullString { return sql.NullString{String: s, Valid: true} }
	for _, tc := range []struct {
		name string
		rv   revocation
		iat  int64
		want bool
	}{
		{"nothing", revocation{}, at.Unix(), false},
		{"scheduled deletion blocks everything", revocation{deletionStatus: ns(StatusScheduled), deletionAt: nt(at)}, at.Unix() + 999, true},
		{"cancelled: old token dead", revocation{deletionStatus: ns(StatusCancelled), deletionAt: nt(at)}, at.Unix(), true},
		{"cancelled: new sign-in lives", revocation{deletionStatus: ns(StatusCancelled), deletionAt: nt(at)}, at.Unix() + 1, false},
		{"disabled", revocation{disabled: true}, at.Unix() + 999, true},
		{"reset: earlier token dead", revocation{resetAt: nt(at)}, at.Unix() - 1, true},
		{"admin revoke: same-second token dead", revocation{revokedAt: nt(at)}, at.Unix(), true},
		{"admin revoke: later sign-in lives", revocation{revokedAt: nt(at)}, at.Unix() + 1, false},
		{"reset: same-second sign-in lives", revocation{resetAt: nt(at)}, at.Unix(), false},
		{"reset: PAT (no iat) unaffected", revocation{resetAt: nt(at)}, 0, false},
	} {
		if got, _ := tc.rv.blocked(tc.iat); got != tc.want {
			t.Errorf("%s: blocked=%v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestPeekClaims(t *testing.T) {
	c, ok := peekClaims(fakeJWT("u1", 42))
	if !ok || c.Sub != "u1" || c.Iat != 42 {
		t.Fatalf("peek: %+v %v", c, ok)
	}
	if _, ok := peekClaims("togo_pat_abc"); ok {
		t.Error("a PAT parsed as a JWT")
	}
}

func TestCSRFValues(t *testing.T) {
	if !csrfValues("Bearer x", "", "") {
		t.Error("a bearer request needs no CSRF token")
	}
	if !csrfValues("", "tok", "tok") {
		t.Error("matching double-submit refused")
	}
	if csrfValues("", "tok", "other") || csrfValues("", "", "") || csrfValues("Bearer ", "", "") {
		t.Error("a bad CSRF pair accepted")
	}
}

func TestLimiter(t *testing.T) {
	l := newLimiter(2, time.Minute)
	if !l.allow("k") || !l.allow("k") || l.allow("k") {
		t.Error("limit of 2 not enforced")
	}
	if !l.allow("other") {
		t.Error("keys are not independent")
	}
}

func TestCodeEmail(t *testing.T) {
	for _, loc := range []string{"en", "ar"} {
		for _, p := range []string{purposeVerify, purposeReset, purposeLogin} {
			subject, text, html := CodeEmail(loc, p, "123456")
			if subject == "" || !strings.Contains(text, "1 2 3 4 5 6") || !strings.Contains(html, "123456") {
				t.Errorf("%s/%s: %q", loc, p, text)
			}
		}
	}
}

func TestPickGitHubEmail(t *testing.T) {
	if _, err := pickGitHubEmail([]githubEmail{{Email: "a@x", Primary: true}, {Email: "b@x", Verified: true}}); err == nil {
		t.Error("an unverified primary / non-primary verified address was accepted")
	}
	if e, err := pickGitHubEmail([]githubEmail{{Email: "b@x", Verified: true}, {Email: "a@x", Primary: true, Verified: true}}); err != nil || e != "a@x" {
		t.Errorf("got %q %v", e, err)
	}
}

func TestMethodsMiddlewareDedupes(t *testing.T) {
	plugin := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"methods": []auth.LoginMethod{
			{Name: "google", Label: "Continue with Google", Type: "oauth", URL: "/api/auth/oauth/google"},
			{Name: "dev", Label: "Login as developer", Type: "dev", URL: "/api/auth/dev/login"},
		}})
	})
	mine := []auth.LoginMethod{{Name: "github", Label: "Continue with GitHub", Type: "oauth", URL: "/api/auth/github"}}
	h := (&Service{}).MethodsMiddleware(func() []auth.LoginMethod { return mine })(plugin)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/auth/methods", nil))
	var body struct {
		Methods []auth.LoginMethod `json:"methods"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, m := range body.Methods {
		names = append(names, m.Name+"="+m.URL)
	}
	got := strings.Join(names, ",")
	if got != "dev=/api/auth/dev/login,github=/api/auth/github" {
		t.Errorf("methods: %s", got)
	}
}

func TestSplitCSV(t *testing.T) {
	if got := splitCSV(" admin, ,owner "); strings.Join(got, "|") != "admin|owner" {
		t.Errorf("splitCSV: %v", got)
	}
}

// fakeJWT is a token-shaped string; only its claims are peeked at.
func fakeJWT(sub string, iat int64) string {
	enc := func(v any) string {
		raw, _ := json.Marshal(v)
		return base64.RawURLEncoding.EncodeToString(raw)
	}
	return enc(map[string]string{"alg": "HS256"}) + "." + enc(map[string]any{"sub": sub, "iat": iat}) + ".sig"
}
