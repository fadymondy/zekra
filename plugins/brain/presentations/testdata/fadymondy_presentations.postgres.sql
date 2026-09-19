-- Presentations (FM-341, data model FM-342): decks, reports and page previews personalised per customer.
--
-- Hand-written like youtube.postgres.sql: nothing here wants generated CRUD.
-- A CRUD on presentation_shares would be a second, unguarded way to list the
-- sealed share tokens, and a CRUD on presentations would skip the content
-- validation in internal/presentations (the only thing standing between a
-- model's JSON and the scene renderers).
--
--   presentations        one document; content holds {"en": {...}, "ar": {...}}
--   presentation_shares  share links: sha256(token) for lookup, the token
--                        vault-sealed so the owner can copy it again
--
-- FM-100 conventions: nothing NULL, 'epoch' for "never", 'infinity' for "no
-- expiry", every statement idempotent — deploy.sh replays every file on every
-- deploy.

CREATE TABLE IF NOT EXISTS presentations (
    id                text        PRIMARY KEY,
    kind              text        NOT NULL CHECK (kind IN ('deck', 'report', 'page')),
    title             text        NOT NULL DEFAULT '',
    customer_name     text        NOT NULL DEFAULT '',
    customer_company  text        NOT NULL DEFAULT '',
    customer_email    text        NOT NULL DEFAULT '',
    -- The language it was written in; content may hold the other one too.
    locale            text        NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar')),
    -- draft | ready | archived
    status            text        NOT NULL DEFAULT 'draft',
    -- Page previews only: minimal | bold | editorial | tech-dark
    style             text        NOT NULL DEFAULT '',
    content           jsonb       NOT NULL DEFAULT '{}'::jsonb,
    -- {"ar": {"from": "en", "provider": "...", "model": "...", "at": "..."}}
    translations      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    view_count        bigint      NOT NULL DEFAULT 0,
    download_count    bigint      NOT NULL DEFAULT 0,
    last_viewed_at    timestamptz NOT NULL DEFAULT 'epoch',
    created_by        text        NOT NULL DEFAULT '',
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS presentations_updated_idx ON presentations (updated_at DESC);
CREATE INDEX IF NOT EXISTS presentations_customer_idx ON presentations (lower(customer_company), lower(customer_name));

CREATE TABLE IF NOT EXISTS presentation_shares (
    id                text        PRIMARY KEY,
    presentation_id   text        NOT NULL REFERENCES presentations (id) ON DELETE CASCADE,
    -- sha256(token), hex. The only column a public request is matched on.
    token_hash        text        NOT NULL UNIQUE,
    -- vault:v1:… of the token, so the owner can copy the link again. '' when
    -- VAULT_KEY is not set: the link is then shown once, at creation.
    token_sealed      text        NOT NULL DEFAULT '',
    -- First 4 characters, to tell links apart in a list.
    token_hint        text        NOT NULL DEFAULT '',
    label             text        NOT NULL DEFAULT '',
    locale            text        NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar')),
    expires_at        timestamptz NOT NULL DEFAULT 'infinity',
    revoked_at        timestamptz NOT NULL DEFAULT 'epoch',
    view_count        bigint      NOT NULL DEFAULT 0,
    download_count    bigint      NOT NULL DEFAULT 0,
    last_viewed_at    timestamptz NOT NULL DEFAULT 'epoch',
    created_by        text        NOT NULL DEFAULT '',
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS presentation_shares_doc_idx ON presentation_shares (presentation_id, created_at DESC);
