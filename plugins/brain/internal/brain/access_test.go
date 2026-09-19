package brain

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

/*
Security: session users are scoped to their brains. Before brain_members, a
request with no token was the trusted console, so every signed-in account was
an admin of every brain. These tests pin member / non-member / admin /
anonymous behaviour on each brain endpoint.
*/

func TestSessionAccessPerEndpoint(t *testing.T) {
	f := newFix(t)
	ns := f.ns("acl")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner'), ($1,'u-carol','viewer')`, ns)
	memID := f.seedMemory(ns, "the acl brain knows the launch is in March")
	f.exec(`INSERT INTO memory_gaps (namespace, query, norm_query) VALUES ($1, 'what is x', 'what is x')`, ns)
	var gapID int64
	db, _ := f.svc.Store.db(context.Background())
	_ = db.QueryRow(`SELECT id FROM memory_gaps WHERE namespace=$1`, ns).Scan(&gapID)
	gap := strconv.FormatInt(gapID, 10)
	_ = gap

	type ep struct {
		name, method, path string
		body               any
		write              bool // needs write (viewer is refused)
	}
	eps := []ep{
		{"brain details", "GET", "/api/brain/brain?namespace=" + ns, nil, false},
		{"export", "GET", "/api/brain/export?namespace=" + ns, nil, false},
		{"graph", "GET", "/api/brain/graph?namespace=" + ns, nil, false},
		{"memory get", "GET", "/api/brain/memory?namespace=" + ns + "&id=" + memID, nil, false},
		{"ontology", "GET", "/api/brain/graph/ontology?namespace=" + ns, nil, false},
		{"secrets list", "GET", "/api/brain/secrets?namespace=" + ns, nil, false},
		{"notes list", "GET", "/api/notes?namespace=" + ns, nil, false},
		{"retain", "POST", "/api/brain/retain", map[string]any{"namespace": ns, "content": "new fact about the acl brain", "sourceKind": "manual"}, true},
		{"dedup", "POST", "/api/brain/dedup", map[string]any{"namespace": ns}, true},
		{"import", "POST", "/api/brain/import?namespace=" + ns, "", true},
		{"note create", "POST", "/api/notes", map[string]any{"namespace": ns, "title": "t"}, true},
		{"gap resolve", "POST", "/api/brain/gaps/resolve", map[string]any{"id": gapID, "status": "dismissed"}, true},
	}
	for _, e := range eps {
		for _, who := range []struct {
			user string
			want bool
		}{{"u-alice", true}, {"u-admin", true}, {"u-carol", !e.write}, {"u-bob", false}, {"", false}} {
			rec := f.do(req{method: e.method, path: e.path, body: e.body, user: who.user})
			ok := rec.Code < 300
			if ok != who.want {
				t.Errorf("%s as %q: got %d (%s), want allowed=%v", e.name, who.user, rec.Code, trim(rec.Body.String()), who.want)
			}
		}
	}

	// Brain-level administration is the owner's (and admins').
	for _, who := range []struct {
		user string
		want int
	}{{"u-bob", 403}, {"u-carol", 403}} {
		rec := f.do(req{method: "POST", path: "/api/brain/brain/delete", user: who.user, body: map[string]any{"namespace": ns, "confirm": ns}})
		if rec.Code != who.want {
			t.Errorf("brain delete as %s: %d", who.user, rec.Code)
		}
		rec = f.do(req{method: "POST", path: "/api/brain/share", user: who.user, body: map[string]any{"namespace": ns, "granteeAgentId": "x"}})
		if rec.Code != who.want {
			t.Errorf("share as %s: %d", who.user, rec.Code)
		}
		rec = f.do(req{method: "GET", path: "/api/brain/members?namespace=" + ns, user: who.user})
		if rec.Code != who.want {
			t.Errorf("members as %s: %d", who.user, rec.Code)
		}
	}
	if rec := f.do(req{method: "GET", path: "/api/brain/members?namespace=" + ns, user: "u-alice"}); rec.Code != 200 {
		t.Errorf("owner lists members: %d", rec.Code)
	}
	// ACL administration is admin-only.
	for _, who := range []struct {
		user string
		want bool
	}{{"u-alice", false}, {"u-admin", true}} {
		rec := f.do(req{method: "GET", path: "/api/brain/tokens", user: who.user})
		if (rec.Code == 200) != who.want {
			t.Errorf("tokens as %s: %d", who.user, rec.Code)
		}
	}
}

func trim(s string) string {
	if len(s) > 120 {
		return s[:120]
	}
	return strings.TrimSpace(s)
}

func TestListsAreScopedToReadableBrains(t *testing.T) {
	f := newFix(t)
	mine, theirs := f.ns("mine"), f.ns("theirs")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner'), ($2,'u-bob','owner')`, mine, theirs)
	f.seedMemory(mine, "alice memory")
	f.seedMemory(theirs, "bob memory")
	f.exec(`INSERT INTO memory_gaps (namespace, query, norm_query) VALUES ($1,'q1','q1'), ($2,'q2','q2')`, mine, theirs)
	f.exec(`INSERT INTO memory_events (namespace, op) VALUES ($1,'recall'), ($2,'recall')`, mine, theirs)

	for _, path := range []string{"/api/brain/namespaces", "/api/brain/gaps", "/api/brain/activity?limit=200", "/api/brain/mine"} {
		body := f.do(req{method: "GET", path: path, user: "u-alice"}).Body.String()
		if !strings.Contains(body, mine) || strings.Contains(body, theirs) {
			t.Errorf("%s as alice leaks or misses: %s", path, trim(body))
		}
		if admin := f.do(req{method: "GET", path: path, user: "u-admin"}).Body.String(); path != "/api/brain/mine" && (!strings.Contains(admin, mine) || !strings.Contains(admin, theirs)) {
			t.Errorf("%s as admin misses brains", path)
		}
		if rec := f.do(req{method: "GET", path: path}); strings.Contains(rec.Body.String(), mine) {
			t.Errorf("%s anonymous leaks: %s", path, trim(rec.Body.String()))
		}
	}
	// Stats count only readable brains.
	var st Stats
	_ = json.Unmarshal(f.do(req{method: "GET", path: "/api/brain/stats", user: "u-bob"}).Body.Bytes(), &st)
	var adminSt Stats
	_ = json.Unmarshal(f.do(req{method: "GET", path: "/api/brain/stats", user: "u-admin"}).Body.Bytes(), &adminSt)
	if st.Brains != 1 || st.Memories != 1 || adminSt.Brains < 2 {
		t.Errorf("stats as bob: %+v (admin %+v)", st, adminSt)
	}
	// The all-brains graph is admin-only.
	if rec := f.do(req{method: "GET", path: "/api/brain/graph", user: "u-alice"}); rec.Code != http.StatusForbidden {
		t.Errorf("all-brains graph as a member: %d", rec.Code)
	}
}

func TestCreatorBecomesOwnerButExistingBrainsCannotBeClaimed(t *testing.T) {
	f := newFix(t)
	fresh, existing := f.ns("fresh"), f.ns("existing")
	f.seedMemory(existing, "someone else's data")

	// First write into a new brain makes the writer its owner.
	rec := f.do(req{method: "POST", path: "/api/brain/retain", user: "u-bob", body: map[string]any{"namespace": fresh, "content": "hello", "sourceKind": "manual"}})
	if rec.Code != http.StatusOK {
		t.Fatalf("retain into a new brain: %d %s", rec.Code, rec.Body)
	}
	if role, _ := f.svc.Store.MemberRole(context.Background(), fresh, "u-bob"); role != "owner" {
		t.Fatalf("creator role: %q", role)
	}
	// A brain that already has data cannot be claimed by writing into it.
	rec = f.do(req{method: "POST", path: "/api/brain/retain", user: "u-bob", body: map[string]any{"namespace": existing, "content": "mine now", "sourceKind": "manual"}})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("claimed an existing brain: %d", rec.Code)
	}
	if rec := f.do(req{method: "POST", path: "/api/brain/brains", user: "u-bob", body: map[string]any{"namespace": existing}}); rec.Code != http.StatusConflict {
		t.Fatalf("created over an existing brain: %d", rec.Code)
	}
	// Explicit create + invite + leave.
	nb := f.ns("team")
	if rec := f.do(req{method: "POST", path: "/api/brain/brains", user: "u-bob", body: map[string]any{"namespace": nb}}); rec.Code != http.StatusCreated {
		t.Fatalf("create brain: %d %s", rec.Code, rec.Body)
	}
	if rec := f.do(req{method: "POST", path: "/api/brain/members", user: "u-alice", body: map[string]any{"namespace": nb, "userId": "u-alice", "role": "owner"}}); rec.Code != http.StatusForbidden {
		t.Fatalf("a non-member added themselves: %d", rec.Code)
	}
	if rec := f.do(req{method: "POST", path: "/api/brain/members", user: "u-bob", body: map[string]any{"namespace": nb, "userId": "u-alice", "role": "viewer"}}); rec.Code != http.StatusOK {
		t.Fatalf("owner invite: %d %s", rec.Code, rec.Body)
	}
	if rec := f.do(req{method: "POST", path: "/api/notes", user: "u-alice", body: map[string]any{"namespace": nb, "title": "x"}}); rec.Code != http.StatusForbidden {
		t.Fatalf("a viewer wrote: %d", rec.Code)
	}
	if rec := f.do(req{method: "POST", path: "/api/brain/members/remove", user: "u-bob", body: map[string]any{"namespace": nb, "userId": "u-bob"}}); rec.Code != http.StatusConflict {
		t.Fatalf("the last owner left: %d", rec.Code)
	}
	if rec := f.do(req{method: "POST", path: "/api/brain/members/remove", user: "u-alice", body: map[string]any{"namespace": nb, "userId": "u-alice"}}); rec.Code != http.StatusOK {
		t.Fatalf("a member could not leave: %d", rec.Code)
	}
}

func TestBackfillMakesAdminsOwnersOfUnownedBrains(t *testing.T) {
	f := newFix(t)
	ns := f.ns("legacy")
	f.seedMemory(ns, "a legacy memory")
	f.exec(`INSERT INTO users (id, email, roles) VALUES ('p1-admin-backfill','p1@example.invalid','admin') ON CONFLICT (id) DO UPDATE SET roles='admin'`)
	defer f.exec(`DELETE FROM users WHERE id='p1-admin-backfill'`)
	db, _ := f.svc.Store.db(context.Background())
	if err := Migrate(context.Background(), db); err != nil && !strings.Contains(err.Error(), "BM25") {
		t.Fatal(err)
	}
	if role, _ := f.svc.Store.MemberRole(context.Background(), ns, "p1-admin-backfill"); role != "owner" {
		t.Fatalf("backfill role: %q", role)
	}
	// A brain that already has members is left alone.
	owned := f.ns("owned")
	f.seedMemory(owned, "x")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-bob','owner')`, owned)
	_ = Migrate(context.Background(), db)
	if role, _ := f.svc.Store.MemberRole(context.Background(), owned, "p1-admin-backfill"); role != "" {
		t.Fatalf("backfill touched an owned brain: %q", role)
	}
}

func TestACLTokenBehaviourUnchanged(t *testing.T) {
	f := newFix(t)
	ns := f.ns("tok")
	agent := f.ns("agent")
	tok, _ := f.svc.Store.CreateToken(context.Background(), agent, "p1", false)
	_, _ = f.svc.Store.Share(context.Background(), ns, agent, true, false)
	f.seedMemory(ns, "token brain")
	if rec := f.do(req{method: "GET", path: "/api/brain/brain?namespace=" + ns, token: tok.Token}); rec.Code != 200 {
		t.Fatalf("granted token read: %d", rec.Code)
	}
	if rec := f.do(req{method: "POST", path: "/api/brain/retain", token: tok.Token, body: map[string]any{"namespace": ns, "content": "x", "sourceKind": "manual"}}); rec.Code != 403 {
		t.Fatalf("read-only token wrote: %d", rec.Code)
	}
	if rec := f.do(req{method: "GET", path: "/api/brain/brain?namespace=" + f.ns("other"), token: tok.Token}); rec.Code != 403 {
		t.Fatalf("token read an ungranted brain: %d", rec.Code)
	}
	if rec := f.do(req{method: "GET", path: "/api/brain/brain?namespace=" + ns, token: "cbt_bogus"}); rec.Code != 403 {
		t.Fatalf("bogus token: %d", rec.Code)
	}
	admin, _ := f.svc.Store.CreateToken(context.Background(), f.ns("root"), "p1", true)
	if rec := f.do(req{method: "GET", path: "/api/brain/tokens", token: admin.Token}); rec.Code != 200 {
		t.Fatalf("admin token: %d", rec.Code)
	}
}
