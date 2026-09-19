---
title: Security
description: How Zekra authenticates agents and people, how per-brain grants work, how the secrets vault protects credentials, and which server switches enforce access.
order: 8
---

# Security

Zekra has two kinds of callers:

- **Agents and services** use **access tokens** and per-brain **grants**.
- **People** use **accounts** to sign in to the web console, with optional two-factor authentication.

## Access tokens

A token looks like `cbt_` followed by 48 hex characters. It is sent in the `X-Zekra-Token`
header. The MCP server and the CLI send it for you from `ZEKRA_TOKEN`.

Each token belongs to an **agent identity** (`agentId`) and is either:

- **Non-admin:** it can use only the brains its identity has been granted.
- **Admin:** it bypasses grants and can manage tokens and grants.

Ways to get a token:

| How | Scope |
|---|---|
| Console → brain → **Sessions** → *Launch a session* (`POST /api/brain/session`) | A new identity with read (and optionally write) on that one brain |
| Console → **Admin → Tokens**, `POST /api/brain/tokens`, `brain_create_token`, `zekra auth token new` | Any identity, admin or not. Needs an admin. |
| `zekra brain create <name> --token` | A new non-admin token with read and write on the new brain |

Revoke a token with `POST /api/brain/tokens/revoke` or from the console. A revoked token is
rejected immediately. `GET /api/brain/tokens` shows each token's `lastUsedAt`.

Keep tokens out of source control. Pass them through environment variables or your MCP
client's `env` block, and prefer one token per agent or machine so you can revoke them
individually.

## Grants

A grant links an agent identity to a brain with two flags:

| Flag | Allows |
|---|---|
| `canRead` | recall, search, get, graph queries, chat, listing secrets and data sources |
| `canWrite` | retain, edit, forget, dedup, deleting the brain, storing, revealing and deleting secrets, managing data sources |

Grants are managed by admins (`POST /api/brain/grant`, `POST /api/brain/grant/revoke`,
`brain_grant`, `brain_revoke_grant`). Anyone with write access to a brain can also share it
with another identity (`POST /api/brain/share`, `memory_share`). Sharing grants read-only
access unless `canWrite` is set.

A missing grant returns `403 permission_denied`, never an empty result, so an agent can
tell "not allowed" apart from "nothing there".

## Secrets vault

Every brain has an encrypted secrets vault.

- **Automatic capture.** When retained text contains something that looks like a
  credential, the value is moved into the vault and the memory keeps a `[secret:<name>]`
  reference instead. Raw secrets never reach the search indexes, so recall cannot leak them.
- **Explicit storage.** `secret_store` or `POST /api/brain/secrets` with a `kind` of
  `api_key`, `password`, `env`, `token`, `private_key`, `connection_string` or `generic`.
- **Reading.** Anyone with read access can list names and masked hints. **Revealing** a
  value requires write access on the brain.
- **Encryption.** AES-256-GCM. On self-hosted instances the key comes from
  `ZEKRA_SECRETS_KEY` (64 hex characters) or is derived from `AUTH_SECRET`. If neither is
  set, storing a secret fails; the vault never stores plaintext.

## Webhook ingest

`POST /api/brain/ingest/{id}` does not use tokens. It is authenticated only by the
`X-Webhook-Secret` header, which must match the secret configured on that webhook data
source. Anyone who has the secret can add content to that brain, so treat it like a token.
See [Data sources](./data-sources.md#webhook).

## Accounts

People sign in to the console at app.zekra.dev with:

- **Email and password.** New accounts confirm their email with a code.
- **Emailed sign-in code.** Passwordless; it also verifies the address.
- **Google, GitHub or Apple**, where enabled. You can link and unlink providers under **Account → Connections**.

### Two-factor authentication

Under **Account → Security** you can turn on an authenticator app (TOTP). Enrolling shows a
QR code. Confirming it turns 2FA on and shows **ten recovery codes once**; store them
safely. After that, every sign-in method asks for a code from the app or a recovery code.
You can generate new recovery codes or turn 2FA off from the same page.

### Sessions, export and deletion

- Resetting your password, being disabled by an admin, or deleting your account signs you
  out everywhere.
- **Account → Export** emails you a link to a copy of your data. The link can be downloaded once.
- **Account → Delete** schedules deletion after a 14-day grace period. You can cancel it
  during that time.

## Enforcement switches

These server settings matter if you [self-host](./self-hosting.md):

| Variable | Effect |
|---|---|
| `ZEKRA_REQUIRE_AUTH=1` | Every `/api/brain/*` endpoint except `ping` and webhook ingest requires a signed-in session or a valid token. Without it, the API is open to anyone who can reach it. |
| `ZEKRA_REQUIRE_TOKEN=1` | Requests without a token are no longer treated as the trusted console. Without it, a tokenless request has **admin rights on every brain**. |
| `ALLOW_REGISTRATION=false` | Closes password sign-up and new SSO accounts. Existing accounts can still sign in. |
| `ADMIN_EMAILS` | Accounts that get the console `admin` role |

Any instance reachable from the internet should set `ZEKRA_REQUIRE_AUTH=1` and give every
agent its own token.
