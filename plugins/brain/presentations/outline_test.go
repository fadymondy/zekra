package presentations

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestEveryTemplateValidates(t *testing.T) {
	ts, err := Templates("")
	if err != nil {
		t.Fatal(err)
	}
	if len(ts) != len(TemplateKeys) {
		t.Fatalf("%d templates", len(ts))
	}
	for _, tp := range ts {
		for kind, byLoc := range tp.Documents {
			for _, loc := range Locales {
				c, ok := byLoc[loc]
				if !ok {
					t.Errorf("%s/%s: no %s variant", tp.Key, kind, loc)
					continue
				}
				if _, _, err := ValidateContent(kind, c); err != nil {
					t.Errorf("%s/%s/%s: %v", tp.Key, kind, loc, err)
				}
				raw, _ := json.Marshal(c)
				if !strings.Contains(string(raw), `"type":"workflow"`) {
					t.Errorf("%s/%s/%s has no workflow block", tp.Key, kind, loc)
				}
				if !strings.Contains(string(raw), `"type":"screen"`) {
					t.Errorf("%s/%s/%s has no screen block", tp.Key, kind, loc)
				}
				if loc == "ar" && !strings.Contains(string(raw), "<المشكلة") && !strings.Contains(string(raw), "مشكلة") && !strings.Contains(string(raw), "<") {
					t.Errorf("%s/%s/ar is not Arabic", tp.Key, kind)
				}
			}
		}
	}
	if _, err := Templates("nope"); err == nil {
		t.Error("unknown template accepted")
	}
}

func fullOutline(locale string) Outline {
	return Outline{
		Customer: PresentationCustomer{Name: "Sara", Company: "Acme Wood & Co"}, Locale: locale,
		Title: strings.Repeat("A long title ", 30), Problem: "Quotes take a week.",
		Goals:         []string{"Quote in a day", "No lost orders", "One source of truth"},
		WorkflowSteps: []OutlineStep{{Title: "Request"}, {Title: "Measure", Owner: "Field team"}, {Title: "Manager review"}, {Title: "Quote sent"}},
		Screens:       []string{"Quote builder", "Order tracker"},
		Phases:        []OutlinePhase{{Name: "Discovery", Duration: "2 weeks", Deliverables: []string{"Map", "Plan"}}, {Name: "Build", Duration: "8 weeks"}},
		Pricing:       []OutlinePrice{{Item: "Build", Price: "$40,000", Note: "fixed price, paid in three milestones"}},
		NextStep:      "Book a call",
	}
}

func TestBuildFromOutlineEveryKindSubset(t *testing.T) {
	subsets := [][]string{{KindDeck}, {KindReport}, {KindPage}, {KindDeck, KindReport}, {KindDeck, KindPage}, {KindReport, KindPage}, {KindPage, KindDeck, KindReport}}
	for _, loc := range Locales {
		for _, kinds := range subsets {
			o := fullOutline(loc)
			o.Kinds = kinds
			docs, err := BuildFromOutline(o, "page123")
			if err != nil {
				t.Fatalf("%s %v: %v", loc, kinds, err)
			}
			if len(docs) != len(kinds) {
				t.Fatalf("%s %v: %d docs", loc, kinds, len(docs))
			}
			if docs[0].Kind == KindDeck && len(kinds) > 1 && contains(kinds, KindPage) {
				t.Errorf("%v: the page must be built before the deck that embeds it", kinds)
			}
			for _, d := range docs {
				if _, _, err := ValidateContent(d.Kind, d.Content); err != nil {
					t.Errorf("%s %s: %v", loc, d.Kind, err)
				}
				if d.Kind == KindDeck {
					raw, _ := json.Marshal(d.Content)
					if !strings.Contains(string(raw), `"document_id":"page123"`) {
						t.Errorf("deck does not embed the page")
					}
				}
			}
		}
	}
	// Minimal outline: only the required fields.
	docs, err := BuildFromOutline(Outline{Customer: PresentationCustomer{Company: "X"}, Title: "T", Problem: "P"}, "")
	if err != nil || len(docs) != 3 {
		t.Fatalf("minimal: %v %d", err, len(docs))
	}
	// Step strings or objects.
	var o Outline
	if err := json.Unmarshal([]byte(`{"workflow_steps":["a",{"title":"b","owner":"c"}]}`), &o); err != nil || o.WorkflowSteps[1].Owner != "c" || o.WorkflowSteps[0].Title != "a" {
		t.Fatalf("steps: %v %+v", err, o.WorkflowSteps)
	}
	if err := json.Unmarshal([]byte(`{"workflow_steps":[3]}`), &o); err == nil {
		t.Error("a number step was accepted")
	}
	for name, bad := range map[string]Outline{
		"no customer": {Title: "T", Problem: "P"},
		"no title":    {Customer: PresentationCustomer{Name: "n"}, Problem: "P"},
		"bad locale":  {Customer: PresentationCustomer{Name: "n"}, Title: "T", Problem: "P", Locale: "fr"},
		"bad kind":    {Customer: PresentationCustomer{Name: "n"}, Title: "T", Problem: "P", Kinds: []string{"memo"}},
		"bad tpl":     {Customer: PresentationCustomer{Name: "n"}, Title: "T", Problem: "P", Template: "x"},
	} {
		if _, err := BuildFromOutline(bad, ""); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestFixHints(t *testing.T) {
	_, _, err := ValidateContent(KindDeck, map[string]any{"slides": []any{map[string]any{"type": "title", "title": "x", "icon": "nope", "x": 1}}})
	ve := err.(*ValidationError)
	for _, fe := range ve.Errors {
		if FixHint(fe) == "" {
			t.Errorf("no hint for %v", fe)
		}
	}
}
