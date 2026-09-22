package brain

/*
Database-backed test harness for notes, membership, OAuth and /api/mcp.

	TEST_DATABASE_URL='postgres://cabrain:…@localhost:55432/zekra_p1_test?sslmode=disable' \
	  go test ./plugins/brain/internal/brain

The database needs the vchord/pg_tokenizer/pg_partman extensions (the stack-togo
Postgres image); the harness applies schema.sql itself. Skipped without
TEST_DATABASE_URL.
*/

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/togo-framework/togo"
)

// fakeEmbedder is deterministic: identical text → identical vector, different
// text → (almost surely) a distant one. Enough for the write pipeline.
type fakeEmbedder struct{}

func (fakeEmbedder) Dim() int { return 1024 }

func (fakeEmbedder) Embed(_ context.Context, texts []string) ([][]float32, error) {
	out := make([][]float32, len(texts))
	for i, t := range texts {
		v := make([]float32, 1024)
		var norm float64
		for j := 0; j < 1024; j += 8 {
			sum := sha256.Sum256([]byte(t + "#" + string(rune(j))))
			for k := 0; k < 8; k++ {
				x := float64(int16(binary.BigEndian.Uint16(sum[k*2:]))) / 32768
				v[j+k] = float32(x)
				norm += x * x
			}
		}
		n := float32(math.Sqrt(norm))
		for j := range v {
			v[j] /= n
		}
		out[i] = v
	}
	return out, nil
}

// fakeDirectory resolves the X-Test-User header as the session user.
type fakeDirectory struct {
	mu    sync.Mutex
	users map[string][]string // id → roles
	gone  map[string]bool
}

func (d *fakeDirectory) SessionUser(r *http.Request) (string, []string, bool) {
	id := r.Header.Get("X-Test-User")
	if id == "" {
		return "", nil, false
	}
	roles, ok := d.UserRoles(r.Context(), id)
	return id, roles, ok
}

func (d *fakeDirectory) UserRoles(_ context.Context, id string) ([]string, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	roles, ok := d.users[id]
	return roles, ok && !d.gone[id]
}

type fix struct {
	t      *testing.T
	svc    *Service
	router chi.Router
	dir    *fakeDirectory
	prefix string
}

var migrateOnce sync.Once
var migrateErr error

func newFix(t *testing.T) *fix {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run the database-backed brain tests")
	}
	t.Setenv("ZEKRA_REQUIRE_AUTH", "1") // anonymous callers get nothing (production posture)
	t.Setenv("ZEKRA_REQUIRE_TOKEN", "")
	t.Setenv("ZEKRA_NOTES_AUTO_ADOPT", "0") // tests that want it turn it on
	// A fixed vault key, so tests can exercise the secret store. Without one the
	// vault fails closed (never plaintext) and any secret write answers 503.
	t.Setenv("ZEKRA_SECRETS_KEY", strings.Repeat("ab", 32))
	t.Setenv("ZEKRA_OAUTH_ISSUER", testIssuer)
	t.Setenv("AUTH_PUBLIC_URL", testIssuer)
	t.Setenv("APP_URL", "")
	t.Setenv("MCP_PUBLIC_URL", "")
	t.Setenv("ZEKRA_PUBLIC_URL", "")
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
	migrateOnce.Do(func() {
		_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, email text, roles text NOT NULL DEFAULT '')`)
		if err := Migrate(context.Background(), db); err != nil && !strings.Contains(err.Error(), "BM25") {
			migrateErr = err
		}
	})
	if migrateErr != nil {
		t.Fatal(migrateErr)
	}
	RegisterEmbedder(k, fakeEmbedder{})
	dir := &fakeDirectory{users: map[string][]string{
		"u-admin": {"admin"}, "u-alice": {"member"}, "u-bob": {"member"}, "u-carol": {},
	}, gone: map[string]bool{}}
	k.Set(UserDirectoryKey, dir)
	svc.RegisterRoutes(k.Router, nil)

	f := &fix{t: t, svc: svc, router: k.Router, dir: dir, prefix: "t" + strings.ToLower(randomToken(5)) + "-"}
	f.prefix = strings.NewReplacer("_", "x", "-", "x").Replace(f.prefix[:len(f.prefix)-1]) + "-"
	t.Cleanup(f.clean)
	return f
}

func (f *fix) ns(name string) string { return f.prefix + name }

func (f *fix) clean() {
	db, err := f.svc.Store.db(context.Background())
	if err != nil {
		return
	}
	like := f.prefix + "%"
	for _, q := range []string{
		`DELETE FROM memories WHERE namespace LIKE $1`,
		`DELETE FROM notes WHERE namespace LIKE $1`,
		`DELETE FROM entity_edges WHERE namespace LIKE $1`,
		`DELETE FROM entities WHERE namespace LIKE $1`,
		`DELETE FROM entity_types WHERE namespace LIKE $1`,
		`DELETE FROM edge_types WHERE namespace LIKE $1`,
		`DELETE FROM brain_members WHERE namespace LIKE $1`,
		`DELETE FROM brain_profiles WHERE namespace LIKE $1`,
		`DELETE FROM namespace_grants WHERE namespace LIKE $1`,
		`DELETE FROM memory_gaps WHERE namespace LIKE $1`,
		`DELETE FROM memory_events WHERE namespace LIKE $1`,
		`DELETE FROM brain_tokens WHERE agent_id LIKE $1`,
		`DELETE FROM mcp_oauth_grants WHERE id IN (SELECT grant_id FROM mcp_oauth_grant_namespaces WHERE namespace LIKE $1)`,
		`DELETE FROM mcp_oauth_codes WHERE namespaces LIKE '%' || $1 || '%'`,
	} {
		_, _ = db.Exec(q, like)
	}
	_, _ = db.Exec(`DELETE FROM mcp_oauth_clients WHERE client_name LIKE 'p1 %'`)
}

func (f *fix) exec(q string, args ...any) {
	f.t.Helper()
	db, _ := f.svc.Store.db(context.Background())
	if _, err := db.Exec(q, args...); err != nil {
		f.t.Fatalf("%s: %v", q, err)
	}
}

func (f *fix) count(q string, args ...any) int {
	f.t.Helper()
	db, _ := f.svc.Store.db(context.Background())
	var n int
	if err := db.QueryRow(q, args...).Scan(&n); err != nil {
		f.t.Fatalf("%s: %v", q, err)
	}
	return n
}

// req is a request builder: as(user) sets the session user, tok() an ACL token.
type req struct {
	method, path string
	body         any
	user, token  string
	headers      map[string]string
}

func (f *fix) do(r req) *httptest.ResponseRecorder {
	f.t.Helper()
	var rd io.Reader
	if r.body != nil {
		switch b := r.body.(type) {
		case string:
			rd = strings.NewReader(b)
		default:
			raw, _ := json.Marshal(b)
			rd = bytes.NewReader(raw)
		}
	}
	hr := httptest.NewRequest(r.method, r.path, rd)
	if r.body != nil {
		hr.Header.Set("Content-Type", "application/json")
	}
	if r.user != "" {
		hr.Header.Set("X-Test-User", r.user)
	}
	if r.token != "" {
		hr.Header.Set("X-Zekra-Token", r.token)
	}
	for k, v := range r.headers {
		hr.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	f.router.ServeHTTP(rec, hr)
	return rec
}

func decodeMap(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	out := map[string]any{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return out
}

// seedMemory retains one memory directly (bypassing HTTP).
func (f *fix) seedMemory(ns, content string) string {
	f.t.Helper()
	res, err := f.svc.Store.Retain(context.Background(), MemoryInput{Namespace: ns, Content: content, SourceKind: "manual"})
	if err != nil {
		f.t.Fatal(err)
	}
	return res.ID
}
