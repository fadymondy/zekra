# Zekra

**ذكرة — shared long-term memory for AI agents.** What one session learns, the next one
already knows.

Zekra is a memory service that any agent (Claude Code, Codex, Gemini, Cursor, your own
fleet) reaches over **MCP**. It stores what agents and people learn, deduplicates and
updates it on write, and returns exactly the right memory on recall — with citations —
so nobody re-derives what is already known.

- **Landing:** https://zekra.dev
- **Console + API + MCP:** https://app.zekra.dev
- **CLI:** [`fadymondy/zekra-cli`](https://github.com/fadymondy/zekra-cli)

## Documentation

Full docs at **https://zekra.dev/en/docs** (source: [`docs/`](./docs)):

- [Introduction](./docs/index.md) and [Quickstart](./docs/quickstart.md)
- [MCP server](./docs/mcp.md): tool reference and client setup
- [CLI](./docs/cli.md): the `zekra` command and the Claude Code plugin
- [REST API](./docs/api.md): endpoints, errors, events, TypeScript client
- [Data sources](./docs/data-sources.md) · [Capture hook](./docs/capture-hook.md) ·
  [Security](./docs/security.md) · [Self-hosting](./docs/self-hosting.md)

## What it does

- **Retain / recall** — hybrid retrieval: dense vectors + multilingual BM25 fused with RRF,
  a salience nudge, reranking, and 1-hop entity expansion. A write-decision step
  (ADD / UPDATE / INVALIDATE / NOOP) updates contradicted facts instead of duplicating them.
  Nothing is hard-deleted: `forget` soft-invalidates and history stays queryable.
- **Many brains** — one namespace per project or team, with per-agent grants and access
  tokens (`cbt_…`) enforced server-side.
- **Knowledge graph** — entities and typed relations extracted from memories, with
  traverse / neighbors / path / ontology queries and a graph "spine".
- **Data sources** — connectors (`text`, `markdown`, `crawler`, `github`, `sql`, `webhook`)
  pull external content, chunk it and retain it through the same write pipeline.
  See [Data sources](./docs/data-sources.md).
- **Chat with a brain** — a tool-calling agent that uses the brain's own recall / search /
  graph / retain as tools and answers with citations and an auditable trace.
- **Knowledge gaps, secrets vault, activity log** — plus a web console to manage it all.
- **Tiers** — Redis L1 working-memory cache, hot Postgres tier, object-store cold tier.

## Connect an agent

```bash
curl -fsSL https://app.zekra.dev/install.sh | sh     # installs the `zekra` CLI
zekra auth login --token <cbt_…>
zekra mcp:install claude-code                        # or claude-desktop | codex | gemini | cursor
```

MCP tools include `memory_retain`, `memory_recall`, `memory_get`, `memory_forget`,
`memory_share`, `memory_edit`, `graph_*`, `memory_gaps`, `brain_*` (list, grants, tokens,
chat), `secret_*` and `datasource_*`. Full reference: [MCP server](./docs/mcp.md) · contracts: [`contracts/tools.md`](./contracts/tools.md).

## Architecture

Zekra is a [togo](https://to-go.dev) app built from plugins:

| Part | Where | Role |
|---|---|---|
| `brain` | `plugins/brain` (module `github.com/togo-framework/brain`) | the memory organ: schema, retain/recall, graph, connectors, chat, REST |
| `brain-tei` | `plugins/brain-tei` | embeddings + rerank via TEI (Qwen3-Embedding-0.6B, bge-reranker-v2-m3) |
| `brain-cognee` | `plugins/brain-cognee` | entity / graph extraction engine (Cognee) |
| `cache-redis` | `plugins/cache-redis` | L1 cache |
| harness | `cmd/api`, `cmd/migrate`, `internal/`, `web/` | the app: API server, migrations, React console |
| `zekra-mcp` | `cmd/zekra-mcp` | stdio MCP server — thin adapter over the REST API |
| `zekractl` | `cmd/zekractl` | ops CLI: inspect DB, apply schema/BM25, BM25 smoke test, graph mirror |

Storage is Postgres with VectorChord + BM25 + pgvector. Design: [`SPEC.md`](./SPEC.md) ·
build plan: [`PLAN.md`](./PLAN.md) · decisions: [`contracts/internal/decisions.md`](./contracts/internal/decisions.md) ·
deploy: [`DEPLOY.md`](./DEPLOY.md).

## Develop

```bash
cp .env.example .env
togo generate        # sqlc → gqlgen → atlas → OpenAPI (the build gate)
togo migrate         # harness schema;  go run ./cmd/zekractl migrate  for the brain schema
togo serve           # API + console
go test ./plugins/brain/...
cd web && npm run dev
```

Configuration comes from `.env` / `togo.yaml` (`ZEKRA_*` variables; legacy `CABRAIN_*` names
are still honoured). Secrets are never committed.

Zekra was previously called **CaBrain**.
