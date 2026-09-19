package brain

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

/*
Notes REST (Phase 1). Gated like the brain endpoints: a signed-in user with
access to the brain (brain_members, or the admin role), an X-Zekra-Token with a
read/write grant, or an OAuth-connected MCP app (in-process only). Every write
publishes an SSE `note` event on /api/brain/events.

	GET    /api/notes?namespace=&q=&tag=&since=&limit=&cursor=&archived=
	POST   /api/notes                    {namespace,title,body,tags,pinned,source}
	GET    /api/notes/{id}
	PUT    /api/notes/{id}               If-Match: "<version>" or {version}; 409 + server copy on conflict
	DELETE /api/notes/{id}               optional If-Match
	GET    /api/notes/{id}/versions
	POST   /api/notes/{id}/restore       {version?}
	POST   /api/notes/{id}/append        {text}
*/

// sessionWriteOK is the CSRF rule for a cookie-authenticated write: echo the
// togo_csrf cookie in X-CSRF-Token, or send a JSON body (a cross-site form cannot
// set application/json without a CORS preflight). Tokens and bearer JWTs are not
// cookie-driven and pass.
func (s *Service) sessionWriteOK(r *http.Request) bool {
	c := s.identify(r)
	if !c.session {
		return true
	}
	if h := r.Header.Get("Authorization"); len(h) > 7 && strings.EqualFold(h[:7], "Bearer ") {
		return true
	}
	if csrfMatches(r) {
		return true
	}
	if r.Method == http.MethodDelete || r.Method == http.MethodPut || r.Method == http.MethodPatch {
		return true // never a simple (form) request
	}
	mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	return mt == "application/json"
}

func csrfMatches(r *http.Request) bool {
	c, err := r.Cookie("togo_csrf")
	h := r.Header.Get("X-CSRF-Token")
	return err == nil && h != "" && subtle.ConstantTimeCompare([]byte(c.Value), []byte(h)) == 1
}

func (s *Service) noteAuthor(r *http.Request, source string) NoteAuthor {
	c := s.identify(r)
	a := NoteAuthor{UserID: c.userID, Agent: c.agent, Source: source}
	if !validNoteSource[a.Source] {
		switch {
		case c.principal != nil:
			a.Source = "agent"
		case c.session:
			a.Source = "web"
		default:
			a.Source = "api"
		}
	}
	return a
}

func (s *Service) publishNote(action string, n *Note) {
	if n == nil {
		return
	}
	s.hub.publish("note", map[string]any{
		"namespace": n.Namespace, "id": n.ID, "action": action, "version": n.Version,
		"updatedAt": n.UpdatedAt,
	})
}

// loadNoteFor loads a note and checks the caller's access to its brain.
func (s *Service) loadNoteFor(w http.ResponseWriter, r *http.Request, write bool) (*Note, bool) {
	n, err := s.Store.GetNote(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, err)
		return nil, false
	}
	ok := s.canRead(r, n.Namespace)
	if write {
		ok = s.canWrite(r, n.Namespace)
	}
	if !ok {
		// Existence of a note in a brain you cannot read is not disclosed.
		if !s.canRead(r, n.Namespace) {
			writeErr(w, ErrNotFound)
		} else {
			writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no write access to brain "+n.Namespace))
		}
		return nil, false
	}
	return n, true
}

func (s *Service) noteWriteGuard(w http.ResponseWriter, r *http.Request) bool {
	if !s.sessionWriteOK(r) {
		writeJSON(w, http.StatusForbidden, apiErr("csrf", "send X-CSRF-Token (from GET /api/auth/csrf) or a JSON body"))
		return false
	}
	return true
}

// ListNotes — GET /api/notes
func (s *Service) ListNotes(w http.ResponseWriter, r *http.Request) {
	qv := r.URL.Query()
	q := NoteQuery{Q: strings.TrimSpace(qv.Get("q")), Tag: strings.TrimSpace(qv.Get("tag")), Cursor: qv.Get("cursor"),
		Category: strings.TrimSpace(qv.Get("category"))}
	q.Limit, _ = strconv.Atoi(qv.Get("limit"))
	q.Archived = qv.Get("archived") == "1" || qv.Get("archived") == "true"
	if v := qv.Get("since"); v != "" {
		t, err := time.Parse(time.RFC3339Nano, v)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "since must be RFC 3339"))
			return
		}
		q.Since = &t
	}
	if ns := qv.Get("namespace"); ns != "" {
		if !s.canRead(r, ns) {
			writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no read access to brain "+ns))
			return
		}
		q.Namespaces = []string{ns}
	} else {
		q.All, q.Namespaces = s.readableNamespaces(r)
		if !q.All && len(q.Namespaces) == 0 && !s.identify(r).valid {
			writeJSON(w, http.StatusUnauthorized, apiErr("unauthenticated", "sign in or present a token"))
			return
		}
	}
	page, err := s.Store.ListNotes(r.Context(), q)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

type noteBody struct {
	Namespace string    `json:"namespace"`
	Title     *string   `json:"title"`
	Body      *string   `json:"body"`
	Tags      *[]string `json:"tags"`
	Pinned    *bool     `json:"pinned"`
	Archived  *bool     `json:"archived"`
	Category  *string   `json:"category"`
	Source    string    `json:"source"`
	Version   int       `json:"version"`
}

func decodeNoteBody(w http.ResponseWriter, r *http.Request) (*noteBody, bool) {
	var in noteBody
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, noteMaxBody+64<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "bad JSON body"))
		return nil, false
	}
	return &in, true
}

func deref[T any](p *T) T {
	var zero T
	if p == nil {
		return zero
	}
	return *p
}

// CreateNote — POST /api/notes
func (s *Service) CreateNote(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	in, ok := decodeNoteBody(w, r)
	if !ok {
		return
	}
	if in.Namespace == "" {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "namespace is required"))
		return
	}
	if !s.canWriteOrClaim(r, in.Namespace) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no write access to brain "+in.Namespace))
		return
	}
	n, err := s.Store.CreateNote(r.Context(), NoteInput{Namespace: in.Namespace, Title: deref(in.Title), Body: deref(in.Body),
		Tags: deref(in.Tags), Pinned: deref(in.Pinned), Category: deref(in.Category)}, s.noteAuthor(r, in.Source))
	if err != nil {
		writeErr(w, err)
		return
	}
	s.publishNote("create", n)
	w.Header().Set("ETag", `"`+strconv.Itoa(n.Version)+`"`)
	writeJSON(w, http.StatusCreated, n)
}

// GetNote — GET /api/notes/{id}
func (s *Service) GetNote(w http.ResponseWriter, r *http.Request) {
	n, ok := s.loadNoteFor(w, r, false)
	if !ok {
		return
	}
	w.Header().Set("ETag", `"`+strconv.Itoa(n.Version)+`"`)
	writeJSON(w, http.StatusOK, n)
}

// expectedVersion reads If-Match ("3", "W/\"3\"", 3) or the body's version.
func expectedVersion(r *http.Request, body int) (int, bool) {
	if h := strings.TrimSpace(r.Header.Get("If-Match")); h != "" && h != "*" {
		h = strings.Trim(strings.TrimPrefix(h, "W/"), `"`)
		v, err := strconv.Atoi(h)
		if err != nil || v <= 0 {
			return 0, false
		}
		return v, true
	}
	return body, true
}

func (s *Service) writeConflict(w http.ResponseWriter, current *Note) {
	w.Header().Set("ETag", `"`+strconv.Itoa(current.Version)+`"`)
	if current.Deleted {
		current.Body = ""
	}
	writeJSON(w, http.StatusConflict, map[string]any{
		"error":   map[string]string{"code": "conflict", "message": "the note changed since you loaded it"},
		"current": current,
	})
}

// UpdateNote — PUT /api/notes/{id}
func (s *Service) UpdateNote(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	if _, ok := s.loadNoteFor(w, r, true); !ok {
		return
	}
	in, ok := decodeNoteBody(w, r)
	if !ok {
		return
	}
	expect, ok := expectedVersion(r, in.Version)
	if !ok {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "If-Match must be the note version"))
		return
	}
	n, err := s.Store.UpdateNote(r.Context(), chi.URLParam(r, "id"), expect, NotePatch{
		Title: in.Title, Body: in.Body, Tags: in.Tags, Pinned: in.Pinned, Archived: in.Archived, Category: in.Category,
	}, s.noteAuthor(r, in.Source))
	if errors.Is(err, ErrConflict) {
		s.writeConflict(w, n)
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	s.publishNote("update", n)
	w.Header().Set("ETag", `"`+strconv.Itoa(n.Version)+`"`)
	writeJSON(w, http.StatusOK, n)
}

// AppendNote — POST /api/notes/{id}/append {text}
func (s *Service) AppendNote(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	if _, ok := s.loadNoteFor(w, r, true); !ok {
		return
	}
	var in struct {
		Text   string `json:"text"`
		Source string `json:"source"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, noteMaxBody)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "bad JSON body"))
		return
	}
	n, err := s.Store.AppendNote(r.Context(), chi.URLParam(r, "id"), in.Text, s.noteAuthor(r, in.Source))
	if err != nil {
		writeErr(w, err)
		return
	}
	s.publishNote("update", n)
	writeJSON(w, http.StatusOK, n)
}

// DeleteNote — DELETE /api/notes/{id}
func (s *Service) DeleteNote(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	if _, ok := s.loadNoteFor(w, r, true); !ok {
		return
	}
	expect, ok := expectedVersion(r, 0)
	if !ok {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "If-Match must be the note version"))
		return
	}
	n, err := s.Store.DeleteNote(r.Context(), chi.URLParam(r, "id"), expect, s.noteAuthor(r, ""))
	if errors.Is(err, ErrConflict) {
		s.writeConflict(w, n)
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	s.publishNote("delete", n)
	n.Body = ""
	writeJSON(w, http.StatusOK, n)
}

// NoteVersions — GET /api/notes/{id}/versions
func (s *Service) NoteVersions(w http.ResponseWriter, r *http.Request) {
	n, ok := s.loadNoteFor(w, r, false)
	if !ok {
		return
	}
	vs, err := s.Store.NoteVersions(r.Context(), n.ID)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": n.ID, "versions": vs})
}

// RestoreNote — POST /api/notes/{id}/restore {version?}
func (s *Service) RestoreNote(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	if _, ok := s.loadNoteFor(w, r, true); !ok {
		return
	}
	var in struct {
		Version int `json:"version"`
	}
	if r.ContentLength != 0 {
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "bad JSON body"))
			return
		}
	}
	n, err := s.Store.RestoreNote(r.Context(), chi.URLParam(r, "id"), in.Version, s.noteAuthor(r, ""))
	if err != nil {
		writeErr(w, err)
		return
	}
	s.publishNote("restore", n)
	writeJSON(w, http.StatusOK, n)
}

// --- brain membership ------------------------------------------------------------

// MyBrains — GET /api/brain/mine: the brains the caller can reach, with a role.
func (s *Service) MyBrains(w http.ResponseWriter, r *http.Request) {
	out, err := s.brainsFor(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"brains": out})
}

// BrainChoice is one brain a user can hand to an app on the consent screen.
type BrainChoice struct {
	Namespace string `json:"namespace"`
	Role      string `json:"role"` // admin | owner | editor | viewer
	CanWrite  bool   `json:"canWrite"`
	Memories  int    `json:"memories"`
}

func (s *Service) brainsFor(r *http.Request) ([]BrainChoice, error) {
	return s.brainsForUser(r, s.identify(r))
}

func (s *Service) brainsForUser(r *http.Request, c caller) ([]BrainChoice, error) {
	ctx := r.Context()
	counts := map[string]int{}
	all, _ := s.Store.Namespaces(ctx)
	for _, b := range all {
		counts[b.Namespace] = b.Memories
	}
	out := []BrainChoice{}
	if c.admin {
		seen := map[string]bool{}
		for _, b := range all {
			seen[b.Namespace] = true
			out = append(out, BrainChoice{Namespace: b.Namespace, Role: "admin", CanWrite: true, Memories: b.Memories})
		}
		if c.userID != "" {
			ms, _ := s.Store.MembershipsFor(ctx, c.userID)
			for _, m := range ms {
				if !seen[m.Namespace] {
					out = append(out, BrainChoice{Namespace: m.Namespace, Role: "admin", CanWrite: true})
				}
			}
		}
		return out, nil
	}
	if !c.session || c.userID == "" {
		_, list := s.readableNamespaces(r)
		for _, ns := range list {
			out = append(out, BrainChoice{Namespace: ns, Role: "viewer", CanWrite: s.canWrite(r, ns), Memories: counts[ns]})
		}
		return out, nil
	}
	ms, err := s.Store.MembershipsFor(ctx, c.userID)
	if err != nil {
		return out, err
	}
	for _, m := range ms {
		out = append(out, BrainChoice{Namespace: m.Namespace, Role: m.Role, CanWrite: m.Role != "viewer", Memories: counts[m.Namespace]})
	}
	return out, nil
}

// CreateBrain — POST /api/brain/brains {namespace}: a signed-in user creates a
// new brain and becomes its owner.
func (s *Service) CreateBrain(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	c := s.identify(r)
	sessionUser := c.session && c.userID != ""
	if !sessionUser && !c.admin {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "sign in (or use an admin token) to create a brain"))
		return
	}
	var in struct {
		Namespace string `json:"namespace"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "bad JSON body"))
		return
	}
	in.Namespace = strings.TrimSpace(in.Namespace)
	var err error
	role := "owner"
	if sessionUser {
		err = s.Store.ClaimBrain(r.Context(), in.Namespace, c.userID)
	} else {
		// An admin token has no user to own the brain: the name is reserved by
		// nothing, and the brain materializes on its first write.
		role = "admin"
		err = s.Store.CheckNewBrain(r.Context(), in.Namespace)
	}
	switch {
	case errors.Is(err, ErrBrainTaken):
		writeJSON(w, http.StatusConflict, apiErr("already_exists", err.Error()))
		return
	case errors.Is(err, ErrInvalidInput):
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "a brain name is 1-63 of a-z 0-9 _ . - and starts with a letter or digit"))
		return
	case err != nil:
		writeErr(w, err)
		return
	}
	s.hub.publish("brain", map[string]any{"namespace": in.Namespace, "created": true})
	writeJSON(w, http.StatusCreated, map[string]any{"namespace": in.Namespace, "role": role})
}

// ListMembers — GET /api/brain/members?namespace= (brain owner or admin)
func (s *Service) ListMembers(w http.ResponseWriter, r *http.Request) {
	ns := r.URL.Query().Get("namespace")
	if !s.canAdmin(r, ns) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "only the brain's owner can see its members"))
		return
	}
	ms, err := s.Store.Members(r.Context(), ns)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"namespace": ns, "members": ms})
}

// SetMember — POST /api/brain/members {namespace, userId | email, role}
func (s *Service) SetMember(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	var in struct {
		Namespace string `json:"namespace"`
		UserID    string `json:"userId"`
		Email     string `json:"email"`
		Role      string `json:"role"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "bad JSON body"))
		return
	}
	if !s.canAdmin(r, in.Namespace) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "only the brain's owner can manage its members"))
		return
	}
	if in.UserID == "" && in.Email != "" {
		id, err := s.Store.userIDByEmail(r.Context(), in.Email)
		if err != nil {
			writeErr(w, err)
			return
		}
		in.UserID = id
	}
	if in.Role == "" {
		in.Role = "editor"
	}
	if err := s.Store.SetMember(r.Context(), in.Namespace, in.UserID, in.Role, s.identify(r).userID); err != nil {
		writeErr(w, err)
		return
	}
	s.hub.publish("member", map[string]any{"namespace": in.Namespace, "userId": in.UserID, "role": in.Role})
	writeJSON(w, http.StatusOK, Membership{Namespace: in.Namespace, UserID: in.UserID, Role: in.Role})
}

// RemoveMember — POST /api/brain/members/remove {namespace, userId}. An owner
// removes anyone; a member may remove themselves (leave).
func (s *Service) RemoveMember(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	var in struct {
		Namespace string `json:"namespace"`
		UserID    string `json:"userId"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "bad JSON body"))
		return
	}
	c := s.identify(r)
	self := c.session && c.userID != "" && c.userID == in.UserID
	if !self && !s.canAdmin(r, in.Namespace) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "only the brain's owner can manage its members"))
		return
	}
	switch err := s.Store.RemoveMember(r.Context(), in.Namespace, in.UserID); {
	case errors.Is(err, ErrLastOwner):
		writeJSON(w, http.StatusConflict, apiErr("last_owner", err.Error()))
		return
	case err != nil:
		writeErr(w, err)
		return
	}
	s.hub.publish("member", map[string]any{"namespace": in.Namespace, "userId": in.UserID, "removed": true})
	writeJSON(w, http.StatusOK, map[string]any{"namespace": in.Namespace, "userId": in.UserID, "removed": true})
}
