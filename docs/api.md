---
title: REST API
description: Zekra's HTTP API for building your own agents and integrations. Covers authentication, every /api/brain endpoint with examples, errors, server-sent events and a typed TypeScript client.
order: 5
---

# REST API

Everything Zekra does is available over plain HTTP and JSON. The MCP server and the CLI are
thin clients of this API.

- **Base URL:** `https://app.zekra.dev` (or your self-hosted URL)
- **Content type:** `application/json` for request and response bodies, unless noted
- **Timestamps:** RFC 3339. **Memory ids:** UUID strings. **Importance:** 0 to 1.

> **SDK:** there is no published SDK package yet. The `zekra-cli` npm package only installs
> the CLI binary and has no importable library. The API is small, so a typed wrapper around
> `fetch` is enough; see [TypeScript client](#typescript-client).

## Authentication

### Access tokens (agents and services)

Send your token in the `X-Zekra-Token` header:

```sh
curl -sS https://app.zekra.dev/api/brain/namespaces -H "X-Zekra-Token: $ZEKRA_TOKEN"
```

A token (`cbt_…`) resolves to an **agent identity**. Each request is checked against that
identity's **grants**: `canRead` for reads and `canWrite` for writes on the brain named in
the request. **Admin** tokens bypass grants and can use the access-control endpoints. A
revoked or unknown token gets no access. The legacy header `X-Cabrain-Token` is still
accepted.

`X-Agent-Id` is an optional label used to attribute activity. It is not a credential. When
a token is present, the token's identity is used.

### Console sessions (people)

The web console signs people in through `/api/auth/*`. The session is carried by a cookie,
or by `Authorization: Bearer <jwt>` using the token returned from `POST /api/auth/login`.
Use access tokens for programmatic access. Sessions are meant for the console.

### How a request is authorized

1. **Authentication gate.** When the server runs with `ZEKRA_REQUIRE_AUTH=1`, which is how
   a public deployment should run, every `/api/brain/*` endpoint except `GET /api/brain/ping`
   and the webhook ingest endpoint needs either a valid `X-Zekra-Token` or a signed-in session.
   Otherwise the response is `401`.
2. **Brain authorization.** Each handler then checks the caller's grant on the brain it
   touches, and returns `403 permission_denied` if the grant is missing.

A request without a token is treated as the trusted console and gets admin rights, unless
the server sets `ZEKRA_REQUIRE_TOKEN=1`. **Always send a token from agents and services.**
See [Security](./security.md).

## Errors

Errors use one shape:

```json
{ "error": { "code": "permission_denied", "message": "no write access to brain research" } }
```

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `invalid_argument` | Bad JSON, or a required field is missing |
| 401 | `unauthenticated` | Webhook secret missing or wrong. The authentication gate also returns 401. |
| 403 | `permission_denied` | Your token has no grant on the brain, or the endpoint is admin-only |
| 404 | `not_found` | No such memory, gap or data source |
| 503 | `no_embedder` | The server has no embedding provider configured, so retain and recall cannot run |
| 503 | `unavailable` | A backing service (database, embedder, LLM) failed |
| 503 | `auth_unavailable` | Authentication is enforced but the auth plugin is not active (server misconfiguration) |

## Memory

### `POST /api/brain/retain`

Store a memory. Access: write.

| Field | Type | Required | Notes |
|---|---|---|---|
| `namespace` | string | yes | |
| `content` | string | yes | |
| `sourceKind` | string | | Where it came from, such as `claude_code`, `chat` or `manual` |
| `sourceRef` | string | | Session, thread or run id |
| `visibility` | string | | `private` (default), `team`, `global` |
| `importanceHint` | number | | 0 to 1. Blended into the computed importance |
| `ownerAgentId` | string | | |
| `metadata` | object | | Free-form. `metadata.type` is what recall's `types` filter matches. |
| `validAt` | RFC 3339 | | When the event happened. Set this when you import dated records; the default is now. |
| `network` | string | | `fact`, `experience`, `observation`, `belief`. Derived when omitted. |
| `memoryType` | string | | `episodic`, `semantic`, `procedural`, `working`. Derived when omitted. |

Field names are also accepted in `snake_case` (`source_kind`, `valid_at` and so on).

```sh
curl -sS https://app.zekra.dev/api/brain/retain \
  -H "X-Zekra-Token: $ZEKRA_TOKEN" -H "Content-Type: application/json" \
  -d '{"namespace":"research","content":"Competitor X raised prices 20% in March.","sourceKind":"manual"}'
```

```json
{ "id": "5b0e…", "decision": "add", "importance": 0.62 }
```

`decision` is one of `add`, `update`, `invalidate` or `noop`. For `update`, `supersededId`
is the memory that was replaced. Credentials in `content` are moved to the brain's secrets
vault and replaced with `[secret:<name>]`.

### `POST /api/brain/recall`

Hybrid recall inside one brain. Access: read.

| Field | Type | Default | Notes |
|---|---|---|---|
| `namespace` | string | required | |
| `query` | string | required | |
| `limit` | int | 8 | Results after reranking |
| `expandEntity` | bool | `true` | One-hop expansion through the entity graph |
| `minImportance` | number | | Importance floor |
| `types` | string[] | | Only memories whose `metadata.type` is in this list |
| `excludeSourceKinds` | string[] | | Drop these source kinds |
| `since`, `until` | RFC 3339 | | Bound on the event time (`validAt`) |
| `asOf` | RFC 3339 | | What the brain believed at that moment, including memories that were later superseded |
| `orderBy` | string | relevance | `recent` or `oldest` switches from relevance to time ordering |

```sh
curl -sS https://app.zekra.dev/api/brain/recall \
  -H "X-Zekra-Token: $ZEKRA_TOKEN" -H "Content-Type: application/json" \
  -d '{"namespace":"research","query":"competitor pricing","limit":5}'
```

```json
{
  "results": [
    {
      "id": "5b0e…",
      "content": "Competitor X raised prices 20% in March.",
      "score": 0.83,
      "network": "fact",
      "memoryType": "semantic",
      "sourceKind": "manual",
      "sourceRef": "",
      "importance": 0.62,
      "validAt": "2026-09-19T10:04:11Z"
    }
  ]
}
```

`viaEntity` is set on results that came in through entity expansion. An empty result list
is recorded as a knowledge gap.

### `POST /api/brain/search`

The same kind of search across several brains. Access: read on each brain searched.

```json
{ "query": "pricing", "namespaces": ["research", "sales"], "limit": 10 }
```

If you omit `namespaces`, all brains your token can read are searched. Each result also
carries `namespace`.

### `GET /api/brain/memory?namespace=&id=`

One memory with full provenance. Access: read.

```json
{
  "id": "5b0e…", "namespace": "research", "visibility": "private",
  "network": "fact", "memoryType": "semantic", "content": "…",
  "sourceKind": "manual", "importance": 0.62, "accessCount": 3, "tier": "hot",
  "validAt": "…", "invalidAt": null, "supersededBy": "", "metadata": {}
}
```

### `POST /api/brain/memory/edit`

`{ namespace, id, content?, importance?, metadata? }`. Changing the content re-embeds the
memory; `metadata` replaces the existing metadata. Access: write. Returns `{ "id", "updated": true }`.

### `POST /api/brain/forget`

`{ namespace, id, reason? }`. Soft-deletes the memory by setting `invalidAt`. Access:
write. Returns `{ "id", "invalidAt" }`.

### `POST /api/brain/dedup`

`{ namespace, sourceKind? }`. Soft-invalidates memories that share a `sourceRef`, keeping
the newest. Access: write. Returns `{ "namespace", "sourceKind", "invalidated": <n> }`.

## Brains

| Endpoint | Body or query | Returns |
|---|---|---|
| `GET /api/brain/namespaces` | | `{ "brains": [ { namespace, memories, lastAt } ] }` |
| `GET /api/brain/brain?namespace=` | | `{ namespace, memories, types, sources, openGaps, recalls, firstAt, lastAt }` |
| `POST /api/brain/brain/delete` | `{ namespace, confirm }` (`confirm` must equal `namespace`) | `{ namespace, deleted }`. Access: write. Deletes the brain and all its memories. |
| `GET /api/brain/export?namespace=` | | The brain as NDJSON (`application/x-ndjson`), one memory per line |
| `POST /api/brain/import?namespace=` | NDJSON body in the export format | `{ "imported": <n> }`. The `namespace` query parameter overrides the namespace in the file. |
| `GET /api/brain/stats` | | Instance totals: `ready`, `brains`, `memories`, `entities`, `edges`, `agents`, `sessions24h`, `recalls24h`, `openGaps` |
| `GET /api/brain/activity?limit=50` | | `{ "items": [ { id, ts, op, namespace, agentId, outcome, latencyMs } ] }` |
| `GET /api/brain/ping` | | `{ "plugin": "brain", "status": "ok", "authRequired": false }`. Always open. |

There is no create-brain endpoint. A brain exists once it holds a memory: retain one to
create it.

## Knowledge gaps

| Endpoint | Body or query | Returns |
|---|---|---|
| `GET /api/brain/gaps?namespace=&status=&limit=` | `status`: `open`, `indexed`, `dismissed` or `all` | `{ "gaps": [ { id, namespace, query, hits, status, resolution, firstSeen, lastSeen } ] }` |
| `POST /api/brain/gaps/resolve` | `{ id, status, resolution? }` | `{ id, status }` |

## Graph

All graph endpoints need read access on the brain.

| Endpoint | Body | Returns |
|---|---|---|
| `GET /api/brain/graph?namespace=&limit=200` | | A sample for visualization: `{ ready, derived, nodes, edges, typeCounts, relationCounts, totalNodes, … }` |
| `GET /api/brain/graph/ontology?namespace=` | | `{ "entityTypes": [ { Name, Description, Count } ], "edgeTypes": [ { Name, Description, Src, Dst, Count } ] }` |
| `POST /api/brain/graph/traverse` | `{ namespace, entity, depth?, relations?, types?, direction?, asOf?, limit? }` | `{ "nodes": [ { id, name, type, depth, path, via, summary, distance } ], "count" }` |
| `POST /api/brain/graph/neighbors` | `{ namespace, entity, asOf? }` | `{ "edges": [ { id, src, dst, relation, fact, validFrom, validTo } ], "count" }` |
| `POST /api/brain/graph/path` | `{ namespace, from, to, maxDepth? }` | `{ "path": [names…], "hops", "connected" }` |
| `POST` or `GET /api/brain/graph/spine` | `{ namespace, entity, depth?, hubs?, roles?, perGroup?, window?, since?, until?, timeRoles? }`, or the same as query parameters on GET (lists comma-separated) | `{ root, depth, hubs, window, groups: [ { role, total, shown, capped, items } ], totals }` |
| `POST /api/brain/graph/communities` | `{ namespace, iterations? }` | `{ "communities": <n> }`. Recomputes entity clusters. Access: write. |

The ontology keys are capitalized (`Name`, `Count`) in the current release.

## Chat

### `POST /api/brain/chat`

Ask a brain a question. Access: read. Set `write: true` to let the agent retain what it
learns; this only takes effect if you also have write access.

```json
{ "namespace": "research", "message": "What changed in competitor pricing?", "topK": 8,
  "history": [ { "role": "user", "content": "…" } ] }
```

```json
{
  "answer": "Competitor X raised prices by 20% in March [1].",
  "citations": [ { "id": "5b0e…", "content": "…", "score": 0.83 } ],
  "footprint": { "namespace": "research", "recalled": 3, "model": "…", "provider": "anthropic",
                 "mode": "agent", "grounded": true, "iterations": 2, "steps": [ { "tool": "recall", "args": "…", "resultCount": 3 } ] }
}
```

If nothing relevant is found, `grounded` is `false` and the answer says so.

## Access control

Admin-only: a non-admin token gets `403`.

| Endpoint | Body or query | Returns |
|---|---|---|
| `GET /api/brain/tokens?includeRevoked=1` | | `{ "tokens": [ { token, agentId, label, isAdmin, createdAt, lastUsedAt, revoked, grants } ] }` |
| `POST /api/brain/tokens` | `{ agentId, label?, isAdmin? }` | The new token object, including `token` |
| `POST /api/brain/tokens/revoke` | `{ token }` | `{ "revoked": true }` |
| `POST /api/brain/grant` | `{ agentId, namespace, canRead? (true), canWrite? (false) }` | `{ agentId, namespace, canRead, canWrite }` |
| `POST /api/brain/grant/revoke` | `{ agentId, namespace }` | `{ "revoked": true }` |

Available to anyone with access to the brain:

| Endpoint | Body | Access | Returns |
|---|---|---|---|
| `POST /api/brain/share` | `{ namespace, granteeAgentId, canRead?, canWrite? }` | write | The grant |
| `POST /api/brain/session` | `{ namespace, write?, label? }` | read (write if `write: true`) | A new scoped token, see below |

`POST /api/brain/session` creates a new agent identity, mints a non-admin token for it and
grants it this brain (read-only unless `write` is true):

```json
{
  "agentId": "session-research-a1b2c3d4",
  "namespace": "research",
  "write": false,
  "token": "cbt_…",
  "mcpConfig": { "mcpServers": { "…": { "command": "zekra-mcp", "env": { "ZEKRA_API_URL": "…", "ZEKRA_TOKEN": "cbt_…", "ZEKRA_DEFAULT_NAMESPACE": "research" } } } },
  "howto": "…"
}
```

## Secrets vault

| Endpoint | Body or query | Access | Returns |
|---|---|---|---|
| `GET /api/brain/secrets?namespace=` | | read | `{ "secrets": [ { namespace, name, hint, kind, sourceRef, createdBy, createdAt, updatedAt } ] }`. Never values. |
| `POST /api/brain/secrets` | `{ namespace, name, value, kind? }` | write | `{ namespace, name, stored: true }` |
| `POST /api/brain/secrets/reveal` | `{ namespace, name }` | write | `{ namespace, name, value }` |
| `POST /api/brain/secrets/delete` | `{ namespace, name }` | write | `{ namespace, name, deleted }` |

## Data sources

| Endpoint | Body or query | Access |
|---|---|---|
| `GET /api/brain/datasources?namespace=` | | read. Returns `{ datasources, kinds }`. |
| `POST /api/brain/datasources` | `{ namespace, kind, name, config }` | write |
| `POST /api/brain/datasources/sync` | `{ id }` | write. Returns `{ ingested, status, error? }`. |
| `POST /api/brain/datasources/delete` | `{ id }` | write |
| `POST /api/brain/ingest/{id}` | `{ content, sourceRef?, metadata? }` with header `X-Webhook-Secret` | Webhook secret only |

Details and connector configs: [Data sources](./data-sources.md).

## Realtime events (SSE)

`GET /api/brain/events` is a [server-sent events](https://developer.mozilla.org/docs/Web/API/Server-sent_events)
stream of brain activity. Each message has an event name and a JSON payload with a `ts`
timestamp. The server sends a `: ping` comment every 25 seconds.

| Event | Payload |
|---|---|
| `retain` | `{ namespace, decision }` |
| `recall` | `{ namespace, count }` |
| `gap` | `{ namespace, query }` on a miss, or `{ resolved, status }` when a gap is resolved |
| `search` | `{ count }` |
| `chat` | `{ namespace, recalled }` |
| `brain` | `{ deleted }` |
| `grant` | `{ agentId, namespace }` |
| `session` | `{ namespace, agentId, write }` |
| `secret` | `{ namespace, name, op }`, where `op` is `put`, `reveal` or `delete` |
| `datasource` | `{ namespace, op, id, … }`, where `op` is `create`, `sync`, `delete` or `ingest` |

```
event: retain
data: {"namespace":"research","decision":"add","ts":"2026-09-19T10:04:11Z"}
```

The stream is meant for the console, which uses its session cookie. The browser
`EventSource` API cannot set custom headers, so outside the browser use a client that can
send `X-Zekra-Token` (for example `curl -N`). The stream is not filtered by brain.

## Account API

People's accounts live under `/api/auth/*` (sign-in), `/api/me/*` (the signed-in user) and
`/api/admin/*` (console administrators). These endpoints use the console session, not
`X-Zekra-Token`.

| Area | Endpoints |
|---|---|
| Sign-up and sign-in | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/auth/methods` |
| Email verification and passwords | `POST /api/auth/verify-email`, `POST /api/auth/verify-email/resend`, `POST /api/auth/password/forgot`, `POST /api/auth/password/reset` |
| Sign-in by emailed code | `POST /api/auth/code/request` `{email}`, `POST /api/auth/code/verify` `{email, code}` |
| Two-factor | `POST /api/auth/2fa/challenge`; `GET /api/me/2fa`; `POST /api/me/2fa/enroll`, `/confirm`, `/disable`, `/recovery` |
| Single sign-on | `GET /api/auth/google`, `GET /api/auth/github`, `GET /api/auth/apple` (each only when configured) |
| App sign-in | `GET /api/auth/providers` (`{providers: [{name, web, app, native}]}`); browser flow in an auth session: `GET /api/auth/google?app=1&return=zekra://auth/google&code_challenge=…&code_challenge_method=S256` then `POST /api/auth/google/exchange` `{code, code_verifier}`, and the same for `github`; native sheets: `POST /api/auth/google/token` `{id_token}`, `POST /api/auth/apple/token` `{identity_token, nonce, full_name?}` — each answers like `/api/auth/login` |
| Linked accounts | `GET /api/me/identities`, `DELETE /api/me/identities/{ref}`; from the app: `POST /api/me/identities/google` `{id_token}` or `{code, code_verifier}`, `POST /api/me/identities/github` `{code, code_verifier}` (codes from the `&link=1` app flow) |
| Profile and preferences | `GET` and `PUT /api/me/account/profile`, `GET` and `PUT /api/me/account/notifications` |
| Data export | `GET` and `POST /api/me/account/export`, `GET /api/me/account/export/download` |
| Account deletion | `GET` and `POST /api/me/delete`, `POST /api/me/delete/cancel` |
| Administration | `/api/admin/stats`, `/api/admin/users`, `/api/admin/users/{id}` and its `roles`, `disable`, `enable`, `verify`, `resend-verification`, `2fa-reset`, `sessions` and `sessions/revoke` actions |

When an account has two-factor on, a sign-in answers `401` with `code: "2fa_required"` and
a `challenge`. Finish it with `POST /api/auth/2fa/challenge` and `{ challenge, code }` or
`{ challenge, recovery_code }`.

## TypeScript client

A minimal typed client using `fetch` (Node 18+, Deno, Bun or the browser):

```ts
type Decision = "add" | "update" | "invalidate" | "noop";

export interface Recalled {
  id: string;
  namespace?: string;
  content: string;
  score: number;
  network: string;
  memoryType: string;
  sourceKind: string;
  sourceRef: string;
  importance: number;
  validAt: string;
  viaEntity?: string;
}

export class ZekraError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export class Zekra {
  constructor(
    private token: string,
    private baseUrl = "https://app.zekra.dev",
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Zekra-Token": this.token,
        ...init.headers,
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = body?.error ?? {};
      throw new ZekraError(res.status, e.code ?? "unknown", e.message ?? res.statusText);
    }
    return body as T;
  }

  retain(namespace: string, content: string, opts: { sourceKind?: string; sourceRef?: string; metadata?: Record<string, unknown> } = {}) {
    return this.call<{ id: string; decision: Decision; importance: number; supersededId?: string }>(
      "/api/brain/retain",
      { method: "POST", body: JSON.stringify({ namespace, content, ...opts }) },
    );
  }

  async recall(namespace: string, query: string, limit = 8): Promise<Recalled[]> {
    const r = await this.call<{ results: Recalled[] }>("/api/brain/recall", {
      method: "POST",
      body: JSON.stringify({ namespace, query, limit }),
    });
    return r.results ?? [];
  }

  forget(namespace: string, id: string, reason?: string) {
    return this.call<{ id: string; invalidAt: string }>("/api/brain/forget", {
      method: "POST",
      body: JSON.stringify({ namespace, id, reason }),
    });
  }

  brains() {
    return this.call<{ brains: { namespace: string; memories: number; lastAt: string }[] }>(
      "/api/brain/namespaces",
    );
  }
}

// Usage
const zekra = new Zekra(process.env.ZEKRA_TOKEN!);
await zekra.retain("research", "Competitor X raised prices 20% in March.", { sourceKind: "manual" });
const hits = await zekra.recall("research", "competitor pricing");
```
