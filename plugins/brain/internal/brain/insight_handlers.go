package brain

import (
	"net/http"
	"strconv"
	"strings"
	"time"
)

// REST surface for the console's insight screens (docs/ux/ZEKRA-CAPABILITY-GAPS.md §2).
// Every endpoint is read-only and scoped to one brain the caller can read.

// readNS returns ?namespace= when the caller can read it, writing a 403 otherwise.
func (s *Service) readNS(w http.ResponseWriter, r *http.Request) (string, bool) {
	ns := r.URL.Query().Get("namespace")
	if !s.canRead(r, ns) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no read access to brain "+ns))
		return "", false
	}
	return ns, true
}

// parseSince accepts an RFC3339 time, a Go duration ("36h") or days ("7d"), meaning "that long ago".
func parseSince(v string) *time.Time {
	if v == "" {
		return nil
	}
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return &t
	}
	var d time.Duration
	if n, err := strconv.Atoi(strings.TrimSuffix(v, "d")); err == nil && strings.HasSuffix(v, "d") {
		d = time.Duration(n) * 24 * time.Hour
	} else if dd, err := time.ParseDuration(v); err == nil {
		d = dd
	} else {
		return nil
	}
	t := time.Now().Add(-d)
	return &t
}

func queryInt(r *http.Request, k string) int {
	n, _ := strconv.Atoi(r.URL.Query().Get(k))
	return n
}

// GET /api/brain/overview?namespace=
func (s *Service) OverviewHandler(w http.ResponseWriter, r *http.Request) {
	ns, ok := s.readNS(w, r)
	if !ok {
		return
	}
	o, err := s.Store.Overview(r.Context(), ns)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, o)
}

// GET /api/brain/memories?namespace=&type=&network=&source=&kind=&tag=&entity=&agent=
//
//	&since=&until=&state=active|invalidated|superseded|all&ids=a,b&cursor=&limit=
func (s *Service) MemoriesHandler(w http.ResponseWriter, r *http.Request) {
	ns, ok := s.readNS(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	f := MemoryFilter{Namespace: ns, MemoryType: q.Get("type"), Network: q.Get("network"),
		SourceKind: q.Get("source"), Kind: q.Get("kind"), Tag: q.Get("tag"), Entity: q.Get("entity"),
		Agent: q.Get("agent"), Since: parseSince(q.Get("since")), Until: parseSince(q.Get("until")),
		State: q.Get("state"), Cursor: q.Get("cursor"), Limit: queryInt(r, "limit")}
	if ids := q.Get("ids"); ids != "" {
		f.IDs = strings.Split(ids, ",")
		if len(f.IDs) > 100 {
			f.IDs = f.IDs[:100]
		}
	}
	page, err := s.Store.ListMemories(r.Context(), f)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// GET /api/brain/memories/facets?namespace=
func (s *Service) FacetsHandler(w http.ResponseWriter, r *http.Request) {
	ns, ok := s.readNS(w, r)
	if !ok {
		return
	}
	f, err := s.Store.Facets(r.Context(), ns)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, f)
}

// GET /api/brain/memory/usage?namespace=&id=
func (s *Service) MemoryUsageHandler(w http.ResponseWriter, r *http.Request) {
	ns, ok := s.readNS(w, r)
	if !ok {
		return
	}
	u, err := s.Store.MemoryUsage(r.Context(), ns, r.URL.Query().Get("id"))
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// GET /api/brain/recalls?namespace=&agent=&outcome=hit|empty&session=&memory=&since=&before=&limit=
func (s *Service) RecallsHandler(w http.ResponseWriter, r *http.Request) {
	ns, ok := s.readNS(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	before, _ := strconv.ParseInt(q.Get("before"), 10, 64)
	items, err := s.Store.Recalls(r.Context(), RecallFilter{Namespace: ns, Agent: q.Get("agent"),
		Outcome: q.Get("outcome"), Session: q.Get("session"), Memory: q.Get("memory"),
		Since: parseSince(q.Get("since")), Before: before, Limit: queryInt(r, "limit")})
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// GET /api/brain/agents?namespace=
func (s *Service) BrainAgentsHandler(w http.ResponseWriter, r *http.Request) {
	ns, ok := s.readNS(w, r)
	if !ok {
		return
	}
	items, err := s.Store.BrainAgents(r.Context(), ns)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
