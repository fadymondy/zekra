package brain

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// eventMetaOf returns the metadata of the newest event matching op (and tool).
func (f *fix) eventMetaOf(ns, op, tool string) map[string]any {
	f.t.Helper()
	db, _ := f.svc.Store.db(context.Background())
	var raw []byte
	err := db.QueryRow(`SELECT metadata FROM memory_events WHERE namespace=$1 AND op=$2
		AND ($3 = '' OR metadata->>'tool' = $3) ORDER BY id DESC LIMIT 1`, ns, op, tool).Scan(&raw)
	if err != nil {
		f.t.Fatalf("no %s event (tool %q) in %s: %v", op, tool, ns, err)
	}
	m := map[string]any{}
	_ = json.Unmarshal(raw, &m)
	return m
}

func TestOAuthMCPCallsAreAuditedWithIdentity(t *testing.T) {
	f := newOAuthFix(t)
	clientID, access, _ := f.fullFlow(ScopeRead+" "+ScopeWrite, f.writeNS())
	res, isErr := f.call(access, "memory_retain", map[string]any{"namespace": f.brain,
		"content": "The audit log names every caller", "source_kind": "manual"})
	if isErr {
		t.Fatalf("retain: %v", res)
	}
	id, _ := res["id"].(string)
	if _, isErr := f.call(access, "memory_recall", map[string]any{"namespace": f.brain, "query": "audit log caller"}); isErr {
		t.Fatal("recall failed")
	}

	call := f.eventMetaOf(f.brain, "call", "memory_recall")
	if call["client"] != "oauth" || call["user"] != f.owner || call["oauth_client"] != clientID ||
		call["route"] != "/api/brain/recall" || call["status"] != 200.0 {
		t.Fatalf("call row = %v", call)
	}
	// Alice owns the brain, so her query text is kept next to its hash.
	rec := f.eventMetaOf(f.brain, "recall", "memory_recall")
	if rec["query"] != "audit log caller" || rec["query_hash"] != queryHash("Audit log caller ") {
		t.Fatalf("recall row = %v", rec)
	}
	if rs, _ := rec["results"].([]any); len(rs) == 0 || rs[0] != id {
		t.Fatalf("recall results = %v, want %s first", rec["results"], id)
	}
	if ret := f.eventMetaOf(f.brain, "retain", "memory_retain"); ret["outcome"] != "add" || ret["oauth_client"] != clientID {
		t.Fatalf("retain row = %v", ret)
	}
}

func TestTokenQueriesAreHashedAndFilterable(t *testing.T) {
	f := newFix(t)
	ns := f.ns("aud")
	agent := f.ns("bot")
	tok, _ := f.svc.Store.CreateToken(context.Background(), agent, "ci-runner", false)
	_, _ = f.svc.Store.Share(context.Background(), ns, agent, true, true)
	f.seedMemory(ns, "deploys run from the main branch")

	body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call",
		"params": map[string]any{"name": "memory_recall", "arguments": map[string]any{"namespace": ns, "query": "secret plan"}}})
	hr := httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(string(body)))
	hr.Header.Set("Content-Type", "application/json")
	hr.Header.Set("X-Zekra-Token", tok.Token)
	hr.Header.Set("Mcp-Session-Id", "sess-1")
	w := httptest.NewRecorder()
	f.router.ServeHTTP(w, hr)
	if w.Code != 200 || strings.Contains(w.Body.String(), `"isError":true`) {
		t.Fatalf("mcp recall: %d %s", w.Code, w.Body)
	}

	// A scoped token owns no brain: the query is a hash only, everywhere.
	for _, op := range []string{"recall", "call"} {
		m := f.eventMetaOf(ns, op, "memory_recall")
		if _, has := m["query"]; has || m["query_hash"] != queryHash("secret plan") {
			t.Fatalf("%s row keeps query text for a non-owner: %v", op, m)
		}
		if m["token"] != "ci-runner" || m["client"] != "token" {
			t.Fatalf("%s row identity = %v", op, m)
		}
	}
	if n := f.count(`SELECT count(*) FROM memory_events WHERE namespace=$1 AND metadata::text LIKE '%secret plan%'`, ns); n != 0 {
		t.Fatalf("query text stored in %d rows", n)
	}

	items := func(q string) []ActivityItem {
		t.Helper()
		rec := f.do(req{method: "GET", path: "/api/brain/activity?namespace=" + ns + q, user: "u-admin"})
		var out struct{ Items []ActivityItem }
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return out.Items
	}
	calls := items("&op=call&tool=memory_recall")
	if len(calls) != 1 || calls[0].Token != "ci-runner" || calls[0].Route != "POST /api/brain/recall" ||
		calls[0].AgentID != agent || calls[0].QueryHash == "" || calls[0].Session != "sess-1" {
		t.Fatalf("op=call&tool filter = %+v", calls)
	}
	for _, it := range items("") {
		if it.Op == "call" {
			t.Fatal("per-call rows listed without op=call")
		}
	}
	if got := items("&client=token&op=recall"); len(got) != 1 || len(got[0].Results) == 0 {
		t.Fatalf("client filter = %+v", got)
	}
	if got := items("&until=2000-01-01T00:00:00Z&op=call,recall"); len(got) != 0 {
		t.Fatalf("until filter = %+v", got)
	}
	// The token itself can read its brain's audit trail.
	if rec := f.do(req{method: "GET", path: "/api/brain/activity?namespace=" + ns, token: tok.Token}); rec.Code != 200 {
		t.Fatalf("token activity: %d", rec.Code)
	}
	if rec := f.do(req{method: "GET", path: "/api/brain/activity?namespace=" + f.ns("other"), token: tok.Token}); rec.Code != 403 {
		t.Fatalf("token read another brain's activity: %d", rec.Code)
	}
}

func TestQueryTextShownToOwnersOnly(t *testing.T) {
	f := newFix(t)
	ns := f.ns("own")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner'), ($1,'u-carol','viewer')`, ns)
	f.seedMemory(ns, "the launch is in March")
	if rec := f.do(req{method: "POST", path: "/api/brain/recall", user: "u-alice",
		body: map[string]any{"namespace": ns, "query": "launch date"}}); rec.Code != 200 {
		t.Fatalf("recall: %d", rec.Code)
	}
	if rec := f.do(req{method: "POST", path: "/api/brain/recall", user: "u-carol",
		body: map[string]any{"namespace": ns, "query": "carol asks"}}); rec.Code != 200 {
		t.Fatalf("viewer recall: %d", rec.Code)
	}
	if n := f.count(`SELECT count(*) FROM memory_events WHERE namespace=$1 AND metadata->>'query' = 'carol asks'`, ns); n != 0 {
		t.Fatal("a viewer's query text was stored")
	}
	queries := func(user string) (texts, hashes int) {
		rec := f.do(req{method: "GET", path: "/api/brain/activity?op=recall&namespace=" + ns, user: user})
		var out struct{ Items []ActivityItem }
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		for _, it := range out.Items {
			if it.Query != "" {
				texts++
			}
			if it.QueryHash != "" {
				hashes++
			}
		}
		return
	}
	if texts, hashes := queries("u-alice"); texts != 1 || hashes != 2 {
		t.Fatalf("owner sees %d texts / %d hashes, want 1/2", texts, hashes)
	}
	if texts, hashes := queries("u-carol"); texts != 0 || hashes != 2 {
		t.Fatalf("viewer sees %d texts / %d hashes, want 0/2", texts, hashes)
	}
}

func TestPurgeAuditRetention(t *testing.T) {
	f := newFix(t)
	ns := f.ns("ret")
	f.exec(`INSERT INTO memory_events (namespace, op, ts, metadata) VALUES
		($1, 'call',   now() - interval '40 days', '{"tool":"memory_recall"}'),
		($1, 'call',   now() - interval '1 day',   '{"tool":"memory_recall"}'),
		($1, 'recall', now() - interval '40 days', '{"query":"old","query_hash":"h","n":1}'),
		($1, 'recall', now() - interval '1 day',   '{"query":"new","query_hash":"h2","n":1}')`, ns)
	if d, s, err := f.svc.Store.PurgeAudit(context.Background(), 0); err != nil || d+s != 0 {
		t.Fatalf("0 days must keep everything: %d %d %v", d, s, err)
	}
	if _, _, err := f.svc.Store.PurgeAudit(context.Background(), 30); err != nil {
		t.Fatal(err)
	}
	if n := f.count(`SELECT count(*) FROM memory_events WHERE namespace=$1 AND op='call'`, ns); n != 1 {
		t.Fatalf("call rows left = %d, want 1", n)
	}
	if n := f.count(`SELECT count(*) FROM memory_events WHERE namespace=$1 AND op='recall' AND metadata ? 'query'`, ns); n != 1 {
		t.Fatalf("recall rows with text = %d, want 1 (the recent one)", n)
	}
	if n := f.count(`SELECT count(*) FROM memory_events WHERE namespace=$1 AND op='recall' AND metadata ? 'query_hash'`, ns); n != 2 {
		t.Fatalf("hashes must survive retention: %d", n)
	}
	t.Setenv("ZEKRA_AUDIT_RETENTION_DAYS", "90")
	if auditRetentionDays() != 90 {
		t.Fatal("ZEKRA_AUDIT_RETENTION_DAYS not read")
	}
	t.Setenv("ZEKRA_AUDIT_RETENTION_DAYS", "-3")
	if auditRetentionDays() != 0 {
		t.Fatal("a negative retention must mean keep")
	}
}

func TestPeekCallRestoresBody(t *testing.T) {
	hr := httptest.NewRequest(http.MethodPost, "/api/brain/recall?x=1", strings.NewReader(`{"namespace":"n1","query":"q1"}`))
	hr.Header.Set("Content-Type", "application/json")
	ns, q := peekCall(hr)
	var back map[string]any
	if err := json.NewDecoder(hr.Body).Decode(&back); err != nil || back["namespace"] != "n1" {
		t.Fatalf("body not restored: %v %v", back, err)
	}
	if ns != "n1" || q != "q1" {
		t.Fatalf("peek = %q %q", ns, q)
	}
	if ns, _ := peekCall(httptest.NewRequest(http.MethodGet, "/api/brain/memory?namespace=n2", nil)); ns != "n2" {
		t.Fatalf("query-param namespace = %q", ns)
	}
}
