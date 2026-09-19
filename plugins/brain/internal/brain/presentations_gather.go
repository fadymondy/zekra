package brain

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/togo-framework/brain/presentations"
)

/*
Gathering brain material for POST /api/presentations/from-brain. Everything is
read through the existing Store (notes, recall, the spine) and scoped to the
one namespace the caller was already authorized for; the result is handed to
presentations.OutlineFromBrain, which adds nothing of its own.

	notes      {ids}        those notes (others' brains and deleted notes are skipped)
	query      {q, limit}   hybrid recall in the brain (needs the embedder)
	entity     {id}         the entity's spine: its root summary and role groups
	namespace  {}           the brain's top notes, a few per category (pinned first)
*/

const (
	presExcerpt       = 400
	presPerCategory   = 3
	presMaxCategories = 8
)

func (s *Service) gatherForPresentation(ctx context.Context, ns string, src presentations.BrainSource, locale string) (presentations.Gathered, error) {
	var g presentations.Gathered
	switch src.Kind {
	case "notes":
		seen := map[string]bool{}
		for _, id := range src.IDs {
			id = strings.TrimSpace(id)
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			n, err := s.Store.GetNote(ctx, id)
			if err != nil || n.Namespace != ns || n.Deleted {
				continue // a note outside this brain is simply not material
			}
			g.Items = append(g.Items, noteMaterial(n))
		}
		if len(g.Items) == 1 {
			g.Title = g.Items[0].Title
		}
	case "query":
		limit := src.Limit
		if limit <= 0 {
			limit = 12
		}
		mems, err := s.Store.Recall(ctx, RecallQuery{Namespace: ns, Query: src.Q, Limit: limit, ExpandEntity: true})
		if err != nil {
			return g, err
		}
		g.Title = strings.TrimSpace(src.Q)
		for _, m := range mems {
			text := presentations.Excerpt(m.Content, presExcerpt)
			g.Items = append(g.Items, presentations.Material{Kind: "memory", Ref: m.ID,
				Title: presentations.Excerpt(firstLine(m.Content), 80), Text: text})
		}
	case "entity":
		sp, err := s.Store.Spine(ctx, SpineQuery{Namespace: ns, Entity: src.ID, PerGroup: 6})
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				return g, presentations.InvalidError{Msg: "source.id: no entity " + fmt.Sprintf("%q", src.ID) + " in brain " + ns}
			}
			return g, err
		}
		g.Title = sp.Root.Name
		g.Summary = strings.TrimSpace(sp.Root.Summary)
		var roles []string
		for _, grp := range sp.Groups {
			if grp.Total == 0 {
				continue
			}
			roles = append(roles, grp.Role)
			g.Steps = append(g.Steps, presentations.OutlineStep{Title: grp.Role, Owner: fmt.Sprint(grp.Total)})
			for _, it := range grp.Items {
				g.Items = append(g.Items, presentations.Material{Kind: "entity", Ref: it.ID, Title: it.Name,
					Text: presentations.Excerpt(it.Summary, presExcerpt), Group: grp.Role})
			}
		}
		if g.Summary == "" && sp.Nodes > 0 {
			// Only what the graph reported: the root, its type and the counts.
			if locale == "ar" {
				g.Summary = fmt.Sprintf("%s (%s): %d عنصرًا مرتبطًا — %s.", sp.Root.Name, sp.Root.Type, sp.Nodes, strings.Join(roles, "، "))
			} else {
				g.Summary = fmt.Sprintf("%s (%s): %d connected entities across %s.", sp.Root.Name, sp.Root.Type, sp.Nodes, strings.Join(roles, ", "))
			}
		}
	case "namespace":
		page, err := s.Store.ListNotes(ctx, NoteQuery{Namespaces: []string{ns}, Limit: 200})
		if err != nil {
			return g, err
		}
		g.Title = ns
		byCat := map[string][]Note{}
		var cats []string
		for _, n := range page.Notes {
			if n.Deleted || n.Archived {
				continue
			}
			if _, ok := byCat[n.Category]; !ok {
				cats = append(cats, n.Category)
			}
			byCat[n.Category] = append(byCat[n.Category], n)
		}
		counts := s.noteCategoryCounts(ctx, ns)
		sort.SliceStable(cats, func(i, j int) bool { return counts[cats[i]] > counts[cats[j]] })
		for _, c := range cats[:min(len(cats), presMaxCategories)] {
			if counts[c] > 0 {
				g.Steps = append(g.Steps, presentations.OutlineStep{Title: c, Owner: fmt.Sprint(counts[c])})
			}
			for _, n := range byCat[c][:min(len(byCat[c]), presPerCategory)] {
				full, err := s.Store.GetNote(ctx, n.ID)
				if err != nil || full.Namespace != ns {
					continue
				}
				g.Items = append(g.Items, noteMaterial(full))
			}
		}
	}
	return g, nil
}

func noteMaterial(n *Note) presentations.Material {
	return presentations.Material{Kind: "note", Ref: n.ID, Title: n.Title,
		Text: presentations.Excerpt(n.Body, presExcerpt), Group: n.Category}
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

// noteCategoryCounts are the exact live-note counts per category of a brain.
func (s *Service) noteCategoryCounts(ctx context.Context, ns string) map[string]int {
	out := map[string]int{}
	db, err := s.Store.db(ctx)
	if err != nil {
		return out
	}
	rows, err := db.QueryContext(ctx, `SELECT category, COUNT(*) FROM notes
		WHERE namespace = $1 AND deleted_at IS NULL AND NOT archived GROUP BY category`, ns)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var c string
		var n int
		if rows.Scan(&c, &n) == nil {
			out[c] = n
		}
	}
	return out
}
