package brain

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/togo-framework/brain/presentations"
)

/*
Presentations REST (ported from fadymondy.com FM-341/342; the logic lives in
plugins/brain/presentations). Every document belongs to one brain and is gated
exactly like notes: read = canRead(namespace), every write (create, update,
delete, translate) = canWrite, and share links (create, revoke, export) =
canWrite too, which for a signed-in user means the brain's owner or editor role
(a viewer is refused), for an X-Zekra-Token a write grant, and for an
OAuth-connected MCP app brains:write on that brain. A document in a brain the
caller cannot read answers 404, like a note. Cookie writes pass the notes CSRF
rule (sessionWriteOK).

	GET    /api/presentations?namespace=&q=&kind=&customer=&status=&limit=
	POST   /api/presentations                    {namespace, kind, customer, locale, content, title?, status?, style?}
	GET    /api/presentations/catalog?kind=      styles, scenes, icons, blocks, JSON schemas (page_styles)
	GET    /api/presentations/templates?template=&kind=&locale=
	POST   /api/presentations/validate           {kind, content} → {valid, errors:[{path,message,hint}], content}
	POST   /api/presentations/from-outline       {namespace, customer, title, problem, …outline}
	POST   /api/presentations/from-brain         {namespace, source:{kind:notes|query|entity|namespace,…}, title?, customer?, locale?, kinds?, style?}
	GET    /api/presentations/{id}               detail: every locale, speaker notes, share links, formats
	PUT    /api/presentations/{id}               (PATCH too) partial update; content replaces one locale
	DELETE /api/presentations/{id}
	POST   /api/presentations/{id}/translate     {to?, content?}
	POST   /api/presentations/{id}/share         {locale?, label?, expires_in_days?, domain_id?} → {share, token, url, recoverable, downloads}
	DELETE /api/presentations/{id}/shares/{share}
	DELETE /api/presentations/{id}/shares        revoke every link
	POST   /api/presentations/{id}/export        {locale?} → download URLs (the web renders the files)

Public (no auth; the 256-bit token is the authorization, rate limited per
client address, Cache-Control: no-store, X-Robots-Tag: noindex, nofollow):

	GET    /api/p/{token}?locale=&event=view|download&host=
	       host (or X-Forwarded-Host) = the host the visitor came in on: a custom share domain only
	       opens its own brain's tokens (404 otherwise); see presentations_domains_handlers.go
	GET    /api/p/{token}/embed/{id}?locale=     a page preview embedded in a shared deck
*/

func (s *Service) presStore() *presentations.Store {
	s.presOnce.Do(func() {
		s.pres = &presentations.Store{DB: s.Store.db, Translator: envTranslator()}
		s.presLimit = presentations.NewLimiter()
		s.presDomainLimit = presentations.NewLimiter()
	})
	return s.pres
}

func (s *Service) mountPresentations(r chi.Router, sec func(http.HandlerFunc) http.HandlerFunc) {
	r.Get("/api/presentations", sec(s.ListPresentations))
	r.Post("/api/presentations", sec(s.CreatePresentation))
	r.Get("/api/presentations/catalog", sec(s.PresentationCatalog))
	r.Get("/api/presentations/templates", sec(s.PresentationTemplates))
	r.Post("/api/presentations/validate", sec(s.ValidatePresentation))
	r.Post("/api/presentations/from-outline", sec(s.PresentationFromOutline))
	r.Post("/api/presentations/from-brain", sec(s.PresentationFromBrain))
	r.Get("/api/presentations/{id}", sec(s.GetPresentation))
	r.Put("/api/presentations/{id}", sec(s.UpdatePresentation))
	r.Patch("/api/presentations/{id}", sec(s.UpdatePresentation))
	r.Delete("/api/presentations/{id}", sec(s.DeletePresentation))
	r.Post("/api/presentations/{id}/translate", sec(s.TranslatePresentation))
	r.Post("/api/presentations/{id}/share", sec(s.SharePresentation))
	r.Delete("/api/presentations/{id}/shares", sec(s.RevokeAllPresentationShares))
	r.Delete("/api/presentations/{id}/shares/{share}", sec(s.RevokePresentationShare))
	r.Post("/api/presentations/{id}/export", sec(s.ExportPresentation))

	// Public share view: deliberately NOT secured.
	s.mountPresentationDomains(r, sec)

	r.Get("/api/p/{token}", s.PublicPresentation)
	r.Get("/api/p/{token}/embed/{id}", s.PublicPresentationEmbed)
}

// ---- errors ---------------------------------------------------------------------

type presFieldError struct {
	Path     string `json:"path"`
	Location string `json:"location"` // huma-compatible alias of path (the fadymondy.com web read this)
	Message  string `json:"message"`
	Hint     string `json:"hint,omitempty"`
}

func presFieldErrors(errs []presentations.FieldError) []presFieldError {
	out := make([]presFieldError, 0, len(errs))
	for _, fe := range errs {
		out = append(out, presFieldError{Path: fe.Path, Location: fe.Path, Message: fe.Message, Hint: presentations.FixHint(fe)})
	}
	return out
}

func writePresErr(w http.ResponseWriter, err error) {
	var ve *presentations.ValidationError
	var bad presentations.InvalidError
	switch {
	case errors.As(err, &ve):
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error":  map[string]string{"code": "invalid_content", "message": "the content is not valid"},
			"detail": "the content is not valid", "errors": presFieldErrors(ve.Errors),
			"hint": "fix every listed path and call again; GET /api/presentations/catalog has the scene types and JSON schemas"})
	case errors.As(err, &bad):
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error": map[string]string{"code": "invalid_argument", "message": bad.Msg}, "detail": bad.Msg})
	case errors.Is(err, presentations.ErrNotFound), errors.Is(err, ErrNotFound):
		writeJSON(w, http.StatusNotFound, apiErr("not_found", "presentation not found"))
	case errors.Is(err, presentations.ErrLinkUnavailable):
		writeJSON(w, http.StatusNotFound, apiErr("not_found", presentations.ErrLinkUnavailable.Error()))
	case errors.Is(err, presentations.ErrNoTranslator):
		writeJSON(w, http.StatusServiceUnavailable, apiErr("no_translator", err.Error()))
	case errors.Is(err, presentations.ErrNoDB):
		writeJSON(w, http.StatusServiceUnavailable, apiErr("unavailable", err.Error()))
	default:
		writeErr(w, err)
	}
}

// ---- access -----------------------------------------------------------------------

// loadPresentation loads a document and checks the caller's access to its
// brain. A document in a brain the caller cannot read is "not found".
func (s *Service) loadPresentation(w http.ResponseWriter, r *http.Request, write bool) (*presentations.Presentation, bool) {
	p, err := s.presStore().Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writePresErr(w, err)
		return nil, false
	}
	if !s.canRead(r, p.Namespace) {
		writePresErr(w, presentations.ErrNotFound)
		return nil, false
	}
	if write && !s.canWrite(r, p.Namespace) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no write access to brain "+p.Namespace))
		return nil, false
	}
	return p, true
}

// presAuthor is who a write is recorded as: the account (owner_user_id) and
// the activity label (created_by).
func (s *Service) presAuthor(r *http.Request) (userID, by string) {
	c := s.identify(r)
	by = c.agent
	if by == "" && c.userID != "" {
		by = "user:" + c.userID
	}
	return c.userID, by
}

func decodePres(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<20))
	if err := dec.Decode(v); err != nil && !errors.Is(err, io.EOF) {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "invalid JSON body: "+err.Error()))
		return false
	}
	return true
}

func (s *Service) presWriteGuard(w http.ResponseWriter, r *http.Request) bool {
	return s.noteWriteGuard(w, r)
}

func (s *Service) presDetail(w http.ResponseWriter, r *http.Request, id string, status int) {
	d, err := s.presStore().Detail(r.Context(), id)
	if err != nil {
		writePresErr(w, err)
		return
	}
	writeJSON(w, status, d)
}

// ---- owner routes -----------------------------------------------------------------

// ListPresentations — GET /api/presentations
func (s *Service) ListPresentations(w http.ResponseWriter, r *http.Request) {
	qv := r.URL.Query()
	f := presentations.PresentationFilter{Query: qv.Get("q"), Kind: qv.Get("kind"), Customer: qv.Get("customer"), Status: qv.Get("status")}
	f.Limit, _ = strconv.Atoi(qv.Get("limit"))
	if ns := strings.TrimSpace(qv.Get("namespace")); ns != "" {
		if !s.canRead(r, ns) {
			writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no read access to brain "+ns))
			return
		}
		f.Namespaces = []string{ns}
	} else {
		f.All, f.Namespaces = s.readableNamespaces(r)
		if !f.All && len(f.Namespaces) == 0 && !s.identify(r).valid {
			writeJSON(w, http.StatusUnauthorized, apiErr("unauthenticated", "sign in or present a token"))
			return
		}
	}
	items, err := s.presStore().List(r.Context(), f)
	if err != nil {
		writePresErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, presentations.PresentationList{Items: items})
}

// CreatePresentation — POST /api/presentations
func (s *Service) CreatePresentation(w http.ResponseWriter, r *http.Request) {
	if !s.presWriteGuard(w, r) {
		return
	}
	var in presentations.PresentationInput
	if !decodePres(w, r, &in) {
		return
	}
	in.Namespace = strings.TrimSpace(in.Namespace)
	if in.Namespace == "" {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "namespace is required: the brain the document belongs to"))
		return
	}
	if !s.canWrite(r, in.Namespace) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no write access to brain "+in.Namespace))
		return
	}
	var by string
	in.OwnerUserID, by = s.presAuthor(r)
	p, err := s.presStore().Create(r.Context(), in, by)
	if err != nil {
		writePresErr(w, err)
		return
	}
	s.publishPresentation("create", p.Namespace, p.ID)
	s.presDetail(w, r, p.ID, http.StatusCreated)
}

// GetPresentation — GET /api/presentations/{id}
func (s *Service) GetPresentation(w http.ResponseWriter, r *http.Request) {
	if p, ok := s.loadPresentation(w, r, false); ok {
		s.presDetail(w, r, p.ID, http.StatusOK)
	}
}

// UpdatePresentation — PUT/PATCH /api/presentations/{id}
func (s *Service) UpdatePresentation(w http.ResponseWriter, r *http.Request) {
	if !s.presWriteGuard(w, r) {
		return
	}
	p, ok := s.loadPresentation(w, r, true)
	if !ok {
		return
	}
	var in presentations.PresentationInput
	if !decodePres(w, r, &in) {
		return
	}
	if in.Namespace != "" && in.Namespace != p.Namespace {
		writeJSON(w, http.StatusUnprocessableEntity, apiErr("invalid_argument", "a document cannot move to another brain"))
		return
	}
	if _, err := s.presStore().Update(r.Context(), p.ID, in); err != nil {
		writePresErr(w, err)
		return
	}
	s.publishPresentation("update", p.Namespace, p.ID)
	s.presDetail(w, r, p.ID, http.StatusOK)
}

// DeletePresentation — DELETE /api/presentations/{id}
func (s *Service) DeletePresentation(w http.ResponseWriter, r *http.Request) {
	if !s.presWriteGuard(w, r) {
		return
	}
	p, ok := s.loadPresentation(w, r, true)
	if !ok {
		return
	}
	if err := s.presStore().Delete(r.Context(), p.ID); err != nil {
		writePresErr(w, err)
		return
	}
	s.publishPresentation("delete", p.Namespace, p.ID)
	w.WriteHeader(http.StatusNoContent)
}

// TranslatePresentation — POST /api/presentations/{id}/translate {to?, content?}.
// With content, the caller's own translation is stored (the MCP fallback);
// without, the configured model translates. No model: 503 no_translator with
// the source content, so an MCP client can translate it itself.
func (s *Service) TranslatePresentation(w http.ResponseWriter, r *http.Request) {
	if !s.presWriteGuard(w, r) {
		return
	}
	p, ok := s.loadPresentation(w, r, true)
	if !ok {
		return
	}
	var in struct {
		To      string `json:"to"`
		Content any    `json:"content"`
	}
	if !decodePres(w, r, &in) {
		return
	}
	to := in.To
	if to == "" {
		to = presentations.OtherLocale(p.Locale)
	}
	if !presentations.IsLocale(to) {
		writePresErr(w, presentations.InvalidError{Msg: "to must be en or ar"})
		return
	}
	st := s.presStore()
	if in.Content != nil {
		content, err := contentArg(in.Content)
		if err != nil {
			writePresErr(w, err)
			return
		}
		_, by := s.presAuthor(r)
		from := p.Locale
		if from == to {
			from = presentations.OtherLocale(to)
		}
		if _, err := st.SetTranslation(r.Context(), p.ID, to, content, map[string]any{
			"from": from, "by": "caller", "agent": by, "at": time.Now().UTC().Format(time.RFC3339)}); err != nil {
			writePresErr(w, err)
			return
		}
	} else if _, err := st.Translate(r.Context(), p.ID, to); err != nil {
		if errors.Is(err, presentations.ErrNoTranslator) {
			from := p.Locale
			if from == to {
				from = presentations.OtherLocale(to)
			}
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{
				"error": map[string]string{"code": "no_translator", "message": err.Error()},
				"from":  from, "to": to, "source_content": p.Content[from]})
			return
		}
		writePresErr(w, err)
		return
	}
	s.publishPresentation("update", p.Namespace, p.ID)
	s.presDetail(w, r, p.ID, http.StatusOK)
}

// contentArg accepts a content object, or a JSON string of one (some MCP
// clients send nested JSON as a string).
func contentArg(v any) (map[string]any, error) {
	switch t := v.(type) {
	case map[string]any:
		return t, nil
	case string:
		var m map[string]any
		if err := json.Unmarshal([]byte(t), &m); err != nil {
			return nil, presentations.InvalidError{Msg: "content must be a JSON object (it was a string that is not JSON)"}
		}
		return m, nil
	}
	return nil, presentations.InvalidError{Msg: "content must be a JSON object"}
}

// downloadsFor lists a link's file exports; shareURL already carries the link's host.
func downloadsFor(kind, shareURL string) map[string]string {
	out := map[string]string{}
	for _, f := range presentations.ExportFormats(kind) {
		out[f] = shareURL + "/download/" + f
	}
	return out
}

// SharePresentation — POST /api/presentations/{id}/share
func (s *Service) SharePresentation(w http.ResponseWriter, r *http.Request) {
	if !s.presWriteGuard(w, r) {
		return
	}
	p, ok := s.loadPresentation(w, r, true)
	if !ok {
		return
	}
	var in presentations.PresentationShareInput
	if !decodePres(w, r, &in) {
		return
	}
	_, by := s.presAuthor(r)
	out, err := s.presStore().CreateShare(r.Context(), p.ID, in, by)
	if err != nil {
		writePresErr(w, err)
		return
	}
	s.publishPresentation("share", p.Namespace, p.ID)
	writeJSON(w, http.StatusCreated, map[string]any{
		"share": out.Share, "token": out.Token, "url": out.URL, "recoverable": out.Recoverable,
		"downloads": downloadsFor(p.Kind, out.URL)})
}

// RevokePresentationShare — DELETE /api/presentations/{id}/shares/{share}
func (s *Service) RevokePresentationShare(w http.ResponseWriter, r *http.Request) {
	if !s.presWriteGuard(w, r) {
		return
	}
	p, ok := s.loadPresentation(w, r, true)
	if !ok {
		return
	}
	if err := s.presStore().RevokeShare(r.Context(), p.ID, chi.URLParam(r, "share")); err != nil {
		writePresErr(w, err)
		return
	}
	s.publishPresentation("unshare", p.Namespace, p.ID)
	writeJSON(w, http.StatusOK, presentations.PresentationRevoked{Revoked: 1})
}

// RevokeAllPresentationShares — DELETE /api/presentations/{id}/shares
func (s *Service) RevokeAllPresentationShares(w http.ResponseWriter, r *http.Request) {
	if !s.presWriteGuard(w, r) {
		return
	}
	p, ok := s.loadPresentation(w, r, true)
	if !ok {
		return
	}
	n, err := s.presStore().RevokeAll(r.Context(), p.ID)
	if err != nil {
		writePresErr(w, err)
		return
	}
	s.publishPresentation("unshare", p.Namespace, p.ID)
	writeJSON(w, http.StatusOK, presentations.PresentationRevoked{Revoked: n})
}

// ExportPresentation — POST /api/presentations/{id}/export {locale?}.
// The files are rendered by the web app ({base}/{locale}/p/{token}/download/{pdf|docx}
// and the owner route {base}/{locale}/presentations/{id}/export/{format}); this
// returns their URLs through an existing copyable link for the locale, or a new
// 7-day link labelled "export".
func (s *Service) ExportPresentation(w http.ResponseWriter, r *http.Request) {
	if !s.presWriteGuard(w, r) {
		return
	}
	p, ok := s.loadPresentation(w, r, true)
	if !ok {
		return
	}
	var in struct {
		Locale string `json:"locale"`
	}
	if !decodePres(w, r, &in) {
		return
	}
	loc := in.Locale
	if loc == "" {
		loc = p.Locale
	}
	if !presentations.IsLocale(loc) {
		writePresErr(w, presentations.InvalidError{Msg: "locale must be en or ar"})
		return
	}
	formats := presentations.ExportFormats(p.Kind)
	if len(formats) == 0 {
		writePresErr(w, presentations.InvalidError{Msg: "page previews have no file export; share them instead"})
		return
	}
	st := s.presStore()
	shares, err := st.ListShares(r.Context(), p.ID)
	if err != nil {
		writePresErr(w, err)
		return
	}
	link, created := "", false
	for _, sh := range shares {
		if sh.Active && sh.URL != "" && sh.Locale == loc {
			link = sh.URL
			break
		}
	}
	if link == "" {
		_, by := s.presAuthor(r)
		out, err := st.CreateShare(r.Context(), p.ID, presentations.PresentationShareInput{Label: "export", Locale: loc, ExpiresInDays: 7}, by)
		if err != nil {
			writePresErr(w, err)
			return
		}
		link, created = out.URL, true
	}
	customer, owner := map[string]string{}, map[string]string{}
	for _, f := range formats {
		customer[f] = link + "/download/" + f
		owner[f] = presentations.BaseURL() + "/" + loc + "/presentations/" + p.ID + "/export/" + f
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "share_url": link, "created_link": created,
		"customer_downloads": customer, "owner_downloads": owner})
}

// PresentationCatalog — GET /api/presentations/catalog?kind=
func (s *Service) PresentationCatalog(w http.ResponseWriter, r *http.Request) {
	c := presentations.Catalog()
	if k := r.URL.Query().Get("kind"); k != "" {
		if sc, ok := c.Schemas[k]; ok {
			c.Schemas = map[string]map[string]any{k: sc}
		}
	}
	writeJSON(w, http.StatusOK, c)
}

// PresentationTemplates — GET /api/presentations/templates?template=&kind=&locale=
func (s *Service) PresentationTemplates(w http.ResponseWriter, r *http.Request) {
	qv := r.URL.Query()
	ts, err := presentations.Templates(qv.Get("template"))
	if err != nil {
		writePresErr(w, err)
		return
	}
	kind, loc := qv.Get("kind"), qv.Get("locale")
	for i := range ts {
		for k, byLoc := range ts[i].Documents {
			if kind != "" && k != kind {
				delete(ts[i].Documents, k)
				continue
			}
			if loc != "" {
				for l := range byLoc {
					if l != loc {
						delete(byLoc, l)
					}
				}
			}
		}
		if loc != "" {
			for l := range ts[i].Outline {
				if l != loc {
					delete(ts[i].Outline, l)
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"templates": ts})
}

// ValidatePresentation — POST /api/presentations/validate {kind, content}
func (s *Service) ValidatePresentation(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Kind    string `json:"kind"`
		Content any    `json:"content"`
	}
	if !decodePres(w, r, &in) {
		return
	}
	content, err := contentArg(in.Content)
	if in.Content == nil {
		content, err = map[string]any{}, nil
	}
	if err != nil {
		writePresErr(w, err)
		return
	}
	res := presentations.Validate(in.Kind, content)
	out := map[string]any{"valid": res.Valid, "errors": presFieldErrors(res.Errors)}
	if res.Valid {
		out["content"] = res.Content
		out["next"] = "POST /api/presentations {namespace, kind, customer, locale, content}"
	} else {
		out["next"] = "fix every path and validate again"
	}
	writeJSON(w, http.StatusOK, out)
}

// outlineCreate creates the documents an outline builds: the page first, then
// the deck (embedding the page) and the report. Status stays as asked (default
// draft).
func (s *Service) outlineCreate(ctx context.Context, r *http.Request, ns string, o presentations.Outline, status, style string) ([]map[string]any, error) {
	if _, err := presentations.BuildFromOutline(o, ""); err != nil {
		return nil, err
	}
	st := s.presStore()
	owner, by := s.presAuthor(r)
	created := []map[string]any{}
	pageID := ""
	create := func(kind string, content map[string]any) error {
		cust := o.Customer
		in := presentations.PresentationInput{Namespace: ns, OwnerUserID: owner, Kind: kind, Customer: &cust,
			Locale: o.Locale, Content: content, Status: status}
		if in.Locale == "" {
			in.Locale = "en"
		}
		if kind == presentations.KindPage {
			in.Style = style
		}
		p, err := st.Create(ctx, in, by)
		if err != nil {
			return err
		}
		created = append(created, map[string]any{"id": p.ID, "kind": p.Kind, "title": p.Title, "status": p.Status})
		if kind == presentations.KindPage {
			pageID = p.ID
		}
		return nil
	}
	docs, _ := presentations.BuildFromOutline(o, "")
	for _, d := range docs {
		if d.Kind == presentations.KindPage {
			if err := create(d.Kind, d.Content); err != nil {
				return created, err
			}
		}
	}
	docs, err := presentations.BuildFromOutline(o, pageID) // the deck embeds the page that now exists
	if err != nil {
		return created, err
	}
	for _, d := range docs {
		if d.Kind != presentations.KindPage {
			if err := create(d.Kind, d.Content); err != nil {
				return created, err
			}
		}
	}
	for _, c := range created {
		s.publishPresentation("create", ns, c["id"].(string))
	}
	return created, nil
}

// PresentationFromOutline — POST /api/presentations/from-outline
func (s *Service) PresentationFromOutline(w http.ResponseWriter, r *http.Request) {
	if !s.presWriteGuard(w, r) {
		return
	}
	var raw json.RawMessage
	if !decodePres(w, r, &raw) {
		return
	}
	var in struct {
		Namespace string `json:"namespace"`
		Status    string `json:"status"`
		Style     string `json:"style"`
	}
	var o presentations.Outline
	if err := json.Unmarshal(raw, &in); err != nil {
		writePresErr(w, presentations.InvalidError{Msg: "outline: " + err.Error()})
		return
	}
	if err := json.Unmarshal(raw, &o); err != nil {
		writePresErr(w, presentations.InvalidError{Msg: "outline: " + err.Error()})
		return
	}
	if !s.presNamespaceWrite(w, r, in.Namespace) {
		return
	}
	if in.Status != "" && in.Status != "draft" && in.Status != "ready" {
		writePresErr(w, presentations.InvalidError{Msg: "status must be draft or ready"})
		return
	}
	created, err := s.outlineCreate(r.Context(), r, in.Namespace, o, in.Status, in.Style)
	if err != nil {
		writePresErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "documents": created, "enrich_next": presentations.EnrichHints(o)})
}

func (s *Service) presNamespaceWrite(w http.ResponseWriter, r *http.Request, ns string) bool {
	if strings.TrimSpace(ns) == "" {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "namespace is required: the brain the documents belong to"))
		return false
	}
	if !s.canWrite(r, ns) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no write access to brain "+ns))
		return false
	}
	return true
}

// PresentationFromBrain — POST /api/presentations/from-brain. The outline is
// built from the brain's own material (presentations_gather.go) and nothing
// else; the documents are drafts.
func (s *Service) PresentationFromBrain(w http.ResponseWriter, r *http.Request) {
	if !s.presWriteGuard(w, r) {
		return
	}
	var in presentations.FromBrainRequest
	if !decodePres(w, r, &in) {
		return
	}
	in.Namespace = strings.TrimSpace(in.Namespace)
	if !s.presNamespaceWrite(w, r, in.Namespace) {
		return
	}
	if err := presentations.CheckBrainSource(in.Source); err != nil {
		writePresErr(w, err)
		return
	}
	g, err := s.gatherForPresentation(r.Context(), in.Namespace, in.Source, in.Locale)
	if err != nil {
		writePresErr(w, err)
		return
	}
	o, err := presentations.OutlineFromBrain(in, g)
	if err != nil {
		writePresErr(w, err)
		return
	}
	created, err := s.outlineCreate(r.Context(), r, in.Namespace, o, "draft", in.Style)
	if err != nil {
		writePresErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "documents": created, "status": "draft",
		"sources": o.Sources(), "enrich_next": []string{
			"review the drafts; every sentence came from the listed sources, nothing was added",
			"presentation_update {id, status: \"ready\"} once approved",
			"presentation_translate {id} for the other language",
		}})
}

func (s *Service) publishPresentation(action, ns, id string) {
	s.hub.publish("presentation", map[string]any{"namespace": ns, "id": id, "action": action})
}

// ---- public share view ------------------------------------------------------------

func clientKey(r *http.Request) string {
	if k := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0]); k != "" {
		return k
	}
	if k := strings.TrimSpace(r.Header.Get("X-Real-IP")); k != "" {
		return k
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func publicHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	allowAnyOrigin(w)
}

// PublicPresentation — GET /api/p/{token}?locale=&event=
func (s *Service) PublicPresentation(w http.ResponseWriter, r *http.Request) {
	st := s.presStore()
	publicHeaders(w)
	key := clientKey(r)
	if !s.presLimit.Allow(key) {
		writeJSON(w, http.StatusTooManyRequests, apiErr("rate_limited", "too many requests; try again in a minute"))
		return
	}
	ev := r.URL.Query().Get("event")
	if ev != "" && ev != presentations.EventView && ev != presentations.EventDownload {
		writeJSON(w, http.StatusUnprocessableEntity, apiErr("invalid_argument", "event must be view or download"))
		return
	}
	out, err := st.OpenSharedOn(r.Context(), requestShareHost(r), chi.URLParam(r, "token"), r.URL.Query().Get("locale"), ev)
	if err != nil {
		if errors.Is(err, presentations.ErrLinkUnavailable) {
			s.presLimit.Miss(key)
		}
		writePresErr(w, err)
		return
	}
	if ev != "" {
		s.notifyPresentationEvent(r, chi.URLParam(r, "token"), ev) // MH-360/373: first view/download → owner, inbox + push (notifications.go); async
	}
	writeJSON(w, http.StatusOK, out)
}

// PublicPresentationEmbed — GET /api/p/{token}/embed/{id}?locale=
func (s *Service) PublicPresentationEmbed(w http.ResponseWriter, r *http.Request) {
	st := s.presStore()
	publicHeaders(w)
	key := clientKey(r)
	if !s.presLimit.Allow(key) {
		writeJSON(w, http.StatusTooManyRequests, apiErr("rate_limited", "too many requests; try again in a minute"))
		return
	}
	out, err := st.OpenSharedEmbedOn(r.Context(), requestShareHost(r), chi.URLParam(r, "token"), chi.URLParam(r, "id"), r.URL.Query().Get("locale"))
	if err != nil {
		if errors.Is(err, presentations.ErrLinkUnavailable) {
			s.presLimit.Miss(key)
		}
		writePresErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}
