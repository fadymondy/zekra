package presentations

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
)

/*
FM-341 polish / FM-350: icons, rich bullets, workflow and screen blocks.
*/

func sampleWorkflow() map[string]any {
	return map[string]any{
		"type": "workflow", "title": "Order to delivery", "layout": "auto",
		"steps": []any{
			map[string]any{"id": "order", "title": "Order", "icon": "shopping-cart", "owner": "Sales"},
			map[string]any{"id": "check", "title": "Stock check", "icon": "search-check", "kind": "decision"},
			map[string]any{"id": "review", "title": "Review", "kind": "human_review"},
			map[string]any{"id": "ship", "title": "Ship", "icon": "truck", "kind": "output"},
		},
		"edges": []any{
			map[string]any{"from": "order", "to": "check"},
			map[string]any{"from": "check", "to": "review", "label": "unclear"},
			map[string]any{"from": "check", "to": "ship", "label": "in stock"},
		},
		"highlight": "check",
	}
}

func sampleScreen() map[string]any {
	return map[string]any{
		"type": "screen", "frame": "browser", "url": "app.acme.test/orders", "layout": "sidebar", "screen_title": "Orders",
		"nav": []any{map[string]any{"label": "Orders", "icon": "package", "active": true}, map[string]any{"label": "Team", "icon": "users"}},
		"parts": []any{
			map[string]any{"type": "kpis", "items": []any{map[string]any{"label": "Open", "value": "128", "delta": "+12%", "trend": "up", "icon": "package"}}},
			map[string]any{"type": "table", "columns": []any{"Order", "Customer"}, "rows": []any{
				map[string]any{"cells": []any{"#1", "Sara"}, "status": "Paid", "tone": "success"},
			}},
			map[string]any{"type": "form", "fields": []any{map[string]any{"label": "Width", "value": "120", "type": "number", "state": "ok"}}},
			map[string]any{"type": "chart", "chart": "donut", "labels": []any{"a", "b"}, "series": []any{map[string]any{"name": "s", "values": []any{1, 2}}}},
			map[string]any{"type": "list", "items": []any{map[string]any{"title": "Cut", "status": "Done", "tone": "success", "icon": "scissors"}}},
			map[string]any{"type": "timeline", "items": []any{map[string]any{"title": "Kickoff", "meta": "Week 1"}}},
			map[string]any{"type": "board", "columns": []any{map[string]any{"title": "To do", "cards": []any{map[string]any{"title": "Quote"}}}}},
			map[string]any{"type": "split", "left_label": "Before", "right_label": "After",
				"left":  []any{map[string]any{"type": "callout", "tone": "danger", "text": "Paper forms"}},
				"right": []any{map[string]any{"type": "image", "url": "https://site.test/x.png", "alt": "x"}}},
		},
		"annotations": []any{map[string]any{"target_part_index": 1, "text": "Live from the ERP"}},
	}
}

func withBlock(t *testing.T, kind string, block map[string]any) map[string]any {
	return mutate(t, kind, func(m map[string]any) {
		switch kind {
		case KindDeck:
			m["slides"] = append(m["slides"].([]any), block)
		case KindPage:
			m["sections"] = append(m["sections"].([]any), block)
		case KindReport:
			s := item(m, "sections", 0)
			s["blocks"] = append(s["blocks"].([]any), block)
		}
	})
}

func clone(m map[string]any) map[string]any {
	b, _ := json.Marshal(m)
	var out map[string]any
	_ = json.Unmarshal(b, &out)
	return out
}

func TestWorkflowAndScreenEverywhere(t *testing.T) {
	for _, kind := range Kinds {
		for _, b := range []map[string]any{sampleWorkflow(), sampleScreen()} {
			if _, _, err := ValidateContent(kind, withBlock(t, kind, clone(b))); err != nil {
				t.Errorf("%s %s: %v", kind, b["type"], err)
			}
		}
	}
}

func blockPath(kind string, t *testing.T) string {
	switch kind {
	case KindDeck:
		return fmt.Sprintf("content.slides[%d]", len(fixture(t, KindDeck)["slides"].([]any)))
	case KindPage:
		return fmt.Sprintf("content.sections[%d]", len(fixture(t, KindPage)["sections"].([]any)))
	}
	blocks := item(fixture(t, KindReport), "sections", 0)["blocks"].([]any)
	return fmt.Sprintf("content.sections[0].blocks[%d]", len(blocks))
}

func TestWorkflowRejects(t *testing.T) {
	cases := []struct {
		name, want string
		f          func(m map[string]any)
	}{
		{"one step", ".steps: needs at least 2", func(m map[string]any) { m["steps"] = m["steps"].([]any)[:1] }},
		{"13 steps", ".steps: allows at most 12", func(m map[string]any) {
			var s []any
			for i := 0; i < 13; i++ {
				s = append(s, map[string]any{"id": fmt.Sprint(i), "title": "x"})
			}
			m["steps"] = s
			delete(m, "edges")
			delete(m, "highlight")
		}},
		{"duplicate id", `.steps[1].id: duplicate step id "order"`, func(m map[string]any) { m["steps"].([]any)[1].(map[string]any)["id"] = "order" }},
		{"edge to nowhere", `.edges[0].to: unknown step id "nowhere"`, func(m map[string]any) { m["edges"].([]any)[0].(map[string]any)["to"] = "nowhere" }},
		{"self edge", ".edges[0]: an edge must join two different steps", func(m map[string]any) { m["edges"].([]any)[0].(map[string]any)["to"] = "order" }},
		{"bad highlight", `.highlight: unknown step id "zzz"`, func(m map[string]any) { m["highlight"] = "zzz" }},
		{"bad kind", ".steps[0].kind: must be one of: step, decision, human_review, system, output", func(m map[string]any) { m["steps"].([]any)[0].(map[string]any)["kind"] = "loop" }},
		{"bad layout", ".layout: must be one of: horizontal, vertical, auto", func(m map[string]any) { m["layout"] = "circle" }},
		{"bad icon", `.steps[0].icon: unknown icon "shopping-carts"`, func(m map[string]any) { m["steps"].([]any)[0].(map[string]any)["icon"] = "shopping-carts" }},
		{"step without title", ".steps[0].title: is required", func(m map[string]any) { delete(m["steps"].([]any)[0].(map[string]any), "title") }},
		{"long title", ".steps[0].title: must be at most 80", func(m map[string]any) { m["steps"].([]any)[0].(map[string]any)["title"] = strings.Repeat("x", 81) }},
		{"unknown field", ".steps[0].color: unknown field", func(m map[string]any) { m["steps"].([]any)[0].(map[string]any)["color"] = "red" }},
	}
	for _, kind := range Kinds {
		for _, c := range cases {
			b := sampleWorkflow()
			c.f(b)
			got := errorsOf(t, kind, withBlock(t, kind, b))
			if !strings.Contains(got, blockPath(kind, t)+c.want) {
				t.Errorf("%s / %s: want %q, got %q", kind, c.name, blockPath(kind, t)+c.want, got)
			}
		}
	}
}

func TestScreenRejects(t *testing.T) {
	part := func(m map[string]any, i int) map[string]any { return m["parts"].([]any)[i].(map[string]any) }
	cases := []struct {
		name, want string
		f          func(m map[string]any)
	}{
		{"no frame", ".frame: is required", func(m map[string]any) { delete(m, "frame") }},
		{"bad frame", ".frame: must be one of: browser, app, tablet", func(m map[string]any) { m["frame"] = "watch" }},
		{"no parts", ".parts: needs at least 1", func(m map[string]any) { m["parts"] = []any{} }},
		{"13 parts", ".parts: allows at most 12", func(m map[string]any) {
			var p []any
			for i := 0; i < 13; i++ {
				p = append(p, map[string]any{"type": "callout", "tone": "info", "text": "x"})
			}
			m["parts"] = p
			delete(m, "annotations")
		}},
		{"unknown part", `.parts[0].type: unknown type "video"`, func(m map[string]any) { part(m, 0)["type"] = "video" }},
		{"nested split", `.parts[7].left[0].type: unknown type "split"`, func(m map[string]any) {
			part(m, 7)["left"] = []any{map[string]any{"type": "split", "left": []any{}, "right": []any{}}}
		}},
		{"31 rows", ".parts[1].rows: allows at most 30", func(m map[string]any) {
			var r []any
			for i := 0; i < 31; i++ {
				r = append(r, map[string]any{"cells": []any{"a"}})
			}
			part(m, 1)["rows"] = r
		}},
		{"more cells than columns", ".parts[1].rows[0].cells: has 3 cells but the table has 2 columns", func(m map[string]any) {
			part(m, 1)["rows"].([]any)[0].(map[string]any)["cells"] = []any{"a", "b", "c"}
		}},
		{"bad tone", ".parts[1].rows[0].tone: must be one of: neutral, info, success, warning, danger", func(m map[string]any) {
			part(m, 1)["rows"].([]any)[0].(map[string]any)["tone"] = "red"
		}},
		{"bad field type", ".parts[2].fields[0].type: must be one of: text, select, date, number, file", func(m map[string]any) {
			part(m, 2)["fields"].([]any)[0].(map[string]any)["type"] = "password"
		}},
		{"bad chart", ".parts[3].chart: must be one of: bar, line, donut", func(m map[string]any) { part(m, 3)["chart"] = "radar" }},
		{"7 kpis", ".parts[0].items: allows at most 6", func(m map[string]any) {
			var k []any
			for i := 0; i < 7; i++ {
				k = append(k, map[string]any{"label": "a", "value": "1"})
			}
			part(m, 0)["items"] = k
		}},
		{"annotation out of range", ".annotations[0].target_part_index: must be a whole number from 0 to 7", func(m map[string]any) {
			m["annotations"].([]any)[0].(map[string]any)["target_part_index"] = 8
		}},
		{"annotation fraction", ".annotations[0].target_part_index: must be a whole number", func(m map[string]any) {
			m["annotations"].([]any)[0].(map[string]any)["target_part_index"] = 1.5
		}},
		{"javascript image", ".parts[7].right[0].url: must be an https:// URL", func(m map[string]any) {
			part(m, 7)["right"].([]any)[0].(map[string]any)["url"] = "javascript:alert(1)"
		}},
		{"bad nav icon", `.nav[0].icon: unknown icon "packages"`, func(m map[string]any) { m["nav"].([]any)[0].(map[string]any)["icon"] = "packages" }},
		{"9 nav items", ".nav: allows at most 8", func(m map[string]any) {
			var n []any
			for i := 0; i < 9; i++ {
				n = append(n, map[string]any{"label": "x"})
			}
			m["nav"] = n
		}},
		{"long url text", ".url: must be at most 120", func(m map[string]any) { m["url"] = strings.Repeat("x", 121) }},
	}
	for _, kind := range Kinds {
		for _, c := range cases {
			b := sampleScreen()
			c.f(b)
			got := errorsOf(t, kind, withBlock(t, kind, b))
			if !strings.Contains(got, blockPath(kind, t)+c.want) {
				t.Errorf("%s / %s: want %q, got %q", kind, c.name, blockPath(kind, t)+c.want, got)
			}
		}
	}
}

func TestIconsAndRichBullets(t *testing.T) {
	ok := mutate(t, KindDeck, func(m map[string]any) {
		item(m, "slides", 0)["icon"] = "factory"
		item(m, "slides", 1)["bullets"] = []any{"plain", map[string]any{"text": "with icon", "icon": "shield-check"}, map[string]any{"text": "no icon"}}
		item(m, "slides", 1)["build"] = false
		item(m, "slides", 2)["metrics"].([]any)[0].(map[string]any)["icon"] = "gauge"
		item(m, "slides", 3)["left"].(map[string]any)["icon"] = "file-text"
		m["transition"] = "fade"
	})
	norm, _, err := ValidateContent(KindDeck, ok)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(norm)
	for _, want := range []string{`"icon":"factory"`, `"plain"`, `{"icon":"shield-check","text":"with icon"}`, `"build":false`, `"transition":"fade"`} {
		if !strings.Contains(string(b), want) {
			t.Errorf("normalised deck lacks %s", want)
		}
	}

	cases := []struct {
		name, want string
		f          func(m map[string]any)
	}{
		{"unknown title icon", `content.slides[0].icon: unknown icon "factori"`, func(m map[string]any) { item(m, "slides", 0)["icon"] = "factori" }},
		{"suggestion", "e.g. factory", func(m map[string]any) { item(m, "slides", 0)["icon"] = "factori" }},
		{"icon not a string", "content.slides[0].icon: must be an icon name", func(m map[string]any) { item(m, "slides", 0)["icon"] = 3 }},
		{"bullet number", `content.slides[1].bullets[0]: must be a string or {"text", "icon"}`, func(m map[string]any) { item(m, "slides", 1)["bullets"] = []any{3} }},
		{"bullet without text", "content.slides[1].bullets[0].text: is required", func(m map[string]any) { item(m, "slides", 1)["bullets"] = []any{map[string]any{"icon": "zap"}} }},
		{"bullet extra field", "content.slides[1].bullets[0].href: unknown field", func(m map[string]any) {
			item(m, "slides", 1)["bullets"] = []any{map[string]any{"text": "x", "href": "y"}}
		}},
		{"empty bullet", "content.slides[1].bullets[0]: must not be empty", func(m map[string]any) { item(m, "slides", 1)["bullets"] = []any{" "} }},
		{"metric icon", `content.slides[2].metrics[0].icon: unknown icon "speed"`, func(m map[string]any) { item(m, "slides", 2)["metrics"].([]any)[0].(map[string]any)["icon"] = "speed" }},
		{"column icon", `content.slides[3].right.icon: unknown icon "Zap"`, func(m map[string]any) { item(m, "slides", 3)["right"].(map[string]any)["icon"] = "Zap" }},
		{"build not bool", "content.slides[0].build: must be true or false", func(m map[string]any) { item(m, "slides", 0)["build"] = "no" }},
		{"transition", "content.transition: must be one of: fade, slide, none", func(m map[string]any) { m["transition"] = "zoom" }},
	}
	for _, c := range cases {
		if got := errorsOf(t, KindDeck, mutate(t, KindDeck, c.f)); !strings.Contains(got, c.want) {
			t.Errorf("%s: want %q, got %q", c.name, c.want, got)
		}
	}
	page := mutate(t, KindPage, func(m map[string]any) {
		item(m, "sections", 1)["items"].([]any)[0].(map[string]any)["icon"] = "sparkle-stars"
	})
	if got := errorsOf(t, KindPage, page); !strings.Contains(got, `content.sections[1].items[0].icon: unknown icon "sparkle-stars"`) {
		t.Errorf("page feature icon: %s", got)
	}
}

func TestIconListMatchesTheWeb(t *testing.T) {
	// The Zekra console (web/) sits three levels up; the brain module also builds
	// standalone, where there is no web/ to compare with.
	raw, err := os.ReadFile("../../../web/lib/presentations/icon-names.ts")
	if os.IsNotExist(err) {
		t.Skip("no web/lib/presentations/icon-names.ts beside this module")
	}
	if err != nil {
		t.Fatal(err)
	}
	raw = bytes.ReplaceAll(raw, []byte("\r"), nil) // a Windows checkout has CRLF
	var web []string
	for _, m := range regexp.MustCompile(`(?m)^  "([a-z0-9-]+)",$`).FindAllStringSubmatch(string(raw), -1) {
		web = append(web, m[1])
	}
	if len(web) < 150 || strings.Join(web, ",") != strings.Join(IconNames, ",") {
		t.Fatalf("web icon names (%d) differ from IconNames (%d); run node .setup/fm-pres-polish/gen-icons.cjs", len(web), len(IconNames))
	}
	if !sort.StringsAreSorted(IconNames) {
		t.Error("IconNames is not sorted")
	}
	for _, need := range []string{"file-text", "shield-check", "scissors", "clipboard-list", "search-check", "factory", "brain-circuit", "zap", "chart", "message"} {
		if !IsIcon(need) {
			t.Errorf("%s is not accepted", need)
		}
	}
	if c := Catalog(); len(c.Icons) != len(IconNames) {
		t.Errorf("catalog lists %d icons", len(c.Icons))
	}
}

func TestHeroVisualAndScreenFocus(t *testing.T) {
	hero := func(v any) map[string]any {
		return mutate(t, KindPage, func(m map[string]any) { item(m, "sections", 0)["visual"] = v })
	}
	for _, b := range []map[string]any{sampleWorkflow(), sampleScreen()} {
		if _, _, err := ValidateContent(KindPage, hero(clone(b))); err != nil {
			t.Errorf("hero visual %s: %v", b["type"], err)
		}
	}
	noScene := mutate(t, KindPage, func(m map[string]any) { delete(item(m, "sections", 0), "scene") })
	if _, _, err := ValidateContent(KindPage, noScene); err != nil {
		t.Errorf("hero without scene or visual: %v", err)
	}
	bad := sampleWorkflow()
	bad["highlight"] = "nope"
	focus := sampleScreen()
	focus["focus"] = 3
	cases := map[string]struct {
		content map[string]any
		want    string
	}{
		"visual of another type": {hero(map[string]any{"type": "chart"}), `content.sections[0].visual.type: unknown type "chart"; use one of: screen, workflow`},
		"visual not an object":   {hero("screen"), "content.sections[0].visual: must be a workflow or screen block"},
		"visual checked":         {hero(bad), `content.sections[0].visual.highlight: unknown step id "nope"`},
		"visual fields checked":  {hero(map[string]any{"type": "screen", "parts": []any{}}), "content.sections[0].visual.frame: is required"},
		"focus out of range": {withBlock(t, KindDeck, func() map[string]any { s := sampleScreen(); s["focus"] = 8; return s }()),
			".focus: must be a whole number from 0 to 7"},
		"focus fraction": {withBlock(t, KindDeck, func() map[string]any { s := sampleScreen(); s["focus"] = 1.5; return s }()),
			".focus: must be a whole number"},
	}
	for name, c := range cases {
		if got := errorsOf(t, KindPage, c.content); strings.HasPrefix(name, "focus") {
			got = errorsOf(t, KindDeck, c.content)
			if !strings.Contains(got, c.want) {
				t.Errorf("%s: want %q, got %q", name, c.want, got)
			}
		} else if !strings.Contains(got, c.want) {
			t.Errorf("%s: want %q, got %q", name, c.want, got)
		}
	}
	if _, _, err := ValidateContent(KindDeck, withBlock(t, KindDeck, focus)); err != nil {
		t.Errorf("valid focus: %v", err)
	}
	if !strings.Contains(SchemaSummary(), "hero visual") || !strings.Contains(blockSummary(), "focus") || !strings.Contains(blockSummary(), "portrait phone") {
		t.Error("docs do not mention hero visual / focus")
	}
}

func TestOutlineOpensThePageWithTheFirstScreen(t *testing.T) {
	o := fullOutline("en")
	o.Kinds = []string{KindPage}
	docs, err := BuildFromOutline(o, "")
	if err != nil {
		t.Fatal(err)
	}
	secs := docs[0].Content["sections"].([]any)
	v, _ := secs[0].(map[string]any)["visual"].(map[string]any)
	if v == nil || v["type"] != "screen" || !strings.Contains(v["screen_title"].(string), "Quote builder") {
		t.Fatalf("hero visual: %v", v)
	}
	n := 0
	for _, s := range secs {
		if s.(map[string]any)["type"] == "screen" {
			n++
		}
	}
	if n != 1 {
		t.Errorf("%d screen sections after the hero; want the remaining 1", n)
	}
	o.Screens = nil
	docs, _ = BuildFromOutline(o, "")
	if _, has := docs[0].Content["sections"].([]any)[0].(map[string]any)["visual"]; has {
		t.Error("a hero visual without screens")
	}
}
