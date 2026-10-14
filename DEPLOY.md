# Deploying Zekra

Production is **app.zekra.dev** (console + API), **mcp.zekra.dev** (MCP) and the API
routes under **zekra.dev**. All of it runs on LXC 109 "zekra" on the Proxmox host
`pve-3x1`, as two **Hosbah** apps. This document describes that setup as it runs today.
It was last checked against the live hosts on 2026-10-11.

## Topology

```
Cloudflare ─► Nginx Proxy Manager (LXC 100, npm.3x1.io)
                 ├─ app.zekra.dev  ─► 10.10.10.109:80 (Hosbah Caddy)
                 ├─ mcp.zekra.dev  ─► 10.10.10.109:80 (Hosbah Caddy); "/" is rewritten to /api/mcp
                 └─ zekra.dev      ─► "/" public site: 10.10.10.123 (fadymondy-web, Hosbah Caddy)
                                      /api,/events,/graphql,/install.sh,/upgrade.sh,/.well-known
                                      ─► 10.10.10.109:80 with Host: app.zekra.dev
                                      (keeps the short `zekra.dev/install.sh` working for the CLI;
                                      do not remove these locations)

LXC 109 "zekra" (10.10.10.109)
  caddy :80 (/etc/caddy/hosbah.json, managed by Hosbah; do not hand-edit)
    app.zekra.dev, zekra-console.hosbah.com ─► hosbah-zekra-console-web-*  (Next console, :3020)
    mcp.zekra.dev, zekra-api.hosbah.com     ─► hosbah-zekra-api-web-*      (Go API, :8080)
    anything else                           ─► 404 "No app is routed at this hostname."
  The console proxies /api, /graphql, /events, /install.sh, /upgrade.sh and the
  CircleXO SSO paths to the API (web/next.config.mjs rewrites, API_ORIGIN), so
  app.zekra.dev/api reaches the API through the console container.
  Containers publish on 127.0.0.1:<random port>; Hosbah rewrites Caddy on every deploy.

  docker zekra-pg    Postgres 17 + vchord / vchord_bm25 / pg_tokenizer / pg_partman
                     127.0.0.1:5432, network `zekra`, volume `zekra-pgdata`
  docker tei-embed   BAAI/bge-m3 (1024-d)              :18081
  docker tei-rerank  BAAI/bge-reranker-v2-m3 (CPU)     :18082
```

NPM points at LXC 109 port 80 by IP and lets Caddy pick the container by Host, so a
deploy (which changes container names and ports) never needs an NPM change.
The former domains `cabrain-app.fadymondy.com` (308 → app.zekra.dev, method and body
preserved for old API clients) and `cabrain.fadymondy.com` (301 → zekra.dev) are
redirect-only.

The old systemd units (`zekra.service` on :8080, `zekra-web.service` on :3020) are
retired. Neither is running (`zekra` is failed, `zekra-web` inactive) and nothing
listens on :8080. Nothing should route to `10.10.10.109:8080` or `:3020` directly.

Shell access, for the database and debugging only: `ssh root@pve-3x1`, then
`pct exec 109 -- …` / `pct push 109 <src> <dst>`.

## Deploying (Hosbah)

- Apps: `zekra-api` (`Dockerfile.api`) and `zekra-console`, both building from `main`.
- **Merging to `main` auto-deploys both** (about 2–4 minutes). The fast track can ship
  a stale console build or fail to start its build container. If that happens, run
  `deploy_app {app, track: "full"}` for the affected app.
- Env changes (`set_env`) apply on the next deploy or `restart_app`.
- Use the Hosbah dashboard, or the Hosbah MCP authorized for the team that owns these
  apps (`list_apps` must show them).
- After a deploy, check `https://app.zekra.dev/api/health` (200),
  `https://app.zekra.dev/en/login` (200) and `https://zekra.dev/install.sh` (200), and search
  the API logs (`app_logs_search`, level `error`) for boot errors.
- Rollback: `rollback_app` to the previous release, or run the previous
  `hosbah/zekra-api:<id>` image that is still on the host.
- Hosbah images carry no `vcs.revision`. To confirm a build, `docker cp <ctr>:/app/zekra`
  and look for a new symbol with `go tool nm`.

## The rule that matters: schema before binary

**The API does not migrate its database at boot.** A binary that reads a new column
will fail every query that touches it until the schema exists. So before merging a
change that touches `plugins/brain/internal/brain/schema.sql`:

1. Diff `schema.sql` against the commit that is live.
2. Take a `pg_dump -Fc` into `/root/backups/`.
3. Apply that delta as the `zekra` role
   (`pct exec 109 -- docker exec -i zekra-pg psql -U zekra -d zekra -v ON_ERROR_STOP=1 -1`).
4. Only then merge, which deploys the new binary.

Do not simply re-run the whole `schema.sql` as `zekra`: that role owns `notes` and
`brain_profiles` but not `memories`, `entities` or `secrets` (owned by `postgres`),
so it stops at the first `ALTER` on those. Changes to postgres-owned tables need
`-U postgres`.

## Configuration

The API's environment lives in the **Hosbah app env** of `zekra-api` (sealed with the
team key). It holds `DATABASE_URL`, `AUTH_SECRET`, `ZEKRA_SECRETS_KEY`,
`MFA_CHALLENGE_SECRET`, the TEI URLs, the OAuth client ids/secrets (`GOOGLE_*`,
`GITHUB_*`; callbacks under `https://app.zekra.dev/api/auth/*/callback`), mail, and the
LLM endpoints. Never commit any of it.

`MFA_CHALLENGE_SECRET` (at least 32 bytes) is required in production. Without it every
API boot logs `MFA_CHALLENGE_SECRET is required in production`. Its value is kept in
the Zekra vault, brain `zekra`, name `zekra-mfa-challenge-secret`.

The console bakes `NEXT_PUBLIC_*` at build time and reads `API_ORIGIN` for its rewrites.

`/etc/zekra/zekra.env` on LXC 109 belongs to the retired systemd unit. It is kept only
for the legacy rollback path below.

Tunables worth knowing:

| Var | Default | Why |
|---|---|---|
| `BRAIN_BM25_TOKENIZER` | `zekra_ml` | llmlingua2 multilingual tokenizer in `tokenizer_catalog`. |
| `BRAIN_RERANK_TIMEOUT` | `4s` | The CPU reranker costs ~2–4s per document; past this budget recall and search keep the hybrid (RRF) order instead of timing out. The API learns the per-document cost and only sends what fits (none on today's CPU, re-probed in the background every 10 min). `0` disables reranking. |
| `BRAIN_HNSW_EF_SEARCH` | `200` | Candidate list for the vector index; lower values drop results because most rows are superseded. |
| `BRAIN_SEARCH_CONCURRENCY` | `6` | Brains queried at once by cross-brain search (`/api/brain/search`). |
| `BRAIN_SEARCH_BRAIN_TIMEOUT` | `5s` | Per-brain limit in cross-brain search; a brain past it is left out (`partial: true`, `skipped: [...]`) instead of failing the request. |

## Legacy manual deploy (rollback reference only)

Before Hosbah (until early Oct 2026) the API and console ran as systemd units on
LXC 109. Use this only if Hosbah itself is down, and remember NPM now routes to Caddy
on :80, not to :8080/:3020.

```bash
# API: static linux binary
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o zekra-api ./cmd/api
cp -a /opt/zekra/zekra-api /opt/zekra/zekra-api.bak-$(date +%Y%m%d-%H%M%S)
install -o zekra -g zekra -m 755 zekra-api /opt/zekra/zekra-api
systemctl restart zekra          # env /etc/zekra/zekra.env; curl :8080/api/brain/mine -> 401

# Console: build INSIDE the runtime image so native modules (sharp) are linux.
# Needs the repo's docs/ beside web/ (next.config.mjs bundles them).
docker run --rm -v "$PWD:/src:ro" -v "$OUT:/out" node:24-bookworm-slim bash -c '
  mkdir /build && cd /src && tar --exclude=web/node_modules --exclude=web/.next -cf - web docs | tar -C /build -xf -
  cd /build/web && npm ci && npm run build
  mkdir -p /out/zekra-web/.next && cp -a .next/standalone/. /out/zekra-web/
  cp -a .next/static /out/zekra-web/.next/static && cp -a public assets content /out/zekra-web/'
tar --no-same-owner -xzf zekra-web.tgz -C /opt/zekra-web.new
cp -a /opt/zekra-web/.env.production /opt/zekra-web.new/
rm -rf /opt/zekra-web.prev && mv /opt/zekra-web /opt/zekra-web.prev && mv /opt/zekra-web.new /opt/zekra-web
systemctl restart zekra-web      # curl :3020/en/login -> 200
```

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
  - Apple, iOS (`native`) — `POST /api/auth/apple/token {identity_token, nonce, full_name?,
    authorization_code?}`, on only when `APPLE_BUNDLE_IDS=com.fadymondy.zekra` (the token's
    audience). The nonce is required and must SHA-256 to the token's claim. Enable the **Sign in
    with Apple** capability on the App ID `com.fadymondy.zekra` and regenerate its profiles (the
    app ships the entitlement). The iOS app uses the sheet when the server reports `apple.native`.
  - Apple, Android and any build without the sheet (`app`) — the web flow in the system browser
    (`/api/auth/apple?app=1&return=zekra://auth/apple&code_challenge=…`); Apple form-posts to the
    callback, which redirects to the app with a one-time code traded at
    `POST /api/auth/apple/exchange {code, code_verifier}`. On when the web flow is configured
    (`APPLE_SERVICES_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY[_PATH]`). Return
    scheme `APPLE_APP_SCHEME` (default `zekra`).
  - Apple token revocation (App Review 5.1.1(v)) — every Apple authorization code (web/app
    callback; the iOS sheet's `authorization_code`) is traded at `appleid.apple.com/auth/token`
    with the ES256 client secret (client id = the Services ID, or the bundle id for the sheet's
    codes). The refresh token is sealed with `VAULT_KEY` in `account_apple_tokens` and revoked at
    `appleid.apple.com/auth/revoke` when Apple is disconnected and when the account is purged.
    Needs the key above (team id, key id, .p8) even for an iOS-only setup; without it sign-in
    still works and nothing is revoked.

  Apple Developer setup: App ID `com.fadymondy.zekra` with Sign in with Apple (primary App ID);
  a Services ID (e.g. `com.fadymondy.zekra.web`) grouped with it, domain `app.zekra.dev`, Return
  URL `https://app.zekra.dev/api/auth/apple/callback`; a key with Sign in with Apple enabled for
  that primary App ID (`APPLE_KEY_ID` + the .p8).
  - GitHub — the app runs the web flow in an auth session
    (`/api/auth/github?app=1&return=zekra://auth/github&code_challenge=…`), so it needs only the
    web credentials and callback URL above. The return must use `GITHUB_APP_SCHEME` (default
    `zekra`); the one-time code lives 2 minutes, works once, and is PKCE-bound to the app —
    `POST /api/auth/github/exchange {code, code_verifier}`.
  - App-flow failures come back as `zekra://auth/<provider>?error=` `cancelled`, `state`,
    `email` (GitHub), `closed`, `disabled` or `failed`.
  - Linking: accounts link by verified email on first sign-in. The app's Account → Connected
    accounts connects more (`&link=1` app flows, or the sheets) and disconnects
    (`/api/me/identities`; the last way to sign in cannot be removed).
  - Deleting an account works for every account: `POST /api/me/delete` takes the password or a
    code from `POST /api/me/delete/code` (accounts made with Google / Apple / GitHub have no
    password). Scheduling signs out everywhere, so cancelling is public:
    `POST /api/me/delete/cancel/code {email}` mails a code when a deletion is pending, then
    `POST /api/me/delete/cancel {email, code}` (or `{email, password}`). Needs mail (Resend).

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
