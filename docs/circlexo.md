# CircleXO hub integration

Zekra can run as an app on the CircleXO hub: hub sign-in next to Zekra's own login, hub orgs mapped
to brains, plan limits from the hub's entitlements, pay-as-you-go usage for hub-token MCP calls, and
hub-issued tokens on the MCP endpoint. **All of it is off unless `CIRCLEXO_ISSUER` is set.** With it
unset nothing changes: the routes below (except the config probe, which answers
`{"enabled":false}`) do not exist and no integration table is read.

Code: `internal/circlexo` (service, sign-in, sync, webhooks, sessions, hub token and limits),
`internal/server/circlexo.go` (wiring), `plugins/brain/hubapi` + `plugins/brain/internal/brain/hub.go`
(the seam the brain plugin uses), `internal/account/hub.go`. Tests: `internal/circlexo/circlexo_test.go`
(against the SDK's `circlexotest` hub; needs `TEST_DATABASE_URL`, skipped otherwise) and
`plugins/brain/internal/brain/hub_test.go`.

## Configuration

Names only; values live in the vault, never in the repo. See `.env.example`.

| Variable | Purpose |
| --- | --- |
| `CIRCLEXO_ISSUER` | The hub's base URL. Turns the integration on. |
| `CIRCLEXO_API_URL` | The hub's app API, when not the issuer. |
| `CIRCLEXO_APP_ID` | Zekra's app id at the hub (also the token audience). |
| `CIRCLEXO_CLIENT_ID` | OIDC client id. |
| `CIRCLEXO_CLIENT_SECRET` or `CIRCLEXO_PRIVATE_KEY` + `CIRCLEXO_KEY_ID` | Client authentication (one of the two). |
| `CIRCLEXO_APP_KEY` | App API key: entitlements, tenants, org members, usage. |
| `CIRCLEXO_WEBHOOK_SECRET` | Signing secret (`whsec_...`) for webhooks and provision/deprovision calls. Required. |
| `CIRCLEXO_SESSION_KEY` | Seals the sign-in state cookie (16+ chars). Empty: derived from `AUTH_SECRET`. |
| `CIRCLEXO_REDIRECT_URL` | Optional. Default `AUTH_PUBLIC_URL` (else `APP_URL`) + `/auth/circlexo/callback`. |

A half-set or invalid configuration is logged at error level at boot and leaves the integration
disabled; Zekra still starts and its own login is unaffected.

## Endpoints

All public; the sign-in routes are browser navigations, the rest authenticate by signature.

| Route | Purpose |
| --- | --- |
| `GET /auth/circlexo/login[?return_to=/path]` | Start the OIDC code flow with PKCE. |
| `GET /auth/circlexo/callback` | Finish sign-in and issue Zekra's normal session cookie. |
| `GET /auth/circlexo/logout` | Clear Zekra's session, then the hub's end-session. |
| `GET /sso/circlexo?org=<slug>` | The hub's launch URL (silent sign-in, lands as that org). |
| `POST /api/circlexo/events` | Signed webhooks: `org.app_installed/removed`, `member.added/role_changed/removed`, `session.revoked`, `entitlement.changed`, other `subscription.*` invalidate the cache. Redeliveries are dropped by webhook id. |
| `POST /api/circlexo/provision`, `/deprovision` | Signed, idempotent lifecycle calls. Provision answers `{product_tenant_id, slug}` (the org's primary brain). Deprovision never deletes data. |
| `GET /api/circlexo/config` | `{"enabled":bool,"login_url":...}`; the login page shows "Sign in with CircleXO" only when enabled. |

The web app proxies `/auth/circlexo/*`, `/sso/circlexo` and `/api/circlexo/*` to the API.

## Mapping rules

Zekra has no organisation or workspace: the unit of sharing is the **brain** (a namespace) and
`brain_members` says who may use it (owner, editor, viewer). So:

- **Org -> primary brain.** Install creates a brain named after the org slug (or reuses the linked
  one) and confirms it to the hub as the tenant (`ConfirmTenant`). The link is in
  `circlexo_org_links`.
- **Further brains** created by a person who belongs to exactly one active org are attributed to that
  org (`circlexo_org_brains`), so the org's `brains` limit can be counted and a hub token for the org
  can reach them. A person in no org, or in several (ambiguous), creates unattributed brains, which
  the hub neither limits nor bills.
- **Roles**, on the org's primary brain only: hub owner and admin -> brain owner, member -> editor,
  billing -> viewer. A sync never demotes or removes a brain's last owner.
- **Removal.** Removing the app marks the link inactive; removing a member removes their membership of
  the primary brain. Nothing else is deleted; the hub can undo both.

Sign-in rules, in order: a linked hub subject signs in as its user; otherwise the hub must vouch for
the e-mail (`email_verified`); an existing Zekra account with that address is linked only if it is
passwordless or its address was confirmed (nobody can pre-register someone's address with a password
and inherit their hub sign-in); otherwise a passwordless account is created. Disabled or deleted
accounts are refused. Errors return to `/login?error=circlexo_<code>` with code `failed`,
`email_unverified`, `account_conflict`, `suspended`, `no_email` or `unavailable`.

Hub sign-in deliberately ignores `ALLOW_REGISTRATION` (the hub decides who may use the app) and
Zekra's own 2FA (the hub owns second factors). Zekra's password, Google/Apple/GitHub sign-in and
2FA keep working unchanged (dual login).

## Entitlements and billing

- Feature `brains` (limit): checked before a brain is created (REST and MCP). Over the limit -> 402
  `plan_limit`; an inactive plan -> 402; plan not confirmable by the hub -> 503 (fail closed); a stale
  copy served during the hub's grace window is read-only, so no new brains.
- Meter `requests` (pay-as-you-go): one unit per hub-token MCP `tools/call`, reported synchronously
  before the tool runs, with a per-call idempotency key. A 402 from the hub (empty wallet or
  exhausted allowance) stops the call with a JSON-RPC error. **Only hub-token calls are metered**;
  Zekra's own tokens and OAuth-connected apps are not.
- `entitlement.changed` and `subscription.*` webhooks invalidate the cache.

## Hub tokens on MCP

`/api/mcp` also accepts an access token issued by the hub (verified against its JWKS, audience =
`CIRCLEXO_APP_ID`). Subject -> Zekra user (the person must have signed in with CircleXO once);
`org_id` -> the org's brains, and the person must be an org member. The token becomes the same
`Principal` an OAuth-connected app gets, so the person's current `brain_members` role is re-checked on
every call and an agent never exceeds its human. A token with `brains:write`, or one the gateway
exchanged for an agent (it carries an `act` chain), may write; any other hub token reads. Admin and
destructive tools (`brain_delete`, `memory_forget`, `secret_reveal`, ...) are never offered to hub
tokens. Refusals: unlinked, non-member, disabled -> 403; plan inactive -> 402; hub unreachable -> 503.

## Tables

Created idempotently by `go run ./cmd/migrate` and on every boot with the integration on, in the
account schema next to `users`: `circlexo_org_links`, `circlexo_org_members`, `circlexo_org_brains`,
`circlexo_user_links`, `circlexo_webhook_events`, `circlexo_sessions`. No foreign keys.

## Differences from the published manifest (`manifests/zekra/circlexo.app.yaml`)

- **Hosts.** The manifest puts every URL on `zekra.dev`; Zekra's API and session cookies are on
  `app.zekra.dev`. Either serve these routes on `zekra.dev` (proxy) or change the manifest's
  `redirect_uris`, `launch`, `post_logout_redirect_uris`, `provision`, `deprovision`, `health` and
  `webhooks.url` to `app.zekra.dev`. The OIDC redirect must be on the host that holds the session
  cookie.
- **`memory_recall_archive`** is listed in the manifest but is not a tool in this code base.
- The code exposes more tools than the manifest lists, and never offers admin/destructive tools to hub
  tokens, whatever the manifest says.
- Manifest scopes are `openid, profile, email, org, entitlements`; hub scopes say nothing about tool
  permissions, so write access comes from `brains:write` or an agent exchange (see above).

## Known limits

- Two Zekra sessions of one user minted in the same second share an `iat`; revoking one hub session
  then ends both (harmless for a sign-out).
- Zekra's session is a stateless JWT: `/auth/circlexo/logout` ends it in this browser only; a hub
  `session.revoked` ends the hub-born sessions via the account guard.
- Deleting an org's primary brain leaves the link dangling until the org is re-provisioned.
- A member the hub lists but who never signed in is added to the org's brain by e-mail only when that
  address maps to a usable account; the hub identity is linked on their first hub sign-in.

## SDK dependency

`github.com/circlexo/circlexo-go` is a public module pinned at `v0.1.0` in `go.mod` (no `replace`).

## Owner cut-over checklist

1. Register Zekra at the hub; note the app id, client credentials, app key and webhook secret.
2. Register the redirect URI (`<public origin>/auth/circlexo/callback`), the post-logout URI, the
   launch URL (`/sso/circlexo`), the webhook URL (`/api/circlexo/events`) and the
   provision/deprovision URLs, on the host that serves the API (see the manifest differences).
3. Set the `CIRCLEXO_*` variables in the environment (not the repo).
4. Run `go run ./cmd/migrate`.
5. Make sure the web app proxies `/auth/circlexo/*`, `/sso/circlexo` and `/api/circlexo/*` to the API.
6. Set `CIRCLEXO_ISSUER` last and restart: the login button appears and the routes mount. Check the
   boot log for "circlexo: hub integration enabled".
7. Install the app on a test org and confirm: a brain appears, members sync, the hub shows the tenant
   active, and limits follow the hub plan.
