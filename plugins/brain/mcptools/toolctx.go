package mcptools

import "context"

type toolKey struct{}

// ToolHeader carries the MCP tool name on the REST call a tool makes, so the
// server's audit log can attribute the call to the tool.
const ToolHeader = "X-Zekra-Tool"

// WithTool returns ctx tagged with the MCP tool being called.
func WithTool(ctx context.Context, name string) context.Context {
	return context.WithValue(ctx, toolKey{}, name)
}

// ToolFrom returns the MCP tool name set by WithTool, or "".
func ToolFrom(ctx context.Context) string {
	s, _ := ctx.Value(toolKey{}).(string)
	return s
}
