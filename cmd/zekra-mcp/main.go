// Command zekra-mcp is Zekra's Model Context Protocol server over stdio (SPEC
// §5.1): the memory, graph, ACL and note tools for Claude Code and other agents
// that launch a local MCP process. Remote clients (claude.ai, Claude Desktop,
// ChatGPT connectors) use the same tools at https://app.zekra.dev/api/mcp.
//
// The tool definitions and their REST translation live in the shared package
// github.com/togo-framework/brain/mcptools; this binary is only the stdio
// transport over HTTP calls to the brain's REST API, so all scoping/validation
// stays server-side in one place. The agent identity travels as the X-Agent-Id
// header (F5), taken from ZEKRA_AGENT_ID — never from tool arguments.
//
//	ZEKRA_API_URL            base URL of the running Zekra app (default https://app.zekra.dev)
//	ZEKRA_AGENT_ID           this MCP session's agent identity (activity label)
//	ZEKRA_TOKEN              X-Zekra-Token ACL token → per-brain read/write
//	ZEKRA_DEFAULT_NAMESPACE  session bound to one brain (fills an omitted namespace)
//
// Wire it into .mcp.json:
//
//	{"mcpServers":{"zekra":{"command":"zekra-mcp"}}}
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/togo-framework/brain/mcptools"
)

func main() {
	srv := &mcptools.Server{
		Backend: &mcptools.HTTPBackend{
			Base:   strings.TrimRight(env("ZEKRA_API_URL", "https://app.zekra.dev"), "/"),
			Agent:  os.Getenv("ZEKRA_AGENT_ID"),
			Token:  os.Getenv("ZEKRA_TOKEN"),
			Client: &http.Client{Timeout: 30 * time.Second},
		},
		DefaultNamespace: os.Getenv("ZEKRA_DEFAULT_NAMESPACE"),
		Name:             "zekra-brain",
	}
	serve(context.Background(), srv, os.Stdin, os.Stdout)
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// serve runs JSON-RPC 2.0 over newline-delimited stdio.
func serve(ctx context.Context, srv *mcptools.Server, in io.Reader, out io.Writer) {
	enc := json.NewEncoder(out)
	sc := bufio.NewScanner(in)
	sc.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for sc.Scan() {
		line := bytes.TrimSpace(sc.Bytes())
		if len(line) == 0 {
			continue
		}
		var req mcptools.Request
		if err := json.Unmarshal(line, &req); err != nil {
			continue
		}
		if res := srv.Handle(ctx, &req); res != nil {
			_ = enc.Encode(res)
		}
	}
}
