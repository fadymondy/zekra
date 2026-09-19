package presentations

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

/*
The fadymondy.com import against a scratch copy of the SOURCE schema
(testdata/fadymondy_presentations.postgres.sql, verbatim) in its own Postgres
schema: rows come across with their ids, share hashes, sealed tokens, hints
and counters, an imported token opens on the new host, and a re-run changes
nothing. The source is only read (a READ ONLY transaction).
*/

func sourceDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	schema := "fmsrc_" + strings.ToLower(newID()[:6])
	if _, err := testDB.Exec(`CREATE SCHEMA ` + schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = testDB.Exec(`DROP SCHEMA ` + schema + ` CASCADE`) })
	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	src, err := sql.Open("pgx", dsn+sep+"search_path="+schema)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = src.Close() })
	ddl, err := os.ReadFile("testdata/fadymondy_presentations.postgres.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := src.Exec(string(ddl)); err != nil {
		t.Fatalf("source ddl: %v", err)
	}
	return src
}

func TestImportFromFadymondy(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	src := sourceDB(t)

	// A document and three links on the source, sealed with fadymondy.com's key.
	fmKey, _ := DecodeVaultKey(testVaultKey)
	fmSealer := KeySealer{Keys: [][]byte{fmKey}}
	docID := "fm" + newID()
	content, _ := json.Marshal(fixture(t, KindDeck))
	if _, err := src.Exec(`INSERT INTO presentations (id, kind, title, customer_name, customer_company, customer_email,
		locale, status, content, translations, view_count, download_count, last_viewed_at, created_by, created_at, updated_at)
		VALUES ($1,'deck','Modernising Acme','Sara','Acme','sara@acme.test','en','ready',$2::jsonb,'{}'::jsonb,7,2,
		'2026-05-01T10:00:00Z','mcp','2026-04-01T09:00:00Z','2026-04-02T09:00:00Z')`, docID, string(content)); err != nil {
		t.Fatal(err)
	}
	live, _ := NewToken()
	sealed, _ := fmSealer.Seal(live)
	revoked, _ := NewToken()
	expired, _ := NewToken()
	for _, r := range []struct {
		id, token, sealed, expires, revokedAt string
		views                                 int
	}{
		{"s-live", live, sealed, "infinity", "epoch", 5},
		{"s-revoked", revoked, "", "infinity", "2026-05-02T00:00:00Z", 1},
		{"s-expired", expired, "", "2026-01-01T00:00:00Z", "epoch", 0},
	} {
		if _, err := src.Exec(`INSERT INTO presentation_shares (id, presentation_id, token_hash, token_sealed, token_hint,
			label, locale, expires_at, revoked_at, view_count, download_count, created_by)
			VALUES ($1,$2,$3,$4,$5,'Sara','en',$6::timestamptz,$7::timestamptz,$8,1,'mcp')`,
			docID+r.id, docID, HashToken(r.token), r.sealed, r.token[:4], r.expires, r.revokedAt, r.views); err != nil {
			t.Fatal(err)
		}
	}

	exp, err := ReadSource(ctx, src)
	if err != nil {
		t.Fatal(err)
	}
	if len(exp.Presentations) != 1 || len(exp.Shares) != 3 {
		t.Fatalf("read: %d docs %d shares", len(exp.Presentations), len(exp.Shares))
	}

	// Dry run: counted, nothing stored.
	res, err := s.Import(ctx, exp, testNS, "", true)
	if err != nil || res.Presentations != 1 || res.Shares != 3 {
		t.Fatalf("dry run: %+v %v", res, err)
	}
	if _, err := s.Get(ctx, docID); err != ErrNotFound {
		t.Fatalf("a dry run stored the document: %v", err)
	}

	// Through the JSON format, as a file export would be.
	raw, _ := json.Marshal(exp)
	parsed, err := ParseExport(raw)
	if err != nil {
		t.Fatal(err)
	}
	res, err = s.Import(ctx, parsed, testNS, "u-fady", false)
	if err != nil || res.Presentations != 1 || res.Shares != 3 || res.Recoverable != 1 {
		t.Fatalf("import: %+v %v", res, err)
	}

	doc, err := s.Get(ctx, docID)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Namespace != testNS || doc.OwnerUserID != "u-fady" || doc.CreatedBy != "mcp" || doc.Status != "ready" ||
		doc.ViewCount != 7 || doc.DownloadCount != 2 || doc.LastViewedAt == nil || doc.CreatedAt.Year() != 2026 ||
		doc.ActiveShares != 1 || doc.Title != "Modernising Acme" {
		t.Fatalf("imported doc: %+v", doc)
	}
	var hash, gotSealed, hint string
	var views int
	if err := testDB.QueryRow(`SELECT token_hash, token_sealed, token_hint, view_count FROM presentation_shares WHERE id=$1`,
		docID+"s-live").Scan(&hash, &gotSealed, &hint, &views); err != nil {
		t.Fatal(err)
	}
	if hash != HashToken(live) || gotSealed != sealed || hint != live[:4] || views != 5 {
		t.Fatalf("share row changed: %s %s %s %d", hash, gotSealed, hint, views)
	}

	// The same token opens on the new host; revoked/expired stay closed.
	if pub, err := s.OpenShared(ctx, live, "", ""); err != nil || pub.Title == "" {
		t.Fatalf("imported link: %v", err)
	}
	for _, tok := range []string{revoked, expired} {
		if _, err := s.OpenShared(ctx, tok, "", ""); err != ErrLinkUnavailable {
			t.Errorf("a closed imported link opens: %v", err)
		}
	}
	// With fadymondy.com's key configured (setup sets it), the owner can copy
	// the link again, on the Zekra host.
	shares, _ := s.ListShares(ctx, docID)
	var url string
	for _, sh := range shares {
		if sh.ID == docID+"s-live" {
			url = sh.URL
		}
	}
	if url != "https://site.test/en/p/"+live {
		t.Fatalf("recovered url: %q", url)
	}

	// Re-running is a no-op.
	res, err = s.Import(ctx, exp, testNS, "u-fady", false)
	if err != nil || res.Presentations != 0 || res.PresentationsSkipped != 1 || res.Shares != 0 || res.SharesSkipped != 3 {
		t.Fatalf("re-run: %+v %v", res, err)
	}
	// The source was only read.
	var n int
	_ = src.QueryRow(`SELECT view_count FROM presentations WHERE id=$1`, docID).Scan(&n)
	if n != 7 {
		t.Fatal("the source changed")
	}
}
