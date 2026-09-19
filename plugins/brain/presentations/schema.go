package presentations

import (
	"fmt"
	"math"
	"net/url"
	"sort"
	"strings"
)

/*
The content model of the three document kinds, as data (FM-342; decks FM-343,
reports FM-344, page previews FM-346).

One declarative spec per kind drives BOTH the validator and the JSON Schema
the MCP tools advertise, so what a model is told it may write and what the
server accepts cannot drift. Every object is closed (unknown keys are
refused, with the path), every string has a length cap, and every URL must be
http(s) or site-relative — never javascript: or data:.
*/

// Kinds.
const (
	KindDeck   = "deck"
	KindReport = "report"
	KindPage   = "page"
)

// Kinds lists the document kinds.
var Kinds = []string{KindDeck, KindReport, KindPage}

// Locales are the two content languages.
var Locales = []string{"en", "ar"}

// IsLocale reports whether s is en or ar.
func IsLocale(s string) bool { return s == "en" || s == "ar" }

// OtherLocale returns the other content language.
func OtherLocale(s string) string {
	if s == "ar" {
		return "en"
	}
	return "ar"
}

const (
	kText     = "text"
	kMarkdown = "markdown"
	kURL      = "url"
	kEnum     = "enum"
	kBool     = "bool"
	kNumber   = "number"
	kStrings  = "strings"
	kNumbers  = "numbers"
	kObject   = "object"
	kList     = "list"
	kVariants = "variants"
	kScene    = "scene"
	kRows     = "rows"
	kID       = "id"
	kIcon     = "icon"
	kBullets  = "bullets"
	kVisual   = "visual"
)

func icon(desc string) fieldSpec {
	return fieldSpec{Name: "icon", Kind: kIcon, Desc: desc}
}

type fieldSpec struct {
	Name     string
	Kind     string
	Required bool
	Min      int // items for lists
	Max      int // characters for strings, items for lists
	Enum     []string
	Of       []fieldSpec            // object / list item fields
	Variants map[string][]fieldSpec // kVariants: fields per "type"
	Desc     string
}

func text(name string, max int, req bool, desc string) fieldSpec {
	return fieldSpec{Name: name, Kind: kText, Max: max, Required: req, Desc: desc}
}

func md(name string, max int, req bool, desc string) fieldSpec {
	return fieldSpec{Name: name, Kind: kMarkdown, Max: max, Required: req, Desc: desc}
}

func link(name string, req bool, desc string) fieldSpec {
	return fieldSpec{Name: name, Kind: kURL, Max: 2000, Required: req, Desc: desc}
}

func variantNames(m map[string][]fieldSpec) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

var notes = md("notes", 5000, false, "speaker notes — owner only, never shown on a share link")

var columnSpec = []fieldSpec{
	text("heading", 160, false, ""),
	icon("shown before the heading"),
	md("body", 4000, false, "markdown"),
	{Name: "bullets", Kind: kStrings, Max: 12, Desc: "up to 12 points"},
}

var slideVariants = map[string][]fieldSpec{
	"title": {text("title", 200, true, ""), text("subtitle", 300, false, ""), text("eyebrow", 80, false, ""),
		icon("a large icon above the title"), notes},
	"bullets": {text("title", 200, true, ""), {Name: "bullets", Kind: kBullets, Required: true, Min: 1, Max: 12,
		Desc: "each a string, or {text, icon} to replace the dot with an icon"}, notes},
	"image": {text("title", 200, false, ""), link("image_url", true, "https URL or a /uploads/… path"),
		text("alt", 300, true, "describes the image"), text("caption", 300, false, ""), notes},
	"quote": {text("quote", 600, true, ""), text("author", 120, false, ""), text("role", 120, false, ""), notes},
	"metric": {text("title", 200, false, ""), {Name: "metrics", Kind: kList, Required: true, Min: 1, Max: 6, Of: []fieldSpec{
		text("label", 80, true, ""), text("value", 24, true, "the figure as displayed, e.g. \"42%\""), text("delta", 24, false, "e.g. \"+12%\""),
		{Name: "trend", Kind: kEnum, Enum: []string{"up", "down", "flat"}},
		icon("shown beside the label"),
	}}, notes},
	"two_column": {text("title", 200, false, ""),
		{Name: "left", Kind: kObject, Required: true, Of: columnSpec},
		{Name: "right", Kind: kObject, Required: true, Of: columnSpec}, notes},
	"code":     {text("title", 200, false, ""), text("language", 30, false, "e.g. go, ts, bash"), {Name: "code", Kind: kText, Required: true, Max: 6000}, notes},
	"workflow": workflowSlide(),
	"screen":   screenSlide(),
	"embed":    {text("title", 200, false, ""), {Name: "document_id", Kind: kID, Required: true, Desc: "id of a PAGE PREVIEW document; it is rendered inline"}, notes},
}

var chartSpec = []fieldSpec{
	{Name: "chart", Kind: kEnum, Required: true, Enum: []string{"bar", "line", "area", "stacked_bar"}},
	text("title", 160, false, ""),
	text("unit", 16, false, "suffix for values, e.g. \"%\" or \"k\""),
	{Name: "labels", Kind: kStrings, Required: true, Min: 2, Max: 36, Desc: "category / x-axis labels"},
	{Name: "series", Kind: kList, Required: true, Min: 1, Max: 6, Of: []fieldSpec{
		text("name", 60, true, ""),
		{Name: "values", Kind: kNumbers, Required: true, Min: 2, Max: 36, Desc: "one value per label"},
	}},
	text("caption", 300, false, ""),
}

var reportBlocks = map[string][]fieldSpec{
	"markdown": {md("text", 20000, true, "markdown: paragraphs, lists, links, emphasis")},
	"table": {{Name: "columns", Kind: kStrings, Required: true, Min: 1, Max: 12},
		{Name: "rows", Kind: kRows, Required: true, Min: 1, Max: 200, Desc: "array of rows; each row an array of cell strings, one per column"},
		text("caption", 300, false, "")},
	"callout": {{Name: "tone", Kind: kEnum, Required: true, Enum: []string{"info", "success", "warning", "danger"}},
		text("title", 160, false, ""), md("text", 2000, true, "")},
	"chart":    chartSpec,
	"workflow": workflowSpec,
	"screen":   screenSpec,
}

var bulletSpec = []fieldSpec{text("text", 500, true, ""), icon("replaces the bullet dot")}

var sceneField = fieldSpec{Name: "scene", Kind: kScene, Desc: "{type, params}; see page_styles"}

var pageSections = map[string][]fieldSpec{
	"hero": {text("eyebrow", 80, false, ""), text("heading", 160, true, ""), md("body", 1000, false, ""),
		text("cta_label", 40, false, ""), link("cta_href", false, ""), sceneField, heroVisual},
	"features": {text("heading", 160, false, ""), md("body", 600, false, ""),
		{Name: "items", Kind: kList, Required: true, Min: 1, Max: 12, Of: []fieldSpec{
			text("title", 100, true, ""), md("body", 500, false, ""),
			icon("a lucide icon name from page_styles.icons, e.g. \"zap\""),
		}}},
	"pricing": {text("heading", 160, false, ""), md("body", 600, false, ""),
		{Name: "plans", Kind: kList, Required: true, Min: 1, Max: 4, Of: []fieldSpec{
			text("name", 60, true, ""), text("price", 24, true, "as displayed, e.g. \"$49\""), text("period", 24, false, "e.g. \"/month\""),
			text("description", 200, false, ""), {Name: "features", Kind: kStrings, Max: 12},
			{Name: "highlighted", Kind: kBool}, text("cta_label", 40, false, ""),
		}}},
	"testimonial": {text("quote", 600, true, ""), text("author", 120, true, ""), text("role", 120, false, "")},
	"cta":         {text("heading", 160, true, ""), md("body", 600, false, ""), text("cta_label", 40, false, ""), link("cta_href", false, "")},
	"gallery": {text("heading", 160, false, ""), {Name: "images", Kind: kList, Required: true, Min: 1, Max: 12, Of: []fieldSpec{
		link("url", true, ""), text("alt", 300, true, ""), text("caption", 200, false, ""),
	}}},
	"scene": {text("heading", 160, false, ""), md("body", 600, false, ""),
		{Name: "scene", Kind: kScene, Required: true},
		{Name: "height", Kind: kEnum, Enum: []string{"sm", "md", "lg"}, Desc: "default md"}},
	"workflow": workflowSpec,
	"screen":   screenSpec,
}

var specs = map[string][]fieldSpec{
	KindDeck: {
		text("title", 200, true, ""), text("subtitle", 300, false, ""),
		{Name: "transition", Kind: kEnum, Enum: []string{"fade", "slide", "none"}, Desc: "between slides; default slide (right-to-left aware)"},
		{Name: "slides", Kind: kVariants, Required: true, Min: 1, Max: 100, Variants: slideVariants},
	},
	KindReport: {
		text("title", 200, true, ""), text("subtitle", 300, false, ""), md("summary", 4000, false, "executive summary"),
		{Name: "sections", Kind: kList, Required: true, Min: 1, Max: 60, Of: []fieldSpec{
			text("heading", 200, true, ""),
			{Name: "blocks", Kind: kVariants, Required: true, Min: 1, Max: 60, Variants: reportBlocks},
		}},
	},
	KindPage: {
		text("title", 200, true, "browser title of the page"), text("description", 300, false, ""),
		{Name: "sections", Kind: kVariants, Required: true, Min: 1, Max: 30, Variants: pageSections},
	},
}

// ---- validation ---------------------------------------------------------------

// FieldError is one problem, with a JSON path.
type FieldError struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// ValidationError lists every problem found, so a model can fix them all at once.
type ValidationError struct {
	Errors []FieldError
}

func (e *ValidationError) Error() string {
	parts := make([]string, 0, len(e.Errors))
	for _, fe := range e.Errors {
		parts = append(parts, fe.Path+": "+fe.Message)
	}
	return "invalid content: " + strings.Join(parts, "; ")
}

type validator struct {
	errs []FieldError
	// Embeds collects document ids referenced by embed slides.
	embeds []string
}

func (v *validator) add(path, msg string) {
	if len(v.errs) < 50 {
		v.errs = append(v.errs, FieldError{Path: path, Message: msg})
	}
}

// ValidateContent checks one locale's content for a kind and returns it
// normalised (scene defaults filled in) plus the embed ids it references.
func ValidateContent(kind string, content map[string]any) (map[string]any, []string, error) {
	spec, ok := specs[kind]
	if !ok {
		return nil, nil, &ValidationError{Errors: []FieldError{{Path: "kind", Message: "must be one of: deck, report, page"}}}
	}
	if content == nil {
		return nil, nil, &ValidationError{Errors: []FieldError{{Path: "content", Message: "is required"}}}
	}
	v := &validator{}
	out := v.object("content", spec, content)
	if len(v.errs) > 0 {
		return nil, nil, &ValidationError{Errors: v.errs}
	}
	return out, v.embeds, nil
}

func (v *validator) object(path string, spec []fieldSpec, m map[string]any) map[string]any {
	known := map[string]bool{}
	out := map[string]any{}
	for _, fs := range spec {
		known[fs.Name] = true
		p := path + "." + fs.Name
		val, present := m[fs.Name]
		if !present || val == nil {
			if fs.Required {
				v.add(p, "is required")
			}
			continue
		}
		if norm, keep := v.field(p, fs, val); keep {
			out[fs.Name] = norm
		}
	}
	var unknown []string
	for k := range m {
		if !known[k] && k != "type" {
			unknown = append(unknown, k)
		}
	}
	sort.Strings(unknown)
	for _, k := range unknown {
		names := make([]string, 0, len(spec))
		for _, fs := range spec {
			names = append(names, fs.Name)
		}
		v.add(path+"."+k, "unknown field; allowed: "+strings.Join(names, ", "))
	}
	return out
}

func (v *validator) str(path string, fs fieldSpec, val any) (string, bool) {
	s, ok := val.(string)
	if !ok {
		v.add(path, "must be a string")
		return "", false
	}
	if fs.Required && strings.TrimSpace(s) == "" {
		v.add(path, "must not be empty")
		return "", false
	}
	if fs.Max > 0 && len([]rune(s)) > fs.Max {
		v.add(path, fmt.Sprintf("must be at most %d characters (got %d)", fs.Max, len([]rune(s))))
		return "", false
	}
	return s, true
}

func (v *validator) list(path string, fs fieldSpec, val any) ([]any, bool) {
	l, ok := val.([]any)
	if !ok {
		v.add(path, "must be an array")
		return nil, false
	}
	if len(l) < fs.Min {
		v.add(path, fmt.Sprintf("needs at least %d item(s)", fs.Min))
		return nil, false
	}
	if fs.Max > 0 && len(l) > fs.Max {
		v.add(path, fmt.Sprintf("allows at most %d items (got %d)", fs.Max, len(l)))
		return nil, false
	}
	return l, true
}

// SafeURL accepts http(s) URLs and site-relative paths only.
func SafeURL(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return true
	}
	if strings.HasPrefix(s, "/") {
		return !strings.HasPrefix(s, "//") && !strings.ContainsAny(s, "\\\n\r")
	}
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != ""
}

func (v *validator) field(path string, fs fieldSpec, val any) (any, bool) {
	switch fs.Kind {
	case kText, kMarkdown:
		return v.str(path, fs, val)
	case kURL:
		s, ok := v.str(path, fs, val)
		if ok && !SafeURL(s) {
			v.add(path, "must be an https:// URL or a site path starting with /")
			return nil, false
		}
		return s, ok
	case kID:
		s, ok := v.str(path, fieldSpec{Required: true, Max: 64}, val)
		if ok {
			v.embeds = append(v.embeds, s)
		}
		return s, ok
	case kEnum:
		s, _ := val.(string)
		for _, e := range fs.Enum {
			if e == s {
				return s, true
			}
		}
		v.add(path, "must be one of: "+strings.Join(fs.Enum, ", "))
		return nil, false
	case kBool:
		b, ok := val.(bool)
		if !ok {
			v.add(path, "must be true or false")
		}
		return b, ok
	case kNumber:
		n, ok := asFloat(val)
		if !ok {
			v.add(path, "must be a number")
		}
		return n, ok
	case kStrings:
		l, ok := v.list(path, fs, val)
		if !ok {
			return nil, false
		}
		out := make([]any, 0, len(l))
		for i, item := range l {
			if s, ok := v.str(fmt.Sprintf("%s[%d]", path, i), fieldSpec{Max: 500}, item); ok {
				out = append(out, s)
			}
		}
		return out, true
	case kNumbers:
		l, ok := v.list(path, fs, val)
		if !ok {
			return nil, false
		}
		out := make([]any, 0, len(l))
		for i, item := range l {
			n, ok := asFloat(item)
			if !ok || math.Abs(n) > 1e15 {
				v.add(fmt.Sprintf("%s[%d]", path, i), "must be a finite number")
				continue
			}
			out = append(out, n)
		}
		return out, true
	case kRows:
		l, ok := v.list(path, fs, val)
		if !ok {
			return nil, false
		}
		out := make([]any, 0, len(l))
		for i, row := range l {
			cells, ok := row.([]any)
			rp := fmt.Sprintf("%s[%d]", path, i)
			if !ok || len(cells) > 12 {
				v.add(rp, "must be an array of at most 12 cells")
				continue
			}
			norm := make([]any, 0, len(cells))
			for j, c := range cells {
				switch cv := c.(type) {
				case float64:
					norm = append(norm, fmt.Sprint(cv))
				default:
					if s, ok := v.str(fmt.Sprintf("%s[%d]", rp, j), fieldSpec{Max: 1000}, c); ok {
						norm = append(norm, s)
					}
				}
			}
			out = append(out, norm)
		}
		return out, true
	case kIcon:
		s, ok := val.(string)
		if !ok {
			v.add(path, "must be an icon name (a string)")
			return nil, false
		}
		if s == "" {
			return nil, false
		}
		if !IsIcon(s) {
			v.add(path, iconError(s))
			return nil, false
		}
		return s, true
	case kVisual:
		m, ok := val.(map[string]any)
		if !ok {
			v.add(path, "must be a workflow or screen block object")
			return nil, false
		}
		typ, _ := m["type"].(string)
		spec, ok := fs.Variants[typ]
		if !ok {
			v.add(path+".type", fmt.Sprintf("unknown type %q; use one of: %s", typ, strings.Join(variantNames(fs.Variants), ", ")))
			return nil, false
		}
		obj := v.object(path, spec, m)
		obj["type"] = typ
		if check := variantChecks[typ]; check != nil {
			check(v, path, obj)
		}
		return obj, true
	case kBullets:
		l, ok := v.list(path, fs, val)
		if !ok {
			return nil, false
		}
		out := make([]any, 0, len(l))
		for i, item := range l {
			ip := fmt.Sprintf("%s[%d]", path, i)
			switch it := item.(type) {
			case string:
				if s, ok := v.str(ip, fieldSpec{Required: true, Max: 500}, it); ok {
					out = append(out, s)
				}
			case map[string]any:
				out = append(out, v.object(ip, bulletSpec, it))
			default:
				v.add(ip, `must be a string or {"text", "icon"}`)
			}
		}
		return out, true
	case kObject:
		m, ok := val.(map[string]any)
		if !ok {
			v.add(path, "must be an object")
			return nil, false
		}
		return v.object(path, fs.Of, m), true
	case kList:
		l, ok := v.list(path, fs, val)
		if !ok {
			return nil, false
		}
		out := make([]any, 0, len(l))
		for i, item := range l {
			ip := fmt.Sprintf("%s[%d]", path, i)
			m, ok := item.(map[string]any)
			if !ok {
				v.add(ip, "must be an object")
				continue
			}
			out = append(out, v.object(ip, fs.Of, m))
		}
		return out, true
	case kVariants:
		l, ok := v.list(path, fs, val)
		if !ok {
			return nil, false
		}
		out := make([]any, 0, len(l))
		for i, item := range l {
			ip := fmt.Sprintf("%s[%d]", path, i)
			m, ok := item.(map[string]any)
			if !ok {
				v.add(ip, "must be an object with a \"type\"")
				continue
			}
			typ, _ := m["type"].(string)
			spec, ok := fs.Variants[typ]
			if !ok {
				v.add(ip+".type", fmt.Sprintf("unknown type %q; use one of: %s", typ, strings.Join(variantNames(fs.Variants), ", ")))
				continue
			}
			obj := v.object(ip, spec, m)
			obj["type"] = typ
			if check := variantChecks[typ]; check != nil {
				check(v, ip, obj)
			}
			out = append(out, obj)
		}
		return out, true
	case kScene:
		s := validateScene(v, path, val)
		return s, s != nil
	}
	v.add(path, "unsupported field kind")
	return nil, false
}

// ---- JSON Schema ------------------------------------------------------------------

func fieldSchema(fs fieldSpec) map[string]any {
	var s map[string]any
	switch fs.Kind {
	case kText, kMarkdown, kURL:
		s = map[string]any{"type": "string", "maxLength": fs.Max}
		if fs.Kind == kURL {
			s["format"] = "uri-reference"
		}
	case kID:
		s = map[string]any{"type": "string"}
	case kEnum:
		s = map[string]any{"type": "string", "enum": fs.Enum}
	case kBool:
		s = map[string]any{"type": "boolean"}
	case kNumber:
		s = map[string]any{"type": "number"}
	case kStrings:
		s = map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "minItems": fs.Min, "maxItems": fs.Max}
	case kNumbers:
		s = map[string]any{"type": "array", "items": map[string]any{"type": "number"}, "minItems": fs.Min, "maxItems": fs.Max}
	case kRows:
		s = map[string]any{"type": "array", "maxItems": fs.Max, "items": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}}
	case kObject:
		s = objectSchema(fs.Of, "")
	case kList:
		s = map[string]any{"type": "array", "minItems": fs.Min, "maxItems": fs.Max, "items": objectSchema(fs.Of, "")}
	case kVariants:
		var one []any
		for _, name := range variantNames(fs.Variants) {
			one = append(one, objectSchema(fs.Variants[name], name))
		}
		s = map[string]any{"type": "array", "minItems": fs.Min, "maxItems": fs.Max, "items": map[string]any{"oneOf": one}}
	case kVisual:
		var one []any
		for _, name := range variantNames(fs.Variants) {
			one = append(one, objectSchema(fs.Variants[name], name))
		}
		s = map[string]any{"oneOf": one}
	case kIcon:
		s = map[string]any{"type": "string", "maxLength": 40, "description": "a kebab-case lucide name listed in page_styles.icons"}
	case kBullets:
		s = map[string]any{"type": "array", "minItems": fs.Min, "maxItems": fs.Max, "items": map[string]any{"oneOf": []any{
			map[string]any{"type": "string", "maxLength": 500},
			objectSchema(bulletSpec, ""),
		}}}
	case kScene:
		s = map[string]any{"type": "object", "required": []string{"type"}, "properties": map[string]any{
			"type":   map[string]any{"type": "string", "enum": sceneTypeList()},
			"params": map[string]any{"type": "object", "description": "per-type params; see page_styles"},
		}}
	default:
		s = map[string]any{}
	}
	if fs.Desc != "" {
		s["description"] = fs.Desc
	}
	return s
}

func sceneTypeList() []string {
	out := make([]string, 0, len(SceneTypes))
	for _, s := range SceneTypes {
		out = append(out, s.Type)
	}
	return out
}

func objectSchema(fields []fieldSpec, variant string) map[string]any {
	props := map[string]any{}
	var req []string
	if variant != "" {
		props["type"] = map[string]any{"const": variant}
		req = append(req, "type")
	}
	for _, fs := range fields {
		props[fs.Name] = fieldSchema(fs)
		if fs.Required {
			req = append(req, fs.Name)
		}
	}
	out := map[string]any{"type": "object", "properties": props, "additionalProperties": false}
	if len(req) > 0 {
		out["required"] = req
	}
	return out
}

// ContentSchema is the JSON Schema of one locale's content for a kind.
func ContentSchema(kind string) map[string]any {
	spec, ok := specs[kind]
	if !ok {
		return nil
	}
	return objectSchema(spec, "")
}

// variantSummary is a compact one-line-per-type description for tool text.
func variantSummary(m map[string][]fieldSpec) string {
	var b strings.Builder
	for _, name := range variantNames(m) {
		var fields []string
		for _, fs := range m[name] {
			if fs.Name == "notes" {
				continue
			}
			n := fs.Name
			if fs.Required {
				n += "*"
			}
			fields = append(fields, n)
		}
		fmt.Fprintf(&b, "%s{%s} ", name, strings.Join(fields, ","))
	}
	return strings.TrimSpace(b.String())
}

// SchemaSummary is the compact content model, for MCP tool descriptions.
func SchemaSummary() string {
	return "CONTENT (per locale; * = required). " +
		"deck: {title*, subtitle, slides*: [ {type, ..., notes} ]} slide types: " + variantSummary(slideVariants) +
		" (bullets items: a string or {text*, icon}; title: icon; metrics items: {label*, value*, delta, trend: up|down|flat, icon}; " +
		"two_column left/right: {heading, icon, body, bullets}; embed: a PAGE PREVIEW id, shown as a scaled full-slide preview with an " +
		"\"Open the page\" link that works through the deck's own share link; notes = speaker notes, owner-only). " +
		blockSummary() + " " +
		"ICONS: kebab-case lucide names from page_styles.icons only (e.g. file-text, shield-check, factory, brain-circuit); unknown names are refused. " +
		"report: {title*, subtitle, summary, sections*: [{heading*, blocks*: [ {type, ...} ]}]} block types: " + variantSummary(reportBlocks) +
		" (chart: chart*=bar|line|area|stacked_bar, labels* 2-36, series*: [{name*, values* one per label}], unit; table rows = array of string arrays; callout tone*=info|success|warning|danger). " +
		"page: {title*, description, sections*: [ {type, ...} ]} section types: " + variantSummary(pageSections) +
		" (features items: {title*, body, icon}; pricing plans: {name*, price*, period, description, features, highlighted, cta_label}; gallery images: {url*, alt*, caption}; scene = {type, params} from page_styles; scene height sm|md|lg; hero visual = a workflow or screen block shown beside the text — without scene or visual the hero text uses the full width). " +
		"Scene type code = {type:\"code\", params:{html*, aspect: " + strings.Join(CodeSceneAspects, "|") + "}}: your own HTML/CSS/JS, run only in a " +
		"sandboxed iframe (allow-scripts, opaque origin) with no network, storage, cookies, forms, popups or navigation; html at most " +
		codeSceneMaxKB + "; no <meta http-equiv>, <base>, <link>, <iframe>, <object> or <embed>; external scripts only three.js " +
		ThreeVersion + " from cdn.jsdelivr.net/npm or unpkg.com (exact URLs in page_styles); exports show a placeholder. " +
		"URLs must be https:// or start with /. Unknown fields are rejected with their path."
}
