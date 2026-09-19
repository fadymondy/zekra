package brain

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
)

/*
Graph editing REST. Reads need read access to the entity's brain (an entity in a
brain you cannot read is a 404); writes need write access and pass the same
CSRF guard as notes. Every write publishes an SSE `graph` event
{namespace, kind: entity|edge|entity_type|edge_type, id, action}.

	GET    /api/brain/entities/search?namespace=&q=&type=&limit=
	POST   /api/brain/entities/neighbors  {namespace?, entity, relations?, limit?}
	POST   /api/brain/entities/path       {namespace?, from, to, max_depth?}
	GET    /api/brain/entities/{id}
	POST   /api/brain/entities            {namespace, name, entity_type, summary?, create_type?}
	PATCH  /api/brain/entities/{id}       {name?, entity_type?, summary?, metadata?, create_type?}
	DELETE /api/brain/entities/{id}
	POST   /api/brain/entities/{id}/note
	POST   /api/brain/edges               {namespace, src_id, dst_id, relation, fact?, weight?, create_type?}
	PATCH  /api/brain/edges/{id}          {relation?, fact?, weight?, create_type?}
	DELETE /api/brain/edges/{id}
	GET    /api/brain/ontology?namespace=
	POST|PATCH|DELETE /api/brain/ontology/entity-types | /edge-types
	GET    /api/notes/{id}/related
	GET    /api/notes/{id}/backlinks
*/

func (s *Service) publishGraph(ns, kind, id, action string) {
	s.hub.publish("graph", map[string]any{"namespace": ns, "kind": kind, "id": id, "action": action})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(v); err != nil {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "bad JSON body"))
		return false
	}
	return true
}

func firstStr(ps ...*string) *string {
	for _, p := range ps {
		if p != nil {
			return p
		}
	}
	return nil
}

// authorize answers the access check for a brain: 404 when unreadable, 403 when
// read-only and a write is asked for.
func (s *Service) authorize(w http.ResponseWriter, r *http.Request, ns string, write bool) bool {
	if !s.canRead(r, ns) {
		writeErr(w, ErrNotFound)
		return false
	}
	if write && !s.canWrite(r, ns) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no write access to brain "+ns))
		return false
	}
	return true
}

func (s *Service) loadEntityFor(w http.ResponseWriter, r *http.Request, write bool) (*Entity, bool) {
	e, err := s.Store.GetEntity(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, err)
		return nil, false
	}
	return e, s.authorize(w, r, e.Namespace, write)
}

// GetEntityHandler — GET /api/brain/entities/{id}
func (s *Service) GetEntityHandler(w http.ResponseWriter, r *http.Request) {
	e, ok := s.loadEntityFor(w, r, false)
	if !ok {
		return
	}
	d, err := s.Store.EntityDetail(r.Context(), e)
	if err != nil {
		writeErr(w, err)
		return
	}
	d.CanWrite = s.canWrite(r, e.Namespace)
	writeJSON(w, http.StatusOK, d)
}

type entityBody struct {
	Namespace   string         `json:"namespace"`
	Name        *string        `json:"name"`
	EntityType  *string        `json:"entity_type"`
	EntityTypeC *string        `json:"entityType"`
	Type        *string        `json:"type"`
	Summary     *string        `json:"summary"`
	Metadata    map[string]any `json:"metadata"`
	CreateType  bool           `json:"create_type"`
	CreateTypeC bool           `json:"createType"`
}

// CreateEntityHandler — POST /api/brain/entities
func (s *Service) CreateEntityHandler(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	var in entityBody
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Namespace == "" {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "namespace is required"))
		return
	}
	if !s.canWrite(r, in.Namespace) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no write access to brain "+in.Namespace))
		return
	}
	e, err := s.Store.CreateEntity(r.Context(), in.Namespace, deref(in.Name), deref(firstStr(in.EntityType, in.EntityTypeC, in.Type)),
		deref(in.Summary), in.CreateType || in.CreateTypeC)
	if err != nil {
		writeErr(w, err)
		return
	}
	s.publishGraph(e.Namespace, "entity", e.ID, "create")
	writeJSON(w, http.StatusCreated, e)
}

// UpdateEntityHandler — PATCH /api/brain/entities/{id}
func (s *Service) UpdateEntityHandler(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	e, ok := s.loadEntityFor(w, r, true)
	if !ok {
		return
	}
	var in entityBody
	if !decodeJSON(w, r, &in) {
		return
	}
	upd, note, err := s.Store.UpdateEntity(r.Context(), e.ID, EntityPatch{
		Name: in.Name, Type: firstStr(in.EntityType, in.EntityTypeC, in.Type), Summary: in.Summary,
		Metadata: in.Metadata, CreateType: in.CreateType || in.CreateTypeC,
	}, s.noteAuthor(r, ""))
	if err != nil {
		writeErr(w, err)
		return
	}
	if note != nil {
		s.publishNote("update", note)
	}
	s.publishGraph(upd.Namespace, "entity", upd.ID, "update")
	writeJSON(w, http.StatusOK, map[string]any{"entity": upd, "note": note})
}

// DeleteEntityHandler — DELETE /api/brain/entities/{id}
func (s *Service) DeleteEntityHandler(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	e, ok := s.loadEntityFor(w, r, true)
	if !ok {
		return
	}
	closed, err := s.Store.DeleteEntity(r.Context(), e.ID)
	if err != nil {
		writeErr(w, err)
		return
	}
	s.publishGraph(e.Namespace, "entity", e.ID, "delete")
	writeJSON(w, http.StatusOK, map[string]any{"id": e.ID, "deleted": true, "closedEdges": closed})
}

// EntityNoteHandler — POST /api/brain/entities/{id}/note
func (s *Service) EntityNoteHandler(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	e, ok := s.loadEntityFor(w, r, true)
	if !ok {
		return
	}
	n, created, err := s.Store.EntityNote(r.Context(), e.ID, s.noteAuthor(r, ""))
	if err != nil {
		writeErr(w, err)
		return
	}
	code := http.StatusOK
	if created {
		code = http.StatusCreated
		s.publishNote("create", n)
		s.publishGraph(e.Namespace, "entity", e.ID, "update")
	}
	writeJSON(w, code, map[string]any{"note": n, "created": created})
}

// SearchEntitiesHandler — GET /api/brain/entities/search
func (s *Service) SearchEntitiesHandler(w http.ResponseWriter, r *http.Request) {
	qv := r.URL.Query()
	ns := qv.Get("namespace")
	if !s.canRead(r, ns) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no read access to brain "+ns))
		return
	}
	limit, _ := strconv.Atoi(qv.Get("limit"))
	out, err := s.Store.SearchEntities(r.Context(), ns, qv.Get("q"), strings.TrimSpace(qv.Get("type")), limit)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entities": out})
}

// EntityNeighborsHandler — POST /api/brain/entities/neighbors
func (s *Service) EntityNeighborsHandler(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Namespace string   `json:"namespace"`
		Entity    string   `json:"entity"`
		Relations []string `json:"relations"`
		Limit     int      `json:"limit"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	e, err := s.Store.ResolveEntity(r.Context(), in.Namespace, in.Entity)
	if err != nil {
		writeErr(w, err)
		return
	}
	if !s.authorize(w, r, e.Namespace, false) {
		return
	}
	edges, err := s.Store.EntityEdges(r.Context(), e.ID, in.Relations, in.Limit)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entity": e, "edges": edges, "count": len(edges)})
}

// EntityPathHandler — POST /api/brain/entities/path
func (s *Service) EntityPathHandler(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Namespace string `json:"namespace"`
		From      string `json:"from"`
		To        string `json:"to"`
		MaxDepth  int    `json:"max_depth"`
		MaxDepthC int    `json:"maxDepth"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	from, err := s.Store.ResolveEntity(r.Context(), in.Namespace, in.From)
	if err != nil {
		writeErr(w, err)
		return
	}
	to, err := s.Store.ResolveEntity(r.Context(), from.Namespace, in.To)
	if err != nil {
		writeErr(w, err)
		return
	}
	if !s.authorize(w, r, from.Namespace, false) {
		return
	}
	depth := in.MaxDepth
	if depth == 0 {
		depth = in.MaxDepthC
	}
	path, err := s.Store.EntityPath(r.Context(), from.ID, to.ID, depth)
	if err != nil {
		writeErr(w, err)
		return
	}
	if path == nil {
		path = []PathStep{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"connected": len(path) > 0, "hops": max(len(path)-1, 0), "path": path})
}

type edgeBody struct {
	Namespace   string   `json:"namespace"`
	SrcID       string   `json:"src_id"`
	SrcIDC      string   `json:"srcId"`
	DstID       string   `json:"dst_id"`
	DstIDC      string   `json:"dstId"`
	Relation    *string  `json:"relation"`
	Fact        *string  `json:"fact"`
	Weight      *float64 `json:"weight"`
	CreateType  bool     `json:"create_type"`
	CreateTypeC bool     `json:"createType"`
}

// CreateEdgeHandler — POST /api/brain/edges
func (s *Service) CreateEdgeHandler(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	var in edgeBody
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Namespace == "" || !s.canWrite(r, in.Namespace) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no write access to brain "+in.Namespace))
		return
	}
	src, dst := in.SrcID, in.DstID
	if src == "" {
		src = in.SrcIDC
	}
	if dst == "" {
		dst = in.DstIDC
	}
	e, err := s.Store.CreateEdge(r.Context(), EdgeInput{Namespace: in.Namespace, SrcID: src, DstID: dst,
		Relation: deref(in.Relation), Fact: deref(in.Fact), Weight: in.Weight, CreateType: in.CreateType || in.CreateTypeC})
	if err != nil {
		writeErr(w, err)
		return
	}
	s.publishGraph(e.Namespace, "edge", e.ID, "create")
	writeJSON(w, http.StatusCreated, e)
}

func (s *Service) loadEdgeFor(w http.ResponseWriter, r *http.Request) (*GraphEdgeRow, bool) {
	e, err := s.Store.GetEdge(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, err)
		return nil, false
	}
	return e, s.authorize(w, r, e.Namespace, true)
}

// UpdateEdgeHandler — PATCH /api/brain/edges/{id}
func (s *Service) UpdateEdgeHandler(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	cur, ok := s.loadEdgeFor(w, r)
	if !ok {
		return
	}
	var in edgeBody
	if !decodeJSON(w, r, &in) {
		return
	}
	e, err := s.Store.UpdateEdge(r.Context(), cur.ID, EdgePatch{Relation: in.Relation, Fact: in.Fact, Weight: in.Weight,
		CreateType: in.CreateType || in.CreateTypeC})
	if err != nil {
		writeErr(w, err)
		return
	}
	if e.ID != cur.ID {
		s.publishGraph(cur.Namespace, "edge", cur.ID, "delete")
		s.publishGraph(e.Namespace, "edge", e.ID, "create")
	} else {
		s.publishGraph(e.Namespace, "edge", e.ID, "update")
	}
	writeJSON(w, http.StatusOK, map[string]any{"edge": e, "replaced": e.ID != cur.ID, "previousId": cur.ID})
}

// DeleteEdgeHandler — DELETE /api/brain/edges/{id}
func (s *Service) DeleteEdgeHandler(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	cur, ok := s.loadEdgeFor(w, r)
	if !ok {
		return
	}
	e, err := s.Store.DeleteEdge(r.Context(), cur.ID)
	if err != nil {
		writeErr(w, err)
		return
	}
	s.publishGraph(e.Namespace, "edge", e.ID, "delete")
	writeJSON(w, http.StatusOK, e)
}

// OntologyV2Handler — GET /api/brain/ontology?namespace=
func (s *Service) OntologyV2Handler(w http.ResponseWriter, r *http.Request) {
	ns := r.URL.Query().Get("namespace")
	if !s.canRead(r, ns) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no read access to brain "+ns))
		return
	}
	ents, rels, err := s.Store.Ontology(r.Context(), ns)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"namespace": ns, "entityTypes": ents, "edgeTypes": rels})
}

func (s *Service) ontologyWrite(kind OntologyKind) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.noteWriteGuard(w, r) {
			return
		}
		var in struct {
			Namespace   string `json:"namespace"`
			Name        string `json:"name"`
			Description string `json:"description"`
			ReassignTo  string `json:"reassign_to"`
			ReassignToC string `json:"reassignTo"`
		}
		if r.Method == http.MethodDelete {
			qv := r.URL.Query()
			in.Namespace, in.Name, in.ReassignTo = qv.Get("namespace"), qv.Get("name"), qv.Get("reassign_to")
			if in.ReassignTo == "" {
				in.ReassignTo = qv.Get("reassignTo")
			}
			if in.Namespace == "" && r.ContentLength > 0 && !decodeJSON(w, r, &in) {
				return
			}
		} else if !decodeJSON(w, r, &in) {
			return
		}
		if in.ReassignTo == "" {
			in.ReassignTo = in.ReassignToC
		}
		if in.Namespace == "" || !s.canWrite(r, in.Namespace) {
			writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no write access to brain "+in.Namespace))
			return
		}
		ctx := r.Context()
		var (
			out    any
			err    error
			action string
			code   = http.StatusOK
		)
		switch r.Method {
		case http.MethodPost:
			action, code = "create", http.StatusCreated
			out, err = s.Store.CreateType(ctx, kind, in.Namespace, in.Name, in.Description)
		case http.MethodPatch:
			action = "update"
			out, err = s.Store.UpdateType(ctx, kind, in.Namespace, in.Name, in.Description)
		default:
			action = "delete"
			var moved int
			moved, err = s.Store.DeleteType(ctx, kind, in.Namespace, in.Name, in.ReassignTo, s.noteAuthor(r, ""))
			out = map[string]any{"name": in.Name, "deleted": true, "reassigned": moved, "reassignTo": in.ReassignTo}
		}
		if err != nil {
			writeErr(w, err)
			return
		}
		s.publishGraph(in.Namespace, string(kind)+"_type", in.Name, action)
		writeJSON(w, code, out)
	}
}

// NoteRelated — GET /api/notes/{id}/related
func (s *Service) NoteRelated(w http.ResponseWriter, r *http.Request) {
	n, ok := s.loadNoteFor(w, r, false)
	if !ok {
		return
	}
	out, err := s.Store.Related(r.Context(), n)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": n.ID, "entityId": n.EntityID, "related": out})
}

// NoteBacklinks — GET /api/notes/{id}/backlinks
func (s *Service) NoteBacklinks(w http.ResponseWriter, r *http.Request) {
	n, ok := s.loadNoteFor(w, r, false)
	if !ok {
		return
	}
	out, err := s.Store.Backlinks(r.Context(), n)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": n.ID, "entityId": n.EntityID, "backlinks": out})
}
