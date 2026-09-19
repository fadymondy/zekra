package brain

import (
	"context"
	"net"
	"strings"
	"testing"
)

/*
Custom share domains through HTTP: who may list and who may manage, the exact
JSON, DNS verification with a fake resolver, the share URL following the
domain, a custom host only opening its own brain's tokens, the public check
endpoint, and editing / reissuing a link.
*/

type stubDNS struct {
	txt   map[string][]string
	cname map[string]string
	ips   map[string][]string
}

func (d *stubDNS) miss(name string) error {
	return &net.DNSError{Err: "no such host", Name: name, IsNotFound: true}
}

func (d *stubDNS) LookupTXT(_ context.Context, n string) ([]string, error) {
	if v, ok := d.txt[n]; ok {
		return v, nil
	}
	return nil, d.miss(n)
}

func (d *stubDNS) LookupCNAME(_ context.Context, h string) (string, error) {
	if v, ok := d.cname[h]; ok {
		return v, nil
	}
	return "", d.miss(h)
}

func (d *stubDNS) LookupHost(_ context.Context, h string) ([]string, error) {
	if v, ok := d.ips[h]; ok {
		return v, nil
	}
	return nil, d.miss(h)
}

func domainSetup(t *testing.T) (*fix, string, *stubDNS) {
	f, ns := presSetup(t)
	t.Setenv("PRESENTATIONS_DOMAIN_TARGET", "edge.zekra.test")
	f.dir.users["u-erin"] = []string{"member"}
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-erin','editor')`, ns)
	dns := &stubDNS{txt: map[string][]string{}, cname: map[string]string{}, ips: map[string][]string{"edge.zekra.test": {"203.0.113.7"}}}
	f.svc.presStore().Resolver = dns
	t.Cleanup(func() { f.exec(`DELETE FROM presentation_domains WHERE namespace LIKE $1`, f.prefix+"%") })
	return f, ns, dns
}

// linkDomain adds and verifies host for ns as user, returning the domain id.
func (f *fix) linkDomain(dns *stubDNS, user, ns, host string) string {
	f.t.Helper()
	rec := f.do(req{method: "POST", path: "/api/presentations/domains", user: user, body: map[string]any{"namespace": ns, "host": host}})
	if rec.Code != 201 {
		f.t.Fatalf("add %s: %d %s", host, rec.Code, trim(rec.Body.String()))
	}
	dom := decodeMap(f.t, rec)
	vr := dom["verifyRecord"].(map[string]any)
	dns.txt[vr["name"].(string)] = []string{vr["value"].(string)}
	dns.cname[host] = "edge.zekra.test."
	rec = f.do(req{method: "POST", path: "/api/presentations/domains/" + dom["id"].(string) + "/verify", user: user, body: map[string]any{}})
	if out := decodeMap(f.t, rec); rec.Code != 200 || out["verified"] != true {
		f.t.Fatalf("verify %s: %d %s", host, rec.Code, trim(rec.Body.String()))
	}
	return dom["id"].(string)
}

func TestPresentationDomainsAccessAndShape(t *testing.T) {
	f, ns, dns := domainSetup(t)
	host := "deck." + strings.TrimSuffix(f.prefix, "-") + ".example.com"

	// Only the brain's owner (or an admin) adds a domain.
	for user, want := range map[string]int{"": 403, "u-bob": 403, "u-carol": 403, "u-erin": 403} {
		if rec := f.do(req{method: "POST", path: "/api/presentations/domains", user: user, body: map[string]any{"namespace": ns, "host": host}}); rec.Code != want {
			t.Errorf("add as %q: %d, want %d", user, rec.Code, want)
		}
	}
	for _, bad := range []string{"https://" + host, host + "/x", host + ":8443", "app.zekra.dev", "foo.zekra.dev", ""} {
		if rec := f.do(req{method: "POST", path: "/api/presentations/domains", user: "u-alice", body: map[string]any{"namespace": ns, "host": bad}}); rec.Code != 422 {
			t.Errorf("add %q: %d, want 422", bad, rec.Code)
		}
	}
	rec := f.do(req{method: "POST", path: "/api/presentations/domains", user: "u-alice", body: map[string]any{"namespace": ns, "host": strings.ToUpper(host)}})
	dom := decodeMap(t, rec)
	if rec.Code != 201 || dom["host"] != host || dom["verified"] != false || dom["default"] != false || dom["lastError"] != "" || dom["createdAt"] == nil {
		t.Fatalf("add: %d %v", rec.Code, dom)
	}
	id := dom["id"].(string)
	vr, _ := dom["verifyRecord"].(map[string]any)
	cn, _ := dom["cname"].(map[string]any)
	if vr["type"] != "TXT" || vr["name"] != "_zekra-verify."+host || vr["value"] == "" || cn["name"] != host || cn["target"] != "edge.zekra.test" {
		t.Fatalf("records: %v %v", vr, cn)
	}

	// List: any reader; not a stranger.
	for user, want := range map[string]int{"": 403, "u-bob": 403, "u-carol": 200, "u-erin": 200, "u-alice": 200, "u-admin": 200} {
		rec := f.do(req{method: "GET", path: "/api/presentations/domains?namespace=" + ns, user: user})
		if rec.Code != want {
			t.Errorf("list as %q: %d, want %d", user, rec.Code, want)
		}
		if want == 200 {
			out := decodeMap(t, rec)
			list, _ := out["domains"].([]any)
			builtin, _ := out["builtin"].(map[string]any)
			if len(list) != 1 || list[0].(map[string]any)["id"] != id || builtin["host"] != "app.zekra.test" {
				t.Errorf("list as %q: %v", user, out)
			}
		}
	}
	if rec := f.do(req{method: "GET", path: "/api/presentations/domains", user: "u-alice"}); rec.Code != 400 {
		t.Errorf("list without namespace: %d", rec.Code)
	}

	// Mutations: a stranger sees 404, a viewer/editor 403.
	for _, c := range []struct {
		user, method, suffix string
		body                 any
		want                 int
	}{
		{"u-bob", "POST", "/verify", map[string]any{}, 404},
		{"", "DELETE", "", nil, 404},
		{"u-carol", "POST", "/verify", map[string]any{}, 403},
		{"u-erin", "PATCH", "", map[string]any{"default": true}, 403},
		{"u-erin", "DELETE", "", nil, 403},
		{"u-alice", "PATCH", "", map[string]any{"default": true}, 422}, // not verified yet
	} {
		if rec := f.do(req{method: c.method, path: "/api/presentations/domains/" + id + c.suffix, user: c.user, body: c.body}); rec.Code != c.want {
			t.Errorf("%s %s as %q: %d, want %d (%s)", c.method, c.suffix, c.user, rec.Code, c.want, trim(rec.Body.String()))
		}
	}

	// Verify: wrong TXT, wrong CNAME, then right.
	verify := func() map[string]any {
		rec := f.do(req{method: "POST", path: "/api/presentations/domains/" + id + "/verify", user: "u-alice", body: map[string]any{}})
		if rec.Code != 200 {
			t.Fatalf("verify: %d %s", rec.Code, trim(rec.Body.String()))
		}
		return decodeMap(t, rec)
	}
	dns.txt["_zekra-verify."+host] = []string{"nope"}
	dns.cname[host] = "edge.zekra.test."
	if out := verify(); out["verified"] != false || !strings.Contains(out["lastError"].(string), "TXT") {
		t.Errorf("wrong TXT: %v", out)
	}
	dns.txt["_zekra-verify."+host] = []string{vr["value"].(string)}
	dns.cname[host] = "elsewhere.example.net."
	if out := verify(); out["verified"] != false || !strings.Contains(out["lastError"].(string), "edge.zekra.test") {
		t.Errorf("wrong CNAME: %v", out)
	}
	if rec := f.do(req{method: "GET", path: "/api/presentations/domains/check?host=" + host}); rec.Code != 404 {
		t.Errorf("check before verification: %d", rec.Code)
	}
	dns.cname[host] = "edge.zekra.test."
	if out := verify(); out["verified"] != true || out["lastError"] != "" {
		t.Errorf("verify: %v", out)
	}

	// The public check: 200 only for a verified host, and it says nothing.
	for q, want := range map[string]int{"host=" + host: 200, "domain=" + strings.ToUpper(host): 200, "host=other.example.com": 404, "": 404, "host=app.zekra.dev": 404} {
		rec := f.do(req{method: "GET", path: "/api/presentations/domains/check?" + q})
		if rec.Code != want || rec.Body.Len() != 0 {
			t.Errorf("check %q: %d %q, want %d and no body", q, rec.Code, rec.Body.String(), want)
		}
	}

	// A verified host cannot be claimed by another brain.
	other := f.ns("pres-b")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-bob','owner')`, other)
	if rec := f.do(req{method: "POST", path: "/api/presentations/domains", user: "u-bob", body: map[string]any{"namespace": other, "host": host}}); rec.Code != 409 {
		t.Errorf("second brain claims the host: %d", rec.Code)
	}

	if out := decodeMap(t, f.do(req{method: "PATCH", path: "/api/presentations/domains/" + id, user: "u-alice", body: map[string]any{"default": true}})); out["default"] != true {
		t.Errorf("default: %v", out)
	}
	if rec := f.do(req{method: "DELETE", path: "/api/presentations/domains/" + id, user: "u-alice"}); rec.Code != 204 {
		t.Errorf("delete: %d", rec.Code)
	}
	if rec := f.do(req{method: "GET", path: "/api/presentations/domains/check?host=" + host}); rec.Code != 404 {
		t.Errorf("check after delete: %d", rec.Code)
	}
}

func TestPresentationDomainIsolationAndShareURLs(t *testing.T) {
	f, nsA, dns := domainSetup(t)
	nsB := f.ns("pres-b")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-bob','owner')`, nsB)
	p := strings.TrimSuffix(f.prefix, "-")
	hostA, hostB := "a."+p+".example.com", "b."+p+".example.com"
	domA := f.linkDomain(dns, "u-alice", nsA, hostA)
	domB := f.linkDomain(dns, "u-bob", nsB, hostB)

	_, deckA := f.createPres("u-alice", nsA, "deck", presFixture(t, "deck"))
	_, deckB := f.createPres("u-bob", nsB, "deck", presFixture(t, "deck"))
	idA, idB := deckA["id"].(string), deckB["id"].(string)

	// A share must use a verified domain of ITS brain.
	if rec := f.do(req{method: "POST", path: "/api/presentations/" + idA + "/share", user: "u-alice", body: map[string]any{"domain_id": domB}}); rec.Code != 422 {
		t.Errorf("share on another brain's domain: %d", rec.Code)
	}
	rec := f.do(req{method: "POST", path: "/api/presentations/" + idA + "/share", user: "u-alice", body: map[string]any{"domain_id": domA}})
	shA := decodeMap(t, rec)
	tokA, _ := shA["token"].(string)
	if rec.Code != 201 || shA["url"] != "https://"+hostA+"/en/p/"+tokA ||
		shA["downloads"].(map[string]any)["pdf"] != "https://"+hostA+"/en/p/"+tokA+"/download/pdf" {
		t.Fatalf("share on a domain: %d %v", rec.Code, shA)
	}
	shB := decodeMap(t, f.do(req{method: "POST", path: "/api/presentations/" + idB + "/share", user: "u-bob", body: map[string]any{"domain": hostB}}))
	tokB, _ := shB["token"].(string)
	if shB["url"] != "https://"+hostB+"/en/p/"+tokB {
		t.Fatalf("share by host: %v", shB)
	}

	// The detail lists url, recoverable, hint, locale, domain and the counters.
	detail := decodeMap(t, f.do(req{method: "GET", path: "/api/presentations/" + idA, user: "u-carol"}))
	first := detail["shares"].([]any)[0].(map[string]any)
	for _, k := range []string{"url", "recoverable", "hint", "locale", "domain", "domain_id", "view_count", "download_count", "active"} {
		if _, ok := first[k]; !ok {
			t.Errorf("share is missing %q: %v", k, first)
		}
	}
	if first["url"] != shA["url"] || first["recoverable"] != true || first["domain"] != hostA || first["domain_id"] != domA {
		t.Errorf("listed share: %v", first)
	}

	// Host isolation on the public view.
	open := func(token, query string, headers map[string]string) int {
		return f.do(req{method: "GET", path: "/api/p/" + token + query, headers: headers}).Code
	}
	for _, c := range []struct {
		name, token, query string
		headers            map[string]string
		want               int
	}{
		{"built-in, no host", tokA, "", nil, 200},
		{"built-in host header", tokA, "", map[string]string{"X-Forwarded-Host": "app.zekra.test"}, 200},
		{"own host (query)", tokA, "?host=" + hostA, nil, 200},
		{"own host (header)", tokA, "", map[string]string{"X-Forwarded-Host": strings.ToUpper(hostA) + ":443"}, 200},
		{"B's token on A's host (query)", tokB, "?host=" + hostA, nil, 404},
		{"B's token on A's host (header)", tokB, "", map[string]string{"X-Forwarded-Host": hostA}, 404},
		{"A's token on B's host", tokA, "?host=" + hostB, nil, 404},
		{"query wins over a friendlier header", tokB, "?host=" + hostA, map[string]string{"X-Forwarded-Host": hostB}, 404},
		{"an unknown custom host", tokA, "?host=evil.example.org", nil, 404},
		{"B on its own host", tokB, "?host=" + hostB, nil, 200},
	} {
		if got := open(c.token, c.query, c.headers); got != c.want {
			t.Errorf("%s: %d, want %d", c.name, got, c.want)
		}
	}
	// The 404 is the ordinary "link not valid" answer: a host reveals nothing about tokens.
	wrong := f.do(req{method: "GET", path: "/api/p/" + tokB + "?host=" + hostA})
	unknown := f.do(req{method: "GET", path: "/api/p/" + strings.Repeat("A", 43) + "?host=" + hostA})
	if wrong.Body.String() != unknown.Body.String() {
		t.Errorf("a foreign token answers differently from an unknown one:\n%s\n%s", wrong.Body.String(), unknown.Body.String())
	}

	// PATCH a share: editor may, viewer may not; unpinning falls back to the built-in base.
	shareID := shA["share"].(map[string]any)["id"].(string)
	path := "/api/presentations/" + idA + "/shares/" + shareID
	for user, want := range map[string]int{"u-bob": 404, "u-carol": 403, "": 404} {
		if rec := f.do(req{method: "PATCH", path: path, user: user, body: map[string]any{"label": "x"}}); rec.Code != want {
			t.Errorf("patch share as %q: %d, want %d", user, rec.Code, want)
		}
		if rec := f.do(req{method: "POST", path: path + "/reissue", user: user, body: map[string]any{}}); rec.Code != want {
			t.Errorf("reissue as %q: %d, want %d", user, rec.Code, want)
		}
	}
	rec = f.do(req{method: "PATCH", path: path, user: "u-erin", body: map[string]any{"label": "for Sara", "expires_in_days": 5, "domain_id": ""}})
	patched := decodeMap(t, rec)
	if rec.Code != 200 || patched["label"] != "for Sara" || patched["expires_at"] == nil || patched["domain_id"] != "" ||
		patched["url"] != "https://app.zekra.test/en/p/"+tokA || patched["domain"] != "app.zekra.test" {
		t.Fatalf("patch: %d %v", rec.Code, patched)
	}
	if rec := f.do(req{method: "PATCH", path: path, user: "u-erin", body: map[string]any{"domain_id": domB}}); rec.Code != 422 {
		t.Errorf("patch onto another brain's domain: %d", rec.Code)
	}
	if rec := f.do(req{method: "PATCH", path: path, user: "u-erin", body: map[string]any{"domain_id": domA}}); rec.Code != 200 {
		t.Errorf("patch back onto the domain: %d", rec.Code)
	}

	// Reissue: a new token on the same label / expiry / domain; the old one is dead.
	rec = f.do(req{method: "POST", path: path + "/reissue", user: "u-erin", body: map[string]any{}})
	re := decodeMap(t, rec)
	newTok, _ := re["token"].(string)
	newShare, _ := re["share"].(map[string]any)
	if rec.Code != 201 || newTok == "" || newTok == tokA || re["url"] != "https://"+hostA+"/en/p/"+newTok || re["revoked"] != shareID ||
		newShare["label"] != "for Sara" || newShare["domain_id"] != domA || newShare["expires_at"] != patched["expires_at"] {
		t.Fatalf("reissue: %d %v", rec.Code, re)
	}
	if open(tokA, "", nil) != 404 || open(newTok, "?host="+hostA, nil) != 200 {
		t.Error("after a reissue the old token must be dead and the new one live")
	}

	// Deleting the domain keeps the link; its URL falls back, and the host stops serving.
	if rec := f.do(req{method: "DELETE", path: "/api/presentations/domains/" + domA, user: "u-alice"}); rec.Code != 204 {
		t.Fatalf("delete domain: %d", rec.Code)
	}
	detail = decodeMap(t, f.do(req{method: "GET", path: "/api/presentations/" + idA, user: "u-alice"}))
	if first := detail["shares"].([]any)[0].(map[string]any); first["url"] != "https://app.zekra.test/en/p/"+newTok {
		t.Errorf("after the domain is deleted: %v", first)
	}
	if open(newTok, "", nil) != 200 || open(newTok, "?host="+hostA, nil) != 404 {
		t.Error("a deleted domain's links must open on the built-in host only")
	}
}
