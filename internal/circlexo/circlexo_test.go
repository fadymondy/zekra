package circlexo

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	circlexo "github.com/circlexo/circlexo-go"
	"github.com/circlexo/circlexo-go/circlexotest"
	"github.com/circlexo/circlexo-go/oidc"
	"github.com/circlexo/circlexo-go/webhooks"
	"github.com/go-chi/chi/v5"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/togo-framework/auth"
	"github.com/togo-framework/brain/hubapi"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/zekra/internal/account"
	acctschema "github.com/fadymondy/zekra/internal/account/schema"
)

/*
The CircleXO integration against circlexotest, the SDK's fake hub, on a real Postgres. Skipped unless
TEST_DATABASE_URL is set (use a throwaway database):

	TEST_DATABASE_URL='postgres://…/zekra_test?sslmode=disable' go test ./internal/circlexo

The brain plugin's tables are stood in for by the three columns this package reads. The secrets below
are throwaway values made up for this file, not a credential.
*/

const (
	testApp           = "app-zekra-test"
	testWebhookSecret = "whsec_" + "emVrcmEtdGVzdC13ZWJob29rLXNlY3JldC0wMTIzNDU2Nw=="
)

type stack struct {
	t   *testing.T
	hub *circlexotest.Hub
	db  *sql.DB
	svc *Service
	srv *httptest.Server
}

func boot(t *testing.T) *stack {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no database configured; set TEST_DATABASE_URL to run the CircleXO integration tests")
	}
	t.Setenv("DB_DRIVER", "pgx")
	t.Setenv("DATABASE_URL", dsn)
	t.Setenv("VAULT_KEY", strings.Repeat("ab", 32))
	t.Setenv("AUTH_SECRET", strings.Repeat("s", 40))
	t.Setenv("AUTH_PUBLIC_URL", "http://zekra.test")
	k := togo.New()
	t.Cleanup(k.Close)
	db, err := k.SQL(context.Background())
	if err != nil {
		t.Skipf("database unavailable: %v", err)
	}
	for _, ddl := range []string{
		`CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY)`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS email text`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS roles text NOT NULL DEFAULT ''`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions text NOT NULL DEFAULT ''`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at text`,
		`CREATE TABLE IF NOT EXISTS public.brain_members (namespace text NOT NULL, user_id text NOT NULL, role text NOT NULL DEFAULT 'owner', created_by text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (namespace, user_id))`,
		`CREATE TABLE IF NOT EXISTS public.memories (namespace text, invalid_at timestamptz)`,
		`CREATE TABLE IF NOT EXISTS public.notes (namespace text)`,
	} {
		if _, err := db.Exec(ddl); err != nil {
			t.Fatalf("preparing the stand-in tables: %v", err)
		}
	}
	for pass := 1; pass <= 2; pass++ {
		if err := acctschema.Migrate(context.Background(), db); err != nil {
			t.Fatalf("account schema pass %d: %v", pass, err)
		}
		if err := Migrate(context.Background(), db); err != nil {
			t.Fatalf("circlexo schema pass %d (must be idempotent): %v", pass, err)
		}
	}
	as, ok := auth.FromKernel(k)
	if !ok {
		t.Skip("auth plugin not registered")
	}
	acct := &account.Service{DB: db, Log: slog.Default(), Auth: as, Now: time.Now}

	h := circlexotest.New(t, testApp)
	cfg := h.Config()
	svc, err := New(db, slog.Default(), acct, cfg, "http://zekra.test"+CallbackPath, Secrets{Webhook: testWebhookSecret, Session: "test-session-key-not-a-secret"})
	if err != nil {
		t.Fatal(err)
	}
	Install(svc)
	t.Cleanup(func() { Install(nil) })
	r := chi.NewRouter()
	svc.Mount(r)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return &stack{t: t, hub: h, db: db, svc: svc, srv: srv}
}

func rnd() string { return strconv.FormatInt(time.Now().UnixNano(), 36) }

func (s *stack) count(q string, args ...any) int {
	s.t.Helper()
	var n int
	if err := s.db.QueryRow(q, args...).Scan(&n); err != nil {
		s.t.Fatal(err)
	}
	return n
}

// install registers an org at the fake hub with these members (hub id, role).
func (s *stack) install(org string, members ...[2]string) {
	s.hub.Install(org)
	var ms []circlexo.Member
	for _, m := range members {
		ms = append(ms, circlexo.Member{UserID: m[0], Email: m[0] + "@example.test", DisplayName: m[0], Role: m[1]})
	}
	s.hub.Lock()
	s.hub.Members[org] = ms
	s.hub.Unlock()
}

func (s *stack) entitle(org string, active bool, brains *int64) {
	f := []circlexo.Entitlement{{Key: featBrains, Kind: "limit", Enabled: true}, {Key: meterRequests, Kind: "metered", Enabled: true}}
	if brains != nil {
		f[0].Limit = brains
	}
	s.hub.Lock()
	s.hub.Entitlements[org] = circlexo.Entitlements{OrgID: org, AppID: testApp, Active: active, Features: f, Version: 1}
	s.hub.Unlock()
	s.svc.Ents.Invalidate(org, 0)
}

func (s *stack) post(path string, body []byte, id, secret string) int {
	s.t.Helper()
	ts := time.Now()
	req, _ := http.NewRequest(http.MethodPost, s.srv.URL+path, strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("webhook-id", id)
	req.Header.Set("webhook-timestamp", strconv.FormatInt(ts.Unix(), 10))
	if secret != "" {
		sig, err := webhooks.Sign(secret, id, ts, body)
		if err != nil {
			s.t.Fatal(err)
		}
		req.Header.Set("webhook-signature", sig)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, res.Body)
	return res.StatusCode
}

func (s *stack) event(typ, org string, data any, id string) int {
	body, _ := json.Marshal(map[string]any{"id": id, "type": typ, "version": 1, "occurred_at": time.Now().UTC(), "org_id": org, "data": data})
	return s.post(EventsPath, body, id, testWebhookSecret)
}

func (s *stack) roleOf(ns, email string) string {
	s.t.Helper()
	var role string
	err := s.db.QueryRow(`SELECT m.role FROM public.brain_members m JOIN users u ON u.id = m.user_id WHERE m.namespace = $1 AND lower(u.email) = lower($2)`, ns, email).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return ""
	}
	if err != nil {
		s.t.Fatal(err)
	}
	return role
}

func (s *stack) link(org string) *OrgLink {
	s.t.Helper()
	l, err := s.svc.OrgByID(context.Background(), org)
	if err != nil {
		s.t.Fatalf("org %s not linked: %v", org, err)
	}
	return l
}

func (s *stack) userID(email string) string {
	s.t.Helper()
	var id string
	if err := s.db.QueryRow(`SELECT id FROM users WHERE lower(email) = lower($1)`, email).Scan(&id); err != nil {
		s.t.Fatalf("no user %s: %v", email, err)
	}
	return id
}

func TestWebhookSignatureAndReplay(t *testing.T) {
	s := boot(t)
	org := "org-" + rnd()
	s.install(org, [2]string{"own-" + org, "owner"})
	s.entitle(org, true, nil)
	body := map[string]any{"slug": "acme-" + rnd(), "name": "Acme"}

	// Unsigned, wrongly signed: refused before anything runs.
	raw, _ := json.Marshal(map[string]any{"id": "ev-bad", "type": "org.app_installed", "version": 1, "occurred_at": time.Now().UTC(), "org_id": org, "data": body})
	if got := s.post(EventsPath, raw, "ev-bad", ""); got != http.StatusUnauthorized {
		t.Fatalf("unsigned: %d", got)
	}
	if got := s.post(EventsPath, raw, "ev-bad", "whsec_"+"d3Jvbmctc2VjcmV0LXdyb25nLXNlY3JldC13cm9uZw=="); got != http.StatusUnauthorized {
		t.Fatalf("wrong secret: %d", got)
	}
	if n := s.count(`SELECT count(*) FROM circlexo_org_links WHERE org_id = $1`, org); n != 0 {
		t.Fatalf("a refused webhook provisioned %d links", n)
	}

	id := "ev-" + rnd()
	if got := s.event("org.app_installed", org, body, id); got != http.StatusOK && got != http.StatusNoContent {
		t.Fatalf("signed install: %d", got)
	}
	if n := s.count(`SELECT count(*) FROM circlexo_org_links WHERE org_id = $1`, org); n != 1 {
		t.Fatalf("links after install: %d", n)
	}
	// A redelivery of the same webhook id is dropped, even if the org was since deactivated.
	if _, err := s.db.Exec(`UPDATE circlexo_org_links SET status = 'inactive' WHERE org_id = $1`, org); err != nil {
		t.Fatal(err)
	}
	if got := s.event("org.app_installed", org, body, id); got >= 300 {
		t.Fatalf("replay: %d", got)
	}
	if s.link(org).Active {
		t.Fatal("a replayed webhook was processed a second time")
	}
}

func TestProvisionIdempotentAndRoles(t *testing.T) {
	s := boot(t)
	org := "org-" + rnd()
	owner, admin, member, billing := "o-"+rnd(), "a-"+rnd(), "m-"+rnd(), "b-"+rnd()
	s.install(org, [2]string{owner, "owner"}, [2]string{admin, "admin"}, [2]string{member, "member"}, [2]string{billing, "billing"})
	s.entitle(org, true, nil)
	slug := "prov-" + rnd()

	var ns string
	for i := 0; i < 3; i++ {
		l, err := s.svc.Provision(context.Background(), ProvisionInput{OrgID: org, Slug: slug})
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			ns = l.PrimaryNamespace
		} else if l.PrimaryNamespace != ns {
			t.Fatalf("provision %d moved the primary brain: %s -> %s", i, ns, l.PrimaryNamespace)
		}
	}
	if n := s.count(`SELECT count(*) FROM circlexo_org_links WHERE org_id = $1`, org); n != 1 {
		t.Fatalf("links: %d", n)
	}
	if n := s.count(`SELECT count(*) FROM public.brain_members WHERE namespace = $1`, ns); n != 4 {
		t.Fatalf("members of %s: %d", ns, n)
	}
	for who, want := range map[string]string{owner: "owner", admin: "owner", member: "editor", billing: "viewer"} {
		if got := s.roleOf(ns, who+"@example.test"); got != want {
			t.Errorf("%s: role %q, want %q", who, got, want)
		}
	}
	// The hub was told the tenant.
	s.hub.Lock()
	tenant := s.hub.Tenants[org]
	s.hub.Unlock()
	if tenant.ProductTenantID != ns || tenant.Status != "active" {
		t.Fatalf("tenant at the hub: %+v", tenant)
	}

	// Role change, then removal; the last owner is never dropped by a sync.
	if got := s.event("member.role_changed", org, map[string]any{"user": map[string]string{"id": member, "email": member + "@example.test"}, "role": "admin"}, "ev-"+rnd()); got >= 300 {
		t.Fatalf("role change: %d", got)
	}
	if got := s.roleOf(ns, member+"@example.test"); got != "owner" {
		t.Errorf("promoted member: %q", got)
	}
	if got := s.event("member.removed", org, map[string]any{"user": map[string]string{"id": billing, "email": billing + "@example.test"}}, "ev-"+rnd()); got >= 300 {
		t.Fatalf("member removed: %d", got)
	}
	if got := s.roleOf(ns, billing+"@example.test"); got != "" {
		t.Errorf("removed member still has %q", got)
	}

	// Removing the app deletes nothing.
	if got := s.event("org.app_removed", org, map[string]any{}, "ev-"+rnd()); got >= 300 {
		t.Fatalf("app removed: %d", got)
	}
	if s.link(org).Active {
		t.Fatal("link still active after removal")
	}
	if n := s.count(`SELECT count(*) FROM public.brain_members WHERE namespace = $1`, ns); n < 3 {
		t.Fatalf("removal deleted memberships: %d left", n)
	}
}

func (s *stack) login(sub, email string, verified bool, org, role string) (*http.Response, string, *loginErr) {
	id := &circlexo.Claims{Subject: sub, SessionID: "sid-" + sub, Raw: map[string]any{"email": email, "email_verified": verified}}
	at := &circlexo.Claims{Subject: sub, OrgID: org, OrgRole: role, SessionID: "sid-" + sub}
	w := httptest.NewRecorder()
	to, err := s.svc.FinishLogin(context.Background(), w, &oidc.Login{IDClaims: id, AccessClaims: at})
	return w.Result(), to, err
}

func hasSession(res *http.Response) bool {
	for _, c := range res.Cookies() {
		if c.Name == auth.SessionCookie && c.Value != "" {
			return true
		}
	}
	return false
}

func TestSignInRules(t *testing.T) {
	s := boot(t)
	tag := rnd()

	// An unverified address is refused and creates nothing.
	res, _, err := s.login("sub-u-"+tag, "unv-"+tag+"@example.test", false, "", "")
	if err == nil || err.Code() != errUnverified || hasSession(res) {
		t.Fatalf("unverified: %v", err)
	}
	if n := s.count(`SELECT count(*) FROM users WHERE lower(email) = $1`, "unv-"+tag+"@example.test"); n != 0 {
		t.Fatal("a refused sign-in created an account")
	}

	// A verified address creates a passwordless account with a session, and links it.
	email := "new-" + tag + "@example.test"
	res, _, err = s.login("sub-n-"+tag, email, true, "", "")
	if err != nil || !hasSession(res) {
		t.Fatalf("new user: %v", err)
	}
	uid := s.userID(email)
	if u, e := s.svc.UserBySubject(context.Background(), "sub-n-"+tag); e != nil || u != uid {
		t.Fatalf("link: %s %v", u, e)
	}
	// The same subject signs in again as the same user, whatever the claim says.
	res, _, err = s.login("sub-n-"+tag, "other-"+tag+"@example.test", true, "", "")
	if err != nil || !hasSession(res) {
		t.Fatalf("second sign-in: %v", err)
	}
	if n := s.count(`SELECT count(*) FROM users WHERE lower(email) = $1`, "other-"+tag+"@example.test"); n != 0 {
		t.Fatal("a linked subject created a second account")
	}

	// An existing password account whose address was never confirmed is not taken over.
	pw := "pw-" + tag + "@example.test"
	if _, e := s.db.Exec(`INSERT INTO users (id, email, password_hash, roles, permissions, created_at) VALUES ($1,$2,'$2a$04$notarealhash','','',$3)`, "pw-"+tag, pw, time.Now().UTC().Format(time.RFC3339)); e != nil {
		t.Fatal(e)
	}
	if _, e := s.db.Exec(`INSERT INTO account_unverified (user_id, email) VALUES ($1,$2)`, "pw-"+tag, pw); e != nil {
		t.Fatal(e)
	}
	_, _, err = s.login("sub-p-"+tag, pw, true, "", "")
	if err == nil || err.Code() != errUnlinkable {
		t.Fatalf("unconfirmed password account: %v", err)
	}
	// Once the address is confirmed, the hub sign-in links to it.
	if _, e := s.db.Exec(`DELETE FROM account_unverified WHERE user_id = $1`, "pw-"+tag); e != nil {
		t.Fatal(e)
	}
	res, _, err = s.login("sub-p-"+tag, pw, true, "", "")
	if err != nil || !hasSession(res) {
		t.Fatalf("confirmed password account: %v", err)
	}
	if u, _ := s.svc.UserBySubject(context.Background(), "sub-p-"+tag); u != "pw-"+tag {
		t.Fatalf("linked to %q", u)
	}
}

func TestSignInJoinsOrgAndSessionRevoked(t *testing.T) {
	s := boot(t)
	org := "org-" + rnd()
	tag := rnd()
	owner := "own-" + tag
	s.install(org, [2]string{owner, "owner"}, [2]string{"joiner-" + tag, "member"})
	s.entitle(org, true, nil)

	// Signing in with the org claim provisions the org (the hub confirms the install) and adds the person.
	res, _, err := s.login("joiner-"+tag, "joiner-"+tag+"@example.test", true, org, "member")
	if err != nil || !hasSession(res) {
		t.Fatalf("sign-in: %v", err)
	}
	l := s.link(org)
	if got := s.roleOf(l.PrimaryNamespace, "joiner-"+tag+"@example.test"); got != "editor" {
		t.Fatalf("role after sign-in: %q", got)
	}

	// session.revoked marks the hub-born session; the guard's hook sees it.
	uid := s.userID("joiner-" + tag + "@example.test")
	var iat int64
	if err := s.db.QueryRow(`SELECT issued_at FROM circlexo_sessions WHERE user_id = $1`, uid).Scan(&iat); err != nil {
		t.Fatalf("session not recorded: %v", err)
	}
	if s.svc.sessionEnded(context.Background(), uid, iat) {
		t.Fatal("session ended before the hub revoked it")
	}
	ev := map[string]any{"user": map[string]string{"id": "joiner-" + tag}, "session_id": "sid-joiner-" + tag}
	if got := s.event("session.revoked", org, ev, "ev-"+rnd()); got >= 300 {
		t.Fatalf("session.revoked: %d", got)
	}
	if !s.svc.sessionEnded(context.Background(), uid, iat) {
		t.Fatal("hub-revoked session still valid")
	}
	if s.svc.Acct.SessionEnded == nil {
		t.Fatal("Install did not wire the account guard")
	}
}

func TestHubTokenAuthMeterAndLimit(t *testing.T) {
	s := boot(t)
	ctx := context.Background()
	org := "org-" + rnd()
	tag := rnd()
	member, stranger := "mem-"+tag, "str-"+tag
	s.install(org, [2]string{"own-" + tag, "owner"}, [2]string{member, "member"})
	limit := int64(2) // the org's primary brain counts as one
	s.entitle(org, true, &limit)
	if _, err := s.svc.Provision(ctx, ProvisionInput{OrgID: org, Slug: "tok-" + tag}); err != nil {
		t.Fatal(err)
	}
	l := s.link(org)

	tok := func(sub, o string, extra map[string]any) string {
		s.hub.Lock()
		s.hub.User.ID, s.hub.User.OrgID = sub, o
		s.hub.Unlock()
		return s.hub.AccessToken(extra)
	}
	refused := func(err error) int {
		var r *hubapi.Refusal
		if errors.As(err, &r) {
			return r.Status
		}
		return 0
	}

	// Not a hub token: falls through to Zekra's own credentials.
	if id, err := s.svc.Authenticate(ctx, "zko_at_not-a-jwt"); id != nil || err != nil {
		t.Fatalf("foreign token: %v %v", id, err)
	}
	// A valid hub token for a person who never signed in: refused, not guessed.
	if _, err := s.svc.Authenticate(ctx, tok(stranger, org, nil)); refused(err) != http.StatusForbidden {
		t.Fatalf("unlinked: %v", err)
	}
	// A member who has signed in with CircleXO once (that is what links the hub identity)
	// authenticates, read-only by default.
	if _, _, lerr := s.login(member, member+"@example.test", true, org, "member"); lerr != nil {
		t.Fatalf("member sign-in: %v", lerr)
	}
	id, err := s.svc.Authenticate(ctx, tok(member, org, nil))
	if err != nil || id == nil {
		t.Fatalf("member: %v", err)
	}
	if id.Write || len(id.Namespaces) != 1 || id.Namespaces[0] != l.PrimaryNamespace || id.OrgID != org {
		t.Fatalf("identity: %+v", id)
	}
	if id, _ = s.svc.Authenticate(ctx, tok(member, org, map[string]any{"scope": "openid brains:write"})); id == nil || !id.Write {
		t.Fatalf("brains:write scope: %+v", id)
	}
	// Someone in another org is not a member of this one.
	if _, err := s.svc.Authenticate(ctx, tok(member, "org-elsewhere", nil)); refused(err) != http.StatusForbidden {
		t.Fatalf("other org: %v", err)
	}

	// Metering: one `requests` unit reaches the hub, and a 402 from it stops the call.
	before := len(s.hub.Usage)
	if err := s.svc.Meter(ctx, id); err != nil {
		t.Fatal(err)
	}
	s.hub.Lock()
	got := len(s.hub.Usage) - before
	s.hub.Unlock()
	if got != 1 {
		t.Fatalf("usage reports: %d", got)
	}
	s.hub.Lock()
	s.hub.Fail = http.StatusPaymentRequired
	s.hub.Unlock()
	if err := s.svc.Meter(ctx, id); refused(err) != http.StatusPaymentRequired {
		t.Fatalf("meter with an empty wallet: %v", err)
	}
	s.hub.Lock()
	s.hub.Fail = http.StatusInternalServerError
	s.hub.Unlock()
	if err := s.svc.Meter(ctx, id); refused(err) != http.StatusServiceUnavailable {
		t.Fatalf("meter with the hub down: %v", err)
	}
	s.hub.Lock()
	s.hub.Fail = 0
	s.hub.Unlock()

	// Brain limit: the org has two brain slots and its primary brain uses one
	// so the first new brain fits and the second does not.
	uid := s.userID(member + "@example.test")
	if err := s.svc.BeforeNewBrain(ctx, uid, "extra-"+tag); err != nil {
		t.Fatalf("first brain: %v", err)
	}
	s.svc.BrainCreated(ctx, uid, "extra-"+tag)
	if err := s.svc.BeforeNewBrain(ctx, uid, "extra2-"+tag); refused(err) != http.StatusPaymentRequired {
		t.Fatalf("over the limit: %v", err)
	}
	s.svc.BrainDeleted(ctx, "extra-"+tag)
	if err := s.svc.BeforeNewBrain(ctx, uid, "extra2-"+tag); err != nil {
		t.Fatalf("after deleting one: %v", err)
	}

	// Fail closed: an org whose plan the hub cannot confirm is refused, and an inactive plan is a 402.
	s.entitle(org, false, nil)
	if _, err := s.svc.Authenticate(ctx, tok(member, org, nil)); refused(err) != http.StatusPaymentRequired {
		t.Fatalf("inactive plan: %v", err)
	}
	if err := s.svc.BeforeNewBrain(ctx, uid, "x-"+tag); refused(err) != http.StatusPaymentRequired {
		t.Fatalf("inactive plan, new brain: %v", err)
	}
}

func TestConfigHandlerOffAndOn(t *testing.T) {
	Install(nil)
	rec := httptest.NewRecorder()
	ConfigHandler(rec, httptest.NewRequest(http.MethodGet, ConfigPath, nil))
	if !strings.Contains(rec.Body.String(), `"enabled":false`) {
		t.Fatalf("off: %s", rec.Body)
	}
	if Enabled() {
		t.Fatal("enabled with no service installed")
	}
}
