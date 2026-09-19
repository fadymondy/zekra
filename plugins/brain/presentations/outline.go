package presentations

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

/*
FM-350: the easy path for any model. An Outline is a handful of plain fields;
BuildFromOutline turns it into valid deck / report / page content with no
model on the server, deterministically, in English or Arabic. The same
builder produces the starter templates (presentation_templates), so every
template is valid by construction and tested.
*/

// OutlineStep is a workflow step: a plain string or {title, owner}.
type OutlineStep struct {
	Title string `json:"title"`
	Owner string `json:"owner,omitempty"`
}

// UnmarshalJSON accepts "Title" or {"title": ..., "owner": ...}.
func (s *OutlineStep) UnmarshalJSON(b []byte) error {
	var str string
	if json.Unmarshal(b, &str) == nil {
		s.Title = str
		return nil
	}
	type plain OutlineStep
	var p plain
	if err := json.Unmarshal(b, &p); err != nil {
		return errors.New(`a workflow step must be a string or {"title", "owner"}`)
	}
	*s = OutlineStep(p)
	return nil
}

// OutlinePhase is one delivery phase.
type OutlinePhase struct {
	Name         string   `json:"name"`
	Duration     string   `json:"duration,omitempty"`
	Deliverables []string `json:"deliverables,omitempty"`
}

// OutlinePrice is one priced item.
type OutlinePrice struct {
	Item  string `json:"item"`
	Price string `json:"price"`
	Note  string `json:"note,omitempty"`
}

// Outline is the input of presentation_create_from_outline.
type Outline struct {
	Customer      PresentationCustomer `json:"customer"`
	Locale        string               `json:"locale,omitempty"`
	Kinds         []string             `json:"kinds,omitempty"`
	Template      string               `json:"template,omitempty"`
	Title         string               `json:"title"`
	Problem       string               `json:"problem"`
	Goals         []string             `json:"goals,omitempty"`
	WorkflowSteps []OutlineStep        `json:"workflow_steps,omitempty"`
	Screens       []string             `json:"screens,omitempty"`
	Phases        []OutlinePhase       `json:"phases,omitempty"`
	Pricing       []OutlinePrice       `json:"pricing,omitempty"`
	NextStep      string               `json:"next_step,omitempty"`

	// Set by OutlineFromBrain only (never from JSON): the brain material the
	// outline was built from, cited in the report and the deck notes, and
	// brain headings (Summary / Key points / Connected) instead of the
	// proposal ones. A brain outline never gets a placeholder workflow.
	brain   bool
	sources []Material
}

// TemplateKeys are the starter flavours.
var TemplateKeys = []string{"consulting_proposal", "product_pitch", "status_report", "assessment", "landing_concept"}

type labels struct {
	problem, goals, how, screens, plan, investment, next, summary, phase, duration, deliverables,
	item, price, note, contact, whyNow, preparedFor, screen, step, open, current, done, planned string
}

var outlineLabels = map[string]labels{
	"en": {problem: "The problem", goals: "Goals", how: "How it works", screens: "What we will build", plan: "Plan",
		investment: "Investment", next: "Next step", summary: "Summary", phase: "Phase", duration: "Duration",
		deliverables: "Deliverables", item: "Item", price: "Price", note: "Note", contact: "Talk to us",
		whyNow: "Why it matters", preparedFor: "Prepared for", screen: "Screen", step: "Step", open: "Open",
		current: "In progress", done: "Done", planned: "Planned"},
	"ar": {problem: "المشكلة", goals: "الأهداف", how: "كيف يعمل", screens: "ما سنبنيه", plan: "الخطة",
		investment: "الاستثمار", next: "الخطوة التالية", summary: "الملخص", phase: "المرحلة", duration: "المدة",
		deliverables: "المخرجات", item: "البند", price: "السعر", note: "ملاحظة", contact: "تواصل معنا",
		whyNow: "لماذا يهم", preparedFor: "أُعدّ لـ", screen: "شاشة", step: "خطوة", open: "مفتوح",
		current: "قيد التنفيذ", done: "منجز", planned: "مخطط"},
}

var (
	goalIcons  = []string{"target", "zap", "shield-check", "trending-up", "users", "sparkles", "gauge", "check-check"}
	stepIcons  = []string{"inbox", "search-check", "clipboard-list", "cog", "badge-check", "truck", "file-text", "send", "chart-column", "workflow", "users", "check"}
	phaseIcons = []string{"compass", "drafting-compass", "code", "rocket", "life-buoy", "trending-up"}
)

func cut(s string, n int) string {
	s = strings.TrimSpace(s)
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	if n <= 1 {
		return string(r[:n])
	}
	return strings.TrimSpace(string(r[:n-1])) + "…"
}

func firstN[T any](l []T, n int) []T {
	if len(l) > n {
		return l[:n]
	}
	return l
}

func orDefault(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}

// normalise fills defaults and checks the few required outline fields.
func (o *Outline) normalise() error {
	var problems []string
	if strings.TrimSpace(o.Customer.Name) == "" && strings.TrimSpace(o.Customer.Company) == "" {
		problems = append(problems, "customer: give a name or a company")
	}
	if strings.TrimSpace(o.Title) == "" {
		problems = append(problems, "title: is required")
	}
	if strings.TrimSpace(o.Problem) == "" {
		problems = append(problems, "problem: is required (one or two sentences)")
	}
	if o.Locale == "" {
		o.Locale = "en"
	}
	if !IsLocale(o.Locale) {
		problems = append(problems, "locale: must be en or ar")
	}
	if len(o.Kinds) == 0 {
		o.Kinds = []string{KindDeck, KindReport, KindPage}
	}
	seen := map[string]bool{}
	var kinds []string
	for _, k := range o.Kinds {
		if _, ok := specs[k]; !ok {
			problems = append(problems, fmt.Sprintf("kinds: %q is not one of deck, report, page", k))
			continue
		}
		if !seen[k] {
			seen[k] = true
			kinds = append(kinds, k)
		}
	}
	o.Kinds = kinds
	if o.Template == "" {
		o.Template = "consulting_proposal"
	}
	okT := false
	for _, k := range TemplateKeys {
		okT = okT || k == o.Template
	}
	if !okT {
		problems = append(problems, "template: must be one of "+strings.Join(TemplateKeys, ", "))
	}
	var steps []OutlineStep
	for _, s := range o.WorkflowSteps {
		if strings.TrimSpace(s.Title) != "" {
			steps = append(steps, s)
		}
	}
	o.WorkflowSteps = firstN(steps, 12)
	if len(problems) > 0 {
		return InvalidError{Msg: "outline: " + strings.Join(problems, "; ")}
	}
	return nil
}

func (o *Outline) workflow(l labels) map[string]any {
	steps := []any{}
	src := o.WorkflowSteps
	if len(src) < 2 {
		// Fall back to the goals, then to a neutral skeleton.
		src = nil
		for _, g := range firstN(o.Goals, 6) {
			src = append(src, OutlineStep{Title: g})
		}
		for len(src) < 2 {
			src = append(src, OutlineStep{Title: fmt.Sprintf("%s %d", l.step, len(src)+1)})
		}
	}
	for i, s := range src {
		st := map[string]any{"id": fmt.Sprintf("s%d", i+1), "title": cut(s.Title, 80), "icon": stepIcons[i%len(stepIcons)]}
		if s.Owner != "" {
			st["owner"] = cut(s.Owner, 60)
		}
		switch {
		case i == len(src)-1:
			st["kind"] = "output"
		case strings.Contains(strings.ToLower(s.Title), "review") || strings.Contains(s.Title, "مراجع"):
			st["kind"] = "human_review"
		}
		steps = append(steps, st)
	}
	return map[string]any{"type": "workflow", "title": l.how, "layout": "auto", "steps": steps, "highlight": "s1"}
}

func (o *Outline) screen(i int, desc string, l labels) map[string]any {
	nav := []any{}
	for j, s := range firstN(o.WorkflowSteps, 6) {
		nav = append(nav, map[string]any{"label": cut(s.Title, 40), "icon": stepIcons[j%len(stepIcons)], "active": j == i%max(1, min(6, len(o.WorkflowSteps)))})
	}
	items := []any{}
	for j, s := range firstN(o.WorkflowSteps, 5) {
		status, tone := l.planned, "neutral"
		if j == 0 {
			status, tone = l.done, "success"
		} else if j == 1 {
			status, tone = l.current, "info"
		}
		items = append(items, map[string]any{"title": cut(s.Title, 100), "meta": cut(s.Owner, 80), "status": status, "tone": tone, "icon": stepIcons[j%len(stepIcons)]})
	}
	parts := []any{
		map[string]any{"type": "callout", "tone": "info", "title": cut(fmt.Sprintf("%s %d", l.screen, i+1), 80), "text": cut(desc, 300)},
	}
	if len(items) > 0 {
		parts = append(parts, map[string]any{"type": "list", "title": l.how, "items": items})
	}
	sc := map[string]any{
		"type": "screen", "frame": "browser", "title": cut(desc, 160), "screen_title": cut(desc, 80),
		"url": cut("app."+slug(o.Customer.Company, o.Customer.Name)+".com", 120), "parts": parts,
		"annotations": []any{map[string]any{"target_part_index": 0, "text": cut(desc, 160)}},
	}
	if len(nav) > 0 {
		sc["layout"] = "sidebar"
		sc["nav"] = nav
	}
	return sc
}

func slug(parts ...string) string {
	for _, p := range parts {
		var b strings.Builder
		for _, r := range strings.ToLower(p) {
			if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
				b.WriteRune(r)
			}
		}
		if b.Len() > 0 {
			return cut(b.String(), 30)
		}
	}
	return "example"
}

func (o *Outline) phasesWorkflow(l labels) map[string]any {
	steps := []any{}
	for i, p := range firstN(o.Phases, 12) {
		st := map[string]any{"id": fmt.Sprintf("p%d", i+1), "title": cut(orDefault(p.Name, fmt.Sprintf("%s %d", l.phase, i+1)), 80),
			"icon": phaseIcons[i%len(phaseIcons)], "kind": "step"}
		if p.Duration != "" {
			st["owner"] = cut(p.Duration, 60)
		}
		if len(p.Deliverables) > 0 {
			st["text"] = cut(strings.Join(p.Deliverables, " · "), 240)
		}
		steps = append(steps, st)
	}
	return map[string]any{"type": "workflow", "title": l.plan, "layout": "horizontal", "steps": steps}
}

func (o *Outline) deck(l labels, pageID string) map[string]any {
	who := strings.Join(nonEmpty(o.Customer.Name, o.Customer.Company), " · ")
	slides := []any{map[string]any{"type": "title", "title": cut(o.Title, 200), "subtitle": cut(l.preparedFor+" "+who, 300),
		"eyebrow": cut(o.Customer.Company, 80), "icon": "sparkles"}}
	if n := o.sourceNotes(); n != "" {
		slides[0].(map[string]any)["notes"] = n
	}
	bullets := []any{map[string]any{"text": cut(o.Problem, 500), "icon": "circle-help"}}
	for i, g := range firstN(o.Goals, 11) {
		bullets = append(bullets, map[string]any{"text": cut(g, 500), "icon": goalIcons[i%len(goalIcons)]})
	}
	slides = append(slides, map[string]any{"type": "bullets", "title": l.problem, "bullets": bullets})
	if o.hasWorkflow() {
		slides = append(slides, o.workflow(l))
	}
	for i, s := range firstN(o.Screens, 6) {
		slides = append(slides, o.screen(i, s, l))
	}
	if len(o.Phases) >= 2 {
		slides = append(slides, o.phasesWorkflow(l))
	}
	if len(o.Pricing) > 0 {
		metrics := []any{}
		for i, p := range firstN(o.Pricing, 6) {
			m := map[string]any{"label": cut(p.Item, 80), "value": cut(p.Price, 24), "icon": []string{"coins", "receipt", "wallet", "banknote", "credit-card", "piggy-bank"}[i%6]}
			if p.Note != "" {
				m["delta"] = cut(p.Note, 24)
			}
			metrics = append(metrics, m)
		}
		slides = append(slides, map[string]any{"type": "metric", "title": l.investment, "metrics": metrics})
	}
	if pageID != "" {
		slides = append(slides, map[string]any{"type": "embed", "title": cut(o.Title, 200), "document_id": pageID})
	}
	if o.NextStep != "" {
		slides = append(slides, map[string]any{"type": "title", "eyebrow": l.next, "title": cut(o.NextStep, 200), "icon": "arrow-right"})
	}
	return map[string]any{"title": cut(o.Title, 200), "subtitle": cut(who, 300), "transition": "slide", "slides": slides}
}

func nonEmpty(s ...string) []string {
	var out []string
	for _, x := range s {
		if strings.TrimSpace(x) != "" {
			out = append(out, x)
		}
	}
	return out
}

func (o *Outline) report(l labels) map[string]any {
	sections := []any{}
	goals := make([]string, 0, len(o.Goals))
	for _, g := range firstN(o.Goals, 20) {
		goals = append(goals, "- "+cut(g, 400))
	}
	intro := []any{map[string]any{"type": "markdown", "text": cut(o.Problem, 4000)}}
	if len(goals) > 0 {
		intro = append(intro, map[string]any{"type": "markdown", "text": "**" + l.goals + "**\n\n" + strings.Join(goals, "\n")})
	}
	sections = append(sections, map[string]any{"heading": l.problem, "blocks": intro})
	if o.hasWorkflow() {
		sections = append(sections, map[string]any{"heading": l.how, "blocks": []any{o.workflow(l)}})
	}
	if len(o.Screens) > 0 {
		blocks := []any{}
		for i, s := range firstN(o.Screens, 10) {
			blocks = append(blocks, o.screen(i, s, l))
		}
		sections = append(sections, map[string]any{"heading": l.screens, "blocks": blocks})
	}
	if len(o.Phases) > 0 {
		rows := []any{}
		for _, p := range firstN(o.Phases, 50) {
			rows = append(rows, []any{cut(p.Name, 200), cut(p.Duration, 100), cut(strings.Join(p.Deliverables, "، "), 900)})
		}
		blocks := []any{}
		if len(o.Phases) >= 2 {
			blocks = append(blocks, o.phasesWorkflow(l))
		}
		blocks = append(blocks, map[string]any{"type": "table", "columns": []any{l.phase, l.duration, l.deliverables}, "rows": rows})
		sections = append(sections, map[string]any{"heading": l.plan, "blocks": blocks})
	}
	if len(o.Pricing) > 0 {
		rows := []any{}
		for _, p := range firstN(o.Pricing, 50) {
			rows = append(rows, []any{cut(p.Item, 300), cut(p.Price, 100), cut(p.Note, 500)})
		}
		sections = append(sections, map[string]any{"heading": l.investment, "blocks": []any{
			map[string]any{"type": "table", "columns": []any{l.item, l.price, l.note}, "rows": rows}}})
	}
	if o.NextStep != "" {
		sections = append(sections, map[string]any{"heading": l.next, "blocks": []any{
			map[string]any{"type": "callout", "tone": "success", "title": l.next, "text": cut(o.NextStep, 2000)}}})
	}
	who := strings.Join(nonEmpty(o.Customer.Name, o.Customer.Company), " · ")
	if s := o.sourcesSection(l); s != nil {
		sections = append(sections, s)
	}
	return map[string]any{"title": cut(o.Title, 200), "subtitle": cut(who, 300), "summary": cut(o.Problem, 4000), "sections": sections}
}

func (o *Outline) page(l labels) map[string]any {
	sections := []any{map[string]any{"type": "hero", "eyebrow": cut(o.Customer.Company, 80), "heading": cut(o.Title, 160),
		"body": cut(o.Problem, 1000), "cta_label": cut(orDefault(o.NextStep, l.contact), 40),
		"scene": map[string]any{"type": "gradient_mesh", "params": map[string]any{}}}}
	screens := o.Screens
	if len(screens) > 0 {
		// The first screen opens the page, beside the promise.
		v := o.screen(0, screens[0], l)
		delete(v, "title")
		sections[0].(map[string]any)["visual"] = v
		screens = screens[1:]
	}
	if len(o.Goals) > 0 {
		items := []any{}
		for i, g := range firstN(o.Goals, 12) {
			items = append(items, map[string]any{"title": cut(g, 100), "icon": goalIcons[i%len(goalIcons)]})
		}
		sections = append(sections, map[string]any{"type": "features", "heading": l.whyNow, "items": items})
	}
	if o.hasWorkflow() {
		sections = append(sections, o.workflow(l))
	}
	for i, s := range firstN(screens, 6) {
		sections = append(sections, o.screen(i+1, s, l))
	}
	if len(o.Pricing) > 0 {
		plans := []any{}
		for i, p := range firstN(o.Pricing, 4) {
			plan := map[string]any{"name": cut(p.Item, 60), "price": cut(p.Price, 24), "highlighted": i == 0}
			if p.Note != "" {
				plan["description"] = cut(p.Note, 200)
			}
			plans = append(plans, plan)
		}
		sections = append(sections, map[string]any{"type": "pricing", "heading": l.investment, "plans": plans})
	}
	sections = append(sections, map[string]any{"type": "cta", "heading": cut(orDefault(o.NextStep, l.next), 160), "cta_label": l.contact})
	return map[string]any{"title": cut(o.Title, 200), "description": cut(o.Problem, 300), "sections": sections}
}

// BuiltDocument is one generated document, validated and normalised.
type BuiltDocument struct {
	Kind    string         `json:"kind"`
	Content map[string]any `json:"content"`
}

// BuildFromOutline returns validated content per kind. pageID, when set, is
// embedded as the deck's page slide (the caller creates the page first).
func BuildFromOutline(o Outline, pageID string) ([]BuiltDocument, error) {
	if err := o.normalise(); err != nil {
		return nil, err
	}
	l := o.labels()
	var out []BuiltDocument
	order := map[string]int{KindPage: 0, KindDeck: 1, KindReport: 2}
	kinds := append([]string{}, o.Kinds...)
	sort.SliceStable(kinds, func(i, j int) bool { return order[kinds[i]] < order[kinds[j]] })
	for _, k := range kinds {
		var c map[string]any
		switch k {
		case KindDeck:
			c = o.deck(l, pageID)
		case KindReport:
			c = o.report(l)
		case KindPage:
			c = o.page(l)
		}
		norm, _, err := ValidateContent(k, c)
		if err != nil {
			return nil, fmt.Errorf("building the %s: %w", k, err)
		}
		// Plain JSON values (scene defaults are Go slices until marshalled).
		raw, _ := json.Marshal(norm)
		var plain map[string]any
		_ = json.Unmarshal(raw, &plain)
		out = append(out, BuiltDocument{Kind: k, Content: plain})
	}
	return out, nil
}

// EnrichHints says what a model should improve after an outline build.
func EnrichHints(o Outline) []string {
	h := []string{
		"replace the generic screen parts with real ones (kpis, table, form, chart, board) that show the product; see page_styles.blocks",
		"give each workflow step a short text, an owner and a fitting icon; mark decisions and human reviews with kind",
		"add speaker notes to the deck slides (notes)",
	}
	if len(o.Screens) == 0 {
		h = append(h, "add at least one screen block showing what will be built")
	}
	if len(o.Phases) == 0 {
		h = append(h, "add the delivery plan (phases) as a workflow and a table")
	}
	if o.Locale == "en" {
		h = append(h, "store the Arabic version: presentation_translate {id} (or with your own translated content)")
	} else {
		h = append(h, "store the English version: presentation_translate {id, to: \"en\"}")
	}
	return append(h, "presentation_share {id} to get a link for the customer")
}

// PresentationTemplate is a starter: a complete, valid document per kind and locale.
type PresentationTemplate struct {
	Key         string                               `json:"key"`
	Name        string                               `json:"name"`
	Description string                               `json:"description"`
	Kinds       []string                             `json:"kinds"`
	Outline     map[string]Outline                   `json:"outline"`
	Documents   map[string]map[string]map[string]any `json:"documents"` // kind → locale → content
}

func placeholderOutline(key, locale string) Outline {
	ar := locale == "ar"
	pick := func(en, a string) string {
		if ar {
			return a
		}
		return en
	}
	o := Outline{
		Customer: PresentationCustomer{Name: pick("<customer name>", "<اسم العميل>"), Company: pick("<company>", "<الشركة>")},
		Locale:   locale, Template: key,
		Title:   pick("<proposal title>", "<عنوان المقترح>"),
		Problem: pick("<customer problem, in one or two sentences>", "<مشكلة العميل في جملة أو جملتين>"),
		Goals:   []string{pick("<goal 1>", "<الهدف 1>"), pick("<goal 2>", "<الهدف 2>"), pick("<goal 3>", "<الهدف 3>")},
		WorkflowSteps: []OutlineStep{
			{Title: pick("<step 1: request comes in>", "<الخطوة 1: وصول الطلب>"), Owner: pick("<team>", "<الفريق>")},
			{Title: pick("<step 2: check>", "<الخطوة 2: التحقق>"), Owner: pick("<team>", "<الفريق>")},
			{Title: pick("<step 3: review>", "<الخطوة 3: المراجعة>"), Owner: pick("<team>", "<الفريق>")},
			{Title: pick("<step 4: result>", "<الخطوة 4: النتيجة>")},
		},
		Screens:  []string{pick("<screen 1: what the user sees>", "<الشاشة 1: ما يراه المستخدم>")},
		Phases:   []OutlinePhase{{Name: pick("<phase 1>", "<المرحلة 1>"), Duration: pick("<2 weeks>", "<أسبوعان>"), Deliverables: []string{pick("<deliverable>", "<مخرج>")}}, {Name: pick("<phase 2>", "<المرحلة 2>"), Duration: pick("<4 weeks>", "<4 أسابيع>")}},
		Pricing:  []OutlinePrice{{Item: pick("<item>", "<البند>"), Price: pick("<price>", "<السعر>"), Note: pick("<note>", "<ملاحظة>")}},
		NextStep: pick("<next step, e.g. a 30-minute call>", "<الخطوة التالية، مثل مكالمة 30 دقيقة>"),
	}
	switch key {
	case "product_pitch":
		o.Title = pick("<product name>: <one-line promise>", "<اسم المنتج>: <الوعد في سطر>")
		o.Kinds = []string{KindDeck, KindPage}
		o.Screens = append(o.Screens, pick("<screen 2: the dashboard>", "<الشاشة 2: لوحة المتابعة>"))
	case "status_report":
		o.Title = pick("<project> status — <date>", "حالة <المشروع> — <التاريخ>")
		o.Problem = pick("<where the project stands, in two sentences>", "<أين يقف المشروع، في جملتين>")
		o.Kinds = []string{KindReport, KindDeck}
		o.Pricing = nil
	case "assessment":
		o.Title = pick("<system> assessment", "تقييم <النظام>")
		o.Problem = pick("<what was assessed and the headline finding>", "<ما الذي قُيّم وأهم نتيجة>")
		o.Kinds = []string{KindReport, KindDeck}
	case "landing_concept":
		o.Title = pick("<headline that states the benefit>", "<عنوان يوضح الفائدة>")
		o.Kinds = []string{KindPage}
		o.Phases = nil
	default:
		o.Kinds = []string{KindDeck, KindReport, KindPage}
	}
	return o
}

var templateInfo = map[string][2]string{
	"consulting_proposal": {"Consulting proposal", "Problem, goals, the future workflow, screens of what will be built, plan, investment, next step. Deck + report + page."},
	"product_pitch":       {"Product pitch", "A product story: promise, how it works, two screens, pricing. Deck + landing page."},
	"status_report":       {"Project status report", "Where the project stands, the workflow in flight, delivery phases. Report + short deck."},
	"assessment":          {"Audit / assessment", "What was assessed, findings, the target workflow and the remediation plan. Report + deck."},
	"landing_concept":     {"Landing concept", "A concept landing page: hero, benefits, how it works, a product screen, pricing, call to action."},
}

// Templates builds every starter (or one, by key) in both locales.
func Templates(only string) ([]PresentationTemplate, error) {
	var out []PresentationTemplate
	for _, key := range TemplateKeys {
		if only != "" && only != key {
			continue
		}
		t := PresentationTemplate{Key: key, Name: templateInfo[key][0], Description: templateInfo[key][1],
			Outline: map[string]Outline{}, Documents: map[string]map[string]map[string]any{}}
		for _, loc := range Locales {
			o := placeholderOutline(key, loc)
			docs, err := BuildFromOutline(o, "<page document id>")
			if err != nil {
				return nil, fmt.Errorf("template %s/%s: %w", key, loc, err)
			}
			t.Kinds = o.Kinds
			t.Outline[loc] = o
			for _, d := range docs {
				if t.Documents[d.Kind] == nil {
					t.Documents[d.Kind] = map[string]map[string]any{}
				}
				t.Documents[d.Kind][loc] = d.Content
			}
		}
		out = append(out, t)
	}
	if only != "" && len(out) == 0 {
		return nil, InvalidError{Msg: "template must be one of " + strings.Join(TemplateKeys, ", ")}
	}
	return out, nil
}

// FixHint turns a validation message into advice a small model can act on.
func FixHint(fe FieldError) string {
	m := fe.Message
	switch {
	case strings.HasPrefix(m, "is required"):
		return "add this field"
	case strings.HasPrefix(m, "unknown field"):
		return "remove this field; " + m
	case strings.HasPrefix(m, "unknown icon"):
		return "use a name from page_styles.icons; " + m
	case strings.HasPrefix(m, "unknown type"), strings.HasPrefix(m, "unknown scene type"):
		return "use one of the listed types"
	case strings.HasPrefix(m, "must be one of"):
		return "use exactly one of the listed values"
	case strings.HasPrefix(m, "must be at most"):
		return "shorten it"
	case strings.HasPrefix(m, "allows at most"):
		return "remove items"
	case strings.HasPrefix(m, "needs at least"):
		return "add items"
	case strings.HasPrefix(m, "unknown step id"):
		return "use the id of a step in this workflow's steps"
	case strings.HasPrefix(m, "must be an https"):
		return "use an https:// URL or a path starting with /"
	case strings.Contains(m, "must be a"):
		return "change the value's type: " + m
	}
	return "fix the value at this path"
}
