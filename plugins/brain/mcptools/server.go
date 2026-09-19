package mcptools

import (
	"context"
	"encoding/json"
)

// SupportedProtocolVersions are the MCP revisions this server speaks, newest
// first. initialize echoes the client's version when it is one of these and
// otherwise answers with the newest (the spec's negotiation rule).
var SupportedProtocolVersions = []string{"2025-06-18", "2025-03-26", "2024-11-05"}

// Request is one JSON-RPC 2.0 message from the client.
type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// IsNotification reports whether the message expects no response.
func (r *Request) IsNotification() bool { return len(r.ID) == 0 || string(r.ID) == "null" }

// Response is one JSON-RPC 2.0 response.
type Response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
}

// RPCError is a JSON-RPC error object.
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Server dispatches MCP JSON-RPC over any transport.
type Server struct {
	Backend Backend
	// DefaultNamespace, when set, fills the namespace argument a call omits
	// (a stdio session bound to one brain).
	DefaultNamespace string
	// Allow filters the tools this credential may list and call (nil = all).
	Allow        func(Access) bool
	Name         string
	Version      string
	Instructions string
}

// Handle answers one message; it returns nil for a notification.
func (s *Server) Handle(ctx context.Context, req *Request) *Response {
	if req.IsNotification() {
		return nil // notifications/initialized, notifications/cancelled, …
	}
	reply := func(result any) *Response { return &Response{JSONRPC: "2.0", ID: req.ID, Result: result} }
	fail := func(code int, msg string) *Response {
		return &Response{JSONRPC: "2.0", ID: req.ID, Error: &RPCError{Code: code, Message: msg}}
	}
	switch req.Method {
	case "initialize":
		var p struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(req.Params, &p)
		version := SupportedProtocolVersions[0]
		for _, v := range SupportedProtocolVersions {
			if v == p.ProtocolVersion {
				version = v
			}
		}
		name, ver := s.Name, s.Version
		if name == "" {
			name = "zekra-brain"
		}
		if ver == "" {
			ver = "0.2.0"
		}
		res := map[string]any{
			"protocolVersion": version,
			"capabilities":    map[string]any{"tools": map[string]any{"listChanged": false}},
			"serverInfo":      map[string]any{"name": name, "version": ver},
		}
		if s.Instructions != "" {
			res["instructions"] = s.Instructions
		}
		return reply(res)
	case "ping":
		return reply(map[string]any{})
	case "tools/list":
		return reply(map[string]any{"tools": ToolsFor(s.Allow)})
	case "tools/call":
		var p struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil || p.Name == "" {
			return fail(-32602, "invalid params")
		}
		if _, known := toolAccess[p.Name]; !known {
			return fail(-32602, "unknown tool: "+p.Name)
		}
		if s.Allow != nil && !s.Allow(ToolAccess(p.Name)) {
			return reply(toolResult(map[string]any{"error": map[string]string{
				"code":    "permission_denied",
				"message": p.Name + " is not available to this connection",
			}}, true))
		}
		args := map[string]any{}
		if len(p.Arguments) > 0 {
			_ = json.Unmarshal(p.Arguments, &args)
		}
		if s.DefaultNamespace != "" {
			if v, ok := args["namespace"]; !ok || v == nil || v == "" {
				args["namespace"] = s.DefaultNamespace
			}
		}
		res, err := Call(ctx, s.Backend, p.Name, args)
		if err != nil {
			return fail(-32602, "unknown tool: "+p.Name)
		}
		return reply(toolResult(res.Payload, res.IsError))
	case "resources/list":
		return reply(map[string]any{"resources": []any{}})
	case "prompts/list":
		return reply(map[string]any{"prompts": []any{}})
	default:
		return fail(-32601, "method not found: "+req.Method)
	}
}

// toolResult wraps a JSON payload as an MCP tool result (text content).
func toolResult(payload any, isErr bool) map[string]any {
	b, _ := json.MarshalIndent(payload, "", "  ")
	return map[string]any{
		"content": []map[string]any{{"type": "text", "text": string(b)}},
		"isError": isErr,
	}
}
