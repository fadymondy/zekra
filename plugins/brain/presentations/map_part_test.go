package presentations

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func sampleMap() map[string]any {
	return map[string]any{
		"type": "map", "title": "Live dispatch", "height": "md", "legend": true,
		"markers": []any{
			map[string]any{"id": "v1", "x": 30, "y": 40, "kind": "vendor", "label": "Pizza Roma"},
			map[string]any{"id": "d1", "x": 42, "y": 55, "kind": "driver", "label": "Ali", "status": "available"},
			map[string]any{"id": "d2", "x": 70, "y": 70, "kind": "driver", "status": "busy"},
			map[string]any{"id": "c1", "x": 75, "y": 30, "kind": "customer", "label": "#88"},
			map[string]any{"id": "h1", "x": 10, "y": 90, "kind": "hub"},
		},
		"routes":  []any{map[string]any{"from": "d2", "to": "c1", "via": []any{map[string]any{"x": 72, "y": 50}}, "tone": "info", "dashed": true, "label": "6 min"}},
		"suggest": map[string]any{"vendor": "v1", "driver": "d1", "eta": "4 min", "distance": "1.2 km"},
		"zones":   []any{map[string]any{"x": 35, "y": 45, "r": 20, "label": "Downtown", "tone": "success"}},
	}
}

func mapScreen(part map[string]any, frame string) map[string]any {
	return map[string]any{"type": "screen", "frame": frame, "parts": []any{part}}
}

func TestMapPartValidates(t *testing.T) {
	for _, frame := range ScreenFrames {
		for _, kind := range Kinds {
			if _, _, err := ValidateContent(kind, withBlock(t, kind, mapScreen(sampleMap(), frame))); err != nil {
				t.Errorf("%s/%s: %v", kind, frame, err)
			}
		}
	}
	// Inside a split, too.
	split := map[string]any{"type": "split", "left": []any{sampleMap()}, "right": []any{map[string]any{"type": "callout", "tone": "info", "text": "x"}}}
	if _, _, err := ValidateContent(KindDeck, withBlock(t, KindDeck, mapScreen(split, "tablet"))); err != nil {
		t.Errorf("map in split: %v", err)
	}
	// Percentages are clamped, not refused.
	m := sampleMap()
	m["markers"].([]any)[0].(map[string]any)["x"] = 140
	m["markers"].([]any)[0].(map[string]any)["y"] = -5
	m["zones"].([]any)[0].(map[string]any)["r"] = 90
	m["routes"].([]any)[0].(map[string]any)["via"] = []any{map[string]any{"x": 101, "y": 50}}
	norm, _, err := ValidateContent(KindPage, withBlock(t, KindPage, mapScreen(m, "browser")))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(norm)
	for _, want := range []string{`"id":"v1","kind":"vendor","label":"Pizza Roma","x":100,"y":0`, `"r":50`, `"via":[{"x":100,"y":50}]`} {
		if !strings.Contains(string(b), want) {
			t.Errorf("not clamped: want %s in %.400s", want, b)
		}
	}
	if !strings.Contains(blockSummary(), `"type":"map"`) || !strings.Contains(blockSummary(), "desktop") {
		t.Error("docs lack the map example or the desktop frame")
	}
}

func TestMapPartRejects(t *testing.T) {
	part := func(m map[string]any, key string, i int) map[string]any { return m[key].([]any)[i].(map[string]any) }
	cases := []struct {
		name, want string
		f          func(m map[string]any)
	}{
		{"no markers", ".markers: needs at least 1", func(m map[string]any) { m["markers"] = []any{} }},
		{"41 markers", ".markers: allows at most 40", func(m map[string]any) {
			var l []any
			for i := 0; i < 41; i++ {
				l = append(l, map[string]any{"id": fmt.Sprint(i), "x": 1, "y": 1, "kind": "customer"})
			}
			m["markers"] = l
			delete(m, "routes")
			delete(m, "suggest")
		}},
		{"duplicate id", `.markers[1].id: duplicate marker id "v1"`, func(m map[string]any) { part(m, "markers", 1)["id"] = "v1" }},
		{"bad kind", ".markers[0].kind: must be one of: driver, vendor, customer, hub", func(m map[string]any) { part(m, "markers", 0)["kind"] = "truck" }},
		{"x not a number", ".markers[0].x: must be a number", func(m map[string]any) { part(m, "markers", 0)["x"] = "left" }},
		{"missing y", ".markers[0].y: is required", func(m map[string]any) { delete(part(m, "markers", 0), "y") }},
		{"route to nowhere", `.routes[0].to: unknown marker id "zz"`, func(m map[string]any) { part(m, "routes", 0)["to"] = "zz" }},
		{"route to itself", ".routes[0]: a route must join two different markers", func(m map[string]any) { part(m, "routes", 0)["to"] = "d2" }},
		{"11 routes", ".routes: allows at most 10", func(m map[string]any) {
			var l []any
			for i := 0; i < 11; i++ {
				l = append(l, map[string]any{"from": "d1", "to": "c1"})
			}
			m["routes"] = l
		}},
		{"13 via points", ".routes[0].via: allows at most 12", func(m map[string]any) {
			var l []any
			for i := 0; i < 13; i++ {
				l = append(l, map[string]any{"x": 1, "y": 1})
			}
			part(m, "routes", 0)["via"] = l
		}},
		{"suggest a customer as driver", `.suggest.driver: marker "c1" is a customer; it must be a driver`, func(m map[string]any) { m["suggest"].(map[string]any)["driver"] = "c1" }},
		{"suggest a driver as vendor", `.suggest.vendor: marker "d1" is a driver; it must be a vendor`, func(m map[string]any) { m["suggest"].(map[string]any)["vendor"] = "d1" }},
		{"suggest unknown", `.suggest.vendor: unknown marker id "nope"`, func(m map[string]any) { m["suggest"].(map[string]any)["vendor"] = "nope" }},
		{"suggest without driver", ".suggest.driver: is required", func(m map[string]any) { delete(m["suggest"].(map[string]any), "driver") }},
		{"7 zones", ".zones: allows at most 6", func(m map[string]any) {
			var l []any
			for i := 0; i < 7; i++ {
				l = append(l, map[string]any{"x": 1, "y": 1, "r": 5})
			}
			m["zones"] = l
		}},
		{"bad height", ".height: must be one of: sm, md, lg", func(m map[string]any) { m["height"] = "xl" }},
		{"unknown field", ".markers[0].lat: unknown field", func(m map[string]any) { part(m, "markers", 0)["lat"] = 1.2 }},
		{"bad tone", ".routes[0].tone: must be one of", func(m map[string]any) { part(m, "routes", 0)["tone"] = "red" }},
	}
	for _, c := range cases {
		m := sampleMap()
		c.f(m)
		got := errorsOf(t, KindDeck, withBlock(t, KindDeck, mapScreen(m, "app")))
		want := blockPath(KindDeck, t) + ".parts[0]" + c.want
		if !strings.Contains(got, want) {
			t.Errorf("%s: want %q, got %q", c.name, want, got)
		}
	}
	if got := errorsOf(t, KindDeck, withBlock(t, KindDeck, mapScreen(sampleMap(), "watch"))); !strings.Contains(got, "must be one of: browser, app, tablet, desktop") {
		t.Errorf("frame enum: %s", got)
	}
}
