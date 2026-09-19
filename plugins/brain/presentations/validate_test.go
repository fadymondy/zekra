package presentations

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

/*
FM-342/343/344/346: what the validator accepts and refuses. Content is the
only thing standing between a model's JSON and the renderers, so every rule
here was also broken on purpose once to see the test fail.
*/

func fixture(t *testing.T, kind string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile("testdata/" + kind + ".json")
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

// mutate decodes a fixture, applies f, and returns it.
func mutate(t *testing.T, kind string, f func(m map[string]any)) map[string]any {
	m := fixture(t, kind)
	f(m)
	return m
}

func errorsOf(t *testing.T, kind string, content map[string]any) string {
	t.Helper()
	_, _, err := ValidateContent(kind, content)
	if err == nil {
		return ""
	}
	return err.Error()
}

func item(m map[string]any, list string, i int) map[string]any {
	return m[list].([]any)[i].(map[string]any)
}

func TestFixturesAreValid(t *testing.T) {
	for _, kind := range Kinds {
		norm, _, err := ValidateContent(kind, fixture(t, kind))
		if err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
		if norm["title"] == "" {
			t.Errorf("%s: title lost", kind)
		}
	}
}

func TestEveryKindRejectsWhatItShould(t *testing.T) {
	cases := []struct {
		name, kind, want string
		f                func(m map[string]any)
	}{
		{"deck needs slides", KindDeck, "content.slides: is required", func(m map[string]any) { delete(m, "slides") }},
		{"deck empty slides", KindDeck, "needs at least 1", func(m map[string]any) { m["slides"] = []any{} }},
		{"unknown slide type", KindDeck, `unknown type "video"`, func(m map[string]any) { item(m, "slides", 0)["type"] = "video" }},
		{"bullets need bullets", KindDeck, "content.slides[1].bullets: is required", func(m map[string]any) { delete(item(m, "slides", 1), "bullets") }},
		{"too many bullets", KindDeck, "allows at most 12", func(m map[string]any) {
			var b []any
			for i := 0; i < 13; i++ {
				b = append(b, "x")
			}
			item(m, "slides", 1)["bullets"] = b
		}},
		{"unknown slide field", KindDeck, "content.slides[0].onclick: unknown field", func(m map[string]any) { item(m, "slides", 0)["onclick"] = "x" }},
		{"javascript url", KindDeck, "image_url: must be an https:// URL", func(m map[string]any) { item(m, "slides", 6)["image_url"] = "javascript:alert(1)" }},
		{"protocol-relative url", KindDeck, "image_url: must be an https:// URL", func(m map[string]any) { item(m, "slides", 6)["image_url"] = "//evil.test/x.png" }},
		{"image needs alt", KindDeck, "alt: is required", func(m map[string]any) { delete(item(m, "slides", 6), "alt") }},
		{"metric trend enum", KindDeck, "trend: must be one of", func(m map[string]any) {
			item(m, "slides", 2)["metrics"].([]any)[0].(map[string]any)["trend"] = "sideways"
		}},
		{"title too long", KindDeck, "at most 200 characters", func(m map[string]any) { m["title"] = strings.Repeat("a", 201) }},
		{"report needs sections", KindReport, "content.sections: is required", func(m map[string]any) { delete(m, "sections") }},
		{"unknown block", KindReport, `unknown type "html"`, func(m map[string]any) {
			item(m, "sections", 0)["blocks"].([]any)[0].(map[string]any)["type"] = "html"
		}},
		{"chart kind", KindReport, "chart: must be one of", func(m map[string]any) {
			item(m, "sections", 0)["blocks"].([]any)[1].(map[string]any)["chart"] = "pie3d"
		}},
		{"chart values numeric", KindReport, "must be a finite number", func(m map[string]any) {
			s := item(m, "sections", 0)["blocks"].([]any)[1].(map[string]any)["series"].([]any)[0].(map[string]any)
			s["values"] = []any{1.0, "two", 3.0, 4.0}
		}},
		{"callout tone", KindReport, "tone: must be one of", func(m map[string]any) {
			item(m, "sections", 0)["blocks"].([]any)[2].(map[string]any)["tone"] = "loud"
		}},
		{"table rows are arrays", KindReport, "must be an array of at most 12 cells", func(m map[string]any) {
			item(m, "sections", 1)["blocks"].([]any)[0].(map[string]any)["rows"] = []any{"a,b,c"}
		}},
		{"page needs sections", KindPage, "content.sections: is required", func(m map[string]any) { delete(m, "sections") }},
		{"unknown page section", KindPage, `unknown type "script"`, func(m map[string]any) { item(m, "sections", 0)["type"] = "script" }},
		{"pricing max plans", KindPage, "allows at most 4", func(m map[string]any) {
			p := item(m, "sections", 3)["plans"].([]any)
			item(m, "sections", 3)["plans"] = append(p, p[0], p[0], p[0])
		}},
		{"cta href", KindPage, "cta_href: must be an https:// URL", func(m map[string]any) { item(m, "sections", 6)["cta_href"] = "data:text/html,hi" }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := errorsOf(t, c.kind, mutate(t, c.kind, c.f))
			if !strings.Contains(got, c.want) {
				t.Fatalf("want an error containing %q, got %q", c.want, got)
			}
		})
	}
	if got := errorsOf(t, "slides", map[string]any{}); !strings.Contains(got, "kind") {
		t.Errorf("unknown kind: %q", got)
	}
}

func TestScenes(t *testing.T) {
	scene := func(s map[string]any) map[string]any {
		return mutate(t, KindPage, func(m map[string]any) { item(m, "sections", 2)["scene"] = s })
	}
	cases := []struct {
		name string
		s    map[string]any
		want string
	}{
		{"unknown type", map[string]any{"type": "eval", "params": map[string]any{}}, `unknown scene type "eval"`},
		{"missing type", map[string]any{"params": map[string]any{}}, `unknown scene type ""`},
		{"arbitrary html", map[string]any{"type": "html", "params": map[string]any{"html": "<script>"}}, `unknown scene type "html"`},
		{"extra top-level key", map[string]any{"type": "particles", "code": "alert(1)"}, "scene.code: unknown field"},
		{"unknown param", map[string]any{"type": "particles", "params": map[string]any{"onframe": "x"}}, "params.onframe: unknown param"},
		{"out of range", map[string]any{"type": "particles", "params": map[string]any{"count": 1e7}}, "params.count: must be between 100 and 5000"},
		{"not an integer", map[string]any{"type": "globe", "params": map[string]any{"arcs": 2.5}}, "must be a whole number"},
		{"not a number", map[string]any{"type": "globe", "params": map[string]any{"points": "many"}}, "must be a number"},
		{"raw colour", map[string]any{"type": "particles", "params": map[string]any{"color": "#ff0000"}}, "must be one of: brand"},
		{"colour list token", map[string]any{"type": "gradient_mesh", "params": map[string]any{"colors": []any{"brand", "red"}}}, "must be a colour token"},
		{"colour list size", map[string]any{"type": "gradient_mesh", "params": map[string]any{"colors": []any{"brand"}}}, "must have 2 to 4 items"},
		{"enum", map[string]any{"type": "floating_geometry", "params": map[string]any{"shape": "teapot"}}, "must be one of: torus"},
		{"boolean", map[string]any{"type": "floating_geometry", "params": map[string]any{"wireframe": "yes"}}, "must be true or false"},
		{"required list", map[string]any{"type": "product_orbit", "params": map[string]any{}}, "params.labels: is required"},
		{"label length", map[string]any{"type": "product_orbit", "params": map[string]any{"labels": []any{"a", strings.Repeat("b", 41)}}}, "at most 40 characters"},
		{"chart values", map[string]any{"type": "chart", "params": map[string]any{"values": []any{1.0}}}, "must have 2 to 24 items"},
		{"params not object", map[string]any{"type": "chart", "params": []any{}}, "params: must be an object"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := errorsOf(t, KindPage, scene(c.s)); !strings.Contains(got, c.want) {
				t.Fatalf("want %q, got %q", c.want, got)
			}
		})
	}

	// Defaults are filled in, so a renderer never sees a missing param.
	norm, _, err := ValidateContent(KindPage, scene(map[string]any{"type": "floating_geometry"}))
	if err != nil {
		t.Fatal(err)
	}
	p := norm["sections"].([]any)[2].(map[string]any)["scene"].(map[string]any)["params"].(map[string]any)
	if p["shape"] != "icosahedron" || p["count"] != float64(6) || p["wireframe"] != true || p["color"] != "brand" {
		t.Fatalf("defaults not applied: %v", p)
	}
	// Every scene type's defaults are themselves valid.
	for _, st := range SceneTypes {
		defaults := map[string]any{}
		for _, prm := range st.Params {
			b, _ := json.Marshal(prm.Default)
			var v any
			_ = json.Unmarshal(b, &v)
			defaults[prm.Name] = v
		}
		if got := errorsOf(t, KindPage, scene(map[string]any{"type": st.Type, "params": defaults})); got != "" {
			t.Errorf("%s: its own defaults are invalid: %s", st.Type, got)
		}
	}
}

func TestSchemaAndSummaryCoverEveryType(t *testing.T) {
	for _, k := range Kinds {
		s := ContentSchema(k)
		if _, err := json.Marshal(s); err != nil || s["type"] != "object" {
			t.Fatalf("%s schema: %v", k, err)
		}
	}
	sum := SchemaSummary()
	for _, want := range []string{"two_column", "embed", "metric", "callout", "chart", "table", "hero", "pricing", "gallery", "scene"} {
		if !strings.Contains(sum, want) {
			t.Errorf("schema summary is missing %s", want)
		}
	}
	raw, _ := json.Marshal(ContentSchema(KindPage))
	for _, st := range SceneTypes {
		if !strings.Contains(string(raw), `"`+st.Type+`"`) {
			t.Errorf("page schema does not list scene %s", st.Type)
		}
	}
}

func TestSafeURL(t *testing.T) {
	for u, want := range map[string]bool{
		"https://fadymondy.com/x": true, "http://a.test": true, "/uploads/a.png": true, "": true,
		"javascript:alert(1)": false, "JavaScript:alert(1)": false, "data:image/png;base64,xx": false,
		"//evil.test": false, "/\\evil.test": false, "vbscript:x": false, "https://": false, "ftp://a.test/x": false,
	} {
		if SafeURL(u) != want {
			t.Errorf("SafeURL(%q) = %v, want %v", u, !want, want)
		}
	}
}

func TestStripNotesIsDeep(t *testing.T) {
	c := fixture(t, KindDeck)
	out, _ := json.Marshal(stripNotes(c))
	if strings.Contains(string(out), "notes") || strings.Contains(string(out), "outage from March") {
		t.Fatalf("speaker notes survived: %s", out)
	}
	if !strings.Contains(string(out), "What we found") {
		t.Fatal("stripping removed content")
	}
}

func TestSameShape(t *testing.T) {
	a := fixture(t, KindPage)
	b := mutate(t, KindPage, func(m map[string]any) { m["title"] = "مرحبا" })
	if err := sameShape("c", a, b); err != nil {
		t.Fatalf("a translated string is a change of shape: %v", err)
	}
	for name, f := range map[string]func(m map[string]any){
		"scene":  func(m map[string]any) { item(m, "sections", 2)["scene"] = map[string]any{"type": "chart"} },
		"href":   func(m map[string]any) { item(m, "sections", 6)["cta_href"] = "https://evil.test" },
		"length": func(m map[string]any) { m["sections"] = m["sections"].([]any)[:1] },
		"type":   func(m map[string]any) { item(m, "sections", 0)["type"] = "cta" },
		"added":  func(m map[string]any) { m["extra"] = "x" },
	} {
		if err := sameShape("c", a, mutate(t, KindPage, f)); err == nil {
			t.Errorf("%s: a structural change passed", name)
		}
	}
}

func TestLimiter(t *testing.T) {
	l := newLimiter()
	now := l.now()
	l.now = func() time.Time { return now }
	for i := 0; i < hitLimit; i++ {
		if !l.allow("1.2.3.4") {
			t.Fatalf("refused at %d", i)
		}
	}
	if l.allow("1.2.3.4") {
		t.Fatal("the per-minute limit did not apply")
	}
	if !l.allow("5.6.7.8") {
		t.Fatal("one address's limit applied to another")
	}
	for i := 0; i < missLimit; i++ {
		l.miss("9.9.9.9")
	}
	if l.allow("9.9.9.9") {
		t.Fatal("a token scanner was not refused")
	}
	now = now.Add(missWindow + time.Second)
	if !l.allow("9.9.9.9") || !l.allow("1.2.3.4") {
		t.Fatal("limits did not expire")
	}
}
