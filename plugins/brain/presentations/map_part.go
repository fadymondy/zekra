package presentations

import (
	"fmt"
	"math"
	"strings"
)

/*
The "map" screen part (FM-350 follow-up): a stylised dispatch map drawn from
data — markers (drivers, vendors, customers, hubs) at percentage positions,
routes between them, coverage zones and an optional nearest-driver suggestion.
No tiles or network: the web app draws a procedural city behind them.

Positions are percentages of the map (0–100) and are clamped, not refused, so
a model's 101 lands on the edge. Ids are unique; routes and the suggestion must
point at markers that exist, and the suggestion at a vendor and a driver.
*/

// MarkerKinds are what a map marker can be.
var MarkerKinds = []string{"driver", "vendor", "customer", "hub"}

func pct(name string, req bool) fieldSpec {
	return fieldSpec{Name: name, Kind: kNumber, Required: req, Desc: "0-100 percent (clamped)"}
}

var mapPartSpec = []fieldSpec{
	text("title", 80, false, ""),
	{Name: "height", Kind: kEnum, Enum: []string{"sm", "md", "lg"}, Desc: "default md"},
	{Name: "markers", Kind: kList, Required: true, Min: 1, Max: 40, Of: []fieldSpec{
		text("id", 40, true, "unique on this map"),
		pct("x", true), pct("y", true),
		{Name: "kind", Kind: kEnum, Required: true, Enum: MarkerKinds},
		text("label", 60, false, ""),
		text("status", 24, false, `drivers: "available" (pulses, green), "busy" (amber) or "offline" (grey); any short text otherwise`),
		tone(),
	}},
	{Name: "routes", Kind: kList, Max: 10, Of: []fieldSpec{
		text("from", 40, true, "a marker id"), text("to", 40, true, "a marker id"),
		{Name: "via", Kind: kList, Max: 12, Desc: "bend points", Of: []fieldSpec{pct("x", true), pct("y", true)}},
		tone(), {Name: "dashed", Kind: kBool}, text("label", 40, false, ""),
	}},
	{Name: "suggest", Kind: kObject, Desc: "highlight the nearest driver for a vendor", Of: []fieldSpec{
		text("vendor", 40, true, "a vendor marker id"), text("driver", 40, true, "a driver marker id"),
		text("eta", 16, false, `e.g. "4 min"`), text("distance", 16, false, `e.g. "1.2 km"`),
	}},
	{Name: "zones", Kind: kList, Max: 6, Desc: "coverage circles", Of: []fieldSpec{
		pct("x", true), pct("y", true), {Name: "r", Kind: kNumber, Required: true, Desc: "radius, 1-50 percent of the width (clamped)"},
		text("label", 40, false, ""), tone(),
	}},
	{Name: "legend", Kind: kBool, Desc: "show a legend under the map"},
}

func clampNum(m map[string]any, key string, lo, hi float64) {
	if f, ok := m[key].(float64); ok {
		m[key] = math.Max(lo, math.Min(hi, f))
	}
}

func checkMap(v *validator, path string, obj map[string]any) {
	markers, _ := obj["markers"].([]any)
	kinds := map[string]string{}
	for i, mk := range markers {
		m, _ := mk.(map[string]any)
		if m == nil {
			continue
		}
		clampNum(m, "x", 0, 100)
		clampNum(m, "y", 0, 100)
		id, _ := m["id"].(string)
		if id == "" {
			continue
		}
		if _, dup := kinds[id]; dup {
			v.add(fmt.Sprintf("%s.markers[%d].id", path, i), fmt.Sprintf("duplicate marker id %q", id))
		}
		k, _ := m["kind"].(string)
		kinds[id] = k
	}
	known := func(p, id string) {
		if id != "" {
			if _, ok := kinds[id]; !ok {
				v.add(p, fmt.Sprintf("unknown marker id %q", id))
			}
		}
	}
	routes, _ := obj["routes"].([]any)
	for i, rt := range routes {
		m, _ := rt.(map[string]any)
		if m == nil {
			continue
		}
		from, _ := m["from"].(string)
		to, _ := m["to"].(string)
		known(fmt.Sprintf("%s.routes[%d].from", path, i), from)
		known(fmt.Sprintf("%s.routes[%d].to", path, i), to)
		if from != "" && from == to {
			v.add(fmt.Sprintf("%s.routes[%d]", path, i), "a route must join two different markers")
		}
		via, _ := m["via"].([]any)
		for _, p := range via {
			if pm, ok := p.(map[string]any); ok {
				clampNum(pm, "x", 0, 100)
				clampNum(pm, "y", 0, 100)
			}
		}
	}
	if s, ok := obj["suggest"].(map[string]any); ok {
		for _, want := range []string{"vendor", "driver"} {
			id, _ := s[want].(string)
			p := path + ".suggest." + want
			if id == "" {
				continue
			}
			k, ok := kinds[id]
			switch {
			case !ok:
				v.add(p, fmt.Sprintf("unknown marker id %q", id))
			case k != want:
				v.add(p, fmt.Sprintf("marker %q is a %s; it must be a %s", id, k, want))
			}
		}
	}
	zones, _ := obj["zones"].([]any)
	for _, z := range zones {
		if m, ok := z.(map[string]any); ok {
			clampNum(m, "x", 0, 100)
			clampNum(m, "y", 0, 100)
			clampNum(m, "r", 1, 50)
		}
	}
}

func init() {
	screenParts["map"] = mapPartSpec
	if split, ok := screenParts["split"]; ok {
		for _, f := range split {
			if f.Kind == kVariants {
				f.Variants["map"] = mapPartSpec
			}
		}
	}
	variantChecks["map"] = checkMap
}

func mapSummary() string {
	return "map {title, height: sm|md|lg, markers* 1-40: [{id*, x*, y* (0-100 %), kind*: " + strings.Join(MarkerKinds, "|") +
		", label, status (drivers: available|busy|offline), tone}], routes ≤10: [{from*, to* (marker ids), via: [{x, y}], tone, dashed, label}], " +
		"suggest: {vendor* (a vendor id), driver* (a driver id), eta, distance}, zones ≤6: [{x*, y*, r* (1-50 %), label, tone}], legend} — " +
		"a self-drawn dispatch map (no tiles). Example: " +
		`{"type":"map","height":"md","legend":true,"markers":[{"id":"v1","x":30,"y":40,"kind":"vendor","label":"Pizza Roma"},` +
		`{"id":"d1","x":42,"y":55,"kind":"driver","label":"Ali","status":"available"},{"id":"c1","x":75,"y":30,"kind":"customer","label":"Order #88"}],` +
		`"routes":[{"from":"d1","to":"c1","via":[{"x":60,"y":55}],"tone":"info"}],"suggest":{"vendor":"v1","driver":"d1","eta":"4 min","distance":"1.2 km"},` +
		`"zones":[{"x":35,"y":45,"r":20,"label":"Downtown","tone":"success"}]}`
}
