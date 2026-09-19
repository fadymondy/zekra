---
title: MCP server
description: Connect Claude Code, Claude Desktop, Cursor, Codex and Gemini CLI to Zekra over the Model Context Protocol, with a full tool reference.
order: 3
---

# MCP server

Zekra's MCP server gives any [Model Context Protocol](https://modelcontextprotocol.io)
client memory tools: recall, retain, graph queries, brains, secrets and data sources.

The server speaks MCP over **stdio**. It is a thin adapter over the [REST API](./api.md).
Each tool call becomes one HTTPS request to your Zekra instance, carrying your token. All
access checks and validation happen on the server.

```
MCP client  --stdio-->  zekra mcp  --HTTPS + X-Zekra-Token-->  Zekra API (app.zekra.dev)
```

## Two binaries

| Binary | Where it comes from | Tools |
|---|---|---|
| **`zekra mcp`** (recommended) | The [`zekra` CLI](./cli.md). Install with `curl`, npm or `go install`. | Memory, brains, access control, chat, secrets and data sources: 24 listed tools. Adds `brain_create`. |
| **`zekra-mcp`** | Built from `cmd/zekra-mcp` in the Zekra server repository | The full set of 31 tools, including the `graph_*` tools, `memory_share`, `memory_dedup` and `memory_recall_archive` |

Both read the same environment variables and call the same API. Use `zekra mcp` unless you
need the graph tools. To build `zekra-mcp`, clone the server repository and run:

```sh
go build -o zekra-mcp ./cmd/zekra-mcp
```

## Configuration

| Variable | Meaning |
|---|---|
| `ZEKRA_API_URL` | Base URL of the Zekra app. Default: `https://app.zekra.dev` |
| `ZEKRA_TOKEN` | Your access token (`cbt_…`), sent as `X-Zekra-Token`. It decides which brains you can read and write. |
| `ZEKRA_AGENT_ID` | Optional agent label, sent as `X-Agent-Id`. With a token, the token's identity is used instead. |
| `ZEKRA_DEFAULT_NAMESPACE` | Optional. Binds the session to one brain: any tool call without a `namespace` argument uses this brain. |

`zekra mcp` also falls back to the values saved by `zekra auth login` in
`~/.zekra/config.json`. Legacy `CABRAIN_*` variable names are still accepted; a `ZEKRA_*`
value always wins.

## Client setup

The fastest path is the CLI, which writes the right file for each client:

```sh
zekra auth login --token cbt_...
zekra mcp:install <client> --brain my-project   # claude-code | claude-desktop | cursor | codex | gemini
```

Use `zekra mcp:print <client>` to see the snippet without writing anything. To configure a
client by hand, use the snippets below. If you use `zekra-mcp`, set `"command": "zekra-mcp"`
and remove `args`.

### Claude Code

Project scope, in `.mcp.json` at the repository root (`--user` makes the CLI write
`~/.claude.json` instead):

```json
{
  "mcpServers": {
    "zekra": {
      "command": "zekra",
      "args": ["mcp"],
      "env": {
        "ZEKRA_API_URL": "https://app.zekra.dev",
        "ZEKRA_TOKEN": "cbt_...",
        "ZEKRA_DEFAULT_NAMESPACE": "my-project"
      }
    }
  }
}
```

Or from the Claude Code CLI:

```sh
claude mcp add zekra \
  -e ZEKRA_API_URL=https://app.zekra.dev \
  -e ZEKRA_TOKEN=cbt_... \
  -e ZEKRA_DEFAULT_NAMESPACE=my-project \
  -- zekra mcp
```

For Claude Code there is also a [plugin](./cli.md#claude-code-plugin) that bundles the MCP
server, slash commands, agents and hooks.

### Claude Desktop

Edit `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "zekra": {
      "command": "zekra",
      "args": ["mcp"],
      "env": {
        "ZEKRA_API_URL": "https://app.zekra.dev",
        "ZEKRA_TOKEN": "cbt_..."
      }
    }
  }
}
```

Claude Desktop may not find binaries on your shell `PATH`. If the server fails to start,
use the absolute path to `zekra`. `zekra mcp:install` writes the absolute path for you.

### Cursor

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "zekra": {
      "command": "zekra",
      "args": ["mcp"],
      "env": {
        "ZEKRA_API_URL": "https://app.zekra.dev",
        "ZEKRA_TOKEN": "cbt_..."
      }
    }
  }
}
```

### Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.zekra]
command = "zekra"
args = ["mcp"]

[mcp_servers.zekra.env]
ZEKRA_API_URL = "https://app.zekra.dev"
ZEKRA_TOKEN = "cbt_..."
```

### Gemini CLI

`~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "zekra": {
      "command": "zekra",
      "args": ["mcp"],
      "env": {
        "ZEKRA_API_URL": "https://app.zekra.dev",
        "ZEKRA_TOKEN": "cbt_..."
      }
    }
  }
}
```

### Any other MCP client

Any client that can launch a stdio server works. Run `zekra mcp` (or `zekra-mcp`) with the
environment variables above. The server implements `initialize`, `ping`, `tools/list` and
`tools/call`, and reports protocol version `2024-11-05`.

## Remote MCP (coming soon)

> **Coming soon:** a remote MCP endpoint over HTTP with OAuth sign-in, so that ChatGPT and
> claude.ai custom connectors can use Zekra without a local binary. It is planned and not
> available yet. Today every client connects through the local stdio server described above.

## Tool results and errors

Every tool returns one text content block that holds the JSON response of the matching
REST endpoint. When the API answers with an error, the result has `isError: true` and the
body carries the structured error:

```json
{ "error": { "code": "permission_denied", "message": "no read access to brain research" } }
```

Error codes are listed in the [REST API reference](./api.md#errors). An unknown tool name
returns JSON-RPC error `-32602`.

## Tool reference

Argument names are exactly as the tools declare them. Some tools use `snake_case` and some
use `camelCase`. **Access** is what the calling token needs on the brain: *read*, *write*
or *admin*. Tools marked **zekra-mcp** are only in the `zekra-mcp` binary. `brain_create` is
only in `zekra mcp`.

### Memory

#### `memory_recall`
Hybrid recall inside one brain: vector search and BM25 fused with RRF, a salience signal,
reranking and optional one-hop entity expansion. Access: read.

| Argument | Type | Required | Notes |
|---|---|---|---|
| `namespace` | string | yes | Brain to read |
| `query` | string | yes | Short, keyword-forward queries rank best |
| `limit` | integer | | Results after reranking (default 8) |
| `expand_entities` | boolean | | One-hop entity expansion (default `true`) |
| `min_importance` | number | | Drop memories below this importance |
| `types` | string[] | | **zekra-mcp.** Only memories whose `metadata.type` is in this list |
| `exclude_source_kinds` | string[] | | **zekra-mcp.** Drop memories from these `sourceKind` values |

Returns `{ "results": [ { id, content, score, network, memoryType, sourceKind, sourceRef, importance, validAt, viaEntity? } ] }`.
An empty result is recorded as a [knowledge gap](#memory_gaps).

#### `memory_retain`
Store a memory. The server runs the write decision (`add`, `update`, `invalidate` or `noop`),
embeds and indexes the text, and vaults any secrets it detects. Access: write.

| Argument | Type | Required | Notes |
|---|---|---|---|
| `namespace` | string | yes | |
| `content` | string | yes | Raw or distilled text, in any language |
| `source_kind` | string | yes in zekra-mcp | Where it came from. `zekra-mcp` accepts `claude_code`, `coder_run`, `whatsapp`, `slack`, `chat`, `manual`. |
| `source_ref` | string | | Session, thread or run id |
| `importance_hint` | number | | 0 to 1. A nudge that is blended in, not a final value |
| `visibility` | string | | `private` (default), `team` or `global` |

Returns `{ "id", "decision", "importance", "supersededId"? }`.

#### `memory_get`
Fetch one memory by id with full provenance. Access: read.

| Argument | Type | Required |
|---|---|---|
| `namespace` | string | yes |
| `id` | string (UUID) | yes |

#### `memory_edit`
Change a memory's content (which re-embeds it), importance or metadata. Access: write.

| Argument | Type | Required | Notes |
|---|---|---|---|
| `namespace` | string | yes | |
| `id` | string | yes | |
| `content` | string | | New content |
| `importance` | number | | 0 to 1 |
| `metadata` | object | | Replaces the existing metadata |

#### `memory_forget`
Soft-delete a memory. It sets `invalidAt` and never removes the row. Access: write.

| Argument | Type | Required | Notes |
|---|---|---|---|
| `namespace` | string | yes | |
| `id` | string | yes | |
| `reason` | string | | Recorded with the memory |

#### `memory_share`
Grant another agent identity access to a brain. The caller needs write access on the brain.
Listed by **zekra-mcp**. `zekra mcp` accepts the call but does not list it.

| Argument | Type | Required | Default |
|---|---|---|---|
| `namespace` | string | yes | |
| `grantee_agent_id` | string | yes | |
| `can_read` | boolean | | `true` |
| `can_write` | boolean | | `false` |

#### `memory_dedup` (zekra-mcp)
Soft-invalidate duplicates in a brain: memories with the same `sourceRef` are collapsed to
the newest one. Access: write.

| Argument | Type | Required | Notes |
|---|---|---|---|
| `namespace` | string | yes | |
| `sourceKind` | string | | Limit to one source kind |

Returns `{ "namespace", "sourceKind", "invalidated": <count> }`.

#### `memory_recall_archive` (zekra-mcp)
Reserved for deep recall over the cold storage tier. It is not implemented yet and always
returns an `unavailable` error.

#### `memory_gaps`
List knowledge gaps: queries whose recall came back empty, deduplicated and counted.

| Argument | Type | Notes |
|---|---|---|
| `namespace` | string | Optional filter |
| `status` | string | `open`, `indexed`, `dismissed` or `all`. Default: open and indexed |
| `limit` | integer | Default 100 |

#### `memory_resolve_gap`
Close a gap after you retain the missing knowledge (`indexed`), or drop it (`dismissed`).

| Argument | Type | Required |
|---|---|---|
| `id` | integer | yes |
| `status` | string: `indexed`, `dismissed` or `open` | yes |
| `resolution` | string | |

### Brains

#### `brain_list`
List brains with their memory counts. No arguments.

#### `brain_details`
One brain in detail: memory count, counts by type and source, open gaps, recall count and
first and last dates. Argument: `namespace` (required).

#### `brain_create` (zekra mcp only)
Create a brain by storing a first marker memory in it. Arguments: `name` (required) and
`description`. Access: write on the new namespace.

#### `brain_delete`
Delete a brain and **all** of its memories. This cannot be undone. Access: write.

| Argument | Type | Required | Notes |
|---|---|---|---|
| `namespace` | string | yes | |
| `confirm` | string | yes | Must equal `namespace`. `zekra mcp` also accepts `true`. |

#### `brain_chat`
Ask a brain a question. An agent recalls and searches the brain, answers only from what it
finds, and returns citations. Access: read.

| Argument | Type | Required | Notes |
|---|---|---|---|
| `namespace` | string | yes | |
| `message` | string | yes | |
| `topK` | integer | | Memories to ground on (default 8) |

Returns `{ "answer", "citations": [...], "footprint": { recalled, model, provider, mode, grounded, iterations, steps } }`.

### Access control (admin)

These tools need an **admin** token.

| Tool | Arguments | What it does |
|---|---|---|
| `brain_create_token` | `agentId` (required), `label`, `isAdmin` (default `false`) | Mint a token for an agent identity. Returns the token once. |
| `brain_tokens` | `includeRevoked` (default `false`) | List tokens with their grants |
| `brain_grant` | `agentId`, `namespace` (both required), `canRead` (default `true`), `canWrite` (default `false`) | Create or update a grant |
| `brain_revoke_grant` | `agentId`, `namespace` (both required) | Remove a grant |

### Secrets vault

| Tool | Arguments | Access | What it does |
|---|---|---|---|
| `secret_list` | `namespace` | read | Secret names and masked hints. Never values. |
| `secret_store` | `namespace`, `name`, `value` (required), `kind` | write | Store or replace a secret. `kind` is one of `api_key`, `password`, `env`, `token`, `private_key`, `connection_string`, `generic`. |
| `secret_reveal` | `namespace`, `name` | write | Decrypt and return the value |
| `secret_delete` | `namespace`, `name` | write | Delete a secret |

### Data sources

| Tool | Arguments | Access | What it does |
|---|---|---|---|
| `datasource_list` | `namespace` | read | Connectors with status, document count and last sync |
| `datasource_create` | `namespace`, `kind`, `name` (required), `config` | write | Add a connector. `kind` is one of `text`, `markdown`, `crawler`, `github`, `sql`, `webhook`. |
| `datasource_sync` | `id` | write | Run a connector now. Returns `{ ingested, status }`. |
| `datasource_delete` | `id` | write | Remove a connector. Memories it already ingested stay. |

Connector `config` keys are listed in [Data sources](./data-sources.md).

### Graph (zekra-mcp)

| Tool | Arguments | What it does |
|---|---|---|
| `graph_ontology` | `namespace` | The brain's entity types and relation types with live counts. Call this first to learn valid names. |
| `graph_traverse` | `namespace`, `entity` (required), `depth` (default 2, max 6), `relations[]`, `types[]`, `direction` (`out`, `in` or `both`), `asOf` (RFC 3339), `limit` | Multi-hop walk from a named entity. Returns each reachable entity with its depth and path. |
| `graph_neighbors` | `namespace`, `entity` (required), `asOf` | Direct typed relations of one entity, with direction and a readable fact |
| `graph_path` | `namespace`, `from`, `to` (required), `maxDepth` (default 4, max 6) | Shortest relation path between two entities |
| `graph_spine` | `namespace`, `entity` (required), `depth` (default 2, max 4), `hubs[]`, `roles[]`, `perGroup` (default 10, max 200), `window` (such as `24h`, `7d`, `2w`, `3m`), `since`, `until`, `timeRoles[]` | Everything connected to one entity in one call, grouped by role. Each group gives the true total next to a capped sample. |

All graph tools need read access on the brain.
