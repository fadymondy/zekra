package mcptools

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// HTTPBackend calls a running Zekra API over HTTP (used by cmd/zekra-mcp).
type HTTPBackend struct {
	Base   string // e.g. https://app.zekra.dev
	Agent  string // X-Agent-Id (activity label, not a credential)
	Token  string // X-Zekra-Token ACL token
	Bearer string // OAuth access token (Authorization: Bearer)
	Client *http.Client
}

// Do performs one REST call.
func (h *HTTPBackend) Do(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, int, error) {
	u := strings.TrimRight(h.Base, "/") + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, u, rd)
	if err != nil {
		return nil, 0, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if h.Agent != "" {
		req.Header.Set("X-Agent-Id", h.Agent)
	}
	if h.Token != "" {
		req.Header.Set("X-Zekra-Token", h.Token) // ACL: per-brain read/write
	}
	if h.Bearer != "" {
		req.Header.Set("Authorization", "Bearer "+h.Bearer)
	}
	hc := h.Client
	if hc == nil {
		hc = http.DefaultClient
	}
	resp, err := hc.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	return DecodeBody(raw), resp.StatusCode, nil
}

// DecodeBody parses a JSON body, wrapping anything else as {"raw": "..."}.
func DecodeBody(raw []byte) any {
	var body any
	if json.Unmarshal(raw, &body) != nil {
		body = map[string]any{"raw": string(raw)}
	}
	return body
}
