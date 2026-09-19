package brain

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
)

/*
Presentations through the brain's HTTP surface: tenancy (a non-member cannot
read or list, a viewer cannot write or share), share tokens hashed at rest, the
unauthenticated public view, expiry and revocation, same-brain embeds, CSRF,
ACL tokens, the from-brain gathering, and the MCP tool registry.
*/

func presFixture(t *testing.T, kind string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile("../../presentations/testdata/" + kind + ".json")
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func presSetup(t *testing.T) (*fix, string) {
	f := newFix(t)
	t.Setenv("PRESENTATIONS_SHARE_BASE", "https://app.zekra.test")
	t.Setenv("VAULT_KEY", "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
	ns := f.ns("pres")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner'), ($1,'u-carol','viewer')`, ns)
	t.Cleanup(func() { f.exec(`DELETE FROM presentations WHERE namespace LIKE $1`, f.prefix+"%") })
	return f, ns
}

func (f *fix) createPres(user, ns, kind string, content map[string]any) (int, map[string]any) {
	f.t.Helper()
	rec := f.do(req{method: "POST", path: "/api/presentations", user: user, body: map[string]any{
		"namespace": ns, "kind": kind, "customer": map[string]any{"name": "Sara", "company": "Acme", "email": "sara@acme.test"},
		"content": content}})
	return rec.Code, decodeMap(f.t, rec)
}

func TestPresentationsTenancy(t *testing.T) {
	f, ns := presSetup(t)
	code, deck := f.createPres("u-alice", ns, "deck", presFixture(t, "deck"))
	if code != 201 || deck["namespace"] != ns || deck["owner_user_id"] != "u-alice" || deck["status"] != "draft" {
		t.Fatalf("create: %d %v", code, deck)
	}
	id := deck["id"].(string)

	// Non-member: not found / not listed / refused; viewer reads but never writes.
	for _, c := range []struct {
		user   string
		method string
		path   string
		body   any
		want   int
	}{
		{"u-bob", "GET", "/api/presentations/" + id, nil, 404},
		{"u-bob", "GET", "/api/presentations?namespace=" + ns, nil, 403},
		{"u-bob", "PATCH", "/api/presentations/" + id, map[string]any{"status": "ready"}, 404},
		{"u-bob", "POST", "/api/presentations/" + id + "/share", map[string]any{}, 404},
		{"", "GET", "/api/presentations/" + id, nil, 404},
		{"u-carol", "GET", "/api/presentations/" + id, nil, 200},
		{"u-carol", "GET", "/api/presentations?namespace=" + ns, nil, 200},
		{"u-carol", "PATCH", "/api/presentations/" + id, map[string]any{"status": "ready"}, 403},
		{"u-carol", "POST", "/api/presentations/" + id + "/share", map[string]any{}, 403},
		{"u-carol", "POST", "/api/presentations/" + id + "/translate", map[string]any{"content": map[string]any{}}, 403},
		{"u-carol", "DELETE", "/api/presentations/" + id, nil, 403},
		{"u-admin", "GET", "/api/presentations/" + id, nil, 200},
	} {
		if rec := f.do(req{method: c.method, path: c.path, body: c.body, user: c.user}); rec.Code != c.want {
			t.Errorf("%s %s as %q: %d, want %d (%s)", c.method, c.path, c.user, rec.Code, c.want, trim(rec.Body.String()))
		}
	}
	if code, _ := f.createPres("u-carol", ns, "deck", presFixture(t, "deck")); code != 403 {
		t.Errorf("viewer created: %d", code)
	}
	if code, _ := f.createPres("u-bob", ns, "deck", presFixture(t, "deck")); code != 403 {
		t.Errorf("non-member created: %d", code)
	}

	// The unscoped list only holds what the caller can read.
	listIDs := func(user string) string {
		rec := f.do(req{method: "GET", path: "/api/presentations", user: user})
		return rec.Body.String()
	}
	if strings.Contains(listIDs("u-bob"), id) {
		t.Error("a non-member lists the document")
	}
	if !strings.Contains(listIDs("u-carol"), id) || !strings.Contains(listIDs("u-alice"), id) {
		t.Error("members do not list the document")
	}

	// An ACL token: a read grant reads, never writes.
	agent := f.ns("agent")
	tok, _ := f.svc.Store.CreateToken(context.Background(), agent, "pres", false)
	_, _ = f.svc.Store.Share(context.Background(), ns, agent, true, false)
	if rec := f.do(req{method: "GET", path: "/api/presentations/" + id, token: tok.Token}); rec.Code != 200 {
		t.Errorf("read token get: %d", rec.Code)
	}
	if rec := f.do(req{method: "POST", path: "/api/presentations/" + id + "/share", token: tok.Token, body: map[string]any{}}); rec.Code != 403 {
		t.Errorf("read token shared: %d", rec.Code)
	}

	// Embeds stay inside the brain: a page in another brain cannot be embedded.
	other := f.ns("pres2")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner')`, other)
	_, page := f.createPres("u-alice", other, "page", presFixture(t, "page"))
	withEmbed := presFixture(t, "deck")
	withEmbed["slides"] = append(withEmbed["slides"].([]any), map[string]any{"type": "embed", "document_id": page["id"]})
	if code, body := f.createPres("u-alice", ns, "deck", withEmbed); code != 422 || !strings.Contains(toJSON(body), "embed.document_id") {
		t.Errorf("cross-brain embed: %d %v", code, body)
	}

	// CSRF: a cookie-session form post without the double-submit token is refused.
	rec := f.do(req{method: "POST", path: "/api/presentations", user: "u-alice", body: "namespace=" + ns,
		headers: map[string]string{"Content-Type": "application/x-www-form-urlencoded"}})
	if rec.Code != 403 {
		t.Errorf("form post without csrf: %d", rec.Code)
	}
}

func toJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func TestPresentationShareLinks(t *testing.T) {
	f, ns := presSetup(t)
	_, deck := f.createPres("u-alice", ns, "deck", presFixture(t, "deck"))
	id := deck["id"].(string)
	rec := f.do(req{method: "POST", path: "/api/presentations/" + id + "/share", user: "u-alice", body: map[string]any{"label": "Sara"}})
	if rec.Code != 201 {
		t.Fatalf("share: %d %s", rec.Code, rec.Body.String())
	}
	sh := decodeMap(t, rec)
	token := sh["token"].(string)
	shareID := sh["share"].(map[string]any)["id"].(string)
	if sh["url"] != "https://app.zekra.test/en/p/"+token || sh["recoverable"] != true {
		t.Fatalf("share: %v", sh)
	}
	if dl := sh["downloads"].(map[string]any); dl["pdf"] != "https://app.zekra.test/en/p/"+token+"/download/pdf" {
		t.Fatalf("downloads: %v", dl)
	}

	// Hashed at rest: sha256 hex, the token itself nowhere in plain text.
	sum := sha256.Sum256([]byte(token))
	if n := f.count(`SELECT COUNT(*) FROM presentation_shares WHERE id=$1 AND token_hash=$2 AND token_sealed LIKE 'vault:v1:%' AND token_hint=$3`,
		shareID, hex.EncodeToString(sum[:]), token[:4]); n != 1 {
		t.Fatal("the share row is not hashed + sealed")
	}
	if n := f.count(`SELECT COUNT(*) FROM presentation_shares WHERE position($1 in token_hash||token_sealed||label) > 0`, token); n != 0 {
		t.Fatal("the token is stored in plain text")
	}
	// The owner can copy the link again (sealed with VAULT_KEY).
	det := decodeMap(t, f.do(req{method: "GET", path: "/api/presentations/" + id, user: "u-alice"}))
	if shares := det["shares"].([]any); len(shares) != 1 || shares[0].(map[string]any)["url"] != sh["url"] {
		t.Fatalf("detail shares: %v", det["shares"])
	}

	// The public view: no auth, only this document, no notes or email.
	pub := f.do(req{method: "GET", path: "/api/p/" + token + "?event=view", headers: map[string]string{"X-Forwarded-For": "10.1.0.1"}})
	if pub.Code != 200 || pub.Header().Get("Cache-Control") != "no-store" || pub.Header().Get("X-Robots-Tag") != "noindex, nofollow" {
		t.Fatalf("public: %d %v", pub.Code, pub.Header())
	}
	for _, leak := range []string{`"notes"`, "sara@acme.test", ns, id, "owner_user_id", "u-alice", token} {
		if strings.Contains(pub.Body.String(), leak) {
			t.Errorf("the public view leaks %q", leak)
		}
	}
	if !strings.Contains(pub.Body.String(), `"locale":"en"`) {
		t.Errorf("public view locale: %s", trim(pub.Body.String()))
	}
	if rec := f.do(req{method: "GET", path: "/api/p/" + token + "?event=delete", headers: map[string]string{"X-Forwarded-For": "10.1.0.1"}}); rec.Code != 422 {
		t.Errorf("bad event: %d", rec.Code)
	}
	if n := f.count(`SELECT view_count FROM presentation_shares WHERE id=$1`, shareID); n != 1 {
		t.Errorf("views counted: %d", n)
	}
	for _, bad := range []string{"nope", strings.Repeat("A", 43), hex.EncodeToString(sum[:])} {
		if rec := f.do(req{method: "GET", path: "/api/p/" + bad, headers: map[string]string{"X-Forwarded-For": "10.1.0.2"}}); rec.Code != 404 {
			t.Errorf("token %q: %d", bad, rec.Code)
		}
	}

	// Expiry.
	rec = f.do(req{method: "POST", path: "/api/presentations/" + id + "/share", user: "u-alice", body: map[string]any{"expires_in_days": 3}})
	exp := decodeMap(t, rec)
	expTok := exp["token"].(string)
	f.exec(`UPDATE presentation_shares SET expires_at = now() - interval '1 second' WHERE id=$1`, exp["share"].(map[string]any)["id"])
	if rec := f.do(req{method: "GET", path: "/api/p/" + expTok, headers: map[string]string{"X-Forwarded-For": "10.1.0.3"}}); rec.Code != 404 {
		t.Errorf("expired link: %d", rec.Code)
	}

	// Revocation (owner/editor only), then the link is gone like an unknown one.
	if rec := f.do(req{method: "DELETE", path: "/api/presentations/" + id + "/shares/" + shareID, user: "u-carol"}); rec.Code != 403 {
		t.Errorf("viewer revoked: %d", rec.Code)
	}
	if rec := f.do(req{method: "DELETE", path: "/api/presentations/" + id + "/shares/" + shareID, user: "u-alice"}); rec.Code != 200 {
		t.Fatalf("revoke: %d %s", rec.Code, rec.Body.String())
	}
	if rec := f.do(req{method: "GET", path: "/api/p/" + token, headers: map[string]string{"X-Forwarded-For": "10.1.0.4"}}); rec.Code != 404 {
		t.Errorf("revoked link: %d", rec.Code)
	}
	if n := f.count(`SELECT COUNT(*) FROM presentation_shares WHERE id=$1 AND token_sealed=''`, shareID); n != 1 {
		t.Error("a revoked link keeps its sealed token")
	}

	// Export returns web URLs through a live link (a new 7-day one here).
	rec = f.do(req{method: "POST", path: "/api/presentations/" + id + "/export", user: "u-alice", body: map[string]any{}})
	ex := decodeMap(t, rec)
	if rec.Code != 200 || ex["created_link"] != true || !strings.HasPrefix(ex["customer_downloads"].(map[string]any)["pdf"].(string), "https://app.zekra.test/en/p/") {
		t.Fatalf("export: %d %v", rec.Code, ex)
	}
}

func TestPresentationPublicEmbed(t *testing.T) {
	f, ns := presSetup(t)
	_, page := f.createPres("u-alice", ns, "page", presFixture(t, "page"))
	_, stranger := f.createPres("u-alice", ns, "page", presFixture(t, "page"))
	d := presFixture(t, "deck")
	d["slides"] = append(d["slides"].([]any), map[string]any{"type": "embed", "document_id": page["id"]})
	code, deck := f.createPres("u-alice", ns, "deck", d)
	if code != 201 {
		t.Fatalf("deck: %d %v", code, deck)
	}
	sh := decodeMap(t, f.do(req{method: "POST", path: "/api/presentations/" + deck["id"].(string) + "/share", user: "u-alice", body: map[string]any{}}))
	tok := sh["token"].(string)
	if rec := f.do(req{method: "GET", path: "/api/p/" + tok + "/embed/" + page["id"].(string), headers: map[string]string{"X-Forwarded-For": "10.2.0.1"}}); rec.Code != 200 {
		t.Fatalf("embed: %d", rec.Code)
	}
	if rec := f.do(req{method: "GET", path: "/api/p/" + tok + "/embed/" + stranger["id"].(string), headers: map[string]string{"X-Forwarded-For": "10.2.0.1"}}); rec.Code != 404 {
		t.Fatalf("stranger embed: %d", rec.Code)
	}
}

func TestPresentationFromBrain(t *testing.T) {
	f, ns := presSetup(t)
	ctx := context.Background()
	author := NoteAuthor{UserID: "u-alice", Source: "web"}
	n1, err := f.svc.Store.CreateNote(ctx, NoteInput{Namespace: ns, Title: "Sentra overview",
		Body: "# Sentra\n\nSentra screens supplier risk for GCC buyers.\n\nMore detail."}, author)
	if err != nil {
		t.Fatal(err)
	}
	n2, _ := f.svc.Store.CreateNote(ctx, NoteInput{Namespace: ns, Title: "PDPL kit", Body: "A compliance kit for the Saudi PDPL.", Category: "spec"}, author)
	other := f.ns("elsewhere")
	foreign, _ := f.svc.Store.CreateNote(ctx, NoteInput{Namespace: other, Title: "Secret plan", Body: "Not for this brain."}, author)

	rec := f.do(req{method: "POST", path: "/api/presentations/from-brain", user: "u-alice", body: map[string]any{
		"namespace": ns, "title": "Sentra brief",
		"source": map[string]any{"kind": "notes", "ids": []string{n1.ID, n2.ID, foreign.ID}}}})
	if rec.Code != 201 {
		t.Fatalf("from-brain: %d %s", rec.Code, rec.Body.String())
	}
	out := decodeMap(t, rec)
	docs := out["documents"].([]any)
	if len(docs) != 2 || out["status"] != "draft" {
		t.Fatalf("documents: %v", out)
	}
	var reportID string
	for _, d := range docs {
		m := d.(map[string]any)
		if m["status"] != "draft" {
			t.Errorf("not a draft: %v", m)
		}
		if m["kind"] == "report" {
			reportID = m["id"].(string)
		}
	}
	body := f.do(req{method: "GET", path: "/api/presentations/" + reportID, user: "u-alice"}).Body.String()
	for _, want := range []string{"Sentra screens supplier risk for GCC buyers.", "PDPL kit", "Sources", `"namespace":"` + ns + `"`} {
		if !strings.Contains(body, want) {
			t.Errorf("report misses %q", want)
		}
	}
	if strings.Contains(body, "Secret plan") || strings.Contains(body, "Not for this brain") {
		t.Error("a note from another brain was used")
	}

	// Only foreign / unknown material: nothing is invented, nothing is created.
	rec = f.do(req{method: "POST", path: "/api/presentations/from-brain", user: "u-alice", body: map[string]any{
		"namespace": ns, "source": map[string]any{"kind": "notes", "ids": []string{foreign.ID}}}})
	if rec.Code != 422 || !strings.Contains(rec.Body.String(), "nothing") {
		t.Errorf("foreign-only: %d %s", rec.Code, rec.Body.String())
	}
	// The whole brain: top notes by category, with the exact counts.
	rec = f.do(req{method: "POST", path: "/api/presentations/from-brain", user: "u-alice", body: map[string]any{
		"namespace": ns, "kinds": []string{"report"}, "source": map[string]any{"kind": "namespace"}}})
	if rec.Code != 201 {
		t.Fatalf("namespace source: %d %s", rec.Code, rec.Body.String())
	}
	// Writers only; bad sources are refused before any gathering.
	for _, c := range []struct {
		user string
		body map[string]any
		want int
	}{
		{"u-carol", map[string]any{"namespace": ns, "source": map[string]any{"kind": "namespace"}}, 403},
		{"u-bob", map[string]any{"namespace": ns, "source": map[string]any{"kind": "namespace"}}, 403},
		{"u-alice", map[string]any{"namespace": ns, "source": map[string]any{"kind": "files"}}, 422},
		{"u-alice", map[string]any{"namespace": ns, "source": map[string]any{"kind": "entity", "id": "no-such-entity"}}, 422},
	} {
		if rec := f.do(req{method: "POST", path: "/api/presentations/from-brain", user: c.user, body: c.body}); rec.Code != c.want {
			t.Errorf("%s %v: %d, want %d (%s)", c.user, c.body, rec.Code, c.want, trim(rec.Body.String()))
		}
	}
}

func TestPresentationToolsListed(t *testing.T) {
	f, _ := presSetup(t)
	rec := f.do(req{method: "GET", path: "/api/mcp/tools"})
	if rec.Code != http.StatusOK {
		t.Fatalf("catalog: %d", rec.Code)
	}
	for _, name := range []string{"page_styles", "presentation_create", "presentation_create_from_outline", "presentation_get",
		"presentation_list", "presentation_update", "presentation_translate", "presentation_validate", "presentation_templates",
		"presentation_export", "presentation_share", "presentation_unshare", "presentation_domains", "presentation_domain_add",
		"presentation_domain_verify"} {
		if !strings.Contains(rec.Body.String(), `"name":"`+name+`"`) {
			t.Errorf("tool %s is not listed", name)
		}
	}
}
