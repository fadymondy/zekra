# Deploying Zekra

This page covers running Zekra in production. For a first install, start with
[docs/self-hosting.md](docs/self-hosting.md) or the Docker Compose stack in the
[README](README.md#self-host-with-docker-compose).

## Components

```
reverse proxy (TLS)
  ├─ app.example.com  ─► console (Next.js, web/Dockerfile, :3020)
  │                       proxies /api, /graphql, /events, /install.sh, /upgrade.sh and the
  │                       SSO paths to the API (API_ORIGIN, baked in at build time)
  └─ mcp.example.com  ─► API (Go, Dockerfile, :8080); rewrite "/" to /api/mcp (optional)

API ─► Postgres 17 with vchord, vchord_bm25, pg_tokenizer and pg_partman
    ─► TEI embeddings (1024-dimension model, e.g. Qwen/Qwen3-Embedding-0.6B)
    ─► TEI reranker (optional, e.g. BAAI/bge-reranker-v2-m3)
    ─► Redis (optional L1 cache), Cognee (optional graph engine), an LLM for chat (optional)
```

The console and API are two images built from this repository: `Dockerfile` (API) and
`web/Dockerfile` (console, build context = the repo root). Any container platform works.
Put both behind one TLS-terminating proxy; the console serves the API under its own origin.

After a deploy, check `/api/health` (200), `/en/login` (200) and `/install.sh` (200) on the
console origin, and look for boot errors in the API log.

## The rule that matters: schema before binary

**The API does not migrate its database at boot.** A binary that reads a new column
will fail every query that touches it until the schema exists. So before deploying a
change that touches `plugins/brain/internal/brain/schema.sql`:

1. Diff `schema.sql` against the commit that is live.
2. Take a backup (`pg_dump -Fc`).
3. Apply the delta (`zekractl migrate` is idempotent, or apply the diff with
   `psql -v ON_ERROR_STOP=1 -1`).
4. Only then deploy the new binary.

If the application role does not own every table (for example, some were created by
`postgres`), apply changes to those tables as their owner.

## Configuration

Every setting is documented in [`.env.example`](.env.example) and
[docs/self-hosting.md](docs/self-hosting.md#2-configure). Keep the API's environment in your
platform's secret store; never commit it. It holds `DATABASE_URL`, `AUTH_SECRET`,
`ZEKRA_SECRETS_KEY`, `MFA_CHALLENGE_SECRET`, the TEI URLs, OAuth client ids/secrets
(`OAUTH_GOOGLE_*`, `OAUTH_GITHUB_*`; callbacks under `<AUTH_PUBLIC_URL>/api/auth/*/callback`),
mail and the LLM endpoints.

`MFA_CHALLENGE_SECRET` (at least 32 bytes) is required in production. Without it every
API boot logs `MFA_CHALLENGE_SECRET is required in production`.

The console bakes `NEXT_PUBLIC_*` at build time and reads `API_ORIGIN` for its rewrites.

Tunables worth knowing:

| Var | Default | Why |
|---|---|---|
| `BRAIN_BM25_TOKENIZER` | `zekra_ml` | llmlingua2 multilingual tokenizer in `tokenizer_catalog`. |
| `BRAIN_RERANK_TIMEOUT` | `4s` | The CPU reranker costs ~2–4s per document; past this budget recall and search keep the hybrid (RRF) order instead of timing out. The API learns the per-document cost and only sends what fits (re-probed in the background every 10 min). `0` disables reranking. |
| `BRAIN_HNSW_EF_SEARCH` | `200` | Candidate list for the vector index; lower values drop results because most rows are superseded. |
| `BRAIN_SEARCH_CONCURRENCY` | `6` | Brains queried at once by cross-brain search (`/api/brain/search`). |
| `BRAIN_SEARCH_BRAIN_TIMEOUT` | `5s` | Per-brain limit in cross-brain search; a brain past it is left out (`partial: true`, `skipped: [...]`) instead of failing the request. |

## Known issues

- The reranker is the recall bottleneck on CPU: `bge-reranker-v2-m3` costs about 4s per
  document even with 24 cores. The API learns the per-document cost and only reranks what
  fits in `BRAIN_RERANK_TIMEOUT`. `mmarco-mMiniLMv2-L12-H384-v1` is ~31× faster and agrees
  with it for English but not for Arabic queries. A GPU removes the problem.
- The API's startup readiness probe checks `DATABASE_URL` only and stops at once on an
  authentication error.

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

## Mobile push notifications (FCM)

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
