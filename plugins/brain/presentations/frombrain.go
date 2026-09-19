package presentations

import (
	"fmt"
	"regexp"
	"strings"
)

/*
"From Zekra": building an outline out of a brain instead of a pasted note.

The brain plugin gathers the material (internal/brain/presentations_gather.go:
notes by id, a recall query, an entity's spine, or a brain's top notes by
category) and hands it here as a Gathered. OutlineFromBrain turns it into an
Outline for the SAME deterministic builder the pasted-outline path uses.

No invented facts: every sentence in the result is either the caller's own
framing (title, customer) or text copied from the gathered material (note
titles and paragraphs, memory text, entity names and summaries, counts the
graph reported). There are no phases, prices, screens or next step unless the
caller passes them, the builder generates no numbers, a brain outline never
gets the placeholder "Step 1 / Step 2" workflow, and the report ends with a
Sources section (the deck's first slide carries the ids in its speaker notes,
which a share link never shows). Documents are created as drafts.
*/

// Material is one piece of gathered brain content.
type Material struct {
	Kind  string `json:"kind"` // note | memory | entity
	Ref   string `json:"ref"`  // note id, memory id or entity id
	Title string `json:"title"`
	Text  string `json:"text,omitempty"`
	Group string `json:"group,omitempty"` // note category or spine role
}

// Gathered is what the brain returned for a source.
type Gathered struct {
	// Title is the natural title of the material (entity name, query, brain).
	Title string
	// Summary is the lead paragraph, copied from the material.
	Summary string
	Items   []Material
	// Steps are the "connected" groups (spine roles, note categories) with the
	// counts the brain reported; nil when the source has no such structure.
	Steps []OutlineStep
}

// BrainSource selects the material: {kind: notes, ids} | {kind: query, q,
// limit} | {kind: entity, id} | {kind: namespace}.
type BrainSource struct {
	Kind  string   `json:"kind"`
	IDs   []string `json:"ids,omitempty"`
	Q     string   `json:"q,omitempty"`
	Limit int      `json:"limit,omitempty"`
	ID    string   `json:"id,omitempty"`
}

// FromBrainRequest is POST /api/presentations/from-brain (and the MCP
// presentation_create_from_outline with a source).
type FromBrainRequest struct {
	Namespace string                `json:"namespace"`
	Source    BrainSource           `json:"source"`
	Customer  *PresentationCustomer `json:"customer,omitempty"`
	Title     string                `json:"title,omitempty"`
	Locale    string                `json:"locale,omitempty"`
	Kinds     []string              `json:"kinds,omitempty"`
	Style     string                `json:"style,omitempty"`
}

// BrainSourceKinds are the accepted source kinds.
var BrainSourceKinds = []string{"notes", "query", "entity", "namespace"}

// CheckBrainSource validates a source before any gathering.
func CheckBrainSource(src BrainSource) error {
	switch src.Kind {
	case "notes":
		if len(src.IDs) == 0 || len(src.IDs) > 50 {
			return InvalidError{"source.ids: give 1 to 50 note ids"}
		}
	case "query":
		if strings.TrimSpace(src.Q) == "" {
			return InvalidError{"source.q: a query is required"}
		}
		if src.Limit < 0 || src.Limit > 50 {
			return InvalidError{"source.limit: 1 to 50 (default 12)"}
		}
	case "entity":
		if strings.TrimSpace(src.ID) == "" {
			return InvalidError{"source.id: an entity id or name is required"}
		}
	case "namespace":
	default:
		return InvalidError{"source.kind must be one of: " + strings.Join(BrainSourceKinds, ", ")}
	}
	return nil
}

type brainLabels struct{ summary, points, connected, sources string }

var brainHeadings = map[string]brainLabels{
	"en": {summary: "Summary", points: "Key points", connected: "Connected", sources: "Sources"},
	"ar": {summary: "الملخص", points: "النقاط الرئيسية", connected: "مرتبط بـ", sources: "المصادر"},
}

// labels are the outline headings, brain ones for a brain outline.
func (o *Outline) labels() labels {
	l := outlineLabels[o.Locale]
	if o.brain {
		b := brainHeadings[o.Locale]
		l.problem, l.goals, l.how, l.whyNow = b.summary, b.points, b.connected, b.points
	}
	return l
}

// hasWorkflow: a pasted outline always gets one (placeholders included, as
// on fadymondy.com); a brain outline only when the brain gave >= 2 steps.
func (o *Outline) hasWorkflow() bool {
	return !o.brain || len(o.WorkflowSteps) >= 2
}

// sourcesSection lists the material a brain outline was built from.
func (o *Outline) sourcesSection(l labels) map[string]any {
	if !o.brain || len(o.sources) == 0 {
		return nil
	}
	var lines []string
	for _, m := range firstN(o.sources, 40) {
		line := "- " + cut(m.Title, 200)
		if m.Group != "" {
			line += " (" + cut(m.Group, 60) + ")"
		}
		lines = append(lines, line)
	}
	return map[string]any{"heading": brainHeadings[o.Locale].sources, "blocks": []any{
		map[string]any{"type": "markdown", "text": cut(strings.Join(lines, "\n"), 20000)}}}
}

// sourceNotes are the deck's owner-only provenance (ids), "" otherwise.
func (o *Outline) sourceNotes() string {
	if !o.brain || len(o.sources) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("Built from the brain, only from this material:\n")
	for _, m := range firstN(o.sources, 40) {
		fmt.Fprintf(&b, "- %s %s: %s\n", m.Kind, m.Ref, cut(m.Title, 80))
	}
	return cut(b.String(), 5000)
}

var (
	mdHeadingRE = regexp.MustCompile(`(?m)^\s{0,3}#{1,6}\s+`)
	mdNoiseRE   = regexp.MustCompile("[*_`>]+")
	spaceRE     = regexp.MustCompile(`\s+`)
)

// Excerpt is the first real paragraph of a markdown text, plain, at most n runes.
func Excerpt(md string, n int) string {
	for _, para := range strings.Split(strings.ReplaceAll(md, "\r", ""), "\n\n") {
		p := strings.TrimSpace(para)
		if p == "" || strings.HasPrefix(p, "#") && !strings.Contains(p, "\n") || strings.HasPrefix(p, "---") {
			continue
		}
		p = mdHeadingRE.ReplaceAllString(p, "")
		p = mdNoiseRE.ReplaceAllString(p, "")
		p = strings.TrimSpace(spaceRE.ReplaceAllString(p, " "))
		if p != "" {
			return cut(p, n)
		}
	}
	return ""
}

// OutlineFromBrain builds an outline from gathered material only.
func OutlineFromBrain(req FromBrainRequest, g Gathered) (Outline, error) {
	var items []Material
	for _, m := range g.Items {
		m.Title = strings.TrimSpace(m.Title)
		m.Text = strings.TrimSpace(m.Text)
		if m.Title == "" && m.Text == "" {
			continue
		}
		if m.Title == "" {
			m.Title = cut(m.Text, 80)
		}
		items = append(items, m)
	}
	if len(items) == 0 && strings.TrimSpace(g.Summary) == "" {
		return Outline{}, InvalidError{"the brain has nothing for this source; nothing was created (no invented content)"}
	}
	o := Outline{Locale: req.Locale, Kinds: req.Kinds, brain: true, sources: items}
	if len(o.Kinds) == 0 {
		o.Kinds = []string{KindDeck, KindReport}
	}
	if req.Customer != nil {
		o.Customer = *req.Customer
	}
	if strings.TrimSpace(o.Customer.Name) == "" && strings.TrimSpace(o.Customer.Company) == "" {
		// Who it is for is framing, not a fact: default to the brain itself.
		o.Customer.Company = req.Namespace
	}
	o.Title = strings.TrimSpace(req.Title)
	if o.Title == "" {
		o.Title = strings.TrimSpace(g.Title)
	}
	if o.Title == "" && len(items) > 0 {
		o.Title = items[0].Title
	}
	o.Problem = strings.TrimSpace(g.Summary)
	rest := items
	if o.Problem == "" {
		// The lead item becomes the summary rather than a key point.
		lead := items[0]
		o.Problem = lead.Text
		if o.Problem == "" {
			o.Problem = lead.Title
		}
		rest = items[1:]
	}
	for _, m := range firstN(rest, 20) {
		point := m.Title
		if m.Text != "" && m.Text != m.Title {
			point = m.Title + ": " + m.Text
		}
		o.Goals = append(o.Goals, cut(point, 400))
	}
	for _, s := range g.Steps {
		if strings.TrimSpace(s.Title) != "" {
			o.WorkflowSteps = append(o.WorkflowSteps, s)
		}
	}
	return o, nil
}

// Sources is the material a brain outline was built from (nil otherwise).
func (o Outline) Sources() []Material { return o.sources }
