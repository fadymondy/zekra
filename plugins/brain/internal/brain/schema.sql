-- Zekra data model — SPEC §3
-- Serialise concurrent applications of this file.
--
-- These statements take catalogue locks; two sessions running them at once take
-- those locks in different orders and Postgres kills one with 40P01 (deadlock
-- detected). That is not hypothetical - go test runs packages in parallel and
-- more than one applies this schema, and two app instances booting together do
-- the same.
--
-- The lock lives HERE, not only in brain.Migrate, because not every applier goes
-- through that function: plugins/brain/presentations reads this file and execs it
-- directly (it cannot import internal/brain - that would be an import cycle).
-- Putting it in the file means every applier is covered, including future ones.
--
-- _xact_ rather than a session lock: a multi-statement Exec runs as one implicit
-- transaction, so this releases when the batch ends without needing an unlock.
SELECT pg_advisory_xact_lock(524308299873);

-- =====================================================================================
-- Source of truth for the schema. Once ToGO is wired, `togo make:plugin cabrain` +
-- sqlc/Atlas will own the generated migrations; this file is what they reconcile
-- against, AND it is the direct-on-Postgres fallback (SPEC §8) if Cognee is dropped.
--
-- Deviations from the *literal* SPEC §3 DDL, and WHY (the spec DDL does not run as-is):
--   [D1] `memories` is PARTITION BY RANGE (valid_at). Postgres requires every UNIQUE/PK
--        constraint on a partitioned table to include the partition key. So the primary
--        key is (id, valid_at), not (id). `id` alone stays UNIQUE-per-partition in
--        practice (gen_random_uuid), and app code keys on `id`.
--   [D2] Because the PK is composite, single-column foreign keys that reference
--        memories(id) are illegal. `superseded_by`, `memory_entities.memory_id`, and
--        `memory_events.memory_id` are therefore plain uuid columns (soft references),
--        enforced in application logic, not by the DB. This is normal for partitioned
--        fact tables and does not weaken scoping (which is on namespace, not FKs).
--   [V1] The BM25 index + multilingual tokenizer syntax is vchord_bm25/pg_tokenizer
--        VERSION-SENSITIVE. The block below is the intended shape; verify the exact
--        API against the installed extensions before first migrate (see NOTE V1).
--   [V2] partman.create_parent signature changed in pg_partman v5. The v5 call is used;
--        the v4 positional form is left commented (see NOTE V2).
-- =====================================================================================

-- ── 3.1 Extensions & roles ───────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vchord        CASCADE;  -- vector index (off-box build, N3)
CREATE EXTENSION IF NOT EXISTS vchord_bm25   CASCADE;  -- BM25 long-text
CREATE EXTENSION IF NOT EXISTS pg_tokenizer  CASCADE;  -- multilingual tokenizer (Arabic, N4)
CREATE EXTENSION IF NOT EXISTS pg_partman    CASCADE;  -- time partitioning

-- Consolidation / sleep plane runs as its own login role so it never shares a
-- connection pool with the latency-critical recall path (N1). Infra already created
-- this role on the live DB; keep IF NOT EXISTS so the migration is idempotent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cabrain_sleep') THEN
    CREATE ROLE cabrain_sleep LOGIN;
  END IF;
END $$;
-- pg_duckdb, if/when added for telemetry, is enabled per-role here — never globally.

-- ── 3.2 Core table: memories ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memories (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),

  -- scoping (F5): every read/write is filtered by these
  namespace        text        NOT NULL,                    -- 'sentra' | 'freshup' | 'orchestra' | ...
  owner_agent_id   text,                                    -- which agent/persona wrote it
  visibility       text        NOT NULL DEFAULT 'private',  -- private | team | global

  -- brain-map classification
  network          text        NOT NULL,                    -- fact | experience | observation | belief
  memory_type      text        NOT NULL DEFAULT 'episodic', -- episodic | semantic | procedural | working
  content          text        NOT NULL,                    -- raw or distilled text
  source_kind      text,                                    -- claude_code | coder_run | whatsapp | slack | chat | manual
  source_ref       text,                                    -- session/thread/run id (provenance)

  -- retrieval
  embedding        vector(1024),                            -- BAAI/bge-m3, 1024-dim, multilingual (locked by infra; TEI 1.6)

  -- amygdala (salience)
  importance       real        NOT NULL DEFAULT 0.5,        -- [0,1]; gates consolidation + decay
  access_count     int         NOT NULL DEFAULT 0,
  last_accessed_at timestamptz,

  -- temporal / reconsolidation (never hard-delete)
  valid_at         timestamptz NOT NULL DEFAULT now(),
  invalid_at       timestamptz,                             -- set on reconsolidation; row stays queryable
  superseded_by    uuid,                                    -- [D2] soft ref to the replacement memory's id

  -- tiering
  tier             text        NOT NULL DEFAULT 'hot',      -- hot | cold (demoted to Iceberg)

  metadata         jsonb       NOT NULL DEFAULT '{}',

  -- [D1] partition key MUST be in the PK
  PRIMARY KEY (id, valid_at),

  CONSTRAINT memories_visibility_chk  CHECK (visibility  IN ('private','team','global')),
  CONSTRAINT memories_tier_chk        CHECK (tier        IN ('hot','cold')),
  CONSTRAINT memories_network_chk     CHECK (network     IN ('fact','experience','observation','belief')),
  CONSTRAINT memories_memtype_chk     CHECK (memory_type IN ('episodic','semantic','procedural','working')),
  CONSTRAINT memories_importance_chk  CHECK (importance >= 0.0 AND importance <= 1.0)
) PARTITION BY RANGE (valid_at);

-- [V2] Partitioning. The table stays PARTITION BY RANGE (valid_at); a DEFAULT
-- partition catches all rows so writes work immediately with no partman dependency.
CREATE TABLE IF NOT EXISTS memories_default PARTITION OF memories DEFAULT;
--
-- pg_partman 5.4.3 monthly rollover + retention (the cold-tier demotion unit, Phase 2)
-- is added later — it needs the `cabrain` role granted on partman's config tables
-- (part_config / part_config_sub), which only a superuser/the partman installer can do
-- (INFRA TODO). Then, to split the default into monthly partitions:
--   SELECT public.create_parent(p_parent_table => 'public.memories',
--     p_control => 'valid_at', p_interval => '1 month', p_type => 'range');

-- Hybrid retrieval indexes (created on the partitioned parent → propagate to partitions).
--
-- Dense vector: pgvector HNSW is the working default. For the SPEC's off-box index build
-- + horizontal scale (N3), swap to VectorChord's vchordrq index once the hot set is large:
--   CREATE INDEX memories_vec ON memories USING vchordrq (embedding vector_cosine_ops);
--
-- PARTIAL, on the live rows only — this is load-bearing, not an optimization.
-- Every ANN query in the brain (recall, cross-brain search, and topNeighbor on the
-- retain/write-decision path) filters `invalid_at IS NULL AND tier='hot'`. A FULL
-- index over every row is post-filtered AFTER the ANN scan, so once most rows are
-- superseded the candidate list is gutted before the query ever sees it: on the live
-- brain (85% superseded) a full index returned 12 of 40 requested rows at the default
-- ef_search — and ZERO for some query vectors, which silently made memories that
-- demonstrably existed unrecallable. Restricting the index to live rows removes the
-- post-filter entirely: VERIFIED 40/40 rows at the default ef_search=40, at lower
-- planner cost, and the index is ~60% smaller.
--
-- Keep the predicate in sync with the queries in schema.go/search.go/store.go — if it
-- ever stops matching theirs, the planner silently falls back to a seq scan.
CREATE INDEX IF NOT EXISTS memories_vec_live
  ON memories USING hnsw (embedding vector_cosine_ops)
  WHERE invalid_at IS NULL AND tier = 'hot';

-- Retire the old full-table index. It is strictly redundant (no ANN query omits the
-- predicate above) AND actively harmful: while it exists the planner keeps choosing it
-- over the partial one, reintroducing the post-filter starvation. Dropped only AFTER
-- the partial index above exists, so there is never a window without a vector index.
DROP INDEX IF EXISTS memories_vec;

-- Domain-type filter index. RecallQuery.Types filters on metadata->>'type' (the
-- DOMAIN type: post/venture/issue/...), which had no index at all — while the two
-- dedicated typed columns, memory_type and network, carried a single hardcoded
-- value each and indexed nothing useful. Agents use this filter to cut noisy
-- ingest streams out of the candidate pool, so it belongs on the hot path.
-- The expression must match buildFilteredRecallSQL's predicate EXACTLY. Indexing a
-- bare metadata->>'type' leaves the planner using only the namespace column and
-- re-checking the type as a Filter; with the COALESCE/NULLIF wrapper included it
-- becomes a real Index Cond (measured: cost 5999 -> ~200 on the flowos brain).
CREATE INDEX IF NOT EXISTS memories_ns_domain_type
  ON memories (namespace, (COALESCE(NULLIF(metadata->>'type',''),'item')))
  WHERE invalid_at IS NULL AND tier = 'hot';

-- [V1] BM25 long-text, Arabic-capable — CONFIRMED API for vchord_bm25 0.3.0 +
-- pg_tokenizer 0.1.1 on the live cabrain DB. Applied by bm25.sql (separate, so a
-- tokenizer-config issue never blocks the core schema), and populated on the retain
-- path (content_bm25 = tokenize(content, 'cabrain_ml')). Shape:
--   SELECT create_tokenizer('cabrain_ml', $$ model = "llmlingua2" $$);  -- see infra/grant-bm25.sql (superuser)
--   ALTER TABLE memories ADD COLUMN content_bm25 bm25vector;   -- populated per-write via tokenize()
--   CREATE INDEX memories_bm25 ON memories USING bm25 (content_bm25 bm25_ops);
-- Recall ranks with:  content_bm25 <&> to_bm25query('memories_bm25', tokenize($q,'cabrain_ml'))
-- (lower = better). Verified multilingual/Arabic by infra §5.2. NOT the English tokenizer (N4).

CREATE INDEX IF NOT EXISTS memories_ns
  ON memories (namespace, tier) WHERE invalid_at IS NULL;   -- hot scoped scans
CREATE INDEX IF NOT EXISTS memories_sal
  ON memories (importance DESC, last_accessed_at);          -- salience / decay ordering

-- ── 3.3 Supporting tables ────────────────────────────────────────────────────────────

-- Entity graph (spreading activation on recall; Cognee owns population). Not partitioned,
-- so a normal single-column PK + real FKs are fine here.
CREATE TABLE IF NOT EXISTS entities (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace text NOT NULL,
  name      text NOT NULL,
  summary   text,                                           -- consolidated "what we know about X"
  embedding vector(1024)
  -- Name uniqueness is a PARTIAL unique index (entities_ns_name, see "Notes are
  -- graph nodes" below): extracted/Cognee entities dedupe by name, note entities
  -- are keyed by natural_key so two notes may share a title.
);

-- memory ↔ entity edges. memory_id is a soft ref [D2] (memories is partitioned);
-- entity_id is a real FK. Orphan-edge cleanup for demoted/removed memories is handled
-- by the sleep workers, not ON DELETE CASCADE.
CREATE TABLE IF NOT EXISTS memory_entities (
  memory_id uuid NOT NULL,                                  -- [D2] -> memories.id (soft)
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  PRIMARY KEY (memory_id, entity_id)
);
CREATE INDEX IF NOT EXISTS memory_entities_entity ON memory_entities (entity_id);

-- ── Graph layer (SPEC §4.2 extended) ────────────────────────────────────────────────
-- Everything below turns the graph from "a bag of untyped nodes" into something you
-- can actually reason over in plain Postgres: typed nodes, typed + temporally-valid
-- edges, first-class episodes for provenance, a declared ontology, and communities.
-- No graph database required — recursive CTEs handle multi-hop traversal, and at this
-- scale (thousands of nodes) they outperform the operational cost of a second store.

-- Node type. Without it every entity is just a name, so a venture is indistinguishable
-- from a person and "show me the ventures" is unanswerable — which made the graph
-- effectively unusable for reasoning.
ALTER TABLE entities ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'entity';
ALTER TABLE entities ADD COLUMN IF NOT EXISTS metadata    jsonb NOT NULL DEFAULT '{}';
ALTER TABLE entities ADD COLUMN IF NOT EXISTS created_at  timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS entities_ns_type ON entities (namespace, entity_type);

-- Bi-temporal on memories: valid_at is the EVENT time (when it happened, back-dated on
-- import); ingested_at is when WE learned it. Graphiti tracks both; we had only one
-- axis, so back-dating an import silently destroyed any record of when it arrived.
ALTER TABLE memories ADD COLUMN IF NOT EXISTS ingested_at timestamptz NOT NULL DEFAULT now();

-- Typed, directed, temporally-valid edges between entities — the Graphiti triplet
-- (subject → RELATION → object). memory_entities stays as the memory↔entity mention
-- index; THIS table is the semantic graph. `fact` is the human-readable sentence and is
-- embedded so edges are semantically searchable in their own right, not just traversable.
CREATE TABLE IF NOT EXISTS entity_edges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace   text NOT NULL,
  src_id      uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  dst_id      uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation    text NOT NULL,                                -- OWNS | MEMBER_OF | ASSIGNED_TO | ...
  fact        text,                                         -- "Ahmed Refaat is Engineering Manager on CADO"
  embedding   vector(1024),
  episode_id  uuid,                                         -- soft ref -> episodes.id (provenance)
  memory_id   uuid,                                         -- soft ref -> memories.id  [D2]
  weight      real NOT NULL DEFAULT 1.0,
  valid_from  timestamptz NOT NULL DEFAULT now(),           -- when the relationship became true
  valid_to    timestamptz,                                  -- NULL = still true; set, never deleted
  ingested_at timestamptz NOT NULL DEFAULT now(),
  metadata    jsonb NOT NULL DEFAULT '{}',
  UNIQUE (namespace, src_id, dst_id, relation, valid_from)
);
CREATE INDEX IF NOT EXISTS entity_edges_src  ON entity_edges (src_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS entity_edges_dst  ON entity_edges (dst_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS entity_edges_rel  ON entity_edges (namespace, relation) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS entity_edges_time ON entity_edges (namespace, valid_from, valid_to);
-- Edges carry an embedding of their FACT, which is what makes the graph searchable
-- by meaning ("who owns compliance?") rather than only by traversal from a known
-- node. Without an ANN index that column is dead weight: every fact query degrades
-- to a full scan over every live edge. Partial on the live set, matching how edges
-- are always queried (valid_to IS NULL), so the index stays small as history grows.
CREATE INDEX IF NOT EXISTS entity_edges_vec ON entity_edges
  USING hnsw (embedding vector_cosine_ops) WHERE valid_to IS NULL;
-- Provenance lookups: "which edges did this memory/episode produce?" is how a fact
-- gets explained, and both were sequential scans.
CREATE INDEX IF NOT EXISTS entity_edges_mem ON entity_edges (memory_id) WHERE memory_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS entity_edges_epi ON entity_edges (episode_id) WHERE episode_id IS NOT NULL;

-- Episodes: the raw ingested unit. Every derived memory/edge traces back to one, so a
-- fact can always be explained by the thing it came from.
CREATE TABLE IF NOT EXISTS episodes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace   text NOT NULL,
  name        text,
  body        text NOT NULL,
  source_kind text,
  source_ref  text,
  occurred_at timestamptz NOT NULL DEFAULT now(),           -- event time
  ingested_at timestamptz NOT NULL DEFAULT now(),           -- learn time
  metadata    jsonb NOT NULL DEFAULT '{}',
  UNIQUE (namespace, source_ref)
);
CREATE INDEX IF NOT EXISTS episodes_ns_time ON episodes (namespace, occurred_at DESC);
ALTER TABLE memories ADD COLUMN IF NOT EXISTS episode_id uuid;   -- soft ref [D2]

-- Declared ontology. Graphiti does this with Pydantic models; we keep it as data so a
-- brain can describe its own shape and callers can validate against it.
CREATE TABLE IF NOT EXISTS entity_types (
  namespace   text NOT NULL,
  name        text NOT NULL,
  description text,
  schema      jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (namespace, name)
);
CREATE TABLE IF NOT EXISTS edge_types (
  namespace   text NOT NULL,
  name        text NOT NULL,
  description text,
  src_type    text,                                         -- NULL = any
  dst_type    text,
  PRIMARY KEY (namespace, name)
);

-- Communities (clusters of densely-connected entities), assigned by label propagation.
CREATE TABLE IF NOT EXISTS communities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace  text NOT NULL,
  name       text NOT NULL,
  summary    text,
  size       int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (namespace, name)
);
ALTER TABLE entities ADD COLUMN IF NOT EXISTS community_id uuid;
CREATE INDEX IF NOT EXISTS entities_community ON entities (community_id);

-- Append-only telemetry (OLAP; consolidation candidates, usage, cost).
CREATE TABLE IF NOT EXISTS memory_events (
  id         bigserial PRIMARY KEY,
  ts         timestamptz NOT NULL DEFAULT now(),
  namespace  text,
  op         text NOT NULL,                                 -- retain|recall|reflect|forget|reconsolidate|demote
  memory_id  uuid,                                          -- [D2] soft ref
  agent_id   text,
  latency_ms int,
  metadata   jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT memory_events_op_chk
    CHECK (op IN ('retain','recall','recall_archive','reflect','forget','reconsolidate','demote','share','search'))
);
CREATE INDEX IF NOT EXISTS memory_events_ns_ts ON memory_events (namespace, ts DESC);

-- Namespace access grants (the claim/share model; enforced in SQL, F5).
CREATE TABLE IF NOT EXISTS namespace_grants (
  agent_id  text NOT NULL,
  namespace text NOT NULL,
  can_read  boolean NOT NULL DEFAULT true,
  can_write boolean NOT NULL DEFAULT true,
  PRIMARY KEY (agent_id, namespace)
);

-- Knowledge gaps: every recall that comes back EMPTY is a question the brain
-- couldn't answer. We record it (deduped, counted) so the operator can act on it —
-- index the missing knowledge — over MCP / chat / the dashboard.
CREATE TABLE IF NOT EXISTS memory_gaps (
  id          bigserial PRIMARY KEY,
  namespace   text NOT NULL,
  query       text NOT NULL,                 -- the original query text
  norm_query  text NOT NULL,                 -- normalized, for dedup
  hits        int  NOT NULL DEFAULT 1,        -- how many times it's been asked
  status      text NOT NULL DEFAULT 'open',   -- open | indexed | dismissed
  resolution  text,                           -- note when resolved
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (namespace, norm_query),
  CONSTRAINT memory_gaps_status_chk CHECK (status IN ('open','indexed','dismissed'))
);
CREATE INDEX IF NOT EXISTS memory_gaps_status ON memory_gaps (status, last_seen DESC);

-- Access tokens (ACL). A token identifies a caller (agent_id); its brain access is
-- namespace_grants(agent_id, namespace, can_read, can_write). Admin tokens bypass
-- grants. Presented over MCP/REST as the X-Zekra-Token header. Enforcement is on
-- when ZEKRA_REQUIRE_TOKEN=1 (else a tokenless caller is the trusted local console).
CREATE TABLE IF NOT EXISTS brain_tokens (
  token        text PRIMARY KEY,
  agent_id     text NOT NULL,
  label        text,
  is_admin     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS brain_tokens_agent ON brain_tokens (agent_id);

-- Per-brain secrets vault. Secrets found while retaining (API keys, passwords,
-- .env values, connection strings, private keys) are moved OUT of memories.content
-- into here, encrypted (AES-256-GCM; nonce||ciphertext in value_enc), and the
-- content is redacted to a `[secret:<name>]` reference so raw values never enter
-- the vector index or a recall response. Reveal is ACL-gated (write/admin on the
-- brain). Namespace-scoped like every other brain object. On the live instance this
-- table resolves under the isolated `cabrain_auth` schema via search_path.
CREATE TABLE IF NOT EXISTS secrets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace   text NOT NULL,
  name        text NOT NULL,
  value_enc   bytea NOT NULL,                 -- AES-256-GCM (nonce||ciphertext)
  hint        text,                           -- non-reversible masked preview
  kind        text,                           -- api_key|password|env|token|private_key|connection_string|credential
  source_ref  text,                           -- memory id / session that introduced it
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (namespace, name)
);
CREATE INDEX IF NOT EXISTS secrets_ns ON secrets (namespace, name);

-- Data sources (connectors). A configured connector instance bound to a brain
-- (namespace). On sync the connector's Fetch() emits Documents which are chunked
-- and retained (same §4.1 write-decision as any retain). Built-in kinds: text,
-- markdown, crawler, github, sql, plus the push-only "webhook". config is free-form
-- per-kind JSON (url/repo/dsn/query/… and, for webhook, a shared `secret`). Secrets
-- inside config are redacted on read (see redactDatasourceSecrets).
--
-- SCHEMA PLACEMENT: pinned to `public` (same schema as `memories`), NOT bare. On the
-- live instance the app runs with search_path=cabrain_auth,public, and an UNQUALIFIED
-- `CREATE TABLE IF NOT EXISTS datasources` would land in cabrain_auth (first writable
-- schema in the path — that is exactly where `secrets` ended up). Worse, if a
-- public.datasources already exists, an unqualified IF NOT EXISTS still creates a
-- SECOND, empty cabrain_auth.datasources that then SHADOWS public in every unqualified
-- read (verified empirically). Pinning to public keeps datasources alongside memories
-- and makes this file idempotent under zekractl migrate regardless of search_path. The
-- app's own unqualified queries (ListDatasources, …) resolve to public since
-- cabrain_auth has no datasources table.
CREATE TABLE IF NOT EXISTS public.datasources (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace    text NOT NULL,
  kind         text NOT NULL,                 -- text|markdown|crawler|github|sql|webhook
  name         text NOT NULL,
  config       jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'idle',  -- idle|syncing|ok|error
  cursor       text,                          -- incremental resume point
  last_error   text,
  doc_count    int NOT NULL DEFAULT 0,
  last_sync_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS datasources_ns ON public.datasources (namespace);

-- ── Brain membership (Phase 1: notes + connect any AI agent) ─────────────────────────
-- Brains are namespaces; before this table no user owned one. brain_members gives a
-- signed-in user access to a brain: the user who creates a brain is its `owner`,
-- editors read+write, viewers read. Admin/owner-ROLE accounts see every brain without
-- a row here. Applied to notes, the remote MCP endpoint and OAuth grants; the older
-- memory endpoints keep their X-Zekra-Token ACL (namespace_grants) unchanged.
-- Pinned to public for the same search_path reason as datasources above.
CREATE TABLE IF NOT EXISTS public.brain_members (
  namespace   text        NOT NULL,
  user_id     text        NOT NULL,
  role        text        NOT NULL DEFAULT 'owner',
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, user_id),
  CONSTRAINT brain_members_role_chk CHECK (role IN ('owner','editor','viewer'))
);
CREATE INDEX IF NOT EXISTS brain_members_user ON public.brain_members (user_id);

-- ── Notes ────────────────────────────────────────────────────────────────────────────
-- A note is a markdown document in a brain. Saving it chunks the body and retains each
-- chunk through the normal write pipeline (source_kind='note',
-- source_ref='note:<id>#<n>'); chunk_hashes remembers what was retained per chunk so an
-- edit re-retains only changed chunks and soft-invalidates removed ones. Deleting a
-- note tombstones it (deleted_at) so incremental sync can report the deletion.
CREATE TABLE IF NOT EXISTS public.notes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace        text        NOT NULL,
  owner_user_id    text,                                   -- NULL when created by an ACL token
  title            text        NOT NULL DEFAULT '',
  body             text        NOT NULL DEFAULT '',        -- markdown
  tags             text[]      NOT NULL DEFAULT '{}',
  pinned           boolean     NOT NULL DEFAULT false,
  archived         boolean     NOT NULL DEFAULT false,
  source           text        NOT NULL DEFAULT 'web',
  version          int         NOT NULL DEFAULT 1,
  chunk_hashes     text[]      NOT NULL DEFAULT '{}',      -- sha256 per retained chunk ('' = not indexed)
  indexed_version  int         NOT NULL DEFAULT 0,
  index_error      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,                            -- tombstone
  CONSTRAINT notes_source_chk CHECK (source IN ('web','mobile','desktop','agent','api'))
);
CREATE INDEX IF NOT EXISTS notes_ns_updated ON public.notes (namespace, updated_at, id);
CREATE INDEX IF NOT EXISTS notes_tags ON public.notes USING gin (tags);

CREATE TABLE IF NOT EXISTS public.note_versions (
  note_id         uuid        NOT NULL REFERENCES public.notes (id) ON DELETE CASCADE,
  version         int         NOT NULL,
  title           text        NOT NULL DEFAULT '',
  body            text        NOT NULL DEFAULT '',
  tags            text[]      NOT NULL DEFAULT '{}',
  pinned          boolean     NOT NULL DEFAULT false,
  archived        boolean     NOT NULL DEFAULT false,
  deleted         boolean     NOT NULL DEFAULT false,
  source          text        NOT NULL DEFAULT 'web',
  author_user_id  text,
  author_agent    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, version)
);

-- ── OAuth 2.1 for the remote MCP endpoint (/api/mcp) ─────────────────────────────────
-- Ported from fadymondy.com (db/mcp_oauth.postgres.sql). Nothing here is a usable
-- credential at rest: codes, access/refresh tokens and client secrets are stored as
-- sha256 hex digests. Prefixed mcp_ so they never collide with other oauth_* tables.
CREATE TABLE IF NOT EXISTS public.mcp_oauth_clients (
  id                         text        PRIMARY KEY,
  client_name                text        NOT NULL DEFAULT '',   -- self-asserted, shown as a claim
  client_uri                 text        NOT NULL DEFAULT '',
  redirect_uris              text        NOT NULL DEFAULT '[]', -- JSON array, exact-match
  token_endpoint_auth_method text        NOT NULL DEFAULT 'none',
  secret_hash                text        NOT NULL DEFAULT '',
  jwks_uri                   text        NOT NULL DEFAULT '',
  jwks                       text        NOT NULL DEFAULT '',
  ip                         text        NOT NULL DEFAULT '',
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

-- One approved connection (user x client). Its brains live in
-- mcp_oauth_grant_namespaces; revoking the grant kills every token under it.
CREATE TABLE IF NOT EXISTS public.mcp_oauth_grants (
  id            text        PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  client_id     text        NOT NULL REFERENCES public.mcp_oauth_clients (id) ON DELETE CASCADE,
  user_id       text        NOT NULL,
  scopes        text        NOT NULL DEFAULT '',
  resource      text        NOT NULL DEFAULT '',
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_oauth_grants_user ON public.mcp_oauth_grants (user_id);
CREATE INDEX IF NOT EXISTS mcp_oauth_grants_client ON public.mcp_oauth_grants (client_id);

-- Per user x client x namespace: which brains a connection may touch and whether it
-- may write. Re-checked on every MCP call against the user's current access.
CREATE TABLE IF NOT EXISTS public.mcp_oauth_grant_namespaces (
  grant_id   text    NOT NULL REFERENCES public.mcp_oauth_grants (id) ON DELETE CASCADE,
  namespace  text    NOT NULL,
  can_write  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (grant_id, namespace)
);

CREATE TABLE IF NOT EXISTS public.mcp_oauth_codes (
  code_hash       text        PRIMARY KEY,
  client_id       text        NOT NULL REFERENCES public.mcp_oauth_clients (id) ON DELETE CASCADE,
  user_id         text        NOT NULL,
  redirect_uri    text        NOT NULL,
  code_challenge  text        NOT NULL,                  -- S256 only
  scopes          text        NOT NULL DEFAULT '',
  namespaces      text        NOT NULL DEFAULT '[]',     -- JSON [{namespace, write}] approved on consent
  resource        text        NOT NULL DEFAULT '',
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,                           -- a second redemption revokes the grant
  grant_id        text        NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_oauth_codes_expires ON public.mcp_oauth_codes (expires_at);

CREATE TABLE IF NOT EXISTS public.mcp_oauth_tokens (
  token_hash  text        PRIMARY KEY,
  grant_id    text        NOT NULL REFERENCES public.mcp_oauth_grants (id) ON DELETE CASCADE,
  kind        text        NOT NULL,                      -- access | refresh
  scopes      text        NOT NULL DEFAULT '',
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,                               -- refresh rotation; reuse revokes the grant
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_grant ON public.mcp_oauth_tokens (grant_id);
CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_expires ON public.mcp_oauth_tokens (expires_at);

-- private_key_jwt assertion ids already spent (RFC 7523 replay protection).
CREATE TABLE IF NOT EXISTS public.mcp_oauth_client_assertions (
  client_id   text        NOT NULL,
  jti         text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  PRIMARY KEY (client_id, jti)
);
CREATE INDEX IF NOT EXISTS mcp_oauth_client_assertions_expires ON public.mcp_oauth_client_assertions (expires_at);

-- Backfill: every brain that has no member yet is owned by the existing admin/owner-role
-- accounts, so the move from "every signed-in account is admin of every brain" to
-- per-brain membership leaves existing brains with owners. Only brains with NO member
-- row are touched, so brains created by users later are never re-owned. Best-effort:
-- the users table may be absent, live in another schema, or be a foreign table
-- without a roles column (Cognee) - any error leaves the backfill for the next migrate.
DO $$
BEGIN
  IF to_regclass('users') IS NOT NULL THEN
    EXECUTE $q$
      INSERT INTO public.brain_members (namespace, user_id, role, created_by)
      SELECT DISTINCT n.namespace, u.id::text, 'owner', 'backfill'
      FROM (SELECT DISTINCT namespace FROM public.memories WHERE invalid_at IS NULL
            UNION SELECT DISTINCT namespace FROM public.notes) n
      CROSS JOIN users u
      WHERE (','||COALESCE(u.roles,'')||',') ~ ',(admin|owner),'
        AND NOT EXISTS (SELECT 1 FROM public.brain_members b WHERE b.namespace = n.namespace)
      ON CONFLICT DO NOTHING
    $q$;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'brain_members backfill skipped: %', SQLERRM;
END $$;

-- ── Notes are graph nodes (the editable graph) ───────────────────────────────────────
-- Every note owns one entity (natural_key 'note:<id>', entity_type = the note's
-- category); [[wikilinks]] in its body become links_to edges from it, and its tags
-- tagged edges. Edge provenance lives in entity_edges.metadata->>'origin'
-- (manual | wikilink | extract | cognee): note saves only ever touch their own
-- derived edges, never manual ones.
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS entity_id uuid;          -- soft ref -> entities.id
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS category  text NOT NULL DEFAULT 'note';
CREATE INDEX IF NOT EXISTS notes_entity ON public.notes (entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notes_ns_category ON public.notes (namespace, category) WHERE deleted_at IS NULL;
ALTER TABLE public.note_versions ADD COLUMN IF NOT EXISTS category text;  -- NULL = recorded before categories

-- natural_key is a stable identity that is not the display name ('note:<id>',
-- 'tag:<name>'). Keyed entities are unique by it; everything else keeps the old
-- name-dedupe, now as a partial index. Writers that upsert by name must say
--   ON CONFLICT (namespace, name) WHERE natural_key IS NULL
ALTER TABLE entities ADD COLUMN IF NOT EXISTS natural_key text;
CREATE UNIQUE INDEX IF NOT EXISTS entities_ns_natural_key ON entities (namespace, natural_key)
  WHERE natural_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS entities_ns_name ON entities (namespace, name)
  WHERE natural_key IS NULL;
CREATE INDEX IF NOT EXISTS entities_ns_lname ON entities (namespace, lower(name));
-- Drop the old table-level UNIQUE (namespace, name) whatever it is called, now that
-- the partial index above carries the name-dedupe. Idempotent.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
    WHERE con.conrelid = 'public.entities'::regclass AND con.contype = 'u'
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
           FROM unnest(con.conkey) k JOIN pg_attribute a
             ON a.attrelid = con.conrelid AND a.attnum = k) = ARRAY['name','namespace']
  LOOP
    EXECUTE format('ALTER TABLE public.entities DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

-- Derived-edge sync looks up "this note's live wikilink edges" on every save.
CREATE INDEX IF NOT EXISTS entity_edges_src_origin ON entity_edges (src_id, (metadata->>'origin'))
  WHERE valid_to IS NULL;

-- ── Every memory is a note (notes_adopt.go) ──────────────────────────────────────────
-- Memories written outside the notes editor (data sources, CLI, MCP memory_retain,
-- ingestion scripts) are adopted as notes. origin_ref is the note's document key
-- (a source_ref minus its chunk suffix, or 'zekra:memory:<id>' for a standalone
-- memory) and makes adoption idempotent; origin_parts maps each original chunk ref
-- to the text the note holds for it, so a re-retain of that chunk updates the note.
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS origin_ref   text;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS origin_parts jsonb NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS notes_ns_origin_ref ON public.notes (namespace, origin_ref)
  WHERE origin_ref IS NOT NULL;
-- notes.source also carries an adopted memory's source_kind (claude_code,
-- datasource:github, import, …), so the fixed list becomes a token check.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.notes'::regclass AND conname = 'notes_source_chk'
                   AND pg_get_constraintdef(oid) LIKE '%~%') THEN
    ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS notes_source_chk;
    ALTER TABLE public.notes ADD CONSTRAINT notes_source_chk
      CHECK (source ~ '^[A-Za-z0-9_:.\-]{1,64}$');
  END IF;
END $$;

-- ── Brain profiles (per-brain settings; profile.go) ──────────────────────────────────
-- Presentation + defaults for one brain: display name, description, colour, icon,
-- avatar/cover images, an advisory visibility label and the default note category.
-- The namespace id stays immutable; display_name is what the console shows. No row =
-- defaults (display_name = namespace, colour from a deterministic palette). Images are
-- blobs in the kernel storage (brains/<ns>/...); image_key/cover_key hold the storage
-- key of an uploaded blob, image_url/cover_url the URL the console renders (the
-- member-only API route for uploads, or an external https URL).
CREATE TABLE IF NOT EXISTS public.brain_profiles (
  namespace             text        PRIMARY KEY,
  display_name          text        NOT NULL DEFAULT '',
  description           text        NOT NULL DEFAULT '',
  color                 text        NOT NULL DEFAULT '',
  icon                  text        NOT NULL DEFAULT '',
  image_url             text        NOT NULL DEFAULT '',
  image_key             text        NOT NULL DEFAULT '',
  cover_url             text        NOT NULL DEFAULT '',
  cover_key             text        NOT NULL DEFAULT '',
  visibility            text        NOT NULL DEFAULT 'private',
  default_note_category text        NOT NULL DEFAULT '',
  settings              jsonb       NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text,
  CONSTRAINT brain_profiles_visibility_chk CHECK (visibility IN ('private','internal'))
);

-- ── Presentations (plugins/brain/presentations; ported from fadymondy.com FM-341/342) ──
-- Decks, reports and page previews personalised for one customer, each owned by ONE
-- brain (namespace) and the account that created it (owner_user_id). Access is the
-- brain's: brain_members roles / X-Zekra-Token grants / OAuth brains:* scopes, checked
-- in internal/brain/presentations_handlers.go. No generated CRUD on purpose: a CRUD on
-- presentation_shares would be a second, unguarded way to list sealed share tokens, and
-- one on presentations would skip the content validator.
--
--   presentations        one document; content holds {"en": {...}, "ar": {...}}
--   presentation_shares  share links: sha256(token) for lookup (token_hash), the token
--                        sealed (vault:v1 AES-GCM, seal.go) so the owner can copy it again
--
-- Conventions kept from the source so imported rows are byte-identical: nothing NULL
-- except owner_user_id, 'epoch' = "never", 'infinity' = "no expiry". Idempotent.
CREATE TABLE IF NOT EXISTS public.presentations (
    id                text        PRIMARY KEY,
    namespace         text        NOT NULL,
    owner_user_id     text,
    kind              text        NOT NULL CHECK (kind IN ('deck', 'report', 'page')),
    title             text        NOT NULL DEFAULT '',
    customer_name     text        NOT NULL DEFAULT '',
    customer_company  text        NOT NULL DEFAULT '',
    customer_email    text        NOT NULL DEFAULT '',
    locale            text        NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar')),
    status            text        NOT NULL DEFAULT 'draft',        -- draft | ready | archived
    style             text        NOT NULL DEFAULT '',             -- pages: minimal | bold | editorial | tech-dark
    content           jsonb       NOT NULL DEFAULT '{}'::jsonb,
    translations      jsonb       NOT NULL DEFAULT '{}'::jsonb,    -- {"ar": {"from","by","provider","model","at"}}
    view_count        bigint      NOT NULL DEFAULT 0,
    download_count    bigint      NOT NULL DEFAULT 0,
    last_viewed_at    timestamptz NOT NULL DEFAULT 'epoch',
    created_by        text        NOT NULL DEFAULT '',
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.presentations ADD COLUMN IF NOT EXISTS namespace text;
ALTER TABLE public.presentations ADD COLUMN IF NOT EXISTS owner_user_id text;
CREATE INDEX IF NOT EXISTS presentations_ns_updated_idx ON public.presentations (namespace, updated_at DESC);
CREATE INDEX IF NOT EXISTS presentations_owner_idx ON public.presentations (owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS presentations_customer_idx ON public.presentations (lower(customer_company), lower(customer_name));

CREATE TABLE IF NOT EXISTS public.presentation_shares (
    id                text        PRIMARY KEY,
    presentation_id   text        NOT NULL REFERENCES public.presentations (id) ON DELETE CASCADE,
    token_hash        text        NOT NULL UNIQUE,                 -- sha256(token), hex: the only lookup key
    token_sealed      text        NOT NULL DEFAULT '',             -- vault:v1:… ('' = shown once, not recoverable)
    token_hint        text        NOT NULL DEFAULT '',             -- first 4 characters
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
CREATE INDEX IF NOT EXISTS presentation_shares_doc_idx ON public.presentation_shares (presentation_id, created_at DESC);

-- ── Custom share domains (plugins/brain/presentations/domains.go) ──
-- A brain links its own domain or subdomain so its share links read
-- https://<host>/{locale}/p/{token}. A claim is unverified until DNS proves it (a TXT
-- record at _zekra-verify.<host> = verify_token, and the host pointing at
-- PRESENTATIONS_DOMAIN_TARGET). A VERIFIED host belongs to exactly one brain; an
-- unverified claim blocks nobody. A request on a custom host only opens that brain's
-- tokens. Deleting a domain keeps its links (domain_id → NULL; the URL falls back to
-- the brain's default verified domain, else the built-in base). Idempotent.
CREATE TABLE IF NOT EXISTS public.presentation_domains (
    id                text        PRIMARY KEY,
    namespace         text        NOT NULL,
    host              text        NOT NULL CHECK (host = lower(host) AND length(host) <= 253),
    verify_token      text        NOT NULL,
    verified_at       timestamptz,                                  -- NULL = not verified
    is_default        boolean     NOT NULL DEFAULT false,
    created_by        text        NOT NULL DEFAULT '',
    created_at        timestamptz NOT NULL DEFAULT now(),
    last_checked_at   timestamptz,
    last_error        text        NOT NULL DEFAULT '',
    CONSTRAINT presentation_domains_ns_host_key UNIQUE (namespace, host)
);
CREATE UNIQUE INDEX IF NOT EXISTS presentation_domains_verified_host_key
    ON public.presentation_domains (host) WHERE verified_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS presentation_domains_default_key
    ON public.presentation_domains (namespace) WHERE is_default;

ALTER TABLE public.presentation_shares ADD COLUMN IF NOT EXISTS domain_id text
    REFERENCES public.presentation_domains (id) ON DELETE SET NULL;

-- ── Per-note icon and colour override (MH-308) ───────────────────────────────
-- Both DEFAULT '' meaning "derive from category", which is how every note
-- behaves today: the renderers map Note.Category onto a curated icon and
-- colour. These columns only record a deliberate override, so existing notes
-- keep their derived appearance and nothing has to be backfilled.
-- Values are validated in the handler against the known icon names and the
-- fixed colour set rather than by a CHECK, so the vocabulary can grow without
-- a migration.
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS icon  text NOT NULL DEFAULT '';
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '';

-- ── GitHub note sync (MH-316) ──────────────────────────────────────────────────
-- Where a brain's notes are exported to. One-way: Zekra is the source of truth
-- and this is an export target, so there is no remote state mirrored here — only
-- the last push, for the UI to show. The PAT is NOT here; it lives in `secrets`
-- under the reserved name `github_token`, encrypted like every other secret.
CREATE TABLE IF NOT EXISTS public.note_github_sync (
  namespace     text        PRIMARY KEY,
  owner         text        NOT NULL,
  repo          text        NOT NULL,
  branch        text        NOT NULL DEFAULT 'main',
  path_template text        NOT NULL DEFAULT 'notes/{slug}.md',
  enabled       boolean     NOT NULL DEFAULT false,
  last_push_at  timestamptz,
  last_commit   text        NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text
);

-- ── Push notifications: device tokens (MH-373) ────────────────────────────────
-- One row per device FCM token (devices.go). A token is ONE device: when another
-- account registers it, the row moves to that account (upsert on token), so a
-- phone that changed hands stops receiving the old account's pushes. `locale`
-- picks the notification text language (en | ar). Rows FCM reports dead
-- (UNREGISTERED, SENDER_ID_MISMATCH) are pruned at send time. Idempotent.
CREATE TABLE IF NOT EXISTS public.device_tokens (
  id            text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id       text        NOT NULL,
  token         text        NOT NULL UNIQUE CHECK (length(token) BETWEEN 1 AND 4096),
  platform      text        NOT NULL CHECK (platform IN ('ios', 'android')),
  user_agent    text        NOT NULL DEFAULT '',
  locale        text        NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_tokens_user_idx ON public.device_tokens (user_id, last_seen_at DESC);

-- "Notify once" ledger: a key (e.g. presentation_share_viewed:<share id>) is
-- inserted by the first sender; ON CONFLICT DO NOTHING makes the claim atomic.
CREATE TABLE IF NOT EXISTS public.push_once (
  key         text        PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Notification center: per-user inbox (MH-360) ──────────────────────────────
-- Every notification a user is sent (notifications.go: Service.notify) is kept
-- here, whether or not push is configured or reached a device. `kind` is the
-- push data "type" (brain_access, presentation_viewed, …), `route` the in-app
-- route it opens. `title`/`body` are in the recipient's language at send time;
-- `texts` keeps every language ({"en":{"title","body"},"ar":{…}}) so a reader can
-- ask for another. `read_at` NULL = unread. Capped per user in code (oldest go).
-- Idempotent.
CREATE TABLE IF NOT EXISTS public.notifications (
  id          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     text        NOT NULL,
  kind        text        NOT NULL CHECK (length(kind) BETWEEN 1 AND 64),
  title       text        NOT NULL,
  body        text        NOT NULL DEFAULT '',
  texts       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  route       text        NOT NULL DEFAULT '',
  data        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
-- The inbox page (keyset on created_at, id) and the unread badge.
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON public.notifications (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON public.notifications (user_id) WHERE read_at IS NULL;
