# AGENTS.md

This file provides guidance to AI coding agents (Codex and others) working in this repository.

**Zekra** is a memory organ for AI agents (hybrid BM25 + vector recall on Postgres/
VectorChord, hot/cold tiers, Redis L1, write-decision dedupe), built as a **togo** app
(Go + sqlc + Atlas + GraphQL/REST, Next.js console in `web/`). Design: `SPEC.md`;
build plan: `PLAN.md`; decision log: `contracts/internal/decisions.md`; deploy: `DEPLOY.md`.

## Commands

- `togo serve` (or `make dev`) — run backend + frontend; `togo dev` for hot reload.
- `togo generate` — sqlc → gqlgen → atlas diff → OpenAPI export. The OpenAPI export compiles
  the whole program, so it is the integration gate.
- `togo migrate` / `go run ./cmd/zekractl migrate` — apply the harness schema / the brain
  plugin's `schema.sql` + `bm25.sql` (needs `DATABASE_URL`). `zekractl inspect` shows the live DB.
- `go build ./...` · `go test ./...` · single test:
  `go test ./plugins/brain/internal/brain -run TestWriteDecision`.
- `togo format` / `togo lint`.
- Web console: `cd web && npm run dev` / `npm run build` (tsc + vite → `web/dist`).

## Architecture

- **The real product is the `brain` plugin** in `plugins/brain` (its own module
  `github.com/togo-framework/brain`). Logic lives in `plugins/brain/internal/brain`:
  `store.go` (Retain/Recall), `writedecision.go` (dedupe on write), `search.go`/`bm25.sql`
  (hybrid recall), `l1cache.go` (Redis L1), `graph.go`/`spine.go` (entity graph),
  `handlers.go`/`service.go` (REST surface), `providers.go` (Embedder/Reranker/Engine seams).
- **Provider plugins** plug in behind those seams: `plugins/brain-tei` (TEI embeddings/rerank),
  `plugins/brain-cognee` (Cognee graph engine), `plugins/cache-redis`.
- The root module is only the **harness** (`cmd/api`, `cmd/migrate`, `cmd/seed`, `internal/`,
  `web/`). In-repo plugins are blank-imported in `internal/plugins/local.go` — keep them out
  of `plugins.gen.go`, which `togo install` rewrites. `cmd/migrate` blank-imports
  `internal/plugins` too, so plugin schemas (e.g. db-postgres) apply on migrate.
- Module resolution: `go.mod` replaces `brain` → `./plugins/brain` (and the other in-repo plugins).
- `cmd/zekra-mcp` is the MCP server (memory_retain/recall/get/forget/…) — a thin stdio
  adapter over the brain's REST API (`ZEKRA_API_URL`, identity via `ZEKRA_AGENT_ID` →
  `X-Agent-Id` header). All scoping/validation stays server-side.
- `scripts/*.py` are maintenance jobs (backfills, brain refresh) run against a live API/DB.

## togo conventions

- Add entities with `togo make:resource <Name> field:type`, then `togo generate && togo migrate`.
- `*.gen.go` and `internal/**/gen/` are generated — never hand-edit.
- API-first: every resource is REST/OpenAPI + GraphQL. Config via `.env`/`togo.yaml`; never hard-code URLs.
- Everything is a plugin (microkernel). Add capabilities with `togo install <owner>/<repo>`.

See `.claude/rules/` for detail.

## Using Zekra while working on Zekra

The project dogfoods itself. If a **zekra** MCP server is configured (the hosted endpoint is
`https://mcp.zekra.dev`, or your own instance), use the `zekra` namespace for this
project's development knowledge (repo docs and git history):

- `memory_recall` before answering questions about the codebase's history or decisions,
  and cite what it returns; if it returns nothing, say so.
- `memory_retain` durable decisions, gotchas and contract details you produce.
- After committing, `python3 scripts/refresh-zekra-brain.py` re-ingests the docs and git log
  (needs `ZEKRA_API_URL` and a token).

See `.claude/rules/memory-first.md`.
