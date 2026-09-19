package brain

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/togo-framework/brain/presentations"
)

/*
Custom share domains + share-link management (logic: presentations/domains.go,
presentations/share_manage.go).

Domains belong to a brain. Listing them needs read access (canRead); every
mutation needs brain administration (canAdmin: an admin, or the signed-in brain
OWNER; an editor is refused; an OAuth-connected app never administers). A domain
in a brain the caller cannot read answers 404.

	GET    /api/presentations/domains?namespace=       {domains:[…], builtin:{host}}
	POST   /api/presentations/domains                  {namespace, host} → 201 domain
	POST   /api/presentations/domains/{id}/verify      DNS check → domain (verified / lastError)
	PATCH  /api/presentations/domains/{id}             {default?} → domain
	DELETE /api/presentations/domains/{id}             204; its links fall back to the default base
	GET    /api/presentations/domains/check?host=      PUBLIC: 200 when the host is verified, else 404
	                                                   (?domain= too: Caddy's on-demand TLS "ask")

	PATCH  /api/presentations/{id}/shares/{share}          {label?, expires_in_days? | expires_at?, domain_id?} → share
	POST   /api/presentations/{id}/shares/{share}/reissue  → {share, token, url, recoverable, downloads, revoked}
*/

func (s *Service) mountPresentationDomains(r chi.Router, sec func(http.HandlerFunc) http.HandlerFunc) {
	r.Get("/api/presentations/domains", sec(s.ListPresentationDomains))
	r.Post("/api/presentations/domains", sec(s.AddPresentationDomain))
	r.Get("/api/presentations/domains/check", s.CheckPresentationDomain) // public
	r.Post("/api/presentations/domains/{id}/verify", sec(s.VerifyPresentationDomain))
	r.Patch("/api/presentations/domains/{id}", sec(s.UpdatePresentationDomain))
	r.Delete("/api/presentations/domains/{id}", sec(s.DeletePresentationDomain))

	r.Patch("/api/presentations/{id}/shares/{share}", sec(s.UpdatePresentationShare))
	r.Post("/api/presentations/{id}/shares/{share}/reissue", sec(s.ReissuePresentationShare))
}

func writeDomainErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, presentations.ErrDomainTaken):
		writeJSON(w, http.StatusConflict, apiErr("already_exists", err.Error()))
	case errors.Is(err, presentations.ErrNotFound):
		writeJSON(w, http.StatusNotFound, apiErr("not_found", "domain not found"))
	default:
		writePresErr(w, err)
	}
}

// loadDomain loads a domain for a mutation: 404 unless the caller can read its
// brain, 403 unless they administer it.
func (s *Service) loadDomain(w http.ResponseWriter, r *http.Request) (*presentations.Domain, bool) {
	dom, err := s.presStore().GetDomain(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeDomainErr(w, err)
		return nil, false
	}
	if !s.canRead(r, dom.Namespace) {
		writeDomainErr(w, presentations.ErrNotFound)
		return nil, false
	}
	if !s.canAdmin(r, dom.Namespace) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "only the owner of brain "+dom.Namespace+" manages its domains"))
		return nil, false
	}
	return dom, true
}

// ListPresentationDomains — GET /api/presentations/domains?namespace=
func (s *Service) ListPresentationDomains(w http.ResponseWriter, r *http.Request) {
	ns := strings.TrimSpace(r.URL.Query().Get("namespace"))
	if ns == "" {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "namespace is required"))
		return
	}
	if !s.canRead(r, ns) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no read access to brain "+ns))
		return
	}
	domains, err := s.presStore().ListDomains(r.Context(), ns)
	if err != nil {
		writeDomainErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"domains": domains,
		"builtin": map[string]string{"host": presentations.BuiltinHost()}})
}

// AddPresentationDomain — POST /api/presentations/domains {namespace, host}
func (s *Service) AddPresentationDomain(w http.ResponseWriter, r *http.Request) {
	if !s.presWriteGuard(w, r) {
		return
	}
	var in struct {
		Namespace string `json:"namespace"`
		Host      string `json:"host"`
	}
	if !decodePres(w, r, &in) {
		return
	}
	in.Namespace = strings.TrimSpace(in.Namespace)
	if in.Namespace == "" {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "namespace is required: the brain the domain belongs to"))
		return
	}
	if !s.canAdmin(r, in.Namespace) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "only the owner of brain "+in.Namespace+" manages its domains"))
		return
	}
	_, by := s.presAuthor(r)
	dom, err := s.presStore().AddDomain(r.Context(), in.Namespace, in.Host, by)
	if err != nil {
		writeDomainErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, dom)
}

// VerifyPresentationDomain — POST /api/presentations/domains/{id}/verify
func (s *Service) VerifyPresentationDomain(w http.ResponseWriter, r *http.Request) {
	if !s.presWriteGuard(w, r) {
		return
	}
	dom, ok := s.loadDomain(w, r)
	if !ok {
		return
	}
	out, err := s.presStore().VerifyDomain(r.Context(), dom.ID)
	if err != nil {
		writeDomainErr(w, err)
		return
	}
	// ?default=1: also make it the brain's default once it verifies (the MCP tool's one-call path).
	if v := r.URL.Query().Get("default"); out.Verified && !out.Default && (v == "1" || v == "true") {
		if out, err = s.presStore().SetDefaultDomain(r.Context(), dom.ID, true); err != nil {
			writeDomainErr(w, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// UpdatePresentationDomain — PATCH /api/presentations/domains/{id} {default?}
func (s *Service) UpdatePresentationDomain(w http.ResponseWriter, r *http.Request) {
	if !s.presWriteGuard(w, r) {
		return
	}
	dom, ok := s.loadDomain(w, r)
	if !ok {
		return
	}
	var in struct {
		Default *bool `json:"default"`
	}
	if !decodePres(w, r, &in) {
		return
	}
	if in.Default == nil {
		writeJSON(w, http.StatusOK, dom)
		return
	}
	out, err := s.presStore().SetDefaultDomain(r.Context(), dom.ID, *in.Default)
	if err != nil {
		writeDomainErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// DeletePresentationDomain — DELETE /api/presentations/domains/{id}
func (s *Service) DeletePresentationDomain(w http.ResponseWriter, r *http.Request) {
	if !s.presWriteGuard(w, r) {
		return
	}
	dom, ok := s.loadDomain(w, r)
	if !ok {
		return
	}
	if err := s.presStore().DeleteDomain(r.Context(), dom.ID); err != nil {
		writeDomainErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// CheckPresentationDomain — GET /api/presentations/domains/check?host= (public).
// For the reverse proxy / on-demand TLS: 200 when the host is a verified custom
// domain, else 404. No body worth reading, rate limited per address.
func (s *Service) CheckPresentationDomain(w http.ResponseWriter, r *http.Request) {
	st := s.presStore()
	w.Header().Set("Cache-Control", "no-store")
	if !s.presDomainLimit.Allow(clientKey(r)) {
		w.WriteHeader(http.StatusTooManyRequests)
		return
	}
	host := r.URL.Query().Get("host")
	if host == "" {
		host = r.URL.Query().Get("domain")
	}
	host = presentations.CleanRequestHost(host)
	if _, ok := st.VerifiedHostNamespace(r.Context(), host); !ok || host == "" || len(host) > 253 {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// requestShareHost is the host a public share request arrived on: ?host= (the
// web app passes the visitor's host), else X-Forwarded-Host. "" = built-in.
func requestShareHost(r *http.Request) string {
	if h := r.URL.Query().Get("host"); h != "" {
		return presentations.CleanRequestHost(h)
	}
	return presentations.CleanRequestHost(r.Header.Get("X-Forwarded-Host"))
}

// UpdatePresentationShare — PATCH /api/presentations/{id}/shares/{share}
func (s *Service) UpdatePresentationShare(w http.ResponseWriter, r *http.Request) {
	if !s.presWriteGuard(w, r) {
		return
	}
	p, ok := s.loadPresentation(w, r, true)
	if !ok {
		return
	}
	var in presentations.PresentationSharePatch
	if !decodePres(w, r, &in) {
		return
	}
	out, err := s.presStore().UpdateShare(r.Context(), p.ID, chi.URLParam(r, "share"), in)
	if err != nil {
		writeShareErr(w, err)
		return
	}
	s.publishPresentation("share", p.Namespace, p.ID)
	writeJSON(w, http.StatusOK, out)
}

func writeShareErr(w http.ResponseWriter, err error) {
	if errors.Is(err, presentations.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, apiErr("not_found", "share link not found (or already revoked)"))
		return
	}
	writePresErr(w, err)
}

// ReissuePresentationShare — POST /api/presentations/{id}/shares/{share}/reissue
func (s *Service) ReissuePresentationShare(w http.ResponseWriter, r *http.Request) {
	if !s.presWriteGuard(w, r) {
		return
	}
	p, ok := s.loadPresentation(w, r, true)
	if !ok {
		return
	}
	_, by := s.presAuthor(r)
	old := chi.URLParam(r, "share")
	out, err := s.presStore().ReissueShare(r.Context(), p.ID, old, by)
	if err != nil {
		writeShareErr(w, err)
		return
	}
	s.publishPresentation("share", p.Namespace, p.ID)
	writeJSON(w, http.StatusCreated, map[string]any{
		"share": out.Share, "token": out.Token, "url": out.URL, "recoverable": out.Recoverable,
		"downloads": downloadsFor(p.Kind, out.URL), "revoked": old})
}
