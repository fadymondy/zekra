package presentations

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestOutlineFromBrainUsesOnlyTheMaterial(t *testing.T) {
	g := Gathered{
		Title: "Sentra",
		Items: []Material{
			{Kind: "note", Ref: "n1", Title: "Sentra overview", Text: "Sentra screens supplier risk for GCC buyers."},
			{Kind: "note", Ref: "n2", Title: "PDPL kit", Text: "A compliance kit for the Saudi PDPL.", Group: "spec"},
			{Kind: "note", Ref: "n3", Title: "", Text: ""}, // empty material is dropped
		},
	}
	o, err := OutlineFromBrain(FromBrainRequest{Namespace: "flowos", Source: BrainSource{Kind: "notes", IDs: []string{"n1", "n2"}}}, g)
	if err != nil {
		t.Fatal(err)
	}
	if o.Title != "Sentra" || o.Customer.Company != "flowos" || o.Problem != "Sentra screens supplier risk for GCC buyers." {
		t.Fatalf("outline: %+v", o)
	}
	if len(o.Goals) != 1 || !strings.Contains(o.Goals[0], "PDPL kit: A compliance kit") {
		t.Fatalf("key points: %v", o.Goals)
	}
	docs, err := BuildFromOutline(o, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(docs) != 2 || docs[0].Kind != KindDeck || docs[1].Kind != KindReport {
		t.Fatalf("kinds: %+v", docs)
	}
	raw, _ := json.Marshal(docs)
	s := string(raw)
	// No placeholder workflow, no invented plan/pricing/screens, brain headings.
	for _, bad := range []string{"Step 1", "Step 2", `"workflow"`, "Investment", "What we will build", "The problem", `"screen"`} {
		if strings.Contains(s, bad) {
			t.Errorf("a brain outline contains %q", bad)
		}
	}
	for _, want := range []string{"Summary", "Key points", "Sources", "Sentra overview", "PDPL kit (spec)", "note n1: Sentra overview"} {
		if !strings.Contains(s, want) {
			t.Errorf("missing %q", want)
		}
	}
	// Provenance ids live in the deck's speaker notes, which a share strips.
	pub, _ := json.Marshal(stripNotes(docs[0].Content))
	if strings.Contains(string(pub), "note n1") {
		t.Error("source ids reach the public view")
	}
}

func TestOutlineFromBrainStepsAndArabic(t *testing.T) {
	g := Gathered{
		Title:   "Acme",
		Summary: "Acme (venture): 7 connected entities across repo, person.",
		Items:   []Material{{Kind: "entity", Ref: "e1", Title: "acme-api", Group: "repo"}, {Kind: "entity", Ref: "e2", Title: "Sara", Group: "person"}},
		Steps:   []OutlineStep{{Title: "repo", Owner: "5"}, {Title: "person", Owner: "2"}},
	}
	o, err := OutlineFromBrain(FromBrainRequest{Namespace: "flowos", Locale: "ar", Kinds: []string{KindReport, KindPage},
		Customer: &PresentationCustomer{Name: "Sara"}}, g)
	if err != nil {
		t.Fatal(err)
	}
	docs, err := BuildFromOutline(o, "")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(docs)
	for _, want := range []string{"الملخص", "المصادر", `"workflow"`, "acme-api"} {
		if !strings.Contains(string(raw), want) {
			t.Errorf("missing %q", want)
		}
	}
}

func TestOutlineFromBrainRefusesNothing(t *testing.T) {
	_, err := OutlineFromBrain(FromBrainRequest{Namespace: "x"}, Gathered{Title: "x", Items: []Material{{Kind: "note"}}})
	var bad InvalidError
	if !errors.As(err, &bad) || !strings.Contains(bad.Msg, "nothing") {
		t.Fatalf("empty material: %v", err)
	}
	for _, src := range []BrainSource{{Kind: "notes"}, {Kind: "query"}, {Kind: "query", Q: "x", Limit: 99}, {Kind: "entity"}, {Kind: "files"}} {
		if CheckBrainSource(src) == nil {
			t.Errorf("source %+v accepted", src)
		}
	}
	if CheckBrainSource(BrainSource{Kind: "namespace"}) != nil || CheckBrainSource(BrainSource{Kind: "query", Q: "x"}) != nil {
		t.Error("valid sources refused")
	}
}

func TestExcerpt(t *testing.T) {
	md := "# Title\n\n---\n\n## Why\nThe **first** real `paragraph`\nspans lines.\n\nSecond."
	if got := Excerpt(md, 200); got != "Why The first real paragraph spans lines." {
		t.Fatalf("excerpt: %q", got)
	}
}

func TestSealerCompatibility(t *testing.T) {
	hexKey := "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
	k1, err := DecodeVaultKey(hexKey)
	if err != nil || len(k1) != 32 {
		t.Fatal(err)
	}
	// base64 form of the same key decodes to the same bytes.
	k1b, err := DecodeVaultKey("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=")
	if err != nil || string(k1b) != string(k1) {
		t.Fatalf("base64 key: %v", err)
	}
	old := KeySealer{Keys: [][]byte{k1}}
	sealed, err := old.Seal("tok")
	if err != nil || !strings.HasPrefix(sealed, SealPrefix) {
		t.Fatal(err)
	}
	// A server with a new first key still opens tokens sealed with the old one.
	k2 := make([]byte, 32)
	both := KeySealer{Keys: [][]byte{k2, k1}}
	if got, err := both.Open(sealed); err != nil || got != "tok" {
		t.Fatalf("open with the second key: %q %v", got, err)
	}
	if _, err := (KeySealer{Keys: [][]byte{k2}}).Open(sealed); err == nil {
		t.Fatal("a wrong key opened the token")
	}
	if (KeySealer{}).Configured() {
		t.Fatal("no keys is configured")
	}
	t.Setenv("VAULT_KEY", "")
	t.Setenv("ZEKRA_SECRETS_KEY", "")
	t.Setenv("AUTH_SECRET", "s3cret")
	if !DefaultSealer().Configured() {
		t.Fatal("AUTH_SECRET should derive a key")
	}
}
