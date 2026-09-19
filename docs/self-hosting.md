---
title: Self-hosting
description: Run your own Zekra instance with Docker, including its dependencies, configuration, schema setup and first admin.
order: 9
---

# Self-hosting

Zekra is open source ([github.com/fadymondy/zekra](https://github.com/fadymondy/zekra)). It
ships as one Go binary that serves the REST API, the web console, GraphQL and an OpenAPI
description on a single port (`:8080`).

## Requirements

| Component | Required | Purpose |
|---|---|---|
| **PostgreSQL** with the `vchord`, `vchord_bm25`, `pg_tokenizer` and `pg_partman` extensions (VectorChord) | yes | Memories, vector index, BM25 keyword index, entity graph, accounts |
| **Embedding server**, [Text Embeddings Inference](https://github.com/huggingface/text-embeddings-inference) (TEI) with a **1024-dimension** model | yes, for retain and recall | Embeddings. The reference setup uses `Qwen/Qwen3-Embedding-0.6B`. The schema's vector column is 1024-dimensional, so the model must match. |
| **Reranker**, TEI with a reranker model | recommended | Reranks recall results. The reference setup uses `BAAI/bge-reranker-v2-m3`. |
| **Redis** | optional | Shared recall cache. An in-process cache is used otherwise. |
| **Chat LLM**: an Ollama-compatible endpoint, or an Anthropic API key | optional | `brain_chat` and `POST /api/brain/chat` |
| **Cognee** | optional | An external engine for entity-graph extraction |
| **Mail**: a [Resend](https://resend.com) API key or SMTP | recommended | Verification codes, sign-in codes and export links |

Without an embedding server, retain and recall return `503 no_embedder`. Everything else
keeps working.

## 1. Build

The generated code (`internal/**/gen`) is not committed, so run code generation before you
build. Code generation uses the [togo](https://to-go.dev) CLI.

```sh
git clone https://github.com/fadymondy/zekra.git
cd zekra
togo generate                 # sqlc, gqlgen, atlas, OpenAPI
docker build -t zekra:latest .
```

The Dockerfile builds the web console and the API into a distroless image that listens on
`:8080`.

## 2. Configure

Copy `.env.example` to `.env` and fill it in. These are the settings that matter most:

### Core

| Variable | Notes |
|---|---|
| `APP_ENV` | `production` fails closed on missing secrets |
| `APP_URL` | Public base URL, such as `https://zekra.example.com` |
| `DATABASE_URL` | `postgres://user:password@host:5432/zekra?sslmode=require` |
| `DB_DRIVER` | `pgx` |
| `AUTH_SECRET` | **Required.** At least 32 bytes (`openssl rand -hex 32`). Signs sessions. If it is unset, sessions end on every restart. |
| `ZEKRA_SECRETS_KEY` | 64 hex characters. Encrypts the secrets vault. If unset, it is derived from `AUTH_SECRET`. Keep it stable, or stored secrets become unreadable. |
| `VAULT_KEY` | 32 bytes (hex or base64). Encrypts two-factor secrets. Falls back to `ZEKRA_SECRETS_KEY`, then `AUTH_SECRET`. Set it in production. |
| `ZEKRA_PUBLIC_URL` | URL placed in the MCP configs that the session launcher generates. Defaults to `APP_URL`. |

### Access control

| Variable | Notes |
|---|---|
| `ZEKRA_REQUIRE_AUTH` | `1` requires a session or token on every brain endpoint. **Set it on any public instance.** |
| `ZEKRA_REQUIRE_TOKEN` | `1` stops treating tokenless requests as trusted admin requests |
| `ADMIN_EMAILS` | Comma-separated emails that get the console admin role |
| `ALLOW_REGISTRATION` | `false` closes sign-up |

See [Security](./security.md#enforcement-switches) for what each switch does.

### Retrieval

| Variable | Notes |
|---|---|
| `TEI_EMBEDDINGS_URL` | Embedding server, such as `http://tei-embed:80` |
| `TEI_EMBEDDINGS_DIM` | `1024` |
| `TEI_RERANKER_URL` | Reranker server (optional) |
| `BRAIN_BM25_TOKENIZER` | BM25 tokenizer name. Leave it at the default unless you install a custom multilingual tokenizer. |
| `BRAIN_HNSW_EF_SEARCH` | Vector search breadth (optional tuning) |
| `CACHE_DRIVER`, `REDIS_URL`, `BRAIN_RECALL_CACHE_TTL` | `memory` (default) or `redis`. The TTL is in seconds; `0` turns off recall caching. |

### Chat

| Variable | Notes |
|---|---|
| `BRAIN_CHAT_LLM_URL`, `BRAIN_CHAT_LLM_MODEL`, `BRAIN_CHAT_LLM_KEY` | Ollama-compatible endpoint. Fall back to `EXTRACTION_LLM_URL`, `EXTRACTION_LLM_MODEL` and `EXTRACTION_LLM_API_KEY`. |
| `ANTHROPIC_API_KEY` (or `BRAIN_CHAT_ANTHROPIC_KEY`), `BRAIN_CHAT_ANTHROPIC_MODEL` | Use Claude for chat instead |
| `BRAIN_CHAT_LLM_TOOLS` | `0` turns off the tool-calling agent and uses single-shot answers |

### Graph engine (optional)

`COGNEE_API_URL`, `COGNEE_API_TOKEN`, `COGNEE_ADMIN_EMAIL`. If `COGNEE_API_URL` is unset,
the engine is off, and the graph is built from memory metadata instead.

### Accounts and mail

| Variable | Notes |
|---|---|
| `AUTH_PUBLIC_URL` | Public origin for OAuth callbacks and email links. Falls back to `APP_URL`. |
| `RESEND_API_KEY`, `MAIL_FROM` | Email delivery. Without a key, production cannot deliver codes, and development only logs them. |
| `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET` | Google sign-in. Callback: `<AUTH_PUBLIC_URL>/api/auth/google/callback` |
| `OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GITHUB_CLIENT_SECRET` | GitHub sign-in. Callback: `<AUTH_PUBLIC_URL>/api/auth/github/callback` |
| `APPLE_SERVICES_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY_PATH` (or `APPLE_PRIVATE_KEY`) | Apple sign-in, HTTPS only. Callback: `<AUTH_PUBLIC_URL>/api/auth/apple/callback` |
| `SESSION_DRIVER` | `cookie` (default) or `database`. With `database`, admins can list and revoke individual sessions. |

A sign-in provider is enabled only when its credentials are set. Otherwise its routes
return 404.

Never commit `.env` or bake secrets into the image.

## 3. Apply the schema

Zekra's schema is applied by the `zekractl` ops tool, not on startup:

```sh
DATABASE_URL=postgres://… go run ./cmd/zekractl migrate
```

This applies the account schema, the brain schema and the BM25 layer. It is idempotent.
If the database role cannot use the BM25 extension's catalogs, the BM25 step is skipped
and recall falls back to vector-only search. To fix that, have a superuser run
`infra/grant-bm25.sql`, then run `zekractl bm25`.

Other `zekractl` commands:

| Command | What it does |
|---|---|
| `zekractl inspect` | Show extensions, tables, tokenizer, BM25 index and row counts |
| `zekractl bm25` | Apply only the BM25 layer |
| `zekractl bm25-test` | Seed a few multilingual rows and run a BM25 query |
| `zekractl admin <email>` | Give an existing account the admin role |
| `zekractl mirror <namespace>` | Copy a brain's Cognee graph into Zekra's entity tables |

## 4. Run

```sh
docker run -d --name zekra -p 8080:8080 --env-file .env zekra:latest
```

Put a TLS-terminating reverse proxy in front of it for public use. The console, API and SSE
stream are all served from the same origin.

## 5. Verify

```sh
curl -s http://localhost:8080/api/brain/ping     # {"plugin":"brain","status":"ok",...}
curl -s http://localhost:8080/api/brain/stats    # {"ready":true,...}
```

Then register at `/register` with an address listed in `ADMIN_EMAILS` (or run
`zekractl admin <email>`), open **Admin → Tokens**, mint a token, and point the CLI at your
instance:

```sh
zekra auth login --url https://zekra.example.com --token cbt_...
zekra mcp:install claude-code
```

## Local development

```sh
cp .env.example .env
togo generate
go run ./cmd/zekractl migrate
togo serve                     # API and console
go test ./plugins/brain/...
```

Legacy `CABRAIN_*` environment variable names are still read. A `ZEKRA_*` value always wins.
