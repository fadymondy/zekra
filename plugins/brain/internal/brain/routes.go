package brain

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// RegisterRoutes mounts the brain's HTTP surface. `secured` is the plugin's
// authentication gate (ZEKRA_REQUIRE_AUTH: session or token required); every
// handler additionally resolves its caller once (withCaller) and authorizes per
// brain in-handler. Kept here, not in the plugin package, so tests mount the
// exact same table.
func (s *Service) RegisterRoutes(r chi.Router, secured func(http.HandlerFunc) http.HandlerFunc) {
	if secured == nil {
		secured = func(h http.HandlerFunc) http.HandlerFunc { return h }
	}
	sec := func(h http.HandlerFunc) http.HandlerFunc { return secured(s.withCaller(h)) }

	// Health stays fully open (liveness probe).
	r.Get("/api/brain/ping", s.Ping)
	r.Get("/api/brain/events", sec(s.Events)) // realtime SSE, scoped per caller
	r.Get("/api/brain/stats", sec(s.Stats))
	r.Get("/api/brain/activity", sec(s.Activity))
	r.Get("/api/brain/namespaces", sec(s.Namespaces))
	r.Get("/api/brain/graph", sec(s.Graph))
	r.Post("/api/brain/recall", sec(s.Recall))
	r.Post("/api/brain/search", sec(s.Search))
	r.Post("/api/brain/retain", sec(s.Retain))
	r.Get("/api/brain/memory", sec(s.Get))
	r.Post("/api/brain/forget", sec(s.Forget))
	r.Post("/api/brain/dedup", sec(s.Dedup))
	// Graph plane — multi-hop traversal, typed neighbours, shortest path,
	// community detection and ontology discovery, all in Postgres.
	r.Post("/api/brain/graph/traverse", sec(s.TraverseHandler))
	// The spine: one entity's whole neighbourhood, grouped by role, in one call.
	r.Post("/api/brain/graph/spine", sec(s.SpineHandler))
	r.Get("/api/brain/graph/spine", sec(s.SpineHandler))
	r.Post("/api/brain/graph/neighbors", sec(s.NeighborsHandler))
	r.Post("/api/brain/graph/path", sec(s.PathHandler))
	r.Post("/api/brain/graph/communities", sec(s.CommunitiesHandler))
	r.Get("/api/brain/graph/ontology", sec(s.OntologyHandler))
	r.Post("/api/brain/share", sec(s.Share))
	r.Get("/api/brain/gaps", sec(s.Gaps))
	r.Post("/api/brain/gaps/resolve", sec(s.ResolveGap))
	r.Get("/api/brain/brain", sec(s.BrainDetail))
	r.Get("/api/brain/export", sec(s.Export))
	r.Post("/api/brain/import", sec(s.Import))
	r.Post("/api/brain/brain/delete", sec(s.DeleteBrain))
	r.Post("/api/brain/memory/edit", sec(s.EditMemory))
	r.Get("/api/brain/tokens", sec(s.ListTokens))
	r.Post("/api/brain/tokens", sec(s.CreateToken))
	r.Post("/api/brain/tokens/revoke", sec(s.RevokeToken))
	r.Post("/api/brain/grant", sec(s.GrantBrain))
	r.Post("/api/brain/grant/revoke", sec(s.RevokeGrant))
	r.Post("/api/brain/session", sec(s.Session))
	// Live agent: chat with a selected brain.
	r.Post("/api/brain/chat", sec(s.Chat))
	// Per-brain secrets vault (reveal/write also do ACL in-handler).
	r.Get("/api/brain/secrets", sec(s.SecretsList))
	r.Post("/api/brain/secrets", sec(s.SecretPut))
	r.Post("/api/brain/secrets/reveal", sec(s.SecretReveal))
	r.Post("/api/brain/secrets/delete", sec(s.SecretDelete))
	// Data sources (connectors). Console CRUD is secured (session/token); the
	// webhook push path is NOT secured — it authenticates by its own X-Webhook-Secret.
	r.Get("/api/brain/datasources", sec(s.Datasources))
	r.Post("/api/brain/datasources", sec(s.CreateDatasource))
	r.Post("/api/brain/datasources/sync", sec(s.SyncDatasource))
	r.Post("/api/brain/datasources/delete", sec(s.DeleteDatasource))
	r.Post("/api/brain/datasources/rotate-secret", sec(s.RotateDatasourceSecret))
	r.Post("/api/brain/ingest/{id}", s.IngestWebhook)

	// Presentations (presentations_handlers.go), incl. the public share view.
	s.mountPresentations(r, sec)

	// Brain membership (who may use which brain).
	r.Get("/api/brain/mine", sec(s.MyBrains))
	r.Post("/api/brain/brains", sec(s.CreateBrain))
	r.Get("/api/brain/members", sec(s.ListMembers))
	r.Post("/api/brain/members", sec(s.SetMember))
	r.Post("/api/brain/members/remove", sec(s.RemoveMember))

	// Brain profile (per-brain settings; profile.go).
	r.Get("/api/brain/profile", sec(s.GetProfile))
	r.Patch("/api/brain/profile", sec(s.PatchProfile))
	r.Post("/api/brain/profile/image", sec(s.UploadProfileImage))
	r.Delete("/api/brain/profile/image", sec(s.DeleteProfileImage))
	r.Get("/api/brain/profile/image/{ns}/{kind}", sec(s.ServeProfileImage))

	// Notes.
	r.Get("/api/notes", sec(s.ListNotes))
	r.Post("/api/notes", sec(s.CreateNote))
	r.Post("/api/notes/adopt", sec(s.AdoptNotes))
	r.Get("/api/notes/tags", sec(s.NoteTags))
	r.Get("/api/notes/{id}", sec(s.GetNote))
	r.Put("/api/notes/{id}", sec(s.UpdateNote))
	r.Delete("/api/notes/{id}", sec(s.DeleteNote))
	r.Get("/api/notes/{id}/versions", sec(s.NoteVersions))
	r.Post("/api/notes/{id}/restore", sec(s.RestoreNote))
	r.Post("/api/notes/{id}/append", sec(s.AppendNote))
	r.Get("/api/notes/{id}/related", sec(s.NoteRelated))
	r.Get("/api/notes/{id}/backlinks", sec(s.NoteBacklinks))

	// Graph editing: entities (nodes), edges, ontology. Notes are nodes too.
	r.Get("/api/brain/entities/search", sec(s.SearchEntitiesHandler))
	r.Post("/api/brain/entities/neighbors", sec(s.EntityNeighborsHandler))
	r.Post("/api/brain/entities/path", sec(s.EntityPathHandler))
	r.Post("/api/brain/entities", sec(s.CreateEntityHandler))
	r.Get("/api/brain/entities/{id}", sec(s.GetEntityHandler))
	r.Patch("/api/brain/entities/{id}", sec(s.UpdateEntityHandler))
	r.Delete("/api/brain/entities/{id}", sec(s.DeleteEntityHandler))
	r.Post("/api/brain/entities/{id}/note", sec(s.EntityNoteHandler))
	r.Post("/api/brain/edges", sec(s.CreateEdgeHandler))
	r.Patch("/api/brain/edges/{id}", sec(s.UpdateEdgeHandler))
	r.Delete("/api/brain/edges/{id}", sec(s.DeleteEdgeHandler))
	r.Get("/api/brain/ontology", sec(s.OntologyV2Handler))
	for _, k := range []struct {
		path string
		kind OntologyKind
	}{{"/api/brain/ontology/entity-types", KindEntityType}, {"/api/brain/ontology/edge-types", KindEdgeType}} {
		h := sec(s.ontologyWrite(k.kind))
		r.Post(k.path, h)
		r.Patch(k.path, h)
		r.Delete(k.path, h)
	}

	// OAuth 2.1 authorization server + the remote MCP endpoint. Their own
	// authentication (client auth, session consent, bearer tokens) applies.
	o := newOAuthServer(s)
	s.oauth = o
	o.mount(r)
	mcp := s.mcpEndpoint(o)
	r.Post("/api/mcp", mcp)
	r.Get("/api/mcp", mcp)
	r.Delete("/api/mcp", mcp)
	r.Options("/api/mcp", mcp)
	r.Get("/api/mcp/tools", s.mcpToolCatalog)
}
