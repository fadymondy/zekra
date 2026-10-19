package brain

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// GET /api/brain/conflicts?namespace=&status=&memory=&limit=
// status: "" (open) | all | resolved | open | resolved_keep_new | resolved_keep_old | both_valid_scoped
func (s *Service) ConflictsHandler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	ns := q.Get("namespace")
	if ns != "" && !s.canRead(r, ns) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no read access to brain "+ns))
		return
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	list, err := s.Store.Conflicts(r.Context(), ns, q.Get("status"), q.Get("memory"), limit)
	if err != nil {
		writeErr(w, err)
		return
	}
	// A non-admin caller only sees conflicts in brains it can read.
	if c := s.identify(r); !c.admin && ns == "" {
		kept := list[:0]
		for _, x := range list {
			if s.canRead(r, x.Namespace) {
				kept = append(kept, x)
			}
		}
		list = kept
	}
	writeJSON(w, http.StatusOK, map[string]any{"conflicts": list})
}

// POST /api/brain/conflicts/resolve  { id, resolution, note }
// resolution: keep_new | keep_old | both_valid_scoped | open
func (s *Service) ResolveConflictHandler(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID         string `json:"id"`
		Resolution string `json:"resolution"`
		Note       string `json:"note"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "bad JSON body"))
		return
	}
	if in.ID == "" || normResolution(in.Resolution) == "" {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument",
			"id and resolution (keep_new | keep_old | both_valid_scoped | open) are required"))
		return
	}
	c, err := s.Store.GetConflict(r.Context(), in.ID)
	if err != nil {
		writeErr(w, err)
		return
	}
	// Resolving changes which memory is valid: a write on the conflict's brain.
	if !s.canWrite(r, c.Namespace) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no write access to brain "+c.Namespace))
		return
	}
	out, err := s.Store.ResolveConflict(r.Context(), in.ID, in.Resolution, in.Note)
	if err != nil {
		writeErr(w, err)
		return
	}
	s.hub.publish("conflict", map[string]any{"namespace": out.Namespace, "resolved": out.ID, "status": out.Status})
	writeJSON(w, http.StatusOK, out)
}

// GET /api/brain/provenance?namespace=&kind=memory|presentation&id=
// What an item was derived from, what was derived from it, and which retired
// sources make it stale.
func (s *Service) ProvenanceHandler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	ns, kind, id := q.Get("namespace"), q.Get("kind"), q.Get("id")
	if kind == "" {
		kind = DerivedMemory
	}
	if ns == "" || id == "" {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "namespace and id are required"))
		return
	}
	if !s.canRead(r, ns) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no read access to brain "+ns))
		return
	}
	// The item must belong to the brain the caller can read.
	if owner := s.Store.derivationNamespace(r.Context(), kind, id); owner != "" {
		if owner != ns {
			writeErr(w, ErrNotFound)
			return
		}
	} else if kind == DerivedMemory {
		if _, err := s.Store.Get(r.Context(), ns, id); err != nil {
			writeErr(w, err)
			return
		}
	}
	p, err := s.Store.Provenance(r.Context(), kind, id)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}
