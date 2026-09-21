# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

**Zekra** is a memory organ for AI agents (hybrid BM25 + vector recall on Postgres/
VectorChord, hot/cold tiers, Redis L1, write-decision dedupe), built as a **togo** app
(Go + sqlc + Atlas + GraphQL/REST, Vite/React console in `web/`). Design: `SPEC.md`;
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
- Module resolution: `go.mod` replaces `brain` → `./plugins/brain`; `go.work` shadows the
  parent `E:\Sites\togo\go.work` and pulls sibling togo plugins from `..\*`.
- `cmd/zekra-mcp` is the MCP server (memory_retain/recall/get/forget/…) — a thin stdio
  adapter over the brain's REST API (`ZEKRA_API_URL`, identity via `ZEKRA_AGENT_ID` →
  `X-Agent-Id` header). All scoping/validation stays server-side.
- `scripts/*.py` are ingestion/sync jobs (FlowOS sync, graph edges, code indexing, rollups)
  run against the live API/DB.

## togo conventions

- Add entities with `togo make:resource <Name> field:type`, then `togo generate && togo migrate`.
- `*.gen.go` and `internal/**/gen/` are generated — never hand-edit.
- API-first: every resource is REST/OpenAPI + GraphQL. Config via `.env`/`togo.yaml`; never hard-code URLs.
- Everything is a plugin (microkernel). Add capabilities with `togo install <owner>/<repo>`.

See `.Codex/rules/` for detail.

## The FlowOS brain (zekra MCP)

The **cabrain** MCP server connects to Zekra's remote Streamable HTTP endpoint at
`https://mcp.zekra.dev` (Codex config: `~/.codex/config.toml`) and exposes this
project's memory organ. Two
brains are loaded:
- **`flowos`** (~1,780 memories) — the FlowOS / OneStudio hub: ventures, domain-expert
  agents, people, issues, posts, roadmaps, releases, goals, learnings, harvested research.
- **`avo`** (~2,490 memories) — the **AVO "Founder Readiness Lab"** repo markdown
  (board pack, playbooks, kaizen engine, kickstart legal/finance, pitch/fundraising,
  research, theses, drills). Use for AVO / founder-readiness / KSA-GCC founder-prep
  questions.

- **`cabrain`** — this project's own dev knowledge (repo docs + git history). Use when
  developing/following up on Zekra itself.

Pick the namespace matching the question (`flowos` studio, `avo` founder readiness,
`cabrain` this project's dev); recall both/all and merge only if genuinely ambiguous.
Manage brains with the MCP tools `brain_list`, `brain_details`, `memory_edit`,
`brain_delete`, and knowledge gaps with `memory_gaps` / `memory_resolve_gap`.

**MEMORY-FIRST IS MANDATORY. Every turn: recall → answer/act → retain.** For ANY
question or task touching FlowOS / OneStudio — a venture, portfolio, person, agent,
issue, task, post, decision, or learning — you **MUST** call the zekra MCP
`memory_recall` tool with `namespace: "flowos"` **before** answering, base the answer
on what it returns (and cite it), and `memory_retain` anything new you produce. If
recall returns nothing, say so — never invent facts.

Examples that must trigger a recall first: "who is X?", "what is the Sentra venture?",
"which agent does Saudi HR?", "what open OAuth issues exist?", "what have we learned
about auth gates?".

- Prefer concise/keyword queries (e.g. `"Sentra"`, `"PDPL compliance kit"`).
- `memory_retain` to store, `memory_get` to fetch by id, `memory_forget` to retire.
- Needs the app on `:8080` (`bash /home/coder/run-cabrain.sh` if down) + the workspace
  on `stack_stacknet`.

**Full mandatory ruleset: `.Codex/rules/memory-first.md` (R1–R8).** Also see
`contracts/internal/flowos-brain.md`.
