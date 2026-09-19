package presentations

import (
	"fmt"
	"math"
	"strings"
)

/*
FM-350: blocks that show an idea from start to end.

  - workflow: steps (with icons, owners and kinds) joined by arrows. A deck
    slide, a page section and a report block, all with the same fields.
  - screen:   a declarative mockup of a product screen (browser / app /
    tablet frame, optional sidebar or top bar, typed parts, numbered
    annotations), drawn with the site's own components. Never an image of a
    UI a model imagined: only these parts, with these limits.

Both are data, validated here like every other block; cross-field rules
(step ids, edges, the highlighted step, annotation targets) live in
variantChecks.
*/

var toneEnum = []string{"neutral", "info", "success", "warning", "danger"}

func tone() fieldSpec {
	return fieldSpec{Name: "tone", Kind: kEnum, Enum: toneEnum, Desc: "badge colour; default neutral"}
}

func trend() fieldSpec {
	return fieldSpec{Name: "trend", Kind: kEnum, Enum: []string{"up", "down", "flat"}}
}

// ---- workflow -------------------------------------------------------------------

// StepKinds are how a workflow step is drawn.
var StepKinds = []string{"step", "decision", "human_review", "system", "output"}

var workflowSpec = []fieldSpec{
	text("title", 160, false, ""),
	md("body", 600, false, "optional lead-in above the flow"),
	{Name: "layout", Kind: kEnum, Enum: []string{"horizontal", "vertical", "auto"}, Desc: "default auto: horizontal when it fits, vertical on phones"},
	{Name: "steps", Kind: kList, Required: true, Min: 2, Max: 12, Desc: "in reading order", Of: []fieldSpec{
		text("id", 40, true, "unique within the workflow, e.g. \"intake\""),
		text("title", 80, true, ""),
		text("text", 240, false, ""),
		icon("lucide name from page_styles.icons"),
		text("owner", 60, false, "who does it, e.g. \"Sales\""),
		{Name: "kind", Kind: kEnum, Enum: StepKinds, Desc: "default step"},
	}},
	{Name: "edges", Kind: kList, Max: 30, Desc: "optional; when omitted the steps run in order", Of: []fieldSpec{
		text("from", 40, true, "a step id"), text("to", 40, true, "a step id"), text("label", 60, false, "e.g. \"approved\""),
	}},
	text("highlight", 40, false, "a step id to emphasise"),
	text("caption", 300, false, ""),
}

func checkWorkflow(v *validator, path string, obj map[string]any) {
	steps, _ := obj["steps"].([]any)
	ids := map[string]bool{}
	for i, s := range steps {
		m, _ := s.(map[string]any)
		id, _ := m["id"].(string)
		if id == "" {
			continue
		}
		if ids[id] {
			v.add(fmt.Sprintf("%s.steps[%d].id", path, i), fmt.Sprintf("duplicate step id %q", id))
		}
		ids[id] = true
	}
	known := func(p, id string) {
		if id != "" && !ids[id] {
			v.add(p, fmt.Sprintf("unknown step id %q", id))
		}
	}
	edges, _ := obj["edges"].([]any)
	for i, e := range edges {
		m, _ := e.(map[string]any)
		from, _ := m["from"].(string)
		to, _ := m["to"].(string)
		known(fmt.Sprintf("%s.edges[%d].from", path, i), from)
		known(fmt.Sprintf("%s.edges[%d].to", path, i), to)
		if from != "" && from == to {
			v.add(fmt.Sprintf("%s.edges[%d]", path, i), "an edge must join two different steps")
		}
	}
	if h, _ := obj["highlight"].(string); h != "" {
		known(path+".highlight", h)
	}
}

// ---- screen -----------------------------------------------------------------------

var listItemSpec = []fieldSpec{
	text("title", 100, true, ""), text("meta", 80, false, "secondary text, e.g. a date"),
	text("status", 24, false, "badge text"), tone(), icon(""),
}

// ScreenPartTypes are the parts a screen may hold.
var screenParts = map[string][]fieldSpec{
	"kpis": {{Name: "items", Kind: kList, Required: true, Min: 1, Max: 6, Of: []fieldSpec{
		text("label", 40, true, ""), text("value", 24, true, ""), text("delta", 24, false, ""), trend(), icon(""),
	}}},
	"table": {text("title", 80, false, ""),
		{Name: "columns", Kind: kStrings, Required: true, Min: 1, Max: 8},
		{Name: "rows", Kind: kList, Required: true, Min: 1, Max: 30, Of: []fieldSpec{
			{Name: "cells", Kind: kStrings, Required: true, Min: 1, Max: 8, Desc: "one per column"},
			text("status", 24, false, "badge text shown in a last column"), tone(),
		}}},
	"form": {text("title", 80, false, ""), {Name: "fields", Kind: kList, Required: true, Min: 1, Max: 12, Of: []fieldSpec{
		text("label", 60, true, ""), text("value", 120, false, ""),
		{Name: "type", Kind: kEnum, Enum: []string{"text", "select", "date", "number", "file"}, Desc: "default text"},
		{Name: "state", Kind: kEnum, Enum: []string{"ok", "missing", "warning"}, Desc: "field check mark / warning"},
		text("hint", 120, false, ""),
	}}, text("submit_label", 40, false, "")},
	"chart": {text("title", 80, false, ""),
		{Name: "chart", Kind: kEnum, Required: true, Enum: []string{"bar", "line", "donut"}},
		{Name: "labels", Kind: kStrings, Required: true, Min: 2, Max: 12},
		{Name: "series", Kind: kList, Required: true, Min: 1, Max: 4, Of: []fieldSpec{
			text("name", 40, true, ""), {Name: "values", Kind: kNumbers, Required: true, Min: 2, Max: 12, Desc: "one per label"},
		}}},
	"list":     {text("title", 80, false, ""), {Name: "items", Kind: kList, Required: true, Min: 1, Max: 12, Of: listItemSpec}},
	"timeline": {text("title", 80, false, ""), {Name: "items", Kind: kList, Required: true, Min: 1, Max: 12, Of: listItemSpec}},
	"board": {text("title", 80, false, ""), {Name: "columns", Kind: kList, Required: true, Min: 1, Max: 5, Of: []fieldSpec{
		text("title", 40, true, ""),
		{Name: "cards", Kind: kList, Max: 8, Of: []fieldSpec{text("title", 80, true, ""), text("meta", 60, false, ""), tone(), icon("")}},
	}}},
	"callout": {{Name: "tone", Kind: kEnum, Required: true, Enum: []string{"info", "success", "warning", "danger"}},
		text("title", 80, false, ""), text("text", 300, true, "")},
	"image": {link("url", true, "https URL or a /uploads/… path"), text("alt", 200, true, ""), text("caption", 120, false, "")},
}

func init() {
	// split holds two stacks of the other parts (one level deep).
	inner := map[string][]fieldSpec{}
	for k, v := range screenParts {
		inner[k] = v
	}
	screenParts["split"] = []fieldSpec{
		text("left_label", 40, false, "e.g. \"Before\""), text("right_label", 40, false, "e.g. \"After\""),
		{Name: "left", Kind: kVariants, Required: true, Min: 1, Max: 4, Variants: inner},
		{Name: "right", Kind: kVariants, Required: true, Min: 1, Max: 4, Variants: inner},
	}
	// Every slide may opt out of its build-in animation.
	for k, fields := range slideVariants {
		slideVariants[k] = append(fields, fieldSpec{Name: "build", Kind: kBool, Desc: "false = show the slide at once (default true: parts stagger in)"})
	}
}

// heroVisual is a page hero's optional picture: a workflow or a screen,
// drawn beside the text with the same components as the blocks.
var heroVisual = fieldSpec{Name: "visual", Kind: kVisual, Variants: map[string][]fieldSpec{"workflow": workflowSpec, "screen": screenSpec},
	Desc: "optional {type: workflow|screen, ...} shown beside the hero text (for example the product's main screen)"}

// ScreenFrames are the device frames a screen can sit in.
var ScreenFrames = []string{"browser", "app", "tablet", "desktop"}

var screenSpec = []fieldSpec{
	text("title", 160, false, "shown above the frame"),
	{Name: "frame", Kind: kEnum, Required: true, Enum: ScreenFrames},
	text("screen_title", 80, false, "the app's own page title, inside the frame"),
	text("url", 120, false, "address-bar TEXT (browser frame), e.g. \"app.acme.com/orders\"; never loaded"),
	{Name: "layout", Kind: kEnum, Enum: []string{"sidebar", "topbar", "none"}, Desc: "default none"},
	{Name: "nav", Kind: kList, Max: 8, Of: []fieldSpec{text("label", 40, true, ""), icon(""), {Name: "active", Kind: kBool}}},
	{Name: "parts", Kind: kVariants, Required: true, Min: 1, Max: 12, Variants: screenParts},
	{Name: "annotations", Kind: kList, Max: 8, Desc: "numbered callouts pointing at parts", Of: []fieldSpec{
		{Name: "target_part_index", Kind: kNumber, Required: true, Desc: "0-based index into parts"},
		text("text", 160, true, ""),
	}},
	{Name: "focus", Kind: kNumber, Desc: "optional 0-based part index: that part is enlarged and the others dimmed (use it when one part is the point of the slide)"},
	text("caption", 300, false, ""),
}

func checkScreen(v *validator, path string, obj map[string]any) {
	parts, _ := obj["parts"].([]any)
	anns, _ := obj["annotations"].([]any)
	for i, a := range anns {
		m, _ := a.(map[string]any)
		n, ok := m["target_part_index"].(float64)
		if !ok {
			continue
		}
		if n != math.Trunc(n) || n < 0 || int(n) >= len(parts) {
			v.add(fmt.Sprintf("%s.annotations[%d].target_part_index", path, i),
				fmt.Sprintf("must be a whole number from 0 to %d (the screen has %d parts)", len(parts)-1, len(parts)))
		}
	}
	if f, ok := obj["focus"].(float64); ok && (f != math.Trunc(f) || f < 0 || int(f) >= len(parts)) {
		v.add(path+".focus", fmt.Sprintf("must be a whole number from 0 to %d (the screen has %d parts)", len(parts)-1, len(parts)))
	}
	checkTables := func(p string, list []any) {
		for i, part := range list {
			m, _ := part.(map[string]any)
			if m["type"] != "table" {
				continue
			}
			cols, _ := m["columns"].([]any)
			rows, _ := m["rows"].([]any)
			for j, r := range rows {
				rm, _ := r.(map[string]any)
				if cells, _ := rm["cells"].([]any); len(cells) > len(cols) {
					v.add(fmt.Sprintf("%s[%d].rows[%d].cells", p, i, j), fmt.Sprintf("has %d cells but the table has %d columns", len(cells), len(cols)))
				}
			}
		}
	}
	checkTables(path+".parts", parts)
	for i, part := range parts {
		m, _ := part.(map[string]any)
		if m["type"] == "split" {
			for _, side := range []string{"left", "right"} {
				l, _ := m[side].([]any)
				checkTables(fmt.Sprintf("%s.parts[%d].%s", path, i, side), l)
			}
		}
	}
}

// variantChecks run after a typed object validated, by its "type". Only the
// FM-350 blocks have cross-field rules, and their names are unique across kinds.
var variantChecks = map[string]func(*validator, string, map[string]any){
	"workflow": checkWorkflow,
	"screen":   checkScreen,
}

func workflowSlide() []fieldSpec { return append(append([]fieldSpec{}, workflowSpec...), notes) }
func screenSlide() []fieldSpec   { return append(append([]fieldSpec{}, screenSpec...), notes) }

// blockSummary documents the FM-350 blocks for the MCP tools.
func blockSummary() string {
	return "WORKFLOW (deck slide, page section, report block; type \"workflow\"): {title, body, layout: horizontal|vertical|auto, " +
		"steps* 2-12: [{id*, title*, text, icon, owner, kind: " + strings.Join(StepKinds, "|") + "}], edges: [{from*, to*, label}] (omit = in order), " +
		"highlight: a step id, caption}. Right-to-left in Arabic, vertical on phones, animated. " +
		"SCREEN (same three places; type \"screen\"): a product-screen mockup drawn with real UI components: {title, frame*: browser (web app, address bar) | app (mobile phone) | tablet (landscape tablet: vendor/admin) | desktop (a desktop app window, no address bar), " +
		"screen_title, url (address-bar text only), layout: sidebar|topbar|none, nav ≤8: [{label*, icon, active}], parts* 1-12, " +
		"annotations ≤8: [{target_part_index* (0-based), text*}], focus (a part index to enlarge; the rest dim), caption}. frame app = a mobile app: drawn as a portrait phone (status bar, screen_title as the app header, parts stacked, nav as a bottom tab bar of up to 5; tables become cards); on a slide the phone sits beside the title and notes. A page hero may carry visual = one workflow or screen block, shown beside its text (use your main product screen). Keep a screen on a slide to about 4 parts so it stays readable; put more on a page or in a report. Part types: " +
		"kpis {items* 1-6: [{label*, value*, delta, trend, icon}]}; table {title, columns* ≤8, rows* ≤30: [{cells* (≤ columns), status, tone}]}; " +
		"form {title, fields* ≤12: [{label*, value, type: text|select|date|number|file, state: ok|missing|warning, hint}], submit_label}; " +
		"chart {title, chart*: bar|line|donut, labels* 2-12, series* 1-4: [{name*, values*}]}; list|timeline {title, items* ≤12: [{title*, meta, status, tone, icon}]}; " +
		"board {title, columns* ≤5: [{title*, cards ≤8: [{title*, meta, tone, icon}]}]}; split {left_label, right_label, left* 1-4 parts, right* 1-4 parts (no nested split)}; " +
		"callout {tone*, title, text*}; image {url*, alt*, caption}; " + mapSummary() + ". tone = " + strings.Join(toneEnum, "|") + ". " +
		"Any slide may set build:false to skip its build-in animation; a deck may set transition: fade|slide|none. " +
		`Example screen: {"type":"screen","frame":"browser","url":"app.acme.com/orders","layout":"sidebar",` +
		`"nav":[{"label":"Orders","icon":"package","active":true},{"label":"Customers","icon":"users"}],` +
		`"parts":[{"type":"kpis","items":[{"label":"Open orders","value":"128","delta":"+12%","trend":"up","icon":"package"}]},` +
		`{"type":"table","columns":["Order","Customer","Total"],"rows":[{"cells":["#1042","Sara Ali","$320"],"status":"Paid","tone":"success"}]}],` +
		`"annotations":[{"target_part_index":1,"text":"Live status from the ERP"}]}. ` +
		`Example workflow: {"type":"workflow","title":"Order to delivery","steps":[{"id":"order","title":"Order","icon":"shopping-cart","owner":"Sales"},` +
		`{"id":"check","title":"Stock check","icon":"search-check","kind":"decision"},{"id":"ship","title":"Ship","icon":"truck","kind":"output"}],` +
		`"edges":[{"from":"order","to":"check"},{"from":"check","to":"ship","label":"in stock"}],"highlight":"check"}.`
}
