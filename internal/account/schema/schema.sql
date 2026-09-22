-- Zekra accounts: the tables behind email verification, password reset, emailed
-- sign-in codes, two-factor, connected accounts (Google / Apple / GitHub), the
-- account area, self-service deletion, data export and admin user management.
--
-- Ported from fadymondy.com-v2 (db/account_codes, account_2fa, account_deletions,
-- account_exports, auth_identities .postgres.sql). Postgres dialect.
--
-- Every statement is idempotent (IF NOT EXISTS) and purely additive: nothing here
-- alters the togo auth plugin's own `users` table. Applied on every boot by
-- internal/account (best effort), and by `go run ./cmd/migrate` / `zekractl migrate`.
--
-- Tables are UNQUALIFIED on purpose: the app runs with
-- search_path=zekra_auth,public, so they land in zekra_auth next to `users`
-- (see DEPLOY.md). No foreign keys to users: this file may run before the auth
-- plugin has created that table on a fresh database.

-- A 6-digit code mailed to an address, stored as a bcrypt hash. One live code per
-- address and purpose (verify | reset | login); a new request replaces it. Five
-- wrong tries kill it.
CREATE TABLE IF NOT EXISTS account_codes (
    email       TEXT        NOT NULL,
    purpose     TEXT        NOT NULL,
    code_hash   TEXT        NOT NULL,
    attempts    INTEGER     NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ NOT NULL,
    sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (email, purpose)
);

-- Password accounts that have not proved their address yet. Accounts created
-- before this table existed, and SSO sign-ups, have no row: they count as verified.
CREATE TABLE IF NOT EXISTS account_unverified (
    user_id     TEXT        PRIMARY KEY,
    email       TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_unverified_email ON account_unverified (lower(email));

-- Sessions issued at or before revoked_at are refused (password reset, admin
-- "sign out everywhere", disable). Stateless JWTs cannot be deleted, so this row
-- is the revocation list.
CREATE TABLE IF NOT EXISTS account_password_resets (
    user_id     TEXT        PRIMARY KEY,
    reset_at    TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS account_session_revocations (
    user_id     TEXT        PRIMARY KEY,
    revoked_at  TIMESTAMPTZ NOT NULL
);

-- Accounts an admin has disabled. Their sessions are refused and they cannot sign in.
CREATE TABLE IF NOT EXISTS account_disabled (
    user_id     TEXT        PRIMARY KEY,
    reason      TEXT        NOT NULL DEFAULT '',
    disabled_by TEXT        NOT NULL DEFAULT '',
    disabled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Authenticator-app secret, sealed (AES-256-GCM). enabled stays false until the
-- first code is confirmed. last_step blocks replaying a code.
CREATE TABLE IF NOT EXISTS account_totp (
    user_id        TEXT        PRIMARY KEY,
    secret_sealed  TEXT        NOT NULL,
    enabled        BOOLEAN     NOT NULL DEFAULT FALSE,
    last_step      BIGINT      NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    enabled_at     TIMESTAMPTZ
);

-- One-time recovery codes, SHA-256 hashed (random, so a slow hash adds nothing).
CREATE TABLE IF NOT EXISTS account_recovery_codes (
    user_id    TEXT        NOT NULL,
    code_hash  TEXT        NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, code_hash)
);

-- A sign-in that passed its first factor and waits for the second.
CREATE TABLE IF NOT EXISTS account_challenges (
    id          TEXT        PRIMARY KEY,
    user_id     TEXT        NOT NULL,
    attempts    INTEGER     NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_challenges_expires ON account_challenges (expires_at);

-- Connected accounts. subject is the provider's stable id; never returned by the API.
CREATE TABLE IF NOT EXISTS auth_identities (
    id           TEXT        PRIMARY KEY DEFAULT (gen_random_uuid())::text,
    user_id      TEXT        NOT NULL,
    provider     TEXT        NOT NULL CHECK (provider IN ('google', 'apple', 'github')),
    subject      TEXT        NOT NULL,
    email        TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_identities_provider_subject_key ON auth_identities (provider, subject);
CREATE UNIQUE INDEX IF NOT EXISTS auth_identities_user_provider_key ON auth_identities (user_id, provider);

-- The account area: display name, avatar, timezone.
CREATE TABLE IF NOT EXISTS account_profiles (
    user_id     TEXT        PRIMARY KEY,
    name        TEXT        NOT NULL DEFAULT '',
    avatar      TEXT        NOT NULL DEFAULT '',
    timezone    TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notification preferences: a flat object of booleans (the console's contract).
CREATE TABLE IF NOT EXISTS account_prefs (
    user_id          TEXT        PRIMARY KEY,
    security_alerts  BOOLEAN     NOT NULL DEFAULT TRUE,
    product_updates  BOOLEAN     NOT NULL DEFAULT FALSE,
    weekly_digest    BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Self-service deletion: scheduled -> (cancelled | purging -> purged).
CREATE TABLE IF NOT EXISTS account_deletions (
    id            TEXT        PRIMARY KEY DEFAULT (gen_random_uuid())::text,
    user_id       TEXT        NOT NULL,
    email         TEXT        NOT NULL DEFAULT '',
    status        TEXT        NOT NULL DEFAULT 'scheduled',
    testimonials  TEXT        NOT NULL DEFAULT 'anonymise',
    request_id    TEXT        NOT NULL DEFAULT '',
    scheduled_for TIMESTAMPTZ NOT NULL,
    revoked_at    TIMESTAMPTZ NOT NULL,
    cancelled_at  TIMESTAMPTZ,
    purged_at     TIMESTAMPTZ,
    summary       TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_deletions_user_idx ON account_deletions (user_id, revoked_at DESC);
CREATE INDEX IF NOT EXISTS account_deletions_status_idx ON account_deletions (status, scheduled_for);

-- Download my data. The zip lives in payload only until downloaded or expired.
CREATE TABLE IF NOT EXISTS account_exports (
    id            TEXT        PRIMARY KEY,
    user_id       TEXT        NOT NULL,
    status        TEXT        NOT NULL,
    locale        TEXT        NOT NULL DEFAULT 'en',
    payload       BYTEA,
    token_hash    TEXT,
    requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ready_at      TIMESTAMPTZ,
    expires_at    TIMESTAMPTZ,
    downloaded_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS account_exports_user ON account_exports (user_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS account_exports_token ON account_exports (token_hash) WHERE token_hash IS NOT NULL;

-- Last sign-in per account (recorded from the auth plugin's auth.login hook), for
-- the admin user list and stats.
CREATE TABLE IF NOT EXISTS account_activity (
    user_id        TEXT        PRIMARY KEY,
    last_login_at  TIMESTAMPTZ,
    login_count    BIGINT      NOT NULL DEFAULT 0
);

-- Account audit trail. Carries a SHA-256 of an erased email, never the email.
-- (Named account_audit, not audit_logs, so it cannot collide with the togo audit plugin.)
CREATE TABLE IF NOT EXISTS account_audit (
    id          TEXT        PRIMARY KEY DEFAULT (gen_random_uuid())::text,
    actor_id    TEXT        NOT NULL DEFAULT '',
    action      TEXT        NOT NULL,
    subject     TEXT        NOT NULL DEFAULT '',
    request_id  TEXT        NOT NULL DEFAULT '',
    ip          TEXT        NOT NULL DEFAULT '',
    details     TEXT        NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_audit_subject_idx ON account_audit (subject, created_at);
