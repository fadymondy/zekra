package brain

/*
The remote MCP endpoint: POST/GET /api/mcp, MCP "streamable HTTP" transport.

  - POST carries one JSON-RPC message (or a batch). Requests are answered with
    application/json; a body of only notifications/responses gets 202 Accepted.
  - GET opens an SSE stream. This server never initiates messages, so the stream
    only carries keep-alive comments; it exists for clients that open it.
  - Mcp-Session-Id is issued on initialize and echoed, but not required: every
    request is authenticated on its own.

Credentials, checked on every request:

  - Authorization: Bearer <OAuth access token> (zko_at_…) — a user-approved
    connection limited to the brains in its grant (see oauth.go);
  - Authorization: Bearer <ACL token> or X-Zekra-Token: <ACL token> — the
    existing per-brain token ACL, for backwards compatibility.

A 401 carries WWW-Authenticate with the protected-resource metadata pointer, so
an OAuth client discovers the authorization server from it.

The tools are the shared set in github.com/togo-framework/brain/mcptools (the
same ones cmd/zekra-mcp serves over stdio). Each tool call becomes an
in-process REST request through the kernel router, so every scoping and
permission check is the REST handler's — one code path for console, stdio MCP
and remote MCP. The OAuth principal rides in the request context, which the
network can never set.
*/

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/togo-framework/brain/mcptools"
)

// inprocBackend serves tool REST calls through the kernel router.
type inprocBackend struct {
	handler   http.Handler
	principal *Principal // OAuth connection, or nil
	token     string     // ACL token, or ""
	agent     string
}

func (b *inprocBackend) Do(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, int, error) {
	u := path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	// A fresh routing context: the outer /api/mcp request's chi context would
	// otherwise make the router treat this as a sub-route of /api/mcp.
	ctx = context.WithValue(ctx, chi.RouteCtxKey, nil)
	ctx = context.WithValue(ctx, callerKey{}, nil)
	if b.principal != nil {
		ctx = WithPrincipal(ctx, b.principal)
	}
	req, err := http.NewRequestWithContext(ctx, method, u, bytes.NewReader(raw))
	if err != nil {
		return nil, 0, err
	}
	req.RemoteAddr = "127.0.0.1:0"
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if b.token != "" {
		req.Header.Set("X-Zekra-Token", b.token)
	}
	if b.agent != "" {
		req.Header.Set("X-Agent-Id", b.agent)
	}
	rec := newRecorder()
	b.handler.ServeHTTP(rec, req)
	return mcptools.DecodeBody(rec.body.Bytes()), rec.status, nil
}

// recorder is a minimal in-memory http.ResponseWriter.
type recorder struct {
	header http.Header
	body   bytes.Buffer
	status int
}

func newRecorder() *recorder { return &recorder{header: http.Header{}, status: http.StatusOK} }

func (r *recorder) Header() http.Header         { return r.header }
func (r *recorder) Write(b []byte) (int, error) { return r.body.Write(b) }
func (r *recorder) WriteHeader(code int)        { r.status = code }
func (r *recorder) Flush()                      {}

// mcpCredential is who is calling /api/mcp.
type mcpCredential struct {
	principal *Principal
	token     string
}

func (s *Service) authenticateMCP(r *http.Request, o *oauthServer) (*mcpCredential, bool) {
	if h := r.Header.Get("Authorization"); len(h) > 7 && strings.EqualFold(h[:7], "Bearer ") {
		tok := strings.TrimSpace(h[7:])
		if strings.HasPrefix(tok, accessPrefix) {
			if p, ok := o.authenticateOAuth(r.Context(), tok); ok {
				return &mcpCredential{principal: p}, true
			}
			return nil, false
		}
		if s.ValidToken(r.Context(), tok) {
			return &mcpCredential{token: tok}, true
		}
		return nil, false
	}
	if tok := TokenHeader(r.Header); tok != "" && s.ValidToken(r.Context(), tok) {
		return &mcpCredential{token: tok}, true
	}
	return nil, false
}

func (cred *mcpCredential) allow() func(mcptools.Access) bool {
	if cred.principal == nil {
		return nil // ACL token: every tool; the REST handlers enforce its grants
	}
	scopes := cred.principal.Scopes
	return func(a mcptools.Access) bool {
		switch a {
		case mcptools.AccessRead:
			return hasScope(scopes, ScopeRead) || hasScope(scopes, ScopeWrite)
		case mcptools.AccessWrite:
			return hasScope(scopes, ScopeWrite)
		default:
			return false // ACL, destructive and connector tools are never offered to apps
		}
	}
}

func (cred *mcpCredential) instructions() string {
	base := "Zekra is a shared memory for AI agents. Use memory_recall before answering from memory, " +
		"memory_retain to store durable facts, and the note_* tools for markdown notes."
	if cred.principal == nil {
		return base
	}
	var names []string
	for ns, w := range cred.principal.Namespaces {
		if w && hasScope(cred.principal.Scopes, ScopeWrite) {
			names = append(names, ns+" (read+write)")
		} else {
			names = append(names, ns+" (read)")
		}
	}
	sort.Strings(names)
	return base + " This connection may use these brains (pass one as `namespace`): " + strings.Join(names, ", ") + "."
}

func (s *Service) mcpUnauthorized(w http.ResponseWriter, r *http.Request) {
	allowAnyOrigin(w)
	w.Header().Set("WWW-Authenticate", bearerChallenge(r, r.Header.Get("Authorization") != "" || TokenHeader(r.Header) != ""))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(mcptools.Response{JSONRPC: "2.0", ID: json.RawMessage("null"),
		Error: &mcptools.RPCError{Code: -32001, Message: "authentication required: connect this server with OAuth or send an X-Zekra-Token"}})
}

// MCP serves POST/GET/DELETE /api/mcp.
func (s *Service) mcpEndpoint(o *oauthServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			o.preflight(w, r)
			return
		}
		cred, ok := s.authenticateMCP(r, o)
		if !ok {
			s.mcpUnauthorized(w, r)
			return
		}
		allowAnyOrigin(w)
		switch r.Method {
		case http.MethodGet:
			s.mcpStream(w, r)
			return
		case http.MethodDelete:
			w.WriteHeader(http.StatusNoContent) // sessions are stateless; nothing to end
			return
		case http.MethodPost:
		default:
			w.Header().Set("Allow", "GET, POST, DELETE, OPTIONS")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}

		raw, err := readLimited(r, 4<<20)
		if err != nil {
			writeRPCError(w, http.StatusRequestEntityTooLarge, -32600, "request too large")
			return
		}
		trimmed := bytes.TrimSpace(raw)
		batch := len(trimmed) > 0 && trimmed[0] == '['
		var msgs []mcptools.Request
		if batch {
			if json.Unmarshal(trimmed, &msgs) != nil || len(msgs) == 0 || len(msgs) > 50 {
				writeRPCError(w, http.StatusBadRequest, -32700, "parse error")
				return
			}
		} else {
			var one mcptools.Request
			if json.Unmarshal(trimmed, &one) != nil {
				writeRPCError(w, http.StatusBadRequest, -32700, "parse error")
				return
			}
			msgs = []mcptools.Request{one}
		}

		agent := ""
		if cred.principal != nil {
			agent = cred.principal.agentLabel()
		}
		srv := &mcptools.Server{
			Backend: &inprocBackend{handler: s.k.Router, principal: cred.principal, token: cred.token, agent: agent},
			Allow:   cred.allow(), Name: "zekra", Instructions: cred.instructions(),
			// Optional: bind the session to one brain (fills an omitted namespace).
			DefaultNamespace: strings.TrimSpace(r.Header.Get("X-Zekra-Namespace")),
		}
		var out []*mcptools.Response
		initialized := false
		for i := range msgs {
			m := &msgs[i]
			if m.Method == "" {
				continue // a client's response to us; we never ask, so nothing to do
			}
			if m.Method == "initialize" {
				initialized = true
			}
			if res := srv.Handle(r.Context(), m); res != nil {
				out = append(out, res)
			}
		}
		if initialized {
			w.Header().Set("Mcp-Session-Id", randomToken(18))
		} else if sid := r.Header.Get("Mcp-Session-Id"); sid != "" {
			w.Header().Set("Mcp-Session-Id", sid)
		}
		if len(out) == 0 {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if batch {
			_ = json.NewEncoder(w).Encode(out)
			return
		}
		_ = json.NewEncoder(w).Encode(out[0])
	}
}

// mcpStream is the optional server→client SSE stream (keep-alives only).
func (s *Service) mcpStream(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok || !strings.Contains(r.Header.Get("Accept"), "text/event-stream") {
		w.Header().Set("Allow", "POST, OPTIONS")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, ": zekra mcp stream\n\n")
	fl.Flush()
	t := time.NewTicker(25 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-t.C:
			fmt.Fprint(w, ": ping\n\n")
			fl.Flush()
		}
	}
}

func readLimited(r *http.Request, max int64) ([]byte, error) {
	var buf bytes.Buffer
	n, err := buf.ReadFrom(http.MaxBytesReader(nil, r.Body, max))
	if err != nil {
		return nil, err
	}
	_ = n
	return buf.Bytes(), nil
}

func writeRPCError(w http.ResponseWriter, status, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(mcptools.Response{JSONRPC: "2.0", ID: json.RawMessage("null"),
		Error: &mcptools.RPCError{Code: code, Message: msg}})
}

// mcpToolCatalog serves GET /api/mcp/tools: the shared tool registry as public
// metadata (name, description, input schema, access class) for the zekra CLI to
// mirror. No credentials, no data.
func (s *Service) mcpToolCatalog(w http.ResponseWriter, _ *http.Request) {
	allowAnyOrigin(w)
	w.Header().Set("Cache-Control", "public, max-age=300")
	writeJSON(w, http.StatusOK, map[string]any{
		"server":           "zekra",
		"protocolVersions": mcptools.SupportedProtocolVersions,
		"url":              MCPPublicURL(),
		"tools":            mcptools.Catalog(),
	})
}
