# Deploying Zekra

Production is **app.zekra.dev**, served from one LXC container on the Proxmox host
`pve-3x1`. This document describes that setup as it actually runs; it was rewritten
on 2026-09-23 after an earlier version turned out to describe a Docker deployment
that production does not use.

## Topology

```
Cloudflare ─► Nginx Proxy Manager (LXC 100, npm.3x1.io)
                 ├─ app.zekra.dev   ─► 10.10.10.109:3020  (console)  + /api,/events,/graphql ─► :8080
                 ├─ mcp.zekra.dev   ─► 10.10.10.109:8080/api/mcp
                 └─ zekra.dev       ─► public site (fadymondy.com-v2, 10.10.10.101:8083)
                                       + /api,/events,/graphql,/install.sh,/upgrade.sh,/.well-known ─► 10.10.10.109:8080
                                       (the same API as app.zekra.dev, so the short `zekra.dev/install.sh`
                                       keeps working for the CLI — do not remove these routes)
LXC 109 "zekra" (10.10.10.109)
  zekra.service      Go API          /opt/zekra/zekra-api        env /etc/zekra/zekra.env   :8080
  zekra-web.service  Next console    /opt/zekra-web (standalone)  docker node:24-bookworm-slim :3020
  docker zekra-pg    Postgres 17 + vchord / vchord_bm25 / pg_tokenizer / pg_partman
                     127.0.0.1:5432, network `zekra`, volume `zekra-pgdata`
  docker tei-embed   BAAI/bge-m3 (1024-d)              127.0.0.1:18081
  docker tei-rerank  BAAI/bge-reranker-v2-m3 (CPU)     127.0.0.1:18082
```

NPM routes by IP, so container renames inside LXC 109 never need an NPM change.
The former domains `cabrain-app.fadymondy.com` (308 → app.zekra.dev, method and body
preserved for old API clients) and `cabrain.fadymondy.com` (301 → zekra.dev) are
redirect-only.

Access: `ssh pve-3x1`, then `pct exec 109 -- …` / `pct push 109 <src> <dst>`.
Scripts are easier to push and run than to quote through ssh + pct.

## The rule that matters: schema before binary

**The API does not migrate its database at boot.** A binary that reads a new column
will fail every query that touches it until the schema exists. So every deploy is:

1. Diff `plugins/brain/internal/brain/schema.sql` against the last deployed commit.
2. Apply that delta as the `zekra` role (`docker exec -i zekra-pg psql -U zekra -d zekra`).
3. Only then swap the binary.

Do not simply re-run the whole `schema.sql` as `zekra`: that role owns `notes` and
`brain_profiles` but not `memories`, `entities` or `secrets` (owned by `postgres`),
so it stops at the first `ALTER` on those. Changes to postgres-owned tables need
`-U postgres`.

## Building

```bash
# API — static linux binary
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o zekra-api ./cmd/api

# Console — build INSIDE the runtime image so native modules (sharp) are linux.
# Needs the repo's docs/ beside web/ (next.config.mjs bundles them).
docker run --rm -v "$PWD:/src:ro" -v "$OUT:/out" node:24-bookworm-slim bash -c '
  mkdir /build && cd /src && tar --exclude=web/node_modules --exclude=web/.next -cf - web docs | tar -C /build -xf -
  cd /build/web && npm ci && npm run build
  mkdir -p /out/zekra-web/.next && cp -a .next/standalone/. /out/zekra-web/
  cp -a .next/static /out/zekra-web/.next/static && cp -a public assets content /out/zekra-web/'
```

The console build bakes `NEXT_PUBLIC_*` from `web/.env.production`; the server keeps
its own copy of that file, which must be carried across on deploy.

## Deploying

```bash
# API
cp -a /opt/zekra/zekra-api /opt/zekra/zekra-api.bak-$(date +%Y%m%d-%H%M%S)
install -o zekra -g zekra -m 755 zekra-api /opt/zekra/zekra-api
systemctl restart zekra          # healthy in ~2s: curl :8080/api/brain/mine -> 401

# Console
tar --no-same-owner -xzf zekra-web.tgz -C /opt/zekra-web.new
cp -a /opt/zekra-web/.env.production /opt/zekra-web.new/
rm -rf /opt/zekra-web.prev && mv /opt/zekra-web /opt/zekra-web.prev && mv /opt/zekra-web.new /opt/zekra-web
systemctl restart zekra-web      # curl :3020/en/login -> 200
```

Rollback: reinstall the newest `zekra-api.bak-*`, or swap `/opt/zekra-web.prev` back.
Take a `pg_dump -Fc` into `/root/backups/` before any schema change.

## Configuration

`/etc/zekra/zekra.env` (mode 600) holds `DATABASE_URL`, `AUTH_SECRET`,
`ZEKRA_SECRETS_KEY`, the TEI URLs, the OAuth client ids/secrets
(`GOOGLE_*`, `GITHUB_*`; callbacks under `https://app.zekra.dev/api/auth/*/callback`),
mail, and the LLM endpoints. Never commit it.

Tunables worth knowing:

| Var | Default | Why |
|---|---|---|
| `BRAIN_BM25_TOKENIZER` | `zekra_ml` | llmlingua2 multilingual tokenizer in `tokenizer_catalog`. |
| `BRAIN_RERANK_TIMEOUT` | `4s` | The CPU reranker costs ~2.2s per document; past this budget recall keeps the hybrid (RRF) order instead of timing out. `0` disables reranking. |
| `BRAIN_HNSW_EF_SEARCH` | `200` | Candidate list for the vector index; lower values drop results because most rows are superseded. |

## Known issues

- The reranker is the recall bottleneck on this hardware: `bge-reranker-v2-m3` costs
  ~4.6s per document on CPU even with 24 cores. Benchmarked alternatives are on
  MH-376; `mmarco-mMiniLMv2-L12-H384-v1` is ~31× faster and agrees with it for
  English but not for Arabic queries.
- The API's startup readiness probe checks `DATABASE_URL` only and stops at once on
  an authentication error (MH-325). It used to probe a stale `*_DATABASE_URL` alias
  and wait 90 silent seconds.

## Mobile app sign-in providers

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
