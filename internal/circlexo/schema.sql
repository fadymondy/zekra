-- Zekra <-> CircleXO hub (docs/circlexo.md). Postgres only; every statement is idempotent and purely
-- additive. Applied on every boot when the integration is on, and by `go run ./cmd/migrate`.
-- Tables are UNQUALIFIED on purpose, like the account tables: they land in zekra_auth (search_path)
-- next to `users`. No foreign keys: this file may run before the auth plugin created `users` and
-- before the brain plugin created its tables.

-- A hub org and the brain that is its "tenant". primary_namespace is what the hub is told
-- (ConfirmTenant): the brain created for the org at install. status: active | inactive (the app was
-- removed; nothing is deleted).
CREATE TABLE IF NOT EXISTS circlexo_org_links (
    org_id             TEXT        PRIMARY KEY,
    org_slug           TEXT        NOT NULL DEFAULT '',
    primary_namespace  TEXT        NOT NULL,
    status             TEXT        NOT NULL DEFAULT 'active',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The people of an org, as the hub last told us (webhooks and hub sign-in). role is the hub role
-- (owner | admin | billing | member). A person can be in several orgs.
CREATE TABLE IF NOT EXISTS circlexo_org_members (
    org_id     TEXT        NOT NULL,
    user_id    TEXT        NOT NULL,
    role       TEXT        NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS circlexo_org_members_user ON circlexo_org_members (user_id);

-- Which org a brain is billed to (counted against the org's `brains` limit, and the set of brains a
-- hub token for that org may reach). A brain belongs to at most one org.
CREATE TABLE IF NOT EXISTS circlexo_org_brains (
    namespace  TEXT        PRIMARY KEY,
    org_id     TEXT        NOT NULL,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS circlexo_org_brains_org ON circlexo_org_brains (org_id);

-- Hub subject (the hub's user id) -> Zekra user. One user per subject and one subject per user.
CREATE TABLE IF NOT EXISTS circlexo_user_links (
    subject    TEXT        PRIMARY KEY,
    user_id    TEXT        NOT NULL UNIQUE,
    email      TEXT        NOT NULL DEFAULT '',
    linked_via TEXT        NOT NULL DEFAULT 'email',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Webhook ids already handled, so a redelivery is dropped by any API replica.
CREATE TABLE IF NOT EXISTS circlexo_webhook_events (
    webhook_id  TEXT        PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Zekra sessions that were born from a hub sign-in: (hub session id, user, the JWT's iat). A
-- session.revoked webhook marks them revoked, and the account guard refuses a request whose
-- session matches a revoked row. Password sessions of the same user are unaffected.
CREATE TABLE IF NOT EXISTS circlexo_sessions (
    sid        TEXT        NOT NULL,
    user_id    TEXT        NOT NULL,
    issued_at  BIGINT      NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (sid, user_id, issued_at)
);
CREATE INDEX IF NOT EXISTS circlexo_sessions_user ON circlexo_sessions (user_id, issued_at);
