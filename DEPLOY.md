# Deploying Zekra on `stack_stacknet`

The app is a **single binary** (`cmd/api`) that serves the API + GraphQL + OpenAPI **and**
the built React console (SPA), wired to the live `cabrain` DB. Everything is proven locally;
the only reason `retain`/`recall` don't execute from the Coder workspace is that **TEI
(`tei-embed`/`tei-rerank`) listens only on `stack_stacknet`**. Running the container on that
network resolves `pg`, `tei-embed`, `tei-rerank`, `cognee`, `minio` by name and lights the
whole thing up.

> **Where these commands run.** Build + `docker run` happen on the **stack host** (the box
> that owns `stack_stacknet`), NOT inside the Coder workspace — the workspace has the Docker
> CLI but no daemon socket (`/var/run/docker.sock` absent), so `docker build`/`run` there fail
> with *"failed to connect to the docker API … daemon running?"*. Run everything below on the
> host, or on any machine whose Docker daemon is attached to `stack_stacknet`.

## 1. Env (on-stacknet, internal names)

Point `--env-file` at the host env file (e.g. `/mnt/e/Sites/services/cabrain/.env`, which mirrors the
workspace's `~/.env.cabrain`); its `ZEKRA_DATABASE_URL` already targets `pg:5432`. Secrets are
never baked into the image. The columns below are what the **app binary actually reads**
(confirmed by `grep Getenv`); everything else in the env file is inert for this container.

| Var | On-stacknet value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://cabrain:…@pg:5432/cabrain` | **Required.** Mapped from `ZEKRA_DATABASE_URL` (see §2). `togo.yaml` pins `driver: pgx`, so `DB_DRIVER` is optional/redundant. |
| `TEI_EMBEDDINGS_URL` / `TEI_RERANKER_URL` | `http://tei-embed:80` / `http://tei-rerank:80` | **Required** for retain/recall embeds + rerank. |
| `TEI_EMBEDDINGS_DIM` | `1024` (BAAI/bge-m3) | **Required**; must match the vector column dim. |
| `BRAIN_BM25_TOKENIZER` | `cabrain_bm25_tok` (default) → set `cabrain_ml` | Optional. Switch to `cabrain_ml` **after** a superuser runs `infra/grant-bm25.sql` §3 (llmlingua2 multilingual tokenizer). Until then leave unset/default. |
| `COGNEE_API_URL` | `http://cognee:8000` | Optional. Unset ⇒ cognify engine disabled (non-fatal). |
| `COGNEE_ADMIN_EMAIL` / `COGNEE_API_TOKEN` | … | Optional. Login creds for the cognify engine (confirm the auth scheme on-stack; workspace probe got 401). |
| `CACHE_DRIVER` / `REDIS_URL` / `BRAIN_RECALL_CACHE_TTL` | `redis` / `redis://redis:6379` / `30` | L1 recall cache. Redis **is** on `stack_stacknet` now (`redis:6379`, verified `PONG`) and is the live default in `run-cabrain.sh`. `memory` (in-process) also works with no deps. |
| `ZEKRA_AGENT_ID` | `claude-code` | Optional. Session identity for grant checks (MCP/API); empty = trusted context. |
| `AUTH_SECRET` | 64-hex (`openssl rand -hex 32`) | **Required for stable auth** — the togo auth plugin signs session JWTs with it. Unset ⇒ an ephemeral secret is generated and sessions die on restart. Never commit. |
| `ZEKRA_SECRETS_KEY` | 64-hex (`openssl rand -hex 32`) | Secrets vault AES-256 key. Stable across restarts so vaulted secrets stay decryptable. Unset ⇒ derived from `AUTH_SECRET`; if that's also unset the vault fails closed (never plaintext). Never commit. |
| `ZEKRA_REQUIRE_AUTH` | unset (`1`/`true` to enforce) | Off ⇒ console open (trusted-admin). On ⇒ the login gate guards admin/management endpoints; requires `AUTH_SECRET` + a registered/dev admin. |
| `COLD_STORE_*` | `http://minio:9000`, bucket `cabrain-cold` | Phase 2 cold-tier (MinIO). Not yet read by the binary; safe to leave in the file. |
| `ADDR` / `WEB_DIST` | `:8080` / `/app/web/dist` | **Baked into the image** — do not override. |

## 2. Build + run (on the host)

```bash
# PREREQUISITE — run codegen first. internal/db/gen and internal/graph/gen are
# gitignored (sqlc/gqlgen output), so a clean clone has no generated code and the
# Dockerfile's `go build ./cmd/api` fails with "no matching versions for query latest"
# (it tries to resolve the missing gen packages as modules). Build from a checkout where
# codegen has run so `COPY . .` includes the gen dirs:
togo generate            # sqlc → gqlgen → atlas → OpenAPI (populates internal/**/gen)

# from repo root (monorepo — plugins/ must be in the build context)
docker build -t cabrain:latest .

# Map ZEKRA_DATABASE_URL → DATABASE_URL. --env-file does NOT expand shell vars, so
# source the file into THIS shell first, then the -e mapping resolves.
set -a; . /mnt/e/Sites/services/cabrain/.env; set +a

docker run -d --name cabrain \
  --network stack_stacknet \
  --env-file /mnt/e/Sites/services/cabrain/.env \
  -e DATABASE_URL="${ZEKRA_DATABASE_URL}?search_path=cabrain_auth,public" \
  -e DB_DRIVER=pgx \
  -e CACHE_DRIVER=redis -e REDIS_URL=redis://redis:6379 \
  cabrain:latest
```

The container joins `stack_stacknet`, so `pg`, `tei-embed`, `tei-rerank`, `cognee`, `minio`,
`redis` resolve by name. `-e DATABASE_URL=…` is the one required remap (the env file only defines
`ZEKRA_DATABASE_URL`); `TEI_*`/`COGNEE_*` come straight from the file. To flip on the
multilingual BM25 tokenizer, add `-e BRAIN_BM25_TOKENIZER=cabrain_ml` **after** the superuser
step in `infra/grant-bm25.sql`.

### 2a. Auth + secrets schema (one-time, per DB)

The togo **auth** plugin and the **secrets vault** store their tables in a dedicated
`cabrain_auth` schema so they never collide with Cognee's pre-existing `public.users`
table in the shared `cabrain` DB. The `?search_path=cabrain_auth,public` above makes the
app resolve `users`/`auth_sessions`/`secrets` there while brain tables (`memories`, …)
fall back to `public`. Create the schema once as the `cabrain` role (additive — does NOT
touch Cognee data):

```sql
CREATE SCHEMA IF NOT EXISTS cabrain_auth;
CREATE TABLE IF NOT EXISTS cabrain_auth.users (
  id text PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL,
  roles text NOT NULL DEFAULT '', permissions text NOT NULL DEFAULT '', created_at text NOT NULL);
CREATE TABLE IF NOT EXISTS cabrain_auth.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), namespace text NOT NULL, name text NOT NULL,
  value_enc bytea NOT NULL, hint text, kind text, source_ref text, created_by text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (namespace, name));
CREATE INDEX IF NOT EXISTS secrets_ns ON cabrain_auth.secrets (namespace, name);
```
(auth's other tables — `auth_sessions`, `personal_access_tokens`, `otp_codes`, … — are
auto-created in `cabrain_auth` on first boot since they don't exist in `public`.) Set
`AUTH_SECRET` and `ZEKRA_SECRETS_KEY` (§1) so JWTs + vaulted secrets survive restarts.

### 2b. Auth & accounts

`internal/account` wraps the togo auth plugin with fadymondy.com-v2's account cycle: email
verification, password reset and sign-in by emailed 6-digit code, TOTP two-factor with
recovery codes, Sign in with Google / Apple / GitHub (+ linked accounts), the account area
(profile, notifications, data export, self-deletion with a 14-day grace period) and the admin
API (`/api/admin/*`). It needs Postgres; on any other driver it stays off and the plain auth
plugin routes keep working.

- **Schema.** `internal/account/schema/schema.sql` (idempotent, unqualified, so it lands in
  `cabrain_auth` via the search_path). It is applied on every boot, best effort; apply it
  explicitly with `go run ./cmd/migrate` or `zekractl migrate` (which now also runs it).
- **Mail.** Set `RESEND_API_KEY` and `MAIL_FROM` (e.g. `Zekra <no-reply@zekra.dev>`, a
  domain verified in Resend). Without a key, non-production logs each email **including its
  code** (`DEV MAIL (not sent)`), and production logs a warning and cannot deliver codes.
- **Providers.** A provider is on only when its credentials are set; otherwise its routes 404
  and `/api/auth/methods` leaves it out. Set `AUTH_PUBLIC_URL=https://app.zekra.dev` and
  register these callback URLs:
  - Google: `https://app.zekra.dev/api/auth/google/callback` (`OAUTH_GOOGLE_CLIENT_ID/SECRET`)
  - GitHub: `https://app.zekra.dev/api/auth/github/callback` (`OAUTH_GITHUB_CLIENT_ID/SECRET`;
    an OAuth App or a GitHub App with "Email addresses: read")
  - Apple: `https://app.zekra.dev/api/auth/apple/callback` (`APPLE_SERVICES_ID`, `APPLE_TEAM_ID`,
    `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY_PATH` or inline `APPLE_PRIVATE_KEY`). Apple posts the
    callback cross-site, so it only works over https.
- **Mobile app sign-in.** `GET /api/auth/providers` tells the app which buttons to show
  (`{providers: [{name, web, app, native}]}`: `app` = the server's browser flow run in an auth
  session, `native` = the provider's own sheet); each path answers like `/api/auth/login`
  (`{token, user}`). Provider sign-ins do not ask for the TOTP code — the provider carries its
  own second factor, on the web and in the app alike. A server without `/api/auth/providers`
  (older builds) gets the GitHub button only.
  - Google (default, `app`) — the app runs the web flow in an auth session
    (`/api/auth/google?app=1&return=zekra://auth/google&code_challenge=…`) and trades the
    one-time code at `POST /api/auth/google/exchange {code, code_verifier}`. It needs only the
    web client (`OAUTH_GOOGLE_CLIENT_ID/SECRET`) and the callback URL above — no iOS/Android
    OAuth client, no Google SDK config. The return must use `GOOGLE_APP_SCHEME` (default
    `zekra`); the code lives 2 minutes, works once, and is PKCE-bound to the app.
  - Google (optional upgrade, `native`) — `POST /api/auth/google/token {id_token}`, verified
    against Google's JWKS. The app uses the native Google sheet instead of the browser only when
    its build has the SDK config: the ID token's audience is the **web** client id, so the app's
    `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` must be `OAUTH_GOOGLE_CLIENT_ID` (or be listed in
    `OAUTH_GOOGLE_AUDIENCES`, comma-separated — add the iOS and Android client ids there too).
    In Google Cloud create an iOS OAuth client (bundle `com.fadymondy.zekra`) and an Android one
    (package `com.fadymondy.zekra` + the SHA-1 of every signing key: debug, upload, Play app
    signing). App build env: `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`,
    `GOOGLE_IOS_URL_SCHEME` (the reversed iOS client id; without it the SDK is left out and the
    app uses the browser flow).
  - Apple — `POST /api/auth/apple/token {identity_token, nonce, full_name?}`, on only when
    `APPLE_BUNDLE_IDS=com.fadymondy.zekra` (the token's audience; the key/Services ID above are
    for the web flow only). The nonce is required and must SHA-256 to the token's claim. Enable
    the **Sign in with Apple** capability on the App ID `com.fadymondy.zekra` and regenerate its
    profiles (the app ships the entitlement). The iOS app shows the button only when the server
    reports `apple.native`.
  - GitHub — the app runs the web flow in an auth session
    (`/api/auth/github?app=1&return=zekra://auth/github&code_challenge=…`), so it needs only the
    web credentials and callback URL above. The return must use `GITHUB_APP_SCHEME` (default
    `zekra`); the one-time code lives 2 minutes, works once, and is PKCE-bound to the app —
    `POST /api/auth/github/exchange {code, code_verifier}`.
  - App-flow failures come back as `zekra://auth/<provider>?error=` `cancelled`, `state`,
    `email` (GitHub), `closed`, `disabled` or `failed`.
- **Two-factor.** Secrets are sealed with `VAULT_KEY` (else `ZEKRA_SECRETS_KEY`, else derived
  from `AUTH_SECRET`). Set `VAULT_KEY` in production: rotating the key it derives from locks
  every enrolled authenticator out.
- **First admin.** Put the owner's address in `ADMIN_EMAILS` (comma-separated). The account
  gets the `admin` role on boot, and on its first request after it registers. Or grant it once:
  `zekractl admin you@example.com`. Roles are read from `users.roles` on every `/api/me/*`,
  `/api/admin/*` and `/api/auth/me` request, so a change applies on the next request.
- **Sessions.** Stateless JWT cookies cannot be deleted, so password reset, admin
  "sign out everywhere", disable and deletion are enforced by revocation tables checked on every
  request. `SESSION_DRIVER=database` additionally lets the admin API list and revoke individual
  sessions.
- **Registration.** Open by default; `ALLOW_REGISTRATION=false` closes password sign-up and
  SSO account creation. Existing accounts still sign in.

## 3. Public entry (host/admin action — do not automate)

Point **NPM `proxy_host id=28`** (`zekra.dev`, currently a Cognee placeholder) at
`Forward Hostname/IP = cabrain`, `Forward Port = 8080` (HTTP-only, scheme `http`, matching the
existing chain — the NPM container is on `stack_stacknet`, so it resolves the `cabrain`
container by name). This is a Nginx Proxy Manager admin change; make it in the NPM UI/API — it
is intentionally left manual here.

## 4. Verify

```bash
curl -s http://cabrain:8080/api/brain/ping            # {"plugin":"brain","status":"ok"}
curl -s http://cabrain:8080/api/brain/stats           # {"ready":true, ...}
curl -s -XPOST http://cabrain:8080/api/brain/retain \
  -H 'content-type: application/json' \
  -d '{"namespace":"demo","content":"first memory","sourceKind":"manual"}'   # → {"id":…,"decision":"add"}
```

On-stacknet the `retain` embed call reaches `tei-embed` and succeeds — the same request that
fails with `lookup tei-embed: no such host` from the workspace.

## Custom share domains (presentations)

A brain owner can link their own domain or subdomain (`deck.acme.com`) so share links read
`https://deck.acme.com/{locale}/p/{token}`. The app side is done; this section is what has to
exist OUTSIDE the app for such a host to reach it. **Nothing here is created yet.**

**How it works.** The owner adds the host in the console (or `presentation_domain_add`) and
publishes two DNS records: `TXT _zekra-verify.<host> = zekra-verify=…` (ownership) and
`CNAME <host> → domains.zekra.dev` (routing). "Verify" checks both
(`POST /api/presentations/domains/{id}/verify`). On a custom host the web app (`web/proxy.ts`)
serves ONLY `/{locale}/p/…` plus `/_next`, `/icons`, `/favicon.*`: no console, login, site or
`/api`. The viewer passes the visitor's host to the API, which opens a token on a custom host
only when the token's brain owns that verified host (404 otherwise).

**Env.**

| Var | Default | Where | Meaning |
|---|---|---|---|
| `PRESENTATIONS_DOMAIN_TARGET` | `domains.zekra.dev` | API | the CNAME target shown to owners and checked by verify |
| `PRESENTATIONS_SHARE_BASE` / `AUTH_PUBLIC_URL` | `https://app.zekra.dev` | API | the built-in share origin (unchanged) |
| `PRESENTATIONS_BUILTIN_HOSTS` | empty | API | extra hosts (comma list) that open any token, for a console on a non-`zekra.dev` name |
| `ZEKRA_APP_HOSTS` | empty | web | extra console hosts (comma list); any host not ours is treated as a custom share host |

**Schema.** `schema.sql` adds table `presentation_domains` and column
`presentation_shares.domain_id`. After applying it as the superuser:
`ALTER TABLE public.presentation_domains OWNER TO cabrain;`

**Routing.** `domains.zekra.dev` must end at the same NPM origin as `app.zekra.dev`, and NPM must
forward unknown hosts to the **web** (Next.js) upstream, never to the API. NPM only routes names it
knows, so add one catch-all, once, in NPM's `/data/nginx/custom/http.conf` (regex names win over
NPM's default site; `zekra.dev` names keep their own proxy hosts):

```nginx
server {
  listen 80;
  server_name ~^(?!(.+\.)?zekra\.dev$).+$;
  location / {
    proxy_pass http://<web-upstream>:3000;          # the same upstream app.zekra.dev uses
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;         # overwrite, never pass the client's
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

**TLS: three options.**

| | How | Per-domain work | Notes |
|---|---|---|---|
| (a) **Cloudflare for SaaS** custom hostnames on the `zekra.dev` zone | Cloudflare issues and renews the cert and proxies to the fallback origin | one Custom Hostname per domain (dashboard or API) | origin IP stays hidden; WAF/DDoS as for `app.zekra.dev`; 100 hostnames free, then per-hostname billing. Required anyway if `domains.zekra.dev` is orange-clouded: a customer CNAME to a proxied name on another account fails (error 1014) without it |
| (b) NPM proxy host per domain + Let's Encrypt | NPM's HTTP-01 | a proxy host per domain, by hand | no new infra, but `domains.zekra.dev` must be DNS-only (exposes the origin IP), and every domain is manual |
| (c) Caddy on-demand TLS | Caddy asks `GET /api/presentations/domains/check?domain=<host>` (200 = verified, 404 = refuse) before issuing | none | fully automatic, but Caddy must own :443 on a public IP; NPM already owns it on this host, so it needs a second IP/VM or replacing NPM at the edge, and exposes the origin IP |

**Recommendation: (a) Cloudflare for SaaS**, given `zekra.dev` is already served through
Cloudflare → NPM. Infra to create, in order (host/admin action, do not automate):

1. Cloudflare DNS, zone `zekra.dev`: `domains` record, **proxied**, pointing where `app` points.
2. Cloudflare → SSL/TLS → Custom Hostnames: enable Cloudflare for SaaS; **Fallback Origin** =
   `domains.zekra.dev`; wait for "Active".
3. NPM: the catch-all `server` block above (one time). With Cloudflare terminating TLS, it stays on
   port 80 exactly like the existing chain; if the zone's SSL mode is Full (strict), listen on 443
   with the existing origin certificate instead.
4. Per customer domain, after the owner's "Verify" passes: add a **Custom Hostname** (`<host>`,
   certificate validation = HTTP, TLS 1.2+). It validates by itself through the owner's CNAME;
   "Active" within minutes. Delete it when the owner removes the domain.
5. Check: `curl -sI https://<host>/` → 404 (no console), `https://<host>/en/p/<token>` → 200,
   and a token of ANOTHER brain on that host → the "link not available" page.

Step 4 is manual today. The follow-up is for verify/delete to call
`POST|DELETE /zones/{zone}/custom_hostnames` (needs `CLOUDFLARE_API_TOKEN` with SSL and
Certificates:Edit + `CLOUDFLARE_ZONE_ID`); not built. If Cloudflare is ever dropped, switch to (c):
the `check` endpoint is already there as Caddy's `ask` URL:

```caddyfile
{
  on_demand_tls {
    ask http://cabrain:8080/api/presentations/domains/check
  }
}
https:// {
  tls { on_demand }
  reverse_proxy <web-upstream>:3000
}
```

## Mobile push notifications (FCM, MH-373)

The brain plugin sends push notifications to the mobile app through FCM HTTP v1: when
a brain is shared with a user, and the first time a customer opens a presentation link.
Devices register through `POST /api/me/device_tokens`; tokens FCM reports dead are pruned.
With no credentials set, push is a no-op and says so once in the log.

| Env | Example | Notes |
|---|---|---|
| `FCM_SERVICE_ACCOUNT_JSON` | raw JSON or base64 | Firebase service-account key (Project settings → Service accounts) |
| `GOOGLE_APPLICATION_CREDENTIALS` | `/run/secrets/fcm.json` | path alternative, used only when the var above is unset |
| `FCM_PROJECT_ID` | `zekra-mobile` | optional; defaults to the key's `project_id` |
| `FCM_DRY_RUN` | `1` | optional; FCM validates but delivers nothing |

The `device_tokens` and `push_once` tables are in the brain plugin's `schema.sql` — run
`zekractl migrate` after deploying. App-side setup: `docs/mobile-release.md`.

## Redis L1 working-memory cache (SPEC §2.1, D4)

Recall does **cache-aside over the kernel `Cache`** (driver-agnostic), keyed by a
per-namespace epoch that every retain bumps (instant, scan-free invalidation).
Postgres stays authoritative — the cache only skips a repeat embed+query.

- **Today (no config):** `CACHE_DRIVER=memory` → an in-process L1 (still skips repeated
  identical recalls). Zero extra infra.
- **Shared Redis L1:** install the redis cache driver and switch config — the brain code
  is unchanged:
  ```bash
  togo install togo-framework/cache-redis     # registers the "redis" cache driver
  # .env:
  CACHE_DRIVER=redis
  REDIS_URL=redis://<redis-host>:6379/0        # or the cache plugin's REDIS_* keys
  BRAIN_RECALL_CACHE_TTL=30                     # seconds; 0 disables recall caching
  ```
- **Stack reality (checked 2026-07-16):** Redis is **not** in the `stack_stacknet`
  compose (services: pg, tei-embed, tei-rerank, minio, cognee, ollama) and `:6379` was not
  usably reachable from the workspace (TCP connects, peer closes with no reply). So the
  Redis L1 stays optional until Redis is attached to `stack_stacknet`; the in-process L1 is
  the default and needs nothing.

## MCP tools (SPEC §5.1)

`cmd/zekra-mcp` is a stdio MCP server exposing the six memory tools
(`memory_retain`, `memory_recall`, `memory_recall_archive`, `memory_get`,
`memory_forget`, `memory_share`) — a thin adapter over the brain REST surface, so
scoping/validation stay server-side. Verified end-to-end against the live DB:
share/get/forget execute; retain/recall reach the TEI boundary and return a clean
`unavailable`. Wire it for an agent:

```bash
go install ./cmd/zekra-mcp     # → $GOBIN/zekra-mcp on PATH
```
```jsonc
// .mcp.json (or Claude Code MCP config)
{"mcpServers":{"zekra":{"command":"zekra-mcp",
  "env":{"ZEKRA_API_URL":"http://localhost:8080","ZEKRA_AGENT_ID":"claude-code"}}}}
```
`ZEKRA_AGENT_ID` is the session identity used for grant checks (F5); empty = the
trusted/no-enforcement context (namespace scoping still isolates data).

## Infra re-check (2026-07-17)

Three infra-gated items were re-verified against the live stack from the workspace. All
three are **still blocked on a human/superuser/host action** — none is a code change:

- **BM25 tokenizer (A):** `cabrain_ml` still does not exist (`tokenizer_catalog.tokenizer`
  → `{cabrain_bm25_tok, multilang}`, both wrapping the fixed-vocab `cabrain_bm25_model`).
  Creating it as role `cabrain` still fails `permission denied for table tokenizer
  (SQLSTATE 42501)`. **Remaining:** a superuser runs `infra/grant-bm25.sql` §3, then set
  `BRAIN_BM25_TOKENIZER=cabrain_ml`. App stays on the default tokenizer until then.
- **Cognee graph (B):** `POST cognee:8000/api/v1/add` still returns **HTTP 500
  `{"error":"Internal server error","detail":"Missing required pgvector credentials."}`** —
  Cognee's own vector store is still unconfigured, so cognify ingests nothing. The `flowos`
  dataset is only an empty metadata record (`GET …/data` → `[]`, `…/graph` → 500), and
  `entities`/`memory_entities` are both `count = 0`. `zekractl mirror` was therefore **not**
  run (nothing to mirror). **Remaining:** configure Cognee's pgvector credentials on the
  Cognee container (host/admin); then re-add + cognify, then `zekractl mirror flowos`.
- **Container deploy (C):** Docker daemon still absent in the workspace — `docker info`
  fails `dial unix /var/run/docker.sock: connect: no such file or directory` (socket not
  present). `docker build`/`run` cannot execute here. **Remaining:** build + run on the
  stack host per §2, and the NPM `proxy_host id=28` change per §3.

## Already done / follow-ups

- **Done:** schema migrated to `cabrain` (memories+default partition, entities, memory_entities,
  memory_events, namespace_grants); vector HNSW index; read-API + retain/recall + brain-tei wired;
  **BM25 fusion (hybrid recall) code-complete** — `content_bm25` column + `memories_bm25` index +
  `cabrain_ml` tokenizer, fused with the vector path via RRF in `recallSQL`, with a transparent
  vector-only fallback (`recallVecSQL`) when the BM25 layer is absent. Verified against the live DB
  with `zekractl` (schema applies; BM25 objects create + rank once granted). L1 recall cache wired +
  unit-tested.
- **Infra TODO (superuser) — BM25:** the `cabrain` app role lacks `USAGE` on `bm25_catalog` /
  `tokenizer_catalog` (the infra §5.2 BM25 test ran as superuser). Run **`infra/grant-bm25.sql`**
  as a superuser on the `cabrain` DB, then `zekractl bm25 && zekractl bm25-test`. Until then recall
  runs vector-only (no lexical fusion) — non-fatal, `ErrBM25Skipped`.
- **Infra TODO (superuser) — partman:** grant `cabrain` on `part_config`/`part_config_sub` so
  pg_partman monthly rollover (Phase 2 tiering) can replace the manual DEFAULT partition.
- **Ops CLI:** `cmd/zekractl` (`inspect` | `migrate` | `bm25` | `bm25-test`) — connects with
  `DATABASE_URL` (pgx); use it on-stack to apply/verify the BM25 layer.
- **Cognify engine:** `plugins/brain-cognee` publishes the `Engine` — on retain the brain calls
  Cognee (`POST /api/v1/add` → `POST /api/v1/cognify`, run-in-background) off the hot path to build
  the entity graph. Boots active from `COGNEE_API_URL`. **Auth is deployment-specific:** the token
  is sent as `Authorization: Bearer` by default; override with `COGNEE_AUTH_HEADER` /
  `COGNEE_AUTH_PREFIX` (the workspace probe returned 401, so confirm the scheme on-stack).
  Entity-graph *mirroring* into Zekra's `entities`/`memory_entities` (so Graph Explorer + 1-hop
  read from Postgres) is the next step — the client exposes `Search` + `DatasetGraphURL` for it.
- **Next (app):** mirror Cognee's graph into `entities`/`memory_entities`; the retain
  ADD/UPDATE/INVALIDATE/NOOP write-decision (§4.1, needs the extraction LLM); cold-tier demotion
  (Phase 2) to light up `memory_recall_archive`.
