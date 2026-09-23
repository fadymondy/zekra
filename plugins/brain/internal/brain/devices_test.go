package brain

/*
Push notification tests (MH-373).

The FCM sender tests run everywhere: a fake OAuth token endpoint and a fake FCM
API (httptest) check the JWT assertion, the token caching and the exact message
shape. The device-token store/handler tests need Postgres:

  - TEST_DATABASE_URL (the full stack-togo database, see harness_test.go) runs
    everything, including the triggers that need the brain/presentation tables;
  - PUSH_TEST_DATABASE_URL (any plain Postgres ≥ 13, no extensions) runs the
    store, handler and pruning tests against just this feature's tables.
*/

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/go-chi/chi/v5"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/togo-framework/togo"
)

// ---- FCM sender (no database) ----------------------------------------------------

func testServiceAccount(t *testing.T) (*serviceAccount, *rsa.PrivateKey) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	pemKey := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
	return &serviceAccount{ClientEmail: "push@zekra-test.iam.gserviceaccount.com", PrivateKey: pemKey, ProjectID: "zekra-test"}, key
}

type fakeFCM struct {
	t          *testing.T
	pub        *rsa.PublicKey
	tokenCalls atomic.Int32
	mu         sync.Mutex
	sends      []map[string]any
	// status/body per device token; default 200 {}
	replies map[string]struct {
		status int
		body   string
	}
	srv *httptest.Server
}

func newFakeFCM(t *testing.T, pub *rsa.PublicKey) *fakeFCM {
	f := &fakeFCM{t: t, pub: pub, replies: map[string]struct {
		status int
		body   string
	}{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/token", f.token)
	mux.HandleFunc("/v1/projects/zekra-test/messages:send", f.send)
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeFCM) token(w http.ResponseWriter, r *http.Request) {
	f.tokenCalls.Add(1)
	_ = r.ParseForm()
	if r.Form.Get("grant_type") != "urn:ietf:params:oauth:grant-type:jwt-bearer" {
		http.Error(w, "bad grant", http.StatusBadRequest)
		return
	}
	parts := strings.Split(r.Form.Get("assertion"), ".")
	if len(parts) != 3 {
		http.Error(w, "bad jwt", http.StatusBadRequest)
		return
	}
	sig, _ := base64.RawURLEncoding.DecodeString(parts[2])
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(f.pub, crypto.SHA256, digest[:], sig); err != nil {
		http.Error(w, "bad signature", http.StatusUnauthorized)
		return
	}
	raw, _ := base64.RawURLEncoding.DecodeString(parts[1])
	var claims map[string]any
	_ = json.Unmarshal(raw, &claims)
	if claims["iss"] != "push@zekra-test.iam.gserviceaccount.com" || claims["scope"] != fcmScope || claims["aud"] != f.srv.URL+"/token" {
		http.Error(w, "bad claims", http.StatusBadRequest)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "ya29.test", "expires_in": 3600, "token_type": "Bearer"})
}

func (f *fakeFCM) send(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Bearer ya29.test" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	f.mu.Lock()
	f.sends = append(f.sends, body)
	f.mu.Unlock()
	msg, _ := body["message"].(map[string]any)
	if rep, ok := f.replies[msg["token"].(string)]; ok {
		w.WriteHeader(rep.status)
		_, _ = io.WriteString(w, rep.body)
		return
	}
	_, _ = io.WriteString(w, `{"name":"projects/zekra-test/messages/1"}`)
}

func (f *fakeFCM) sender(t *testing.T, sa *serviceAccount) *fcmSender {
	t.Helper()
	snd, err := newFCMSender(sa)
	if err != nil {
		t.Fatal(err)
	}
	snd.tokenURL = f.srv.URL + "/token"
	snd.baseURL = f.srv.URL
	return snd
}

func TestFCMSenderMessageShape(t *testing.T) {
	sa, key := testServiceAccount(t)
	fake := newFakeFCM(t, &key.PublicKey)
	snd := fake.sender(t, sa)

	ctx := context.Background()
	data := map[string]string{"route": "/note/n1", "type": "test"}
	for i := 0; i < 2; i++ {
		if err := snd.Deliver(ctx, "device-token-1", pushText{Title: "Hello", Body: "World"}, data); err != nil {
			t.Fatalf("deliver %d: %v", i, err)
		}
	}
	if n := fake.tokenCalls.Load(); n != 1 {
		t.Fatalf("access token minted %d times, want 1 (cached)", n)
	}
	if len(fake.sends) != 2 {
		t.Fatalf("sends = %d", len(fake.sends))
	}
	msg := fake.sends[0]["message"].(map[string]any)
	if msg["token"] != "device-token-1" {
		t.Fatalf("token = %v", msg["token"])
	}
	n := msg["notification"].(map[string]any)
	if n["title"] != "Hello" || n["body"] != "World" {
		t.Fatalf("notification = %v", n)
	}
	android := msg["android"].(map[string]any)
	if android["priority"] != "HIGH" || android["notification"].(map[string]any)["sound"] != "default" {
		t.Fatalf("android = %v", android)
	}
	aps := msg["apns"].(map[string]any)["payload"].(map[string]any)["aps"].(map[string]any)
	if aps["content-available"] != float64(1) {
		t.Errorf("aps content-available = %v, want 1 (wakes the app to refresh widgets)", aps["content-available"])
	}
	if aps["sound"] != "default" {
		t.Fatalf("aps = %v", aps)
	}
	if d := msg["data"].(map[string]any); d["route"] != "/note/n1" {
		t.Fatalf("data = %v", d)
	}
	if _, ok := fake.sends[0]["validate_only"]; ok {
		t.Fatal("validate_only set without FCM_DRY_RUN")
	}

	// No data → no data key at all (an empty map is at best noise).
	if err := snd.Deliver(ctx, "device-token-1", pushText{Title: "a", Body: "b"}, nil); err != nil {
		t.Fatal(err)
	}
	if _, ok := fake.sends[2]["message"].(map[string]any)["data"]; ok {
		t.Fatal("empty data map was sent")
	}
}

func TestFCMSenderDeadTokens(t *testing.T) {
	sa, key := testServiceAccount(t)
	fake := newFakeFCM(t, &key.PublicKey)
	type rep = struct {
		status int
		body   string
	}
	fake.replies["gone"] = rep{404, `{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}`}
	fake.replies["bad-token"] = rep{400, `{"error":{"status":"INVALID_ARGUMENT","message":"The registration token is not a valid FCM registration token","details":[{"fieldViolations":[{"field":"message.token"}]}]}}`}
	fake.replies["other-project"] = rep{403, `{"error":{"status":"PERMISSION_DENIED","details":[{"errorCode":"SENDER_ID_MISMATCH"}]}}`}
	fake.replies["bad-message"] = rep{400, `{"error":{"status":"INVALID_ARGUMENT","message":"Invalid value at 'message.data'"}}`}
	fake.replies["quota"] = rep{429, `{"error":{"status":"RESOURCE_EXHAUSTED","details":[{"errorCode":"QUOTA_EXCEEDED"}]}}`}
	snd := fake.sender(t, sa)
	ctx := context.Background()
	for tok, dead := range map[string]bool{"gone": true, "bad-token": true, "other-project": true, "bad-message": false, "quota": false} {
		err := snd.Deliver(ctx, tok, pushText{Title: "t", Body: "b"}, nil)
		if got := errors.Is(err, errDeadToken); got != dead {
			t.Errorf("%s: dead=%v, want %v (err %v)", tok, got, dead, err)
		}
		if err == nil {
			t.Errorf("%s: no error", tok)
		}
	}
}

func TestParseServiceAccount(t *testing.T) {
	sa, _ := testServiceAccount(t)
	raw, _ := json.Marshal(map[string]string{
		"client_email": sa.ClientEmail, "project_id": sa.ProjectID,
		// as pasted into an env var: literal backslash-n sequences
		"private_key": strings.ReplaceAll(sa.PrivateKey, "\n", `\n`),
	})
	for name, in := range map[string]string{"json": string(raw), "base64": base64.StdEncoding.EncodeToString(raw)} {
		got, err := parseServiceAccount(in)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if _, err := parseRSAPrivateKey(got.PrivateKey); err != nil {
			t.Fatalf("%s: key: %v", name, err)
		}
	}
	t.Setenv("FCM_PROJECT_ID", "override")
	got, _ := parseServiceAccount(string(raw))
	if got.ProjectID != "override" {
		t.Fatalf("FCM_PROJECT_ID not applied: %q", got.ProjectID)
	}
	if _, err := parseServiceAccount(`{"client_email":"x"}`); err == nil {
		t.Fatal("incomplete key accepted")
	}
	if _, err := parseServiceAccount("not json at all!"); err == nil {
		t.Fatal("garbage accepted")
	}
}

func TestPushNotConfiguredIsNoop(t *testing.T) {
	t.Setenv("FCM_SERVICE_ACCOUNT_JSON", "")
	t.Setenv("GOOGLE_APPLICATION_CREDENTIALS", "")
	svc := &Service{Store: &Store{}}
	t.Cleanup(func() { pushers.Delete(svc) })
	p := svc.pusher()
	if p.d != nil {
		t.Fatal("pusher configured without a key")
	}
	p.notifyUser("u1", pushMessage{}) // must not panic or block
	if _, err := p.sendNow(context.Background(), "u1", pushMessage{}); !errors.Is(err, ErrPushNotConfigured) {
		t.Fatalf("err = %v", err)
	}
	// Adding yourself is never news: no query, nothing recorded. (With push off
	// the trigger otherwise still runs — the inbox is written regardless; see
	// notifications_test.go.)
	svc.notifyBeforeMemberSet(context.Background(), "ns", "u1", "u1")()
}

func TestPushTextAndMasking(t *testing.T) {
	m := brainAccessMessage("team-x", "Team X")
	if m.textFor("ar").Title == m.textFor("en").Title || m.textFor("fr").Title != m.textFor("en").Title {
		t.Fatal("locale selection / fallback broken")
	}
	if m.Data["route"] != "/brain/team-x" {
		t.Fatalf("route = %q", m.Data["route"])
	}
	if r := brainAccessMessage("a/b", "x").Data["route"]; r != "/brain/a%2Fb" {
		t.Fatalf("namespace not escaped: %q", r)
	}
	if r := presentationViewedPush("p1", "").Data["route"]; r != "/presentation/p1" {
		t.Fatalf("route = %q", r)
	}
	for in, want := range map[string]string{"ar-EG": "ar", "AR": "ar", "en_US": "en", "": "en", "fr": "en"} {
		if got := normalizePushLocale(in); got != want {
			t.Errorf("normalizePushLocale(%q) = %q", in, got)
		}
	}
	tok := "cXk3aVdEQ0E6APA91bHexampletokenvalue1234"
	if h := maskDeviceToken(tok); strings.Contains(h, tok[6:len(tok)-4]) || !strings.HasPrefix(h, tok[:6]) {
		t.Fatalf("mask = %q", h)
	}
	if maskDeviceToken("short") != "…" {
		t.Fatal("short token not fully masked")
	}
}

// ---- database-backed -------------------------------------------------------------

// pushSchemaBlock is this feature's slice of schema.sql, for a plain Postgres.
func pushSchemaBlock(t *testing.T) string {
	t.Helper()
	start := strings.Index(schemaSQL, "-- ── Push notifications: device tokens (MH-373)")
	endAt := strings.Index(schemaSQL, "CREATE TABLE IF NOT EXISTS public.push_once")
	if start < 0 || endAt < 0 {
		t.Fatal("push block not found in schema.sql")
	}
	end := endAt + strings.Index(schemaSQL[endAt:], ");") + 2
	return schemaSQL[start:end]
}

var pushMigrateOnce sync.Once
var pushMigrateErr error

// pushFix is newFix on the full database when TEST_DATABASE_URL is set, else a
// minimal fixture on PUSH_TEST_DATABASE_URL with only the push tables.
func pushFix(t *testing.T) (*fix, bool) {
	t.Helper()
	if os.Getenv("TEST_DATABASE_URL") != "" {
		f := newFix(t)
		f.cleanPush()
		t.Cleanup(f.cleanPush)
		return f, true
	}
	dsn := os.Getenv("PUSH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL (full) or PUSH_TEST_DATABASE_URL (plain Postgres) to run the device-token tests")
	}
	t.Setenv("ZEKRA_REQUIRE_AUTH", "1")
	t.Setenv("ZEKRA_REQUIRE_TOKEN", "")
	k := &togo.Kernel{
		Config: &togo.Config{DBDriver: "pgx", DatabaseURL: dsn},
		Router: chi.NewMux(),
		Log:    slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	svc := New(k)
	db, err := svc.Store.db(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	pushMigrateOnce.Do(func() { _, pushMigrateErr = db.Exec(pushSchemaBlock(t)) })
	if pushMigrateErr != nil {
		t.Fatal(pushMigrateErr)
	}
	dir := &fakeDirectory{users: map[string][]string{"u-admin": {"admin"}}, gone: map[string]bool{}}
	k.Set(UserDirectoryKey, dir)
	svc.RegisterRoutes(k.Router, nil)
	f := &fix{t: t, svc: svc, router: k.Router, dir: dir, prefix: "t" + strings.ToLower(strings.NewReplacer("_", "x", "-", "x").Replace(randomToken(5))) + "-"}
	t.Cleanup(f.cleanPush)
	// The trigger tests also need the brain/presentation tables; a plain
	// database that has them (applied from schema.sql by hand) runs those too.
	var have int
	_ = db.QueryRow(`SELECT count(*) FROM (VALUES ('public.brain_members'), ('public.brain_profiles'),
		('public.presentations'), ('public.presentation_shares')) v(t) WHERE to_regclass(v.t) IS NOT NULL`).Scan(&have)
	return f, have == 4
}

// user registers a fresh session user unique to this test.
func (f *fix) user(name string) string {
	id := f.prefix + name
	f.dir.mu.Lock()
	f.dir.users[id] = []string{"member"}
	f.dir.mu.Unlock()
	return id
}

func (f *fix) cleanPush() {
	db, err := f.svc.Store.db(context.Background())
	if err != nil {
		return
	}
	_, _ = db.Exec(`DELETE FROM device_tokens WHERE user_id LIKE $1 OR token LIKE $1`, f.prefix+"%")
	_, _ = db.Exec(`DELETE FROM push_once WHERE key LIKE $1`, "%"+f.prefix+"%")
	// Trigger fixtures (ignored where the tables do not exist).
	_, _ = db.Exec(`DELETE FROM brain_members WHERE namespace LIKE $1`, f.prefix+"%")
	_, _ = db.Exec(`DELETE FROM presentations WHERE id LIKE $1`, f.prefix+"%")
	pushers.Delete(f.svc)
}

// recordingDeliverer is a fake deliverer: tokens in dead answer errDeadToken.
type recordingDeliverer struct {
	mu   sync.Mutex
	dead map[string]bool
	got  []struct {
		token string
		text  pushText
		data  map[string]string
	}
}

func (d *recordingDeliverer) Deliver(_ context.Context, token string, text pushText, data map[string]string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.got = append(d.got, struct {
		token string
		text  pushText
		data  map[string]string
	}{token, text, data})
	if d.dead[token] {
		return errDeadToken
	}
	return nil
}

func (f *fix) fakePush() (*recordingDeliverer, *pusher) {
	d := &recordingDeliverer{dead: map[string]bool{}}
	p := &pusher{store: f.svc.Store, log: slog.New(slog.NewTextHandler(io.Discard, nil)), d: d}
	pushers.Store(f.svc, p)
	return d, p
}

func TestDeviceTokenStore(t *testing.T) {
	f, _ := pushFix(t)
	ctx := context.Background()
	st := f.svc.Store
	alice, bob := f.user("alice"), f.user("bob")
	tok := f.prefix + "fcm-token-aaaaaaaaaaaa-1"

	d, err := st.UpsertDeviceToken(ctx, alice, tok, "ios", "zekra-mobile ios 18", "ar-EG")
	if err != nil {
		t.Fatal(err)
	}
	if d.ID == "" || d.Locale != "ar" || strings.Contains(d.TokenHint, tok[6:len(tok)-4]) {
		t.Fatalf("device = %+v", d)
	}
	// Re-registering is an upsert, not a second row.
	if _, err := st.UpsertDeviceToken(ctx, alice, tok, "ios", "zekra-mobile ios 18.1", "en"); err != nil {
		t.Fatal(err)
	}
	list, _ := st.DeviceTokens(ctx, alice)
	if len(list) != 1 || list[0].UserAgent != "zekra-mobile ios 18.1" || list[0].Locale != "en" {
		t.Fatalf("alice devices = %+v", list)
	}
	// The same token registered by another account MOVES to it.
	if _, err := st.UpsertDeviceToken(ctx, bob, tok, "ios", "", ""); err != nil {
		t.Fatal(err)
	}
	if list, _ := st.DeviceTokens(ctx, alice); len(list) != 0 {
		t.Fatalf("token still on alice: %+v", list)
	}
	if list, _ := st.DeviceTokens(ctx, bob); len(list) != 1 {
		t.Fatalf("bob devices = %+v", list)
	}
	// Unregister only removes the caller's own row.
	if removed, _ := st.UnregisterDeviceToken(ctx, alice, tok); removed {
		t.Fatal("alice removed bob's device")
	}
	if removed, _ := st.UnregisterDeviceToken(ctx, bob, tok); !removed {
		t.Fatal("bob could not remove his device")
	}
	for _, bad := range []struct{ tok, platform string }{{"", "ios"}, {"has space", "ios"}, {tok, "web"}, {strings.Repeat("x", 4097), "android"}} {
		if _, err := st.UpsertDeviceToken(ctx, alice, bad.tok, bad.platform, "", ""); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("accepted %q/%q: %v", bad.tok[:min(len(bad.tok), 12)], bad.platform, err)
		}
	}
	// The per-account cap keeps the most recently seen devices.
	for i := 0; i < maxDevicesPerUser+3; i++ {
		if _, err := st.UpsertDeviceToken(ctx, alice, f.prefix+"cap-token-"+strings.Repeat("y", 8)+string(rune('a'+i)), "android", "", ""); err != nil {
			t.Fatal(err)
		}
	}
	if list, _ := st.DeviceTokens(ctx, alice); len(list) != maxDevicesPerUser {
		t.Fatalf("cap: %d devices", len(list))
	}
}

func TestDeviceTokenHandlers(t *testing.T) {
	f, _ := pushFix(t)
	alice := f.user("alice")
	tok := f.prefix + "fcm-token-bbbbbbbbbbbb-2"
	body := map[string]any{"token": tok, "platform": "android", "user_agent": "zekra-mobile android 35", "locale": "en"}

	// No session → 401, for every route.
	for _, r := range []req{
		{method: "GET", path: "/api/me/device_tokens"},
		{method: "POST", path: "/api/me/device_tokens", body: body},
		{method: "POST", path: "/api/me/device_tokens/unregister", body: map[string]any{"token": tok}},
		{method: "POST", path: "/api/me/device_tokens/test", body: map[string]any{}},
	} {
		if rec := f.do(r); rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s anonymous = %d %s", r.method, r.path, rec.Code, rec.Body)
		}
	}
	// A cookie-style form post without CSRF is refused.
	rec := f.do(req{method: "POST", path: "/api/me/device_tokens", user: alice, body: "token=" + url.QueryEscape(tok),
		headers: map[string]string{"Content-Type": "application/x-www-form-urlencoded"}})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("form post without csrf = %d", rec.Code)
	}
	if rec := f.do(req{method: "POST", path: "/api/me/device_tokens", user: alice, body: map[string]any{"token": tok, "platform": "web"}}); rec.Code != http.StatusBadRequest {
		t.Fatalf("platform web = %d", rec.Code)
	}
	if rec := f.do(req{method: "POST", path: "/api/me/device_tokens", user: alice, body: body}); rec.Code != http.StatusOK {
		t.Fatalf("register = %d %s", rec.Code, rec.Body)
	}
	// Bearer-authenticated JSON (how the app calls) passes the CSRF rule too.
	if rec := f.do(req{method: "POST", path: "/api/me/device_tokens", user: alice, body: body,
		headers: map[string]string{"Authorization": "Bearer session-jwt"}}); rec.Code != http.StatusOK {
		t.Fatalf("register (bearer) = %d %s", rec.Code, rec.Body)
	}
	rec = f.do(req{method: "GET", path: "/api/me/device_tokens", user: alice})
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), tok) {
		t.Fatalf("list = %d %s (full token must never be listed)", rec.Code, rec.Body)
	}
	var out struct {
		Devices []DeviceToken `json:"devices"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if len(out.Devices) != 1 || out.Devices[0].Platform != "android" {
		t.Fatalf("devices = %+v", out.Devices)
	}
	// Another user cannot unregister alice's device.
	bob := f.user("bob")
	rec = f.do(req{method: "POST", path: "/api/me/device_tokens/unregister", user: bob, body: map[string]any{"token": tok}})
	if rec.Code != http.StatusOK || decodeMap(t, rec)["removed"] != false {
		t.Fatalf("bob unregister = %d %s", rec.Code, rec.Body)
	}
	rec = f.do(req{method: "POST", path: "/api/me/device_tokens/unregister", user: alice, body: map[string]any{"token": tok}})
	if rec.Code != http.StatusOK || decodeMap(t, rec)["removed"] != true {
		t.Fatalf("alice unregister = %d %s", rec.Code, rec.Body)
	}
	// Push not configured → the test endpoint says so.
	t.Setenv("FCM_SERVICE_ACCOUNT_JSON", "")
	t.Setenv("GOOGLE_APPLICATION_CREDENTIALS", "")
	pushers.Delete(f.svc)
	if rec := f.do(req{method: "POST", path: "/api/me/device_tokens/test", user: alice, body: map[string]any{}}); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("test (unconfigured) = %d %s", rec.Code, rec.Body)
	}
}

func TestPushSendPrunesDeadTokens(t *testing.T) {
	f, _ := pushFix(t)
	ctx := context.Background()
	alice := f.user("alice")
	live, dead := f.prefix+"live-token-cccccccccc", f.prefix+"dead-token-dddddddddd"
	if _, err := f.svc.Store.UpsertDeviceToken(ctx, alice, live, "ios", "", "ar"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Store.UpsertDeviceToken(ctx, alice, dead, "android", "", "en"); err != nil {
		t.Fatal(err)
	}
	d, _ := f.fakePush()
	d.dead[dead] = true

	rec := f.do(req{method: "POST", path: "/api/me/device_tokens/test", user: alice, body: map[string]any{}})
	if rec.Code != http.StatusOK {
		t.Fatalf("test = %d %s", rec.Code, rec.Body)
	}
	var res pushResult
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res.Devices != 2 || res.Sent != 1 || res.Pruned != 1 || !res.Configured {
		t.Fatalf("result = %+v", res)
	}
	for _, g := range d.got {
		want := "Zekra"
		if g.token == live {
			want = "ذكرة" // the Arabic device gets the Arabic text
		}
		if g.text.Title != want {
			t.Fatalf("%s got title %q", g.token, g.text.Title)
		}
	}
	if list, _ := f.svc.Store.DeviceTokens(ctx, alice); len(list) != 1 || list[0].Platform != "ios" {
		t.Fatalf("after prune = %+v", list)
	}
	// A second test right away is rate limited.
	if rec := f.do(req{method: "POST", path: "/api/me/device_tokens/test", user: alice, body: map[string]any{}}); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("second test = %d", rec.Code)
	}
}

func TestPushNewMemberTrigger(t *testing.T) {
	f, full := pushFix(t)
	if !full {
		t.Skip("needs the brain_members/brain_profiles tables (TEST_DATABASE_URL)")
	}
	ctx := context.Background()
	ns := f.ns("pushbrain")
	owner, alice := f.user("owner"), f.user("alice")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1, $2, 'owner')`, ns, owner)
	if _, err := f.svc.Store.UpsertDeviceToken(ctx, alice, f.prefix+"member-token-eeeeeeee", "ios", "", "en"); err != nil {
		t.Fatal(err)
	}
	d, p := f.fakePush()

	add := func(role string) {
		rec := f.do(req{method: "POST", path: "/api/brain/members", user: owner, body: map[string]any{"namespace": ns, "userId": alice, "role": role}})
		if rec.Code != http.StatusOK {
			t.Fatalf("set member = %d %s", rec.Code, rec.Body)
		}
		p.wg.Wait()
	}
	add("viewer")
	if len(d.got) != 1 || d.got[0].data["route"] != "/brain/"+url.PathEscape(ns) {
		t.Fatalf("new member push = %+v", d.got)
	}
	add("editor") // a role change is not news
	if len(d.got) != 1 {
		t.Fatalf("role change pushed: %+v", d.got)
	}
}

func TestPushPresentationFirstView(t *testing.T) {
	f, full := pushFix(t)
	if !full {
		t.Skip("needs the presentations tables (TEST_DATABASE_URL)")
	}
	ctx := context.Background()
	owner := f.user("presowner")
	docID, shareID, hash := f.prefix+"doc", f.prefix+"share", f.prefix+"hash"
	f.exec(`INSERT INTO presentations (id, namespace, owner_user_id, kind, title, content) VALUES ($1, $2, $3, 'deck', 'Q3 plan', '{}')`, docID, f.ns("pres"), owner)
	f.exec(`INSERT INTO presentation_shares (id, presentation_id, token_hash, view_count) VALUES ($1, $2, $3, 1)`, shareID, docID, hash)

	if _, _, ok := f.svc.presentationViewedMessage(ctx, hash, owner); ok {
		t.Fatal("the owner's own view notified")
	}
	uid, msg, ok := f.svc.presentationViewedMessage(ctx, hash, "")
	if !ok || uid != owner || msg.Data["route"] != "/presentation/"+url.PathEscape(docID) {
		t.Fatalf("first view = %v %q %+v", ok, uid, msg)
	}
	if _, _, ok := f.svc.presentationViewedMessage(ctx, hash, ""); ok {
		t.Fatal("second view notified again")
	}
}
