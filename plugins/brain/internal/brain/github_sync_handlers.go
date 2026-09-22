package brain

import (
	"encoding/json"
	"errors"
	"net/http"
)

/*
The REST surface for GitHub note sync (MH-316).

ACL: reading and writing the config, and pushing, all require ADMIN on the
brain, not merely write. Three reasons, and they are the same reason: this
feature turns a brain's contents into a commit under someone's GitHub account.
An editor who can add a note should not be able to decide where every note in
the brain is published, nor to cause a push using a token they cannot read.
*/

// GitHubSyncHandler — GET /api/brain/notes/github { namespace }
func (s *Service) GitHubSyncHandler(w http.ResponseWriter, r *http.Request) {
	ns := r.URL.Query().Get("namespace")
	if !s.canAdmin(r, ns) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "admin access to brain "+ns+" is required"))
		return
	}
	cfg, err := s.Store.GetGitHubSync(r.Context(), ns)
	if err != nil {
		writeErr(w, err)
		return
	}
	// Whether the token exists, never the token. The UI needs to know if it has
	// to ask for one; nobody needs to read it back.
	_, tokenErr := s.Store.RevealSecret(r.Context(), ns, ReservedGitHubSecret)
	writeJSON(w, http.StatusOK, map[string]any{"config": cfg, "hasToken": tokenErr == nil})
}

// SaveGitHubSyncHandler — PUT /api/brain/notes/github
//
//	{ namespace, owner, repo, branch?, pathTemplate?, enabled?, token? }
//
// `token` is write-only: supplied here, stored in the secret store, and never
// returned by any endpoint.
func (s *Service) SaveGitHubSyncHandler(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Namespace    string `json:"namespace"`
		Owner        string `json:"owner"`
		Repo         string `json:"repo"`
		Branch       string `json:"branch"`
		PathTemplate string `json:"pathTemplate"`
		Enabled      bool   `json:"enabled"`
		Token        string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "bad JSON body"))
		return
	}
	if !s.canAdmin(r, in.Namespace) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "admin access to brain "+in.Namespace+" is required"))
		return
	}
	cfg := GitHubSyncConfig{
		Namespace: in.Namespace, Owner: in.Owner, Repo: in.Repo,
		Branch: in.Branch, PathTemplate: in.PathTemplate, Enabled: in.Enabled,
	}
	if err := cfg.Validate(); err != nil {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", err.Error()))
		return
	}
	if in.Token != "" {
		if err := s.Store.PutSecret(r.Context(), in.Namespace, ReservedGitHubSecret, in.Token,
			"github", "note-sync", s.identify(r).agent); err != nil {
			writeErr(w, err)
			return
		}
	}
	if err := s.Store.PutGitHubSync(r.Context(), cfg, s.identify(r).agent); err != nil {
		writeErr(w, err)
		return
	}
	saved, err := s.Store.GetGitHubSync(r.Context(), in.Namespace)
	if err != nil {
		writeErr(w, err)
		return
	}
	_, tokenErr := s.Store.RevealSecret(r.Context(), in.Namespace, ReservedGitHubSecret)
	writeJSON(w, http.StatusOK, map[string]any{"config": saved, "hasToken": tokenErr == nil})
}

// DeleteGitHubSyncHandler — DELETE /api/brain/notes/github { namespace }
func (s *Service) DeleteGitHubSyncHandler(w http.ResponseWriter, r *http.Request) {
	ns := r.URL.Query().Get("namespace")
	if !s.canAdmin(r, ns) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "admin access to brain "+ns+" is required"))
		return
	}
	if err := s.Store.DeleteGitHubSync(r.Context(), ns); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

// PushGitHubSyncHandler — POST /api/brain/notes/github/push { namespace }
func (s *Service) PushGitHubSyncHandler(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Namespace string `json:"namespace"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "bad JSON body"))
		return
	}
	if !s.canAdmin(r, in.Namespace) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "admin access to brain "+in.Namespace+" is required"))
		return
	}
	cfg, err := s.Store.GetGitHubSync(r.Context(), in.Namespace)
	if err != nil {
		writeErr(w, err)
		return
	}
	if cfg.Owner == "" || cfg.Repo == "" {
		writeJSON(w, http.StatusBadRequest, apiErr("failed_precondition", "no GitHub repository is configured for this brain"))
		return
	}
	if !cfg.Enabled {
		// Disabled is a deliberate off switch, not a soft default: pushing
		// anyway would make the toggle a lie.
		writeJSON(w, http.StatusBadRequest, apiErr("failed_precondition", "GitHub sync is turned off for this brain"))
		return
	}
	token, err := s.Store.RevealSecret(r.Context(), in.Namespace, ReservedGitHubSecret)
	if errors.Is(err, ErrNotFound) || token == "" {
		writeJSON(w, http.StatusBadRequest, apiErr("failed_precondition", "no GitHub token is stored for this brain"))
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}

	result, err := s.PushNotes(r.Context(), in.Namespace, cfg, token)
	if err != nil {
		var ghErr *githubError
		if errors.As(err, &ghErr) {
			// Pass GitHub's own status through where it is meaningful — a 404
			// on a private repo means "bad token or no access", and saying
			// "internal error" would send the user hunting in the wrong place.
			status := http.StatusBadGateway
			switch ghErr.Status {
			case http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound, http.StatusUnprocessableEntity, http.StatusConflict:
				status = http.StatusBadRequest
			}
			writeJSON(w, status, apiErr("github_error", ghErr.Error()))
			return
		}
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
