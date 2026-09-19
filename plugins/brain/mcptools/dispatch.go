package mcptools

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

// Backend performs one REST call against the Zekra API and returns the decoded
// JSON body and HTTP status. The stdio binary uses HTTPBackend; /api/mcp uses an
// in-process backend that serves the request through the kernel router.
type Backend interface {
	Do(ctx context.Context, method, path string, query url.Values, body map[string]any) (payload any, status int, err error)
}

// Access classifies a tool for credentials that are not all-powerful.
type Access string

const (
	AccessRead  Access = "read"  // reads one or more brains
	AccessWrite Access = "write" // writes a brain
	AccessAdmin Access = "admin" // ACL / destructive / vault-reveal / connectors: never offered to OAuth apps
)

var toolAccess = map[string]Access{
	"memory_retain": AccessWrite, "memory_recall": AccessRead,
	"memory_get": AccessRead, "memory_dedup": AccessWrite, "memory_forget": AccessWrite,
	"memory_share": AccessAdmin, "graph_traverse": AccessRead, "graph_spine": AccessRead,
	"graph_neighbors": AccessRead, "graph_path": AccessRead, "graph_ontology": AccessRead,
	"memory_gaps": AccessRead, "memory_resolve_gap": AccessWrite, "brain_list": AccessRead,
	"brain_details": AccessRead, "memory_edit": AccessWrite, "brain_delete": AccessAdmin, "brain_create": AccessAdmin,
	"brain_grant": AccessAdmin, "brain_revoke_grant": AccessAdmin, "brain_create_token": AccessAdmin,
	"brain_tokens": AccessAdmin, "brain_chat": AccessRead, "secret_list": AccessRead,
	"secret_store": AccessWrite, "secret_reveal": AccessAdmin, "secret_delete": AccessWrite,
	"datasource_list": AccessRead, "datasource_create": AccessAdmin, "datasource_sync": AccessAdmin,
	"datasource_delete": AccessAdmin,
	"note_create":       AccessWrite, "note_update": AccessWrite, "note_append": AccessWrite,
	"note_get": AccessRead, "note_search": AccessRead, "note_list": AccessRead, "note_delete": AccessWrite,
	"notes_adopt": AccessWrite,
}

// ToolAccess returns a tool's access class (admin for an unknown tool: fail closed).
func ToolAccess(name string) Access {
	if a, ok := toolAccess[name]; ok {
		return a
	}
	return AccessAdmin
}

// Tools returns every tool definition (memory + graph + ACL + notes).
func Tools() []map[string]any {
	out := make([]map[string]any, 0, len(toolDefs)+len(noteToolDefs)+len(graphToolDefs))
	out = append(out, toolDefs...)
	out = append(out, noteToolDefs...)
	return append(out, graphToolDefs...)
}

// ToolsFor returns the tools whose access class is allowed.
func ToolsFor(allow func(Access) bool) []map[string]any {
	if allow == nil {
		return Tools()
	}
	var out []map[string]any
	for _, t := range Tools() {
		if name, _ := t["name"].(string); allow(ToolAccess(name)) {
			out = append(out, t)
		}
	}
	return out
}

// ErrUnknownTool is returned by Call for a name no tool has.
var ErrUnknownTool = fmt.Errorf("unknown tool")

// Result is a tool outcome before MCP wrapping.
type Result struct {
	Payload any
	IsError bool
}

// Call translates a tool call into its REST request and performs it through b.
// A transport failure becomes an error result; a non-2xx REST answer is surfaced
// as an error result carrying the structured body (permission_denied, …).
func Call(ctx context.Context, b Backend, name string, args map[string]any) (Result, error) {
	if args == nil {
		args = map[string]any{}
	}
	var (
		body any
		code int
		err  error
	)
	post := func(path string, payload map[string]any) {
		body, code, err = b.Do(ctx, "POST", path, nil, clean(payload))
	}
	put := func(path string, payload map[string]any) {
		body, code, err = b.Do(ctx, "PUT", path, nil, clean(payload))
	}
	get := func(path string, q url.Values) { body, code, err = b.Do(ctx, "GET", path, q, nil) }
	del := func(path string) { body, code, err = b.Do(ctx, "DELETE", path, nil, nil) }
	patch := func(path string, payload map[string]any) {
		body, code, err = b.Do(ctx, "PATCH", path, nil, clean(payload))
	}
	note := func(suffix string) string { return "/api/notes/" + url.PathEscape(str(args["id"])) + suffix }

	switch name {
	case "memory_retain":
		post("/api/brain/retain", map[string]any{
			"namespace":      args["namespace"],
			"content":        args["content"],
			"sourceKind":     args["source_kind"],
			"sourceRef":      args["source_ref"],
			"visibility":     args["visibility"],
			"importanceHint": args["importance_hint"],
		})
	case "memory_recall":
		post("/api/brain/recall", map[string]any{
			"namespace":          args["namespace"],
			"query":              args["query"],
			"limit":              args["limit"],
			"expandEntity":       args["expand_entities"],
			"types":              args["types"],
			"excludeSourceKinds": args["exclude_source_kinds"],
			"minImportance":      args["min_importance"],
		})
	case "memory_get":
		get("/api/brain/memory", url.Values{"namespace": {str(args["namespace"])}, "id": {str(args["id"])}})
	case "memory_dedup":
		post("/api/brain/dedup", map[string]any{"namespace": args["namespace"], "sourceKind": args["sourceKind"]})
	case "memory_forget":
		post("/api/brain/forget", map[string]any{"namespace": args["namespace"], "id": args["id"], "reason": args["reason"]})
	case "memory_share":
		post("/api/brain/share", map[string]any{
			"namespace":      args["namespace"],
			"granteeAgentId": args["grantee_agent_id"],
			"canRead":        args["can_read"],
			"canWrite":       args["can_write"],
		})
	case "graph_traverse":
		post("/api/brain/graph/traverse", map[string]any{
			"namespace": args["namespace"], "entity": args["entity"], "depth": args["depth"],
			"relations": args["relations"], "types": args["types"],
			"direction": args["direction"], "asOf": args["asOf"], "limit": args["limit"]})
	case "graph_spine":
		post("/api/brain/graph/spine", map[string]any{
			"namespace": args["namespace"], "entity": args["entity"], "depth": args["depth"],
			"hubs": args["hubs"], "roles": args["roles"], "perGroup": args["perGroup"],
			"window": args["window"], "since": args["since"], "until": args["until"],
			"timeRoles": args["timeRoles"]})
	case "graph_neighbors":
		post("/api/brain/graph/neighbors", map[string]any{
			"namespace": args["namespace"], "entity": args["entity"], "asOf": args["asOf"]})
	case "graph_path":
		post("/api/brain/graph/path", map[string]any{
			"namespace": args["namespace"], "from": args["from"], "to": args["to"], "maxDepth": args["maxDepth"]})
	case "graph_ontology":
		get("/api/brain/graph/ontology", url.Values{"namespace": {str(args["namespace"])}})
	case "memory_gaps":
		get("/api/brain/gaps", nonEmpty(url.Values{
			"namespace": {str(args["namespace"])}, "status": {str(args["status"])}, "limit": {str(args["limit"])}}))
	case "memory_resolve_gap":
		post("/api/brain/gaps/resolve", map[string]any{
			"id": args["id"], "status": args["status"], "resolution": args["resolution"]})
	case "brain_list":
		get("/api/brain/namespaces", nil)
	case "brain_details":
		get("/api/brain/brain", url.Values{"namespace": {str(args["namespace"])}})
	case "memory_edit":
		post("/api/brain/memory/edit", map[string]any{
			"namespace": args["namespace"], "id": args["id"], "content": args["content"],
			"importance": args["importance"], "metadata": args["metadata"]})
	case "brain_create":
		post("/api/brain/brains", map[string]any{"namespace": args["namespace"]})
	case "brain_delete":
		post("/api/brain/brain/delete", map[string]any{"namespace": args["namespace"], "confirm": args["confirm"]})
	case "brain_grant":
		post("/api/brain/grant", map[string]any{
			"agentId": args["agentId"], "namespace": args["namespace"],
			"canRead": args["canRead"], "canWrite": args["canWrite"]})
	case "brain_revoke_grant":
		post("/api/brain/grant/revoke", map[string]any{"agentId": args["agentId"], "namespace": args["namespace"]})
	case "brain_create_token":
		post("/api/brain/tokens", map[string]any{
			"agentId": args["agentId"], "label": args["label"], "isAdmin": args["isAdmin"]})
	case "brain_tokens":
		qv := url.Values{}
		if v, _ := args["includeRevoked"].(bool); v {
			qv.Set("includeRevoked", "1")
		}
		get("/api/brain/tokens", qv)
	case "brain_chat":
		post("/api/brain/chat", map[string]any{
			"namespace": args["namespace"], "message": args["message"], "topK": args["topK"]})
	case "secret_list":
		get("/api/brain/secrets", url.Values{"namespace": {str(args["namespace"])}})
	case "secret_store":
		post("/api/brain/secrets", map[string]any{
			"namespace": args["namespace"], "name": args["name"], "value": args["value"], "kind": args["kind"]})
	case "secret_reveal":
		post("/api/brain/secrets/reveal", map[string]any{"namespace": args["namespace"], "name": args["name"]})
	case "secret_delete":
		post("/api/brain/secrets/delete", map[string]any{"namespace": args["namespace"], "name": args["name"]})
	case "datasource_list":
		get("/api/brain/datasources", url.Values{"namespace": {str(args["namespace"])}})
	case "datasource_create":
		post("/api/brain/datasources", map[string]any{
			"namespace": args["namespace"], "kind": args["kind"], "name": args["name"], "config": args["config"]})
	case "datasource_sync":
		post("/api/brain/datasources/sync", map[string]any{"id": args["id"]})
	case "datasource_delete":
		post("/api/brain/datasources/delete", map[string]any{"id": args["id"]})

	// --- notes -----------------------------------------------------------------
	case "note_create":
		post("/api/notes", map[string]any{
			"namespace": args["namespace"], "title": args["title"], "body": args["body"],
			"tags": args["tags"], "pinned": args["pinned"], "category": args["category"], "source": "agent"})
	case "note_update":
		put(note(""), map[string]any{
			"title": args["title"], "body": args["body"], "tags": args["tags"],
			"pinned": args["pinned"], "archived": args["archived"], "version": args["version"], "category": args["category"],
			"source": "agent"})
	case "note_append":
		post(note("/append"), map[string]any{"text": args["text"], "source": "agent"})
	case "note_get":
		get(note(""), nil)
	case "note_search":
		limit := str(args["limit"])
		if limit == "" {
			limit = "20"
		}
		get("/api/notes", nonEmpty(url.Values{
			"q": {str(args["query"])}, "namespace": {str(args["namespace"])},
			"tag": {str(args["tag"])}, "limit": {limit}}))
	case "note_list":
		qv := nonEmpty(url.Values{
			"namespace": {str(args["namespace"])}, "tag": {str(args["tag"])},
			"limit": {str(args["limit"])}, "cursor": {str(args["cursor"])}})
		if v, _ := args["archived"].(bool); v {
			qv.Set("archived", "1")
		}
		get("/api/notes", qv)
	case "note_delete":
		del(note(""))
	case "notes_adopt":
		post("/api/notes/adopt", map[string]any{"namespace": args["namespace"]})
	default:
		if !callGraph(name, args, post, patch, get, del) && !callProfile(name, args, patch, get) &&
			!callPresentation(name, args, post, patch, get, del) {
			return Result{}, ErrUnknownTool
		}
	}

	if err != nil {
		return Result{Payload: map[string]any{"error": map[string]string{"code": "unavailable", "message": err.Error()}},
			IsError: true}, nil
	}
	return Result{Payload: body, IsError: code >= 400}, nil
}

// clean drops nil values so absent optional args don't override server defaults.
func clean(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for k, v := range in {
		if v != nil {
			out[k] = v
		}
	}
	return out
}

func nonEmpty(q url.Values) url.Values {
	for k, v := range q {
		if len(v) == 0 || strings.TrimSpace(v[0]) == "" {
			delete(q, k)
		}
	}
	return q
}

func str(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case float64:
		if t == float64(int64(t)) {
			return fmt.Sprintf("%d", int64(t))
		}
	}
	return fmt.Sprint(v)
}

// CatalogEntry is one tool's public metadata (GET /api/mcp/tools).
type CatalogEntry struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	InputSchema any    `json:"inputSchema"`
	Access      Access `json:"access"`
}

// Catalog is the tool registry as public metadata, in tools/list order — the
// source of truth the zekra CLI mirrors.
func Catalog() []CatalogEntry {
	out := []CatalogEntry{}
	for _, t := range Tools() {
		name, _ := t["name"].(string)
		desc, _ := t["description"].(string)
		out = append(out, CatalogEntry{Name: name, Description: desc, InputSchema: t["inputSchema"], Access: ToolAccess(name)})
	}
	return out
}
