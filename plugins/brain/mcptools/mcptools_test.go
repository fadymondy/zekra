package mcptools

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
)

// fakeBackend records the REST call a tool produced.
type fakeBackend struct {
	method, path string
	query        url.Values
	body         map[string]any
	status       int
}

func (f *fakeBackend) Do(_ context.Context, method, path string, q url.Values, body map[string]any) (any, int, error) {
	f.method, f.path, f.query, f.body = method, path, q, body
	st := f.status
	if st == 0 {
		st = 200
	}
	return map[string]any{"ok": true}, st, nil
}

func TestEveryToolHasAnAccessClassAndDispatches(t *testing.T) {
	seen := map[string]bool{}
	for _, tl := range Tools() {
		name := tl["name"].(string)
		if seen[name] {
			t.Errorf("duplicate tool %s", name)
		}
		seen[name] = true
		if _, ok := toolAccess[name]; !ok {
			t.Errorf("%s has no access class", name)
		}
		b := &fakeBackend{}
		if _, err := Call(context.Background(), b, name, map[string]any{"namespace": "n", "id": "x"}); err != nil {
			t.Errorf("%s does not dispatch: %v", name, err)
		}
		if b.path == "" {
			t.Errorf("%s made no REST call", name)
		}
	}
	for name := range toolAccess {
		if !seen[name] {
			t.Errorf("access class for a tool that does not exist: %s", name)
		}
	}
}

func TestToolTranslation(t *testing.T) {
	cases := []struct {
		tool         string
		args         map[string]any
		method, path string
		check        func(b *fakeBackend) bool
	}{
		{"memory_retain", map[string]any{"namespace": "a", "content": "c", "source_kind": "manual"}, "POST", "/api/brain/retain",
			func(b *fakeBackend) bool { return b.body["sourceKind"] == "manual" && b.body["content"] == "c" }},
		{"note_create", map[string]any{"namespace": "a", "title": "t", "body": "b"}, "POST", "/api/notes",
			func(b *fakeBackend) bool { return b.body["source"] == "agent" && b.body["title"] == "t" }},
		{"note_update", map[string]any{"id": "abc", "body": "x", "version": float64(3)}, "PUT", "/api/notes/abc",
			func(b *fakeBackend) bool { return b.body["version"] == float64(3) && b.body["title"] == nil }},
		{"note_append", map[string]any{"id": "abc", "text": "more"}, "POST", "/api/notes/abc/append",
			func(b *fakeBackend) bool { return b.body["text"] == "more" }},
		{"note_get", map[string]any{"id": "a/b"}, "GET", "/api/notes/a%2Fb", nil},
		{"note_delete", map[string]any{"id": "abc"}, "DELETE", "/api/notes/abc", nil},
		{"notes_adopt", map[string]any{"namespace": "a"}, "POST", "/api/notes/adopt",
			func(b *fakeBackend) bool { return b.body["namespace"] == "a" }},
		{"note_search", map[string]any{"query": "q"}, "GET", "/api/notes",
			func(b *fakeBackend) bool {
				return b.query.Get("q") == "q" && b.query.Get("limit") == "20" && !b.query.Has("namespace")
			}},
		{"note_list", map[string]any{"namespace": "a", "archived": true, "limit": float64(5)}, "GET", "/api/notes",
			func(b *fakeBackend) bool { return b.query.Get("archived") == "1" && b.query.Get("limit") == "5" }},
		{"note_create", map[string]any{"namespace": "a", "title": "t", "category": "meeting"}, "POST", "/api/notes",
			func(b *fakeBackend) bool { return b.body["category"] == "meeting" }},
		{"note_related", map[string]any{"id": "n1"}, "GET", "/api/notes/n1/related", nil},
		{"notes_graph_ontology", map[string]any{"namespace": "a"}, "GET", "/api/brain/ontology",
			func(b *fakeBackend) bool { return b.query.Get("namespace") == "a" }},
		{"notes_graph_neighbors", map[string]any{"entity": "Ada", "relations": []any{"uses"}}, "POST", "/api/brain/entities/neighbors",
			func(b *fakeBackend) bool { return b.body["entity"] == "Ada" && b.body["namespace"] == nil }},
		{"notes_graph_path", map[string]any{"from": "a", "to": "b", "max_depth": float64(3)}, "POST", "/api/brain/entities/path",
			func(b *fakeBackend) bool { return b.body["max_depth"] == float64(3) }},
		{"entity_get", map[string]any{"id": "e1"}, "GET", "/api/brain/entities/e1", nil},
		{"entity_create", map[string]any{"namespace": "a", "name": "X", "entity_type": "person"}, "POST", "/api/brain/entities",
			func(b *fakeBackend) bool { return b.body["entity_type"] == "person" }},
		{"entity_update", map[string]any{"id": "e1", "name": "Y"}, "PATCH", "/api/brain/entities/e1",
			func(b *fakeBackend) bool { return b.body["name"] == "Y" && b.body["summary"] == nil }},
		{"edge_create", map[string]any{"namespace": "a", "src_id": "s", "dst_id": "d", "relation": "uses"}, "POST", "/api/brain/edges",
			func(b *fakeBackend) bool { return b.body["src_id"] == "s" && b.body["relation"] == "uses" }},
		{"edge_update", map[string]any{"id": "g1", "relation": "owns"}, "PATCH", "/api/brain/edges/g1", nil},
		{"edge_delete", map[string]any{"id": "g1"}, "DELETE", "/api/brain/edges/g1", nil},
		{"brain_create", map[string]any{"namespace": "new"}, "POST", "/api/brain/brains",
			func(b *fakeBackend) bool { return b.body["namespace"] == "new" }},
		{"brain_delete", map[string]any{"namespace": "x", "confirm": "x"}, "POST", "/api/brain/brain/delete",
			func(b *fakeBackend) bool { return b.body["confirm"] == "x" }},
		{"brain_profile_get", map[string]any{"namespace": "x"}, "GET", "/api/brain/profile",
			func(b *fakeBackend) bool { return b.query.Get("namespace") == "x" }},
		{"brain_profile_update", map[string]any{"namespace": "x", "display_name": "X Brain", "color": "teal"}, "PATCH", "/api/brain/profile",
			func(b *fakeBackend) bool {
				return b.body["displayName"] == "X Brain" && b.body["color"] == "teal" && b.body["icon"] == nil
			}},
	}
	for _, c := range cases {
		b := &fakeBackend{}
		if _, err := Call(context.Background(), b, c.tool, c.args); err != nil {
			t.Fatalf("%s: %v", c.tool, err)
		}
		if b.method != c.method || b.path != c.path || (c.check != nil && !c.check(b)) {
			t.Errorf("%s → %s %s %v %v", c.tool, b.method, b.path, b.query, b.body)
		}
	}
	if _, err := Call(context.Background(), &fakeBackend{}, "memory_recall_archive", nil); err != ErrUnknownTool {
		t.Errorf("memory_recall_archive should be gone: %v", err)
	}
}

func rpc(t *testing.T, s *Server, raw string) *Response {
	t.Helper()
	var req Request
	if err := json.Unmarshal([]byte(raw), &req); err != nil {
		t.Fatal(err)
	}
	return s.Handle(context.Background(), &req)
}

func TestServerDispatch(t *testing.T) {
	b := &fakeBackend{}
	s := &Server{Backend: b, DefaultNamespace: "home"}

	init := rpc(t, s, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}`)
	if init.Result.(map[string]any)["protocolVersion"] != "2024-11-05" {
		t.Fatalf("negotiation: %v", init.Result)
	}
	init = rpc(t, s, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}`)
	if init.Result.(map[string]any)["protocolVersion"] != SupportedProtocolVersions[0] {
		t.Fatalf("unknown version must get the newest: %v", init.Result)
	}
	if rpc(t, s, `{"jsonrpc":"2.0","method":"notifications/initialized"}`) != nil {
		t.Fatal("a notification got a response")
	}
	// Default namespace fills an omitted one.
	rpc(t, s, `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"memory_recall","arguments":{"query":"q"}}}`)
	if b.body["namespace"] != "home" {
		t.Fatalf("default namespace: %v", b.body)
	}
	// A REST error is an in-band tool error.
	b.status = 403
	res := rpc(t, s, `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"note_get","arguments":{"id":"x"}}}`)
	if res.Error != nil || res.Result.(map[string]any)["isError"] != true {
		t.Fatalf("403 must be isError: %+v", res)
	}
	if res := rpc(t, s, `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"nope"}}`); res.Error == nil || res.Error.Code != -32602 {
		t.Fatalf("unknown tool: %+v", res)
	}
	if res := rpc(t, s, `{"jsonrpc":"2.0","id":5,"method":"bogus"}`); res.Error == nil || res.Error.Code != -32601 {
		t.Fatalf("unknown method: %+v", res)
	}

	// An allow filter hides and refuses tools.
	s.Allow = func(a Access) bool { return a == AccessRead }
	list := rpc(t, s, `{"jsonrpc":"2.0","id":6,"method":"tools/list"}`)
	raw, _ := json.Marshal(list.Result)
	if strings.Contains(string(raw), `"note_create"`) || !strings.Contains(string(raw), `"note_get"`) {
		t.Fatalf("filtered tools/list: %s", raw)
	}
	b.path = ""
	res = rpc(t, s, `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"note_create","arguments":{"namespace":"a","title":"t"}}}`)
	if res.Result.(map[string]any)["isError"] != true || b.path != "" {
		t.Fatalf("a filtered tool was called: %+v (path %q)", res, b.path)
	}
}

func TestPresentationDomainTools(t *testing.T) {
	type call struct {
		method, path string
		body         map[string]any
	}
	var got call
	post := func(p string, b map[string]any) { got = call{"POST", p, b} }
	get := func(p string, q url.Values) { got = call{"GET", p + "?" + q.Encode(), nil} }
	none := func(string) {}
	for _, c := range []struct {
		tool string
		args map[string]any
		want string
	}{
		{"presentation_domains", map[string]any{"namespace": "acme"}, "GET /api/presentations/domains?namespace=acme"},
		{"presentation_domain_add", map[string]any{"namespace": "acme", "host": "deck.acme.com"}, "POST /api/presentations/domains"},
		{"presentation_domain_verify", map[string]any{"id": "d/1"}, "POST /api/presentations/domains/d%2F1/verify"},
		{"presentation_domain_verify", map[string]any{"id": "d1", "default": true}, "POST /api/presentations/domains/d1/verify?default=1"},
		{"presentation_share", map[string]any{"id": "p1", "domain": "deck.acme.com"}, "POST /api/presentations/p1/share"},
	} {
		got = call{}
		if !callPresentation(c.tool, c.args, post, func(string, map[string]any) {}, get, none) {
			t.Fatalf("%s is not dispatched", c.tool)
		}
		if got.method+" "+got.path != c.want {
			t.Errorf("%s: %s %s, want %s", c.tool, got.method, got.path, c.want)
		}
		if c.tool == "presentation_share" && got.body["domain"] != "deck.acme.com" {
			t.Errorf("presentation_share does not pass domain: %v", got.body)
		}
		if c.tool == "presentation_domain_add" && got.body["host"] != "deck.acme.com" {
			t.Errorf("presentation_domain_add body: %v", got.body)
		}
		if _, ok := toolAccess[c.tool]; !ok {
			t.Errorf("%s has no access class", c.tool)
		}
	}
}
