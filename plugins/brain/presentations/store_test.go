package presentations

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

/*
FM-342 against a real database: TEST_DATABASE_URL (a throwaway Postgres with
the vchord stack, like the brain harness; the brain schema.sql, which carries
the presentations tables, is applied here). Tokens, expiry, revocation, what a
share link reveals, view counting and translation. Skipped without
TEST_DATABASE_URL.

	TEST_DATABASE_URL='postgres://…/zekra_pres_test?sslmode=disable' go test ./presentations
*/

var (
	testDB     *sql.DB
	testNS     string
	schemaOnce sync.Once
	schemaErr  error
)

// A fixed 32-byte key, so the recoverable-link path is exercised.
const testVaultKey = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"

func setup(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run the database-backed presentations tests")
	}
	schemaOnce.Do(func() {
		if testDB, schemaErr = sql.Open("pgx", dsn); schemaErr != nil {
			return
		}
		ddl, err := os.ReadFile("../internal/brain/schema.sql")
		if err != nil {
			schemaErr = err
			return
		}
		_, schemaErr = testDB.Exec(string(ddl))
	})
	if schemaErr != nil {
		t.Fatalf("apply the brain schema: %v", schemaErr)
	}
	t.Setenv("PRESENTATIONS_SHARE_BASE", "https://site.test")
	t.Setenv("VAULT_KEY", testVaultKey)
	t.Setenv("ZEKRA_SECRETS_KEY", "")
	t.Setenv("AUTH_SECRET", "")
	testNS = "ptest-" + strings.ToLower(newID()[:8])
	t.Cleanup(func() { _, _ = testDB.Exec(`DELETE FROM presentations WHERE namespace = $1`, testNS) })
	return &Store{DB: func(context.Context) (*sql.DB, error) { return testDB, nil }}
}

func customer() *PresentationCustomer {
	return &PresentationCustomer{Name: "Sara", Company: "Acme", Email: "sara@acme.test"}
}

func create(t *testing.T, s *Store, kind string) *Presentation {
	t.Helper()
	p, err := s.Create(context.Background(), PresentationInput{Namespace: testNS, Kind: kind, Customer: customer(), Locale: "en", Content: fixture(t, kind)}, "owner")
	if err != nil {
		t.Fatalf("create %s: %v", kind, err)
	}
	return p
}

func TestCreateUpdateList(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	deck := create(t, s, KindDeck)
	if deck.Title != "Modernising Acme's order platform" || deck.Status != "draft" || deck.Style != "" {
		t.Fatalf("deck: %+v", deck)
	}
	page := create(t, s, KindPage)
	if page.Style != "minimal" {
		t.Fatalf("page default style: %q", page.Style)
	}

	// Input errors are specific.
	for name, in := range map[string]PresentationInput{
		"no customer": {Namespace: testNS, Kind: KindDeck, Content: fixture(t, KindDeck)},
		"bad kind":    {Namespace: testNS, Kind: "memo", Customer: customer(), Content: fixture(t, KindDeck)},
		"bad locale":  {Namespace: testNS, Kind: KindDeck, Customer: customer(), Locale: "fr", Content: fixture(t, KindDeck)},
		"deck style":  {Namespace: testNS, Kind: KindDeck, Customer: customer(), Style: "bold", Content: fixture(t, KindDeck)},
		"bad style":   {Namespace: testNS, Kind: KindPage, Customer: customer(), Style: "neon", Content: fixture(t, KindPage)},
		"bad email":   {Namespace: testNS, Kind: KindDeck, Customer: &PresentationCustomer{Name: "x", Email: "nope"}, Content: fixture(t, KindDeck)},
		"no content":  {Namespace: testNS, Kind: KindDeck, Customer: customer()},
	} {
		if _, err := s.Create(ctx, in, "owner"); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}

	// Embeds must be page previews that exist.
	withEmbed := func(id string) map[string]any {
		return mutate(t, KindDeck, func(m map[string]any) {
			m["slides"] = append(m["slides"].([]any), map[string]any{"type": "embed", "document_id": id})
		})
	}
	if _, err := s.Create(ctx, PresentationInput{Namespace: testNS, Kind: KindDeck, Customer: customer(), Content: withEmbed(deck.ID)}, ""); err == nil ||
		!strings.Contains(err.Error(), "only page previews") {
		t.Errorf("embedding a deck: %v", err)
	}
	if _, err := s.Create(ctx, PresentationInput{Namespace: testNS, Kind: KindDeck, Customer: customer(), Content: withEmbed("missing")}, ""); err == nil {
		t.Error("embedding a missing document was accepted")
	}
	updated, err := s.Update(ctx, deck.ID, PresentationInput{Content: withEmbed(page.ID), Status: "ready"})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != "ready" || len(updated.Content["en"]["slides"].([]any)) != 8 {
		t.Fatalf("update: %+v", updated)
	}
	if _, err := s.Update(ctx, deck.ID, PresentationInput{Namespace: testNS, Kind: KindReport}); err == nil {
		t.Error("kind change accepted")
	}
	if _, err := s.Update(ctx, deck.ID, PresentationInput{Locale: "ar"}); err == nil {
		t.Error("switching to a locale with no content accepted")
	}
	// Content in the other locale is stored beside, not over.
	ar := mutate(t, KindDeck, func(m map[string]any) { m["title"] = "تحديث منصة الطلبات" })
	both, err := s.Update(ctx, deck.ID, PresentationInput{Locale: "ar", Content: ar})
	if err != nil {
		t.Fatal(err)
	}
	if len(both.Locales) != 2 || both.Title != "Modernising Acme's order platform" {
		t.Fatalf("locales %v title %q", both.Locales, both.Title)
	}

	create(t, s, KindReport)
	all, err := s.List(ctx, PresentationFilter{Namespaces: []string{testNS}})
	if err != nil || len(all) != 3 {
		t.Fatalf("list: %d %v", len(all), err)
	}
	for _, c := range []struct {
		f    PresentationFilter
		want int
	}{
		{PresentationFilter{Kind: KindPage}, 1},
		{PresentationFilter{Status: "ready"}, 1},
		{PresentationFilter{Customer: "acme"}, 3},
		{PresentationFilter{Customer: "globex"}, 0},
		{PresentationFilter{Query: "audit"}, 1},
		{PresentationFilter{Query: "100%_"}, 0},
		{PresentationFilter{Query: deck.ID}, 1},
		// Tenancy: another brain sees nothing; no scope at all is nothing.
		{PresentationFilter{Namespaces: []string{testNS + "-other"}}, 0},
		{PresentationFilter{Namespaces: []string{}}, 0},
	} {
		f := c.f
		if f.Namespaces == nil {
			f.Namespaces = []string{testNS}
		}
		got, err := s.List(ctx, f)
		if err != nil || len(got) != c.want {
			t.Errorf("filter %+v: %d, want %d (%v)", f, len(got), c.want, err)
		}
	}
	if _, err := s.List(ctx, PresentationFilter{Namespaces: []string{testNS}, Kind: "x"}); err == nil {
		t.Error("bad kind filter accepted")
	}
	if err := s.Delete(ctx, page.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(ctx, page.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete: %v", err)
	}
}

func TestShareLinks(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	page := create(t, s, KindPage)
	deck, err := s.Create(ctx, PresentationInput{Namespace: testNS, Kind: KindDeck, Customer: customer(), Content: mutate(t, KindDeck, func(m map[string]any) {
		m["slides"] = append(m["slides"].([]any), map[string]any{"type": "embed", "document_id": page.ID})
	})}, "owner")
	if err != nil {
		t.Fatal(err)
	}
	other := create(t, s, KindReport)

	if _, err := s.CreateShare(ctx, deck.ID, PresentationShareInput{Locale: "ar"}, ""); err == nil {
		t.Error("shared a locale with no content")
	}
	if _, err := s.CreateShare(ctx, deck.ID, PresentationShareInput{ExpiresInDays: -1}, ""); err == nil {
		t.Error("negative expiry accepted")
	}
	created, err := s.CreateShare(ctx, deck.ID, PresentationShareInput{Label: "Sara"}, "owner")
	if err != nil {
		t.Fatal(err)
	}
	token := created.Token

	// Token: 32 random bytes, stored only as its hash (and sealed).
	if len(token) != 43 || !validTokenShape(token) {
		t.Fatalf("token shape: %q", token)
	}
	if created.URL != "https://site.test/en/p/"+token {
		t.Fatalf("url: %s", created.URL)
	}
	var hash, sealed string
	if err := testDB.QueryRow(`SELECT token_hash, token_sealed FROM presentation_shares WHERE id=$1`, created.Share.ID).Scan(&hash, &sealed); err != nil {
		t.Fatal(err)
	}
	if hash != HashToken(token) || len(hash) != 64 || strings.Contains(hash, token) {
		t.Fatalf("stored hash %q", hash)
	}
	var plain int
	_ = testDB.QueryRow(`SELECT COUNT(*) FROM presentation_shares WHERE position($1 in token_hash||token_sealed||token_hint||label) > 0`, token).Scan(&plain)
	if plain != 0 {
		t.Fatal("the token is stored in plain text")
	}
	if HashToken(token) == HashToken(token+"x") {
		t.Fatal("hash collision")
	}
	second, _ := s.CreateShare(ctx, deck.ID, PresentationShareInput{}, "")
	if second.Token == token {
		t.Fatal("two links got the same token")
	}
	if created.Recoverable {
		shares, _ := s.ListShares(ctx, deck.ID)
		if shares[1].URL != created.URL {
			t.Fatalf("the sealed token did not reopen: %q", shares[1].URL)
		}
	}

	// The public view: read-only, no notes, no email, only its own embeds.
	pub, err := s.OpenShared(ctx, token, "", EventView)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(pub)
	for _, leak := range []string{"notes", "outage from March", "sara@acme.test", other.ID, "Platform audit", deck.ID, "created_by", "token"} {
		if strings.Contains(string(raw), leak) {
			t.Errorf("the public view leaks %q", leak)
		}
	}
	if pub.Kind != KindDeck || pub.Customer != "Sara" || pub.Company != "Acme" || len(pub.Formats) != 1 || pub.ExpiresAt != nil {
		t.Fatalf("public view: %+v", pub)
	}
	if emb, ok := pub.Embeds[page.ID]; !ok || emb.Style != "minimal" || emb.Content["title"] == nil {
		t.Fatalf("embed not resolved: %+v", pub.Embeds)
	}
	_, _ = s.OpenShared(ctx, token, "ar", EventDownload) // no ar: falls back to en
	_, _ = s.OpenShared(ctx, token, "", "")              // records nothing
	d, _ := s.Get(ctx, deck.ID)
	if d.ViewCount != 1 || d.DownloadCount != 1 || d.LastViewedAt == nil || d.ActiveShares != 2 {
		t.Fatalf("counts: views %d downloads %d last %v active %d", d.ViewCount, d.DownloadCount, d.LastViewedAt, d.ActiveShares)
	}

	// Unknown, malformed, other documents' ids: all the same answer.
	for _, bad := range []string{"", "x", token[:42], token + "A", strings.Repeat("A", 43), deck.ID, HashToken(token), "../" + token[3:]} {
		if _, err := s.OpenShared(ctx, bad, "", EventView); !errors.Is(err, ErrLinkUnavailable) {
			t.Errorf("token %q: %v", bad, err)
		}
	}

	// Revocation.
	if err := s.RevokeShare(ctx, deck.ID, created.Share.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.RevokeShare(ctx, other.ID, second.Share.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked another document's link: %v", err)
	}
	if _, err := s.OpenShared(ctx, token, "", EventView); !errors.Is(err, ErrLinkUnavailable) {
		t.Fatalf("revoked link still opens: %v", err)
	}
	if _, err := s.OpenShared(ctx, second.Token, "", ""); err != nil {
		t.Fatalf("revoking one link closed another: %v", err)
	}
	shares, _ := s.ListShares(ctx, deck.ID)
	for _, s := range shares {
		if s.ID == created.Share.ID && (s.Active || s.RevokedAt == nil || s.URL != "") {
			t.Fatalf("revoked share: %+v", s)
		}
	}

	// Expiry.
	third, _ := s.CreateShare(ctx, deck.ID, PresentationShareInput{ExpiresInDays: 7}, "")
	if third.Share.ExpiresAt == nil {
		t.Fatal("expiry not reported")
	}
	if _, err := s.OpenShared(ctx, third.Token, "", ""); err != nil {
		t.Fatal(err)
	}
	_, _ = testDB.Exec(`UPDATE presentation_shares SET expires_at = now() - interval '1 second' WHERE id=$1`, third.Share.ID)
	if _, err := s.OpenShared(ctx, third.Token, "", ""); !errors.Is(err, ErrLinkUnavailable) {
		t.Fatalf("expired link opens: %v", err)
	}

	// Archiving closes every link; deleting removes them.
	_, _ = s.Update(ctx, deck.ID, PresentationInput{Status: "archived"})
	if _, err := s.OpenShared(ctx, second.Token, "", ""); !errors.Is(err, ErrLinkUnavailable) {
		t.Fatalf("archived document opens: %v", err)
	}
	_, _ = s.Update(ctx, deck.ID, PresentationInput{Status: "ready"})
	n, err := s.RevokeAll(ctx, deck.ID)
	if err != nil || n != 2 { // second, and third (expired, not revoked)
		t.Fatalf("revoke all: %d %v", n, err)
	}
	_ = s.Delete(ctx, deck.ID)
	var left int
	_ = testDB.QueryRow(`SELECT COUNT(*) FROM presentation_shares WHERE presentation_id=$1`, deck.ID).Scan(&left)
	if left != 0 {
		t.Fatal("links survived their document")
	}
}

func TestTranslate(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	page := create(t, s, KindPage)
	// No model configured: the MCP fallback is named.
	if _, err := s.Translate(ctx, page.ID, ""); !errors.Is(err, ErrNoTranslator) {
		t.Fatalf("no provider: %v", err)
	}

	fake := &fakeTranslator{}
	s.Translator = fake
	stored := page.Content["en"]
	clone := func(f func(m map[string]any)) map[string]any {
		b, _ := json.Marshal(stored)
		var m map[string]any
		_ = json.Unmarshal(b, &m)
		f(m)
		return m
	}
	good := clone(func(m map[string]any) {
		m["title"] = "أكمي تراك"
		item(m, "sections", 0)["heading"] = "كل طرد، مباشرة."
	})
	goodJSON, _ := json.Marshal(good)
	broken := clone(func(m map[string]any) { item(m, "sections", 0)["cta_href"] = "https://evil.test" })
	brokenJSON, _ := json.Marshal(broken)
	fake.replies = []string{"not json", string(brokenJSON), "```json\n" + string(goodJSON) + "\n```"}

	if _, err := s.Translate(ctx, page.ID, ""); err == nil || !strings.Contains(err.Error(), "not JSON") {
		t.Fatalf("prose answer: %v", err)
	}
	if _, err := s.Translate(ctx, page.ID, ""); err == nil || !strings.Contains(err.Error(), "must not change") {
		t.Fatalf("changed href: %v", err)
	}
	p, _ := s.Get(ctx, page.ID)
	if len(p.Locales) != 1 {
		t.Fatal("a rejected translation was stored")
	}
	out, err := s.Translate(ctx, page.ID, "ar")
	if err != nil {
		t.Fatal(err)
	}
	if out.Content["ar"]["title"] != "أكمي تراك" || out.Translations["ar"] == nil || out.Locale != "en" {
		t.Fatalf("translated: %+v", out.Translations)
	}
	// Editing the Arabic by hand clears the machine-translation mark.
	edited, err := s.Update(ctx, page.ID, PresentationInput{Locale: "ar", Content: good})
	if err != nil || edited.Translations["ar"] != nil {
		t.Fatalf("hand edit: %v %v", err, edited.Translations)
	}
}

// fakeTranslator answers its replies in order, one per call.
type fakeTranslator struct {
	replies []string
	calls   int
}

func (f *fakeTranslator) Generate(_ context.Context, system, user string) (string, string, string, error) {
	if f.calls >= len(f.replies) {
		return "", "", "", errors.New("no more replies")
	}
	f.calls++
	return f.replies[f.calls-1], "fake", "fake-1", nil
}
