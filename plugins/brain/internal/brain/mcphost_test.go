package brain

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

const mcpHostURL = "https://mcp.p1.example.test"

// With MCP_PUBLIC_URL set, mcp.<domain> is the canonical resource and the
// issuer, the consent page stays on the app, and <app>/api/mcp keeps working.
func TestMCPPublicHost(t *testing.T) {
	f := newOAuthFix(t)
	t.Setenv("MCP_PUBLIC_URL", mcpHostURL)
	t.Setenv("ZEKRA_OAUTH_ISSUER", "")

	onHost := func(method, path, host string) *http.Request {
		r := httptest.NewRequest(method, path, strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
		r.Host = host
		return r
	}
	// Protected-resource metadata, per host and form.
	for _, c := range []struct{ path, host, want string }{
		{"/.well-known/oauth-protected-resource", "mcp.p1.example.test", mcpHostURL},
		{"/.well-known/oauth-protected-resource/", "mcp.p1.example.test", mcpHostURL},
		{"/.well-known/oauth-protected-resource/api/mcp", "mcp.p1.example.test", mcpHostURL + "/api/mcp"},
		{"/.well-known/oauth-protected-resource/api/mcp", "p1.zekra.example.test", testIssuer + "/api/mcp"},
		{"/.well-known/oauth-protected-resource", "p1.zekra.example.test", testIssuer + "/api/mcp"},
	} {
		pr := decode(t, f.do(onHost("GET", c.path, c.host)))
		if pr["resource"] != c.want {
			t.Errorf("%s on %s: resource %v, want %s", c.path, c.host, pr["resource"], c.want)
		}
		if as, _ := pr["authorization_servers"].([]any); len(as) != 1 || as[0] != mcpHostURL {
			t.Errorf("%s: authorization_servers %v", c.path, pr["authorization_servers"])
		}
	}
	// AS metadata: issuer = MCP host; consent page on the app.
	md := decode(t, f.do(onHost("GET", "/.well-known/oauth-authorization-server", "mcp.p1.example.test")))
	if md["issuer"] != mcpHostURL || md["token_endpoint"] != mcpHostURL+"/api/oauth/token" ||
		md["authorization_endpoint"] != testIssuer+"/en/oauth/authorize" {
		t.Fatalf("AS metadata: %v", md)
	}
	// The 401 on the MCP host (NPM rewrote "/" to /api/mcp) points at the root document.
	res := f.do(onHost("POST", "/api/mcp", "mcp.p1.example.test"))
	if www := res.Header().Get("WWW-Authenticate"); res.Code != 401 ||
		!strings.Contains(www, `resource_metadata="`+mcpHostURL+`/.well-known/oauth-protected-resource"`) {
		t.Fatalf("401 on the MCP host: %d %q", res.Code, www)
	}
	res = f.do(onHost("POST", "/api/mcp", "p1.zekra.example.test"))
	if www := res.Header().Get("WWW-Authenticate"); !strings.Contains(www, testIssuer+"/.well-known/oauth-protected-resource/api/mcp") {
		t.Fatalf("401 on the app host: %q", www)
	}

	// Full flow bound to the MCP host resource, and one bound to <app>/api/mcp.
	for _, resource := range []string{mcpHostURL, mcpHostURL + "/", testIssuer + "/api/mcp"} {
		client := f.client()
		verifier, challenge := pkcePair()
		q := authzQuery(client, challenge, ScopeRead)
		q.Set("resource", resource)
		rec := f.decide(f.owner, q, true, f.readNS())
		to, _ := url.Parse(decode(t, rec)["redirect_to"].(string))
		if to.Query().Get("iss") != mcpHostURL {
			t.Fatalf("iss must be the issuer (%s): %s", mcpHostURL, to)
		}
		form := codeForm(client, to.Query().Get("code"), verifier)
		form.Set("resource", resource)
		trec, body := f.token(form)
		if trec.Code != http.StatusOK {
			t.Fatalf("token for %s: %d %s", resource, trec.Code, trec.Body)
		}
		if c, _ := f.mcp(body["access_token"].(string), "tools/list", nil); c != http.StatusOK {
			t.Fatalf("token bound to %s refused: %d", resource, c)
		}
	}
	// A foreign resource is refused at both steps.
	client := f.client()
	verifier, challenge := pkcePair()
	q := authzQuery(client, challenge, ScopeRead)
	q.Set("resource", "https://evil.example.test")
	if rec := f.authorizeRequest(f.owner, q); decode(t, rec)["error"] != "invalid_target" {
		t.Fatalf("foreign resource at authorize: %s", rec.Body)
	}
	q.Set("resource", mcpHostURL)
	rec := f.decide(f.owner, q, true, f.readNS())
	to, _ := url.Parse(decode(t, rec)["redirect_to"].(string))
	form := codeForm(client, to.Query().Get("code"), verifier)
	form.Set("resource", testIssuer+"/api/mcp") // allowed in general, but not what was authorized
	if trec, body := f.token(form); trec.Code != http.StatusBadRequest || body["error"] != "invalid_target" {
		t.Fatalf("token resource differing from the authorization: %d %s", trec.Code, trec.Body)
	}
}

func TestToolCatalogEndpoint(t *testing.T) {
	f := newFix(t)
	rec := f.do(req{method: "GET", path: "/api/mcp/tools"})
	var out struct {
		Tools []struct {
			Name        string         `json:"name"`
			Access      string         `json:"access"`
			InputSchema map[string]any `json:"inputSchema"`
		} `json:"tools"`
	}
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &out) != nil {
		t.Fatalf("catalog: %d %s", rec.Code, rec.Body)
	}
	names := map[string]string{}
	for _, tl := range out.Tools {
		names[tl.Name] = tl.Access
		if tl.InputSchema["type"] != "object" {
			t.Errorf("%s has no object schema", tl.Name)
		}
	}
	for _, want := range []string{"brain_create", "brain_delete", "note_create", "note_append", "memory_recall"} {
		if names[want] == "" {
			t.Errorf("catalog lacks %s", want)
		}
	}
	if _, ok := names["memory_recall_archive"]; ok {
		t.Error("memory_recall_archive is still listed")
	}
	if names["brain_delete"] != "admin" || names["note_get"] != "read" {
		t.Errorf("access classes: %v", names)
	}
}

func TestSessionConfigAndConsoleFixes(t *testing.T) {
	f := newFix(t)
	t.Setenv("MCP_PUBLIC_URL", mcpHostURL)
	ns := f.ns("sess")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner')`, ns)

	// B1: session config under the "zekra" key, remote + local forms.
	rec := f.do(req{method: "POST", path: "/api/brain/session", user: "u-alice", body: map[string]any{"namespace": ns, "write": true}})
	body := rec.Body.String()
	var out struct {
		MCPConfig      map[string]map[string]map[string]any `json:"mcpConfig"`
		MCPConfigLocal map[string]map[string]map[string]any `json:"mcpConfigLocal"`
		Howto          string                               `json:"howto"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	remote := out.MCPConfig["mcpServers"]["zekra"]
	local := out.MCPConfigLocal["mcpServers"]["zekra"]
	if rec.Code != 200 || remote["type"] != "http" || remote["url"] != mcpHostURL || local["command"] != "zekra" ||
		!strings.Contains(out.Howto, "install.sh") || strings.Contains(body, "cabrain") {
		t.Fatalf("session config: %d %s", rec.Code, body)
	}
	env, _ := local["env"].(map[string]any)
	if env["ZEKRA_TOKEN"] == nil || env["ZEKRA_AGENT_ID"] == nil || env["ZEKRA_API_URL"] == nil {
		t.Fatalf("local env: %v", env)
	}

	// B2: a generated webhook secret is shown once; the list masks it; rotate returns a new one.
	rec = f.do(req{method: "POST", path: "/api/brain/datasources", user: "u-alice", body: map[string]any{"namespace": ns, "kind": "webhook", "name": "hook"}})
	var ds Datasource
	_ = json.Unmarshal(rec.Body.Bytes(), &ds)
	secret, _ := ds.Config["secret"].(string)
	if rec.Code != 200 || !strings.HasPrefix(secret, "whk_") {
		t.Fatalf("webhook create must return its generated secret once: %s", rec.Body)
	}
	if list := f.do(req{method: "GET", path: "/api/brain/datasources?namespace=" + ns, user: "u-alice"}).Body.String(); strings.Contains(list, secret) {
		t.Fatal("the list leaks the webhook secret")
	}
	rec = f.do(req{method: "POST", path: "/api/brain/datasources/rotate-secret", user: "u-alice", body: map[string]any{"id": ds.ID}})
	var rot map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &rot)
	if rec.Code != 200 || rot["secret"] == secret || !strings.HasPrefix(rot["secret"].(string), "whk_") {
		t.Fatalf("rotate: %d %s", rec.Code, rec.Body)
	}
	if rec := f.do(req{method: "POST", path: "/api/brain/datasources/rotate-secret", user: "u-bob", body: map[string]any{"id": ds.ID}}); rec.Code != 403 {
		t.Fatalf("a non-member rotated the secret: %d", rec.Code)
	}
	// A caller-supplied secret is not echoed.
	rec = f.do(req{method: "POST", path: "/api/brain/datasources", user: "u-alice", body: map[string]any{"namespace": ns, "kind": "webhook", "name": "own", "config": map[string]any{"secret": "mine-123456"}}})
	if strings.Contains(rec.Body.String(), "mine-123456") {
		t.Fatal("echoed a caller-supplied secret")
	}

	// B3: export filename.
	rec = f.do(req{method: "GET", path: "/api/brain/export?namespace=" + ns, user: "u-alice"})
	if cd := rec.Header().Get("Content-Disposition"); !strings.Contains(cd, `zekra-`+ns+`.ndjson`) {
		t.Fatalf("export filename: %q", cd)
	}

	// B4: ontology keys are lowercase.
	f.exec(`INSERT INTO entity_types (namespace, name, description) VALUES ($1,'venture','a venture') ON CONFLICT DO NOTHING`, ns)
	onto := f.do(req{method: "GET", path: "/api/brain/graph/ontology?namespace=" + ns, user: "u-alice"}).Body.String()
	if !strings.Contains(onto, `"name":"venture"`) || !strings.Contains(onto, `"count":`) || strings.Contains(onto, `"Name"`) {
		t.Fatalf("ontology keys: %s", onto)
	}
	f.exec(`DELETE FROM entity_types WHERE namespace=$1`, ns)
	f.exec(`DELETE FROM datasources WHERE namespace=$1`, ns)
}
