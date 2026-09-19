---
title: Data sources
description: Load documents, web pages, GitHub repositories, SQL query results and webhook events into a Zekra brain with connectors.
order: 6
---

# Data sources

A **data source** is a connector attached to one brain. When it syncs, it fetches documents
from somewhere else, splits them into chunks of about 1,600 characters on paragraph and line
boundaries, and retains each chunk into the brain. Each chunk goes through the normal retain
pipeline: embedding, keyword indexing, secret detection and the write decision. Syncing the
same content again is therefore cheap, because unchanged chunks resolve to `noop`.

You can manage data sources in the console (a brain's **Sources** tab), over the
[REST API](./api.md#data-sources), or with the MCP tools `datasource_list`,
`datasource_create`, `datasource_sync` and `datasource_delete`.

## Connector kinds

| Kind | Direction | What it ingests |
|---|---|---|
| `text` | pull | Inline text stored in the connector config |
| `markdown` | pull | Inline markdown (handled the same way as `text`) |
| `crawler` | pull | One web page, fetched and reduced to text |
| `github` | pull | Text files from a GitHub repository tree |
| `sql` | pull | The rows returned by a SQL query, one document per row |
| `webhook` | push | Content POSTed to Zekra by another system |

### `text` and `markdown`

| Key | Required | Notes |
|---|---|---|
| `content` | yes | The text to ingest |
| `title` | | Optional title |

### `crawler`

| Key | Required | Notes |
|---|---|---|
| `url` | yes | The page to fetch |

### `github`

| Key | Default | Notes |
|---|---|---|
| `repo` | required | `owner/name` |
| `branch` | the repository's default branch, else `main` | |
| `path` | repository root | Only files under this path |
| `ext` | `.md` | One suffix, or a list or comma-separated string (`".go,.ts,.sql"`) to index source code |
| `exclude` | | Extra path substrings to skip. Directories such as `node_modules`, `vendor` and `dist`, lock files, minified and generated files are always skipped. |
| `maxBytes` | 60000 | Skip files larger than this |
| `maxDocs` | 500 | Maximum files per sync |
| `fileDates` | `false` | Date each file by its last commit instead of the repository's last push (one extra API call per file) |
| `token` | | GitHub token, needed for private repositories |

### `sql`

| Key | Default | Notes |
|---|---|---|
| `driver` | `pgx` (PostgreSQL) | |
| `dsn` | required | Connection string. Use a read-only database user. |
| `query` | required | Each returned row becomes one document, written as `column: value` lines |
| `refColumn` | | Column used as each memory's `sourceRef`, so a memory can be traced to its row |
| `titleColumn` | | Column used as the document title |

A sync reads at most 5,000 rows. Each sync runs the whole query again, and the write
decision skips rows that have not changed.

### `webhook`

| Key | Notes |
|---|---|
| `secret` | Shared secret that senders present in the `X-Webhook-Secret` header. **Set it yourself when you create the source.** If you omit it, Zekra generates one (`whk_…`), but secrets are masked in every API response, so you cannot read a generated secret back. |

Webhook sources are push-only. Calling sync on one returns an error.

## Secrets in connector configs

The config keys `secret`, `token`, `password`, `apiKey` and `dsn` are returned as `••••`
by every API response. The stored values are used only on the server.

## Examples

Create a GitHub source and sync it:

```sh
curl -sS https://app.zekra.dev/api/brain/datasources \
  -H "X-Zekra-Token: $ZEKRA_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "namespace": "my-project",
    "kind": "github",
    "name": "project-docs",
    "config": { "repo": "acme/handbook", "path": "docs", "ext": ".md" }
  }'
# -> { "id": "3f2c…", "status": "idle", ... }

curl -sS https://app.zekra.dev/api/brain/datasources/sync \
  -H "X-Zekra-Token: $ZEKRA_TOKEN" -H "Content-Type: application/json" \
  -d '{"id":"3f2c…"}'
# -> { "ingested": 42, "status": "ok" }
```

Index rows from a database:

```json
{
  "namespace": "support",
  "kind": "sql",
  "name": "resolved-tickets",
  "config": {
    "dsn": "postgres://readonly:PASSWORD@db.example.com:5432/support?sslmode=require",
    "query": "SELECT id, subject, resolution, closed_at FROM tickets WHERE status = 'resolved' ORDER BY closed_at DESC LIMIT 5000",
    "refColumn": "id",
    "titleColumn": "subject"
  }
}
```

Push events with a webhook:

```sh
# 1. Create the source with your own secret
curl -sS https://app.zekra.dev/api/brain/datasources \
  -H "X-Zekra-Token: $ZEKRA_TOKEN" -H "Content-Type: application/json" \
  -d '{"namespace":"ops","kind":"webhook","name":"ci-events","config":{"secret":"'"$WEBHOOK_SECRET"'"}}'
# -> { "id": "9a1d…", ... }

# 2. The sender pushes content. It authenticates with the webhook secret, not a Zekra token.
curl -sS https://app.zekra.dev/api/brain/ingest/9a1d… \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET" -H "Content-Type: application/json" \
  -d '{"content":"Deploy 1234 succeeded on main","sourceRef":"ci/deploy/1234"}'
# -> { "id": "9a1d…", "ingested": 1 }
```

The ingest body takes `content` (required), `sourceRef` and `metadata`.

## Source status

`GET /api/brain/datasources?namespace=` returns each source with `status` (`idle`,
`syncing`, `ok` or `error`), `lastError`, `docCount` and `lastSyncAt`, plus the list of
available `kinds`. Deleting a source keeps the memories it already ingested.
