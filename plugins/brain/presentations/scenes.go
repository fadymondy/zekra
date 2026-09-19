package presentations

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

/*
Style presets and scene types for page previews (FM-346).

A scene is DATA: {"type": "particles", "params": {...}}. The web app renders
each type with a vetted component (web/components/presentations/scenes).
Unknown types and unknown params are refused here, and every number is
range-checked, so a stored scene can only ever ask a renderer for something it
was built to draw.

The one exception is "code" (code_scene.go): model-written HTML/CSS/JS that
runs ONLY inside <iframe sandbox="allow-scripts" srcdoc> under its own CSP, so
it has an opaque origin and never executes as fadymondy.com.

Colours are design-system TOKENS (brand, primary, chart-1…), never raw values:
the page must follow light/dark and the site's palette.
*/

// ColorTokens are the design-system colours a scene or preset may name.
var ColorTokens = []string{"brand", "primary", "accent", "foreground", "muted", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5"}

// StylePreset is one look a page preview can take.
type StylePreset struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// StylePresets is the fixed set, built from the site design system.
var StylePresets = []StylePreset{
	{Key: "minimal", Name: "Minimal", Description: "Quiet: hairline rules, generous whitespace, the site's grid look. Good for consulting and B2B."},
	{Key: "bold", Name: "Bold", Description: "Large type, brand-coloured hero band, strong contrast. Good for launches and consumer products."},
	{Key: "editorial", Name: "Editorial", Description: "Serif-leaning headings, narrow reading column, pull quotes. Good for stories and reports-as-pages."},
	{Key: "tech-dark", Name: "Tech dark", Description: "Always dark, mono accents, glowing brand edges. Good for developer tools, AI and infrastructure."},
}

// IsStyle reports whether key is a preset.
func IsStyle(key string) bool {
	for _, s := range StylePresets {
		if s.Key == key {
			return true
		}
	}
	return false
}

// Param kinds.
const (
	ParamNumber     = "number"
	ParamInteger    = "integer"
	ParamBoolean    = "boolean"
	ParamEnum       = "enum"
	ParamColor      = "color"
	ParamColorList  = "color_list"
	ParamStringList = "string_list"
	ParamNumberList = "number_list"
	// ParamCode is an HTML document body, validated by validateCodeHTML.
	ParamCode = "code"
)

// Param is one typed scene parameter.
type Param struct {
	Name        string   `json:"name"`
	Kind        string   `json:"kind"`
	Description string   `json:"description"`
	Min         *float64 `json:"min,omitempty"`
	Max         *float64 `json:"max,omitempty"`
	Enum        []string `json:"enum,omitempty"`
	MinItems    int      `json:"min_items,omitempty"`
	MaxItems    int      `json:"max_items,omitempty"`
	MaxLength   int      `json:"max_length,omitempty"`
	Default     any      `json:"default"`
	Required    bool     `json:"required,omitempty"`
}

// SceneType is one renderer the web app ships.
type SceneType struct {
	Type        string  `json:"type"`
	Engine      string  `json:"engine"` // three | canvas | iframe
	Description string  `json:"description"`
	Params      []Param `json:"params"`
}

func f(v float64) *float64 { return &v }

func num(name, desc string, min, max, def float64) Param {
	return Param{Name: name, Kind: ParamNumber, Description: desc, Min: f(min), Max: f(max), Default: def}
}

func integer(name, desc string, min, max, def float64) Param {
	return Param{Name: name, Kind: ParamInteger, Description: desc, Min: f(min), Max: f(max), Default: def}
}

func color(name, desc, def string) Param {
	return Param{Name: name, Kind: ParamColor, Description: desc, Enum: ColorTokens, Default: def}
}

// SceneTypes is the vetted set. Adding one here requires a renderer in
// web/components/presentations/scenes with the same type key.
var SceneTypes = []SceneType{
	{
		Type: "particles", Engine: "three",
		Description: "A slowly drifting 3D particle field.",
		Params: []Param{
			integer("count", "number of particles", 100, 5000, 1500),
			color("color", "particle colour token", "brand"),
			num("size", "particle size in px", 0.5, 6, 2),
			num("speed", "drift speed multiplier", 0, 3, 0.6),
			num("spread", "cloud radius in scene units", 2, 30, 12),
		},
	},
	{
		Type: "globe", Engine: "three",
		Description: "A rotating dotted globe with optional arcs between random points.",
		Params: []Param{
			integer("points", "dots on the sphere", 100, 4000, 1200),
			integer("arcs", "arcs drawn between points", 0, 24, 8),
			color("color", "dot colour token", "brand"),
			color("arc_color", "arc colour token", "accent"),
			num("rotation_speed", "turns per minute", 0, 20, 3),
		},
	},
	{
		Type: "floating_geometry", Engine: "three",
		Description: "Floating, slowly rotating solids.",
		Params: []Param{
			{Name: "shape", Kind: ParamEnum, Description: "solid", Enum: []string{"torus", "icosahedron", "box", "torus_knot", "octahedron"}, Default: "icosahedron"},
			integer("count", "how many solids", 1, 24, 6),
			{Name: "wireframe", Kind: ParamBoolean, Description: "draw edges only", Default: true},
			color("color", "solid colour token", "brand"),
			num("speed", "rotation speed multiplier", 0, 3, 0.8),
		},
	},
	{
		Type: "product_orbit", Engine: "three",
		Description: "A central core with labelled satellites orbiting it (a product and its modules).",
		Params: []Param{
			{Name: "labels", Kind: ParamStringList, Description: "satellite labels, shown as a legend", MinItems: 2, MaxItems: 8, MaxLength: 40, Required: true, Default: []string{"API", "Web", "Mobile"}},
			num("orbit_radius", "orbit radius in scene units", 2, 10, 4),
			num("speed", "orbit speed multiplier", 0, 3, 0.7),
			color("core_color", "core colour token", "brand"),
			color("satellite_color", "satellite colour token", "accent"),
		},
	},
	{
		Type: "gradient_mesh", Engine: "canvas",
		Description: "Soft animated blobs of colour.",
		Params: []Param{
			{Name: "colors", Kind: ParamColorList, Description: "2–4 colour tokens", Enum: ColorTokens, MinItems: 2, MaxItems: 4, Default: []string{"brand", "chart-2", "chart-4"}},
			num("speed", "motion speed multiplier", 0, 3, 0.5),
			num("blur", "blur radius in px", 0, 120, 60),
		},
	},
	{
		Type: "generative_lines", Engine: "canvas",
		Description: "Flowing sine lines.",
		Params: []Param{
			integer("lines", "number of lines", 3, 200, 40),
			num("amplitude", "wave height as a share of the canvas", 0.01, 0.5, 0.15),
			num("frequency", "waves across the canvas", 0.5, 12, 3),
			num("speed", "motion speed multiplier", 0, 3, 0.6),
			color("color", "line colour token", "brand"),
		},
	},
	{
		Type: "chart", Engine: "canvas",
		Description: "A simple animated bar or line chart drawn on canvas (decorative; use a report chart block for data people must read).",
		Params: []Param{
			{Name: "kind", Kind: ParamEnum, Description: "chart kind", Enum: []string{"bar", "line"}, Default: "bar"},
			{Name: "values", Kind: ParamNumberList, Description: "2–24 values", MinItems: 2, MaxItems: 24, Required: true, Default: []float64{3, 5, 4, 7, 9}},
			{Name: "labels", Kind: ParamStringList, Description: "optional labels, one per value", MaxItems: 24, MaxLength: 24, Default: []string{}},
			color("color", "series colour token", "brand"),
		},
	},
	{
		Type: "code", Engine: "iframe",
		Description: "Free-form HTML/CSS/JS written by you, run in a sandboxed iframe (sandbox=\"allow-scripts\", opaque origin, srcdoc) " +
			"under a fixed CSP: " + CodeSceneCSP + ". No network (fetch/XHR/WebSocket fail), no cookies or storage, no forms, " +
			"popups, modals or top navigation, no nested frames. Limits: html at most " + codeSceneMaxKB + "; no <meta http-equiv>, " +
			"<base>, <link>, <iframe>/<frame>, <object> or <embed>; the ONLY external scripts are " + codeScriptAllowlistText() +
			" (as <script src>, an importmap, or an import in a module script). Draw with canvas/WebGL; the frame is transparent " +
			"and follows the page theme: <html> carries data-theme=\"light|dark\", dir and a matching color-scheme (use CanvasText/light-dark()). " +
			"PDF/Word exports show a placeholder.",
		Params: []Param{
			{Name: "html", Kind: ParamCode, Description: "the document body: markup, <style> and inline <script> (type=module allowed)", MaxLength: CodeSceneMaxBytes, Required: true, Default: `<canvas style="width:100%;height:100%"></canvas>`},
			{Name: "aspect", Kind: ParamEnum, Description: "frame aspect ratio (width:height); the frame never resizes to its content", Enum: CodeSceneAspects, Default: "16:9"},
		},
	},
}

// SceneByType looks a scene type up.
func SceneByType(t string) (SceneType, bool) {
	for _, s := range SceneTypes {
		if s.Type == t {
			return s, true
		}
	}
	return SceneType{}, false
}

func sceneTypeNames() string {
	names := make([]string, 0, len(SceneTypes))
	for _, s := range SceneTypes {
		names = append(names, s.Type)
	}
	return strings.Join(names, ", ")
}

func isColorToken(s string) bool {
	for _, c := range ColorTokens {
		if c == s {
			return true
		}
	}
	return false
}

func asFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, !math.IsNaN(n) && !math.IsInf(n, 0)
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	}
	return 0, false
}

// validateScene checks {"type","params"} at path and returns the normalised
// scene (defaults filled in).
func validateScene(v *validator, path string, raw any) map[string]any {
	m, ok := raw.(map[string]any)
	if !ok {
		v.add(path, "must be an object {\"type\": ..., \"params\": {...}}")
		return nil
	}
	typ, _ := m["type"].(string)
	st, ok := SceneByType(typ)
	if !ok {
		v.add(path+".type", fmt.Sprintf("unknown scene type %q; use one of: %s (see page_styles)", typ, sceneTypeNames()))
		return nil
	}
	for k := range m {
		if k != "type" && k != "params" {
			v.add(path+"."+k, "unknown field; a scene has only type and params")
		}
	}
	params := map[string]any{}
	if p, present := m["params"]; present && p != nil {
		pm, ok := p.(map[string]any)
		if !ok {
			v.add(path+".params", "must be an object")
			return nil
		}
		params = pm
	}
	known := map[string]Param{}
	for _, p := range st.Params {
		known[p.Name] = p
	}
	var unknown []string
	for k := range params {
		if _, ok := known[k]; !ok {
			unknown = append(unknown, k)
		}
	}
	sort.Strings(unknown)
	for _, k := range unknown {
		v.add(path+".params."+k, fmt.Sprintf("unknown param for %s", typ))
	}
	out := map[string]any{}
	for _, p := range st.Params {
		pp := path + ".params." + p.Name
		val, present := params[p.Name]
		if !present || val == nil {
			if p.Required {
				v.add(pp, "is required")
			}
			out[p.Name] = p.Default
			continue
		}
		if norm, ok := checkParam(v, pp, p, val); ok {
			out[p.Name] = norm
		}
	}
	return map[string]any{"type": typ, "params": out}
}

func checkRange(v *validator, path string, p Param, n float64) bool {
	if p.Min != nil && n < *p.Min || p.Max != nil && n > *p.Max {
		v.add(path, fmt.Sprintf("must be between %g and %g", *p.Min, *p.Max))
		return false
	}
	return true
}

func checkParam(v *validator, path string, p Param, val any) (any, bool) {
	switch p.Kind {
	case ParamNumber, ParamInteger:
		n, ok := asFloat(val)
		if !ok {
			v.add(path, "must be a number")
			return nil, false
		}
		if p.Kind == ParamInteger && n != math.Trunc(n) {
			v.add(path, "must be a whole number")
			return nil, false
		}
		return n, checkRange(v, path, p, n)
	case ParamCode:
		src, ok := val.(string)
		if !ok {
			v.add(path, "must be a string of HTML")
			return nil, false
		}
		good := true
		for _, msg := range validateCodeHTML(src) {
			v.add(path, msg)
			good = false
		}
		return src, good
	case ParamBoolean:
		b, ok := val.(bool)
		if !ok {
			v.add(path, "must be true or false")
		}
		return b, ok
	case ParamEnum, ParamColor:
		s, _ := val.(string)
		for _, e := range p.Enum {
			if e == s {
				return s, true
			}
		}
		v.add(path, fmt.Sprintf("must be one of: %s", strings.Join(p.Enum, ", ")))
		return nil, false
	case ParamColorList, ParamStringList, ParamNumberList:
		list, ok := val.([]any)
		if !ok {
			v.add(path, "must be an array")
			return nil, false
		}
		if len(list) < p.MinItems || (p.MaxItems > 0 && len(list) > p.MaxItems) {
			v.add(path, fmt.Sprintf("must have %d to %d items", p.MinItems, p.MaxItems))
			return nil, false
		}
		good := true
		switch p.Kind {
		case ParamNumberList:
			out := make([]float64, 0, len(list))
			for i, item := range list {
				n, ok := asFloat(item)
				if !ok || math.Abs(n) > 1e12 {
					v.add(fmt.Sprintf("%s[%d]", path, i), "must be a finite number")
					good = false
				}
				out = append(out, n)
			}
			return out, good
		default:
			out := make([]string, 0, len(list))
			for i, item := range list {
				s, ok := item.(string)
				ip := fmt.Sprintf("%s[%d]", path, i)
				switch {
				case !ok:
					v.add(ip, "must be a string")
					good = false
				case p.Kind == ParamColorList && !isColorToken(s):
					v.add(ip, fmt.Sprintf("must be a colour token: %s", strings.Join(ColorTokens, ", ")))
					good = false
				case p.MaxLength > 0 && len([]rune(s)) > p.MaxLength:
					v.add(ip, fmt.Sprintf("must be at most %d characters", p.MaxLength))
					good = false
				}
				out = append(out, s)
			}
			return out, good
		}
	}
	v.add(path, "unsupported param kind "+p.Kind)
	return nil, false
}
