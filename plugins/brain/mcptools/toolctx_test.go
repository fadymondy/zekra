package mcptools

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestToolsCallTagsTheBackendRequest(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get(ToolHeader)
		_, _ = w.Write([]byte(`{"memories":[]}`))
	}))
	defer srv.Close()
	s := &Server{Backend: &HTTPBackend{Base: srv.URL}}
	params, _ := json.Marshal(map[string]any{"name": "memory_recall",
		"arguments": map[string]any{"namespace": "a", "query": "q"}})
	if resp := s.Handle(context.Background(), &Request{JSONRPC: "2.0", ID: json.RawMessage(`1`),
		Method: "tools/call", Params: params}); resp == nil || resp.Error != nil {
		t.Fatalf("tools/call failed: %+v", resp)
	}
	if got != "memory_recall" {
		t.Fatalf("%s = %q, want memory_recall", ToolHeader, got)
	}
	if ToolFrom(context.Background()) != "" {
		t.Fatal("tool leaked into a bare context")
	}
}
