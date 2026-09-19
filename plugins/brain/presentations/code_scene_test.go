package presentations

import (
	"encoding/json"
	"strings"
	"testing"
)

/*
FM-346 "code" scenes: model-written HTML that only ever runs in a sandboxed,
CSP-locked iframe. These cover the defence-in-depth validation; the frame
itself is tested in web/lib/presentations/presentations.test.ts and attacked in
a real Chrome (see the FM-346 notes).
*/

const threeURL = "https://cdn.jsdelivr.net/npm/three@" + ThreeVersion + "/build/three.module.js"

const legitCode = `<canvas id="c"></canvas>
<style>html,body{margin:0;height:100%}canvas{width:100%;height:100%;display:block}</style>
<script type="importmap">{"imports":{"three":"` + threeURL + `","three/addons/":"https://cdn.jsdelivr.net/npm/three@` + ThreeVersion + `/examples/jsm/"}}</script>
<script type="module">
import * as THREE from "three";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@` + ThreeVersion + `/examples/jsm/controls/OrbitControls.js";
const r = new THREE.WebGLRenderer({ canvas: document.getElementById("c") });
// a string that only looks like markup: "<iframe src=x>" is fine inside a script
</script>
<script src="https://unpkg.com/three@` + ThreeVersion + `/build/three.module.min.js" type="module"></script>`

func codePage(t *testing.T, html any, extra map[string]any) map[string]any {
	return mutate(t, KindPage, func(m map[string]any) {
		params := map[string]any{"html": html}
		for k, v := range extra {
			params[k] = v
		}
		item(m, "sections", 2)["scene"] = map[string]any{"type": "code", "params": params}
	})
}

func TestCodeSceneAcceptsLegitimateThreeJS(t *testing.T) {
	norm, _, err := ValidateContent(KindPage, codePage(t, legitCode, map[string]any{"aspect": "4:3"}))
	if err != nil {
		t.Fatalf("legitimate code scene refused: %v", err)
	}
	b, _ := json.Marshal(norm)
	if !strings.Contains(string(b), `"aspect":"4:3"`) || !strings.Contains(string(b), `"type":"code"`) {
		t.Fatalf("code scene not normalised: %.300s", b)
	}
	// default aspect
	norm, _, err = ValidateContent(KindPage, codePage(t, "<canvas></canvas>", nil))
	if err != nil {
		t.Fatal(err)
	}
	b, _ = json.Marshal(norm)
	if !strings.Contains(string(b), `"aspect":"16:9"`) {
		t.Fatalf("aspect default missing: %.300s", b)
	}
}

func TestCodeSceneRejects(t *testing.T) {
	const p = "content.sections[2].scene.params"
	cases := []struct {
		name  string
		html  any
		extra map[string]any
		want  string
	}{
		{"too large (200 KB)", "<p>" + strings.Repeat("x", 200*1024) + "</p>", nil, p + ".html: is "},
		{"empty", "   ", nil, p + ".html: must not be empty"},
		{"missing html", nil, nil, p + ".html: is required"},
		{"not a string", 42, nil, p + ".html: must be a string"},
		{"meta refresh", `<meta http-equiv="refresh" content="0;url=https://evil.test">`, nil, `<meta http-equiv="refresh"> is not allowed`},
		{"meta refresh, odd case", `<META HTTP-EQUIV=" Refresh " content="0">`, nil, `<meta http-equiv="refresh"> is not allowed`},
		{"meta csp override", `<meta http-equiv="Content-Security-Policy" content="default-src *">`, nil, "<meta http-equiv> is not allowed"},
		{"base", `<base href="https://evil.test/">`, nil, "<base> is not allowed"},
		{"iframe", `<iframe src="https://evil.test"></iframe>`, nil, "<iframe> is not allowed"},
		{"iframe srcdoc", `<IFRAME srcdoc="<script>parent.x</script>"></IFRAME>`, nil, "<iframe> is not allowed"},
		{"frame", `<frameset><frame src="x"></frameset>`, nil, "<frame> is not allowed"},
		{"object", `<object data="x.swf"></object>`, nil, "<object> is not allowed"},
		{"embed", `<embed src="x.swf">`, nil, "<embed> is not allowed"},
		{"link", `<link rel="stylesheet" href="https://evil.test/x.css">`, nil, "<link> is not allowed"},
		{"script from another host", `<script src="https://evil.test/x.js"></script>`, nil, "is not on the script allowlist"},
		{"script from an allowed host, other package", `<script src="https://cdn.jsdelivr.net/npm/evil@1/x.js"></script>`, nil, "is not on the script allowlist"},
		{"three at another version", `<script src="https://cdn.jsdelivr.net/npm/three@0.1.0/build/three.module.js"></script>`, nil, "is not on the script allowlist"},
		{"allowlisted prefix with traversal", `<script src="https://cdn.jsdelivr.net/npm/three@` + ThreeVersion + `/examples/jsm/../../../evil@1/x.js"></script>`, nil, "is not on the script allowlist"},
		{"allowlisted URL plus query", `<script src="` + threeURL + `?x=1"></script>`, nil, "is not on the script allowlist"},
		{"protocol-relative script", `<script src="//evil.test/x.js"></script>`, nil, "is not on the script allowlist"},
		{"data: script", `<script src="data:text/javascript,alert(1)"></script>`, nil, "is not on the script allowlist"},
		{"relative script", `<script src="/api/x.js"></script>`, nil, "is not on the script allowlist"},
		{"svg script href", `<svg><script href="https://evil.test/x.js"></script></svg>`, nil, "is not on the script allowlist"},
		{"importmap to another host", `<script type="importmap">{"imports":{"three":"https://evil.test/three.js"}}</script>`, nil, `importmap target "https://evil.test/three.js"`},
		{"importmap not json", `<script type="importmap">{nope</script>`, nil, "must be valid JSON"},
		{"module import from another host", `<script type="module">import x from "https://evil.test/x.js"</script>`, nil, `import "https://evil.test/x.js"`},
		{"dynamic import from another host", `<script type="module">await import('https://evil.test/x.js')</script>`, nil, `import "https://evil.test/x.js"`},
		{"bad aspect", "<canvas></canvas>", map[string]any{"aspect": "9:16"}, p + ".aspect: must be one of"},
		{"unknown param", "<canvas></canvas>", map[string]any{"sandbox": "allow-same-origin"}, p + ".sandbox: unknown param"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var m map[string]any
			if c.html == nil {
				m = mutate(t, KindPage, func(m map[string]any) {
					item(m, "sections", 2)["scene"] = map[string]any{"type": "code", "params": map[string]any{}}
				})
			} else {
				m = codePage(t, c.html, c.extra)
			}
			got := errorsOf(t, KindPage, m)
			if !strings.Contains(got, c.want) {
				t.Fatalf("want %q in errors, got %q", c.want, got)
			}
		})
	}
}

func TestAllowedScriptURL(t *testing.T) {
	if CodeSceneMaxBytes != 200*1024 {
		t.Errorf("the code scene limit is %d bytes, documented as 200 KB", CodeSceneMaxBytes)
	}
	for _, u := range CodeScriptAllowlist {
		if strings.HasSuffix(u, "/") {
			if AllowedScriptURL(u) {
				t.Errorf("a bare directory is not a script: %s", u)
			}
			if !AllowedScriptURL(u + "controls/OrbitControls.js") {
				t.Errorf("addon under %s refused", u)
			}
			continue
		}
		if !AllowedScriptURL(u) {
			t.Errorf("allowlisted URL refused: %s", u)
		}
		if !strings.Contains(u, "@"+ThreeVersion+"/") {
			t.Errorf("allowlist entry is not pinned to %s: %s", ThreeVersion, u)
		}
	}
	for _, u := range []string{"", "http://cdn.jsdelivr.net/npm/three@" + ThreeVersion + "/build/three.module.js", threeURL + "#x", threeURL + "%00", "https://cdn.jsdelivr.net/npm/three@latest/build/three.module.js"} {
		if AllowedScriptURL(u) {
			t.Errorf("accepted %q", u)
		}
	}
}

func TestCodeSceneCSPAndCatalog(t *testing.T) {
	for _, d := range []string{"default-src 'none'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'",
		"script-src 'unsafe-inline' https://cdn.jsdelivr.net/npm/three@" + ThreeVersion + "/ https://unpkg.com/three@" + ThreeVersion + "/;"} {
		if !strings.Contains(CodeSceneCSP, d) {
			t.Errorf("CSP lacks %q", d)
		}
	}
	for _, bad := range []string{"'unsafe-eval'", "*", "'self'", "http:"} {
		if strings.Contains(CodeSceneCSP, bad) {
			t.Errorf("CSP allows %s", bad)
		}
	}
	st, ok := SceneByType("code")
	if !ok || st.Engine != "iframe" {
		t.Fatalf("code scene not in the catalog: %+v", st)
	}
	for _, want := range []string{"sandbox", "200 KB", "<base>", "<iframe>", "<object>", "<embed>", "http-equiv", threeURL, "placeholder"} {
		if !strings.Contains(st.Description, want) {
			t.Errorf("code scene description does not mention %q", want)
		}
	}
	if s := SchemaSummary(); !strings.Contains(s, `type:"code"`) || !strings.Contains(s, "200 KB") {
		t.Errorf("schema summary does not describe code scenes")
	}
}

// The CSP's script sources are exactly the allowlist's directories.
func TestCodeSceneCSPPinsScriptPaths(t *testing.T) {
	for _, a := range CodeScriptAllowlist {
		dir := a[:strings.Index(a, "@"+ThreeVersion+"/")+len("@"+ThreeVersion+"/")]
		if !strings.Contains(CodeSceneCSP, " "+dir+" ") && !strings.Contains(CodeSceneCSP, " "+dir+";") {
			t.Errorf("CSP does not pin %s", dir)
		}
	}
	for _, host := range []string{"https://cdn.jsdelivr.net ", "https://unpkg.com ", "https://cdn.jsdelivr.net;", "https://unpkg.com;"} {
		if strings.Contains(CodeSceneCSP, host) {
			t.Errorf("CSP allows a whole host: %q", host)
		}
	}
}

func TestCodeSceneDescribesTheme(t *testing.T) {
	st, _ := SceneByType("code")
	if !strings.Contains(st.Description, `data-theme=\"light|dark\"`) && !strings.Contains(st.Description, `data-theme="light|dark"`) {
		t.Error("code scene description does not tell the author how to follow the theme")
	}
}
