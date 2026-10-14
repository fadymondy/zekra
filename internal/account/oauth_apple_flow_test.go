package account

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

/*
Apple sign-in and account deletion end to end on Postgres (TEST_DATABASE_URL,
see flow_test.go), against the fake Apple in oauth_apple_test.go:

  - the app (browser) flow signs in, keeps the refresh token sealed, and the
    purge revokes it at Apple;
  - disconnecting Apple revokes too;
  - an account without a password ("!sso") deletes itself and cancels the
    deletion with emailed codes.
*/

func flowStamp() string { return strings.ReplaceAll(time.Now().Format("150405.000000"), ".", "") }

func TestFlowAppleAppSignInKeepsAndRevokesTheToken(t *testing.T) {
	s, _, _ := testService(t)
	t.Setenv("ALLOW_REGISTRATION", "true")
	a, f := testApple(t, s)
	email := "zk-apple-" + flowStamp() + "@example.test"
	f.email = email
	f.sub = "apple-sub-" + flowStamp()
	var userID string
	t.Cleanup(func() {
		if userID != "" {
			_, _ = s.PurgeUser(context.Background(), userID, email)
		}
	})

	verifier, challenge := pkcePair()
	rec := startAppleApp(a, "&code_challenge="+challenge+"&code_challenge_method=S256")
	f.setNonce(flowNonce(t, rec))
	got := appleCallback(a, rec.Result().Cookies(), url.Values{"code": {"a-code"}, "state": {stateOf(t, rec)},
		"user": {`{"name":{"firstName":"Ada","lastName":"Lovelace"}}`}})
	loc, _ := url.Parse(got.Header().Get("Location"))
	code := loc.Query().Get("code")
	if got.Code != http.StatusSeeOther || !strings.HasPrefix(got.Header().Get("Location"), appleTestReturn) || code == "" {
		t.Fatalf("callback: %d %s", got.Code, got.Header().Get("Location"))
	}
	// The code is PKCE-bound: the app trades it with its verifier for {token, user}.
	ex, body := postJSON(http.HandlerFunc(a.exchangeCode), "/api/auth/apple/exchange", map[string]string{"code": code, "code_verifier": verifier},
		func(r *http.Request) { r.RemoteAddr = "192.0.2.10:1" })
	user, _ := body["user"].(map[string]any)
	if ex.Code != http.StatusOK || body["token"] == nil || user == nil {
		t.Fatalf("exchange: %d %s", ex.Code, ex.Body)
	}
	userID, _ = user["id"].(string)
	var name string
	_ = s.DB.QueryRow(`SELECT name FROM account_profiles WHERE user_id = $1`, userID).Scan(&name)
	if name != "Ada Lovelace" {
		t.Errorf("Apple's first-authorization name not saved: %q", name)
	}

	// The refresh token is kept, sealed, under the Services ID.
	var sealed, client string
	if err := s.DB.QueryRow(`SELECT refresh_token, client_id FROM account_apple_tokens WHERE user_id = $1`, userID).Scan(&sealed, &client); err != nil {
		t.Fatalf("no stored refresh token: %v", err)
	}
	if !strings.HasPrefix(sealed, vaultPrefix) || strings.Contains(sealed, "rt-") || client != appleTestServices {
		t.Fatalf("stored token: %q %q", sealed, client)
	}
	if plain, err := vaultOpen(sealed); err != nil || plain != "rt-"+appleTestServices {
		t.Fatalf("sealed token: %q %v", plain, err)
	}

	// A second sign-in through the iOS sheet's code adds the bundle id's token.
	f.setNonce("")
	pid := ssoIdentity{Provider: "apple", Subject: f.sub, Email: email}
	claims := &appleClaims{}
	claims.Subject, claims.Audience = f.sub, []string{appleTestBundle}
	a.nativeRefresh(context.Background(), &pid, claims, "a-code")
	if _, _, err := s.resolveProviderUser(context.Background(), pid); err != nil {
		t.Fatalf("native sign-in: %v", err)
	}
	var n int
	_ = s.DB.QueryRow(`SELECT count(*) FROM account_apple_tokens WHERE user_id = $1`, userID).Scan(&n)
	if n != 2 {
		t.Fatalf("tokens kept: %d, want 2 (Services ID + bundle id)", n)
	}

	// Purge: both revoked at Apple with the client that obtained them, rows gone.
	summary, err := s.PurgeUser(context.Background(), userID, email)
	if err != nil {
		t.Fatalf("purge: %v", err)
	}
	revoked := strings.Join(f.revocations(), ",")
	if summary["apple_tokens_revoked"] != 2 || !strings.Contains(revoked, appleTestServices+"|rt-"+appleTestServices) ||
		!strings.Contains(revoked, appleTestBundle+"|rt-"+appleTestBundle) {
		t.Fatalf("revocations: %v (summary %v)", revoked, summary)
	}
	_ = s.DB.QueryRow(`SELECT count(*) FROM account_apple_tokens WHERE user_id = $1`, userID).Scan(&n)
	if n != 0 {
		t.Errorf("%d Apple tokens survived the purge", n)
	}
	userID = ""
}

func TestFlowAppleDisconnectRevokes(t *testing.T) {
	s, _, _ := testService(t)
	_, f := testApple(t, s)
	stamp := flowStamp()
	email, userID := "zk-unlink-"+stamp+"@example.test", "zk-unlink-"+stamp
	t.Cleanup(func() { _, _ = s.PurgeUser(context.Background(), userID, email) })
	hash, _ := bcrypt.GenerateFromPassword([]byte("a-password"), bcrypt.MinCost)
	if _, err := s.DB.Exec(`INSERT INTO users (id, email, password_hash, roles, permissions, created_at) VALUES ($1,$2,$3,'','',$4)`,
		userID, email, string(hash), time.Now().UTC().Format(time.RFC3339)); err != nil {
		t.Fatal(err)
	}
	pid := ssoIdentity{Provider: "apple", Subject: "unlink-sub-" + stamp, Email: email, RefreshToken: "rt-unlink", TokenClient: appleTestBundle}
	if err := s.link(context.Background(), userID, pid); err != nil {
		t.Fatalf("link: %v", err)
	}
	var n int
	_ = s.DB.QueryRow(`SELECT count(*) FROM account_apple_tokens WHERE user_id = $1`, userID).Scan(&n)
	if n != 1 {
		t.Fatalf("link kept %d tokens", n)
	}
	if err := s.unlink(context.Background(), userID, "apple"); err != nil {
		t.Fatalf("unlink: %v", err)
	}
	if got := f.revocations(); len(got) != 1 || got[0] != appleTestBundle+"|rt-unlink" {
		t.Errorf("revocations: %v", got)
	}
	_ = s.DB.QueryRow(`SELECT count(*) FROM account_apple_tokens WHERE user_id = $1`, userID).Scan(&n)
	if n != 0 {
		t.Error("the token row outlived the disconnect")
	}
}

func TestFlowPasswordlessDeleteAndCancelByCode(t *testing.T) {
	s, mb, _ := testService(t)
	stamp := flowStamp()
	email, userID := "zk-sso-"+stamp+"@example.test", "zk-sso-"+stamp
	t.Cleanup(func() { _, _ = s.PurgeUser(context.Background(), userID, email) })
	if _, err := s.DB.Exec(`INSERT INTO users (id, email, password_hash, roles, permissions, created_at) VALUES ($1,$2,'!sso','','',$3)`,
		userID, email, time.Now().UTC().Format(time.RFC3339)); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	meta := Meta{IP: "192.0.2.20", RequestID: "t"}

	// No proof, a password (it has none), a code never sent: all refused.
	if _, err := s.Schedule(ctx, userID, Proof{}, "", meta); !errors.Is(err, ErrNoProof) {
		t.Errorf("no proof: %v", err)
	}
	if _, err := s.Schedule(ctx, userID, Proof{Password: "!sso"}, "", meta); !errors.Is(err, ErrWrongPassword) {
		t.Errorf("the SSO marker as a password: %v", err)
	}
	if err := s.RequestDeletionCode(ctx, userID, "ar", meta); err != nil {
		t.Fatalf("delete code: %v", err)
	}
	code := mb.lastCode(t)
	if last := mb.sent[len(mb.sent)-1]; last.To != email || !strings.Contains(last.HTML, `dir="rtl"`) {
		t.Errorf("delete code mail: to %s", last.To)
	}
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	if _, err := s.Schedule(ctx, userID, Proof{Code: wrong}, "", meta); !errors.Is(err, ErrWrongCode) {
		t.Errorf("wrong code: %v", err)
	}
	row, err := s.Schedule(ctx, userID, Proof{Code: code}, "", meta)
	if err != nil || row.Status != StatusScheduled {
		t.Fatalf("schedule by code: %v %+v", err, row)
	}
	if _, err := s.Schedule(ctx, userID, Proof{Code: code}, "", meta); !errors.Is(err, ErrWrongCode) {
		t.Errorf("the delete code worked twice: %v", err)
	}
	// Signed out everywhere: a token issued before is stripped.
	if blocked, _ := mustRevocation(t, s, userID).blocked(time.Now().Add(-time.Minute).Unix()); !blocked {
		t.Error("tokens still work after scheduling")
	}

	// Cancel without a session: a code is mailed only for a pending deletion.
	before := mb.count()
	if err := s.RequestCancelCode(ctx, "nobody-"+stamp+"@example.test", "en", meta); err != nil || mb.count() != before {
		t.Errorf("cancel code for an unknown address: %v, %d mails", err, mb.count()-before)
	}
	if err := s.Cancel(ctx, email, Proof{Code: "123456"}, meta); !errors.Is(err, ErrBadCredentials) {
		t.Errorf("cancel with a code never sent: %v", err)
	}
	if err := s.RequestCancelCode(ctx, strings.ToUpper(email), "en", meta); err != nil || mb.count() != before+1 {
		t.Fatalf("cancel code: %v", err)
	}
	cancelCode := mb.lastCode(t)
	if err := s.Cancel(ctx, email, Proof{Code: code}, meta); !errors.Is(err, ErrBadCredentials) {
		t.Errorf("the delete code cancelled: %v", err)
	}
	if err := s.Cancel(ctx, strings.ToUpper(email), Proof{Code: cancelCode}, meta); err != nil {
		t.Fatalf("cancel by code: %v", err)
	}
	if latest, _ := s.Latest(ctx, userID); latest == nil || latest.Status != StatusCancelled {
		t.Fatalf("after cancel: %+v", latest)
	}
	// Nothing pending any more: no new cancel code.
	before = mb.count()
	_ = s.RequestCancelCode(ctx, email, "en", meta)
	if mb.count() != before {
		t.Error("a cancel code was sent with nothing pending")
	}
}

func mustRevocation(t *testing.T, s *Service, userID string) revocation {
	t.Helper()
	rv, err := s.revocationFor(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	return rv
}

// The public cancel legs must work without a session.
func TestIsPublicMe(t *testing.T) {
	for path, want := range map[string]bool{
		"/api/me/delete/cancel": true, "/api/me/delete/cancel/code": true, "/api/me/delete/cancel/": true,
		"/api/me/delete": false, "/api/me/delete/code": false, "/api/me/identities": false,
	} {
		if got := isPublicMe(httptest.NewRequest(http.MethodPost, path, nil)); got != want {
			t.Errorf("%s: %v", path, got)
		}
	}
	if isPublicMe(httptest.NewRequest(http.MethodGet, "/api/me/delete/cancel", nil)) {
		t.Error("GET is public")
	}
}
