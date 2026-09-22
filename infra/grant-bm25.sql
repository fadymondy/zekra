-- Zekra BM25 — infra provisioning for the app role (`zekra`). Run as a
-- SUPERUSER (or the extension owner) on the zekra database.
--
-- STATUS (verified 2026-07-17 against the live zekra DB):
--   ✓ Grants below are APPLIED — `zekra` can now USE vchord_bm25 + pg_tokenizer.
--   ✓ zekractl bm25 / bm25-test pass: content_bm25 column + memories_default_bm25
--     index build, and an Arabic BM25 query ranks the Arabic row at -0.7616.
--   ⚠ The tokenizer currently in use, `zekra_bm25_tok`, is a FIXED-VOCAB PROBE
--     (a custom model built from a tiny sample table). It only tokenizes words in
--     that sample — general English/Arabic terms outside it produce empty tokens
--     (verified: tokenize('the quick brown fox cluster pods','zekra_bm25_tok') → {}).
--     Provision a PRODUCTION multilingual tokenizer (step 3) for real recall — the
--     `zekra_ml` / llmlingua2 config in step 3 is byte-for-byte verified against this
--     DB's pg_tokenizer 0.1.1 (parsed+validated; only the catalog INSERT needs a
--     superuser). Switching the app over is just BRAIN_BM25_TOKENIZER=zekra_ml.
--
-- RE-CHECK (2026-07-17, as role `zekra`): step 3 has NOT been run by a superuser yet.
--   `SELECT name FROM tokenizer_catalog.tokenizer` → {zekra_bm25_tok, multilang}; NO
--   `zekra_ml`. (Both existing rows use model `zekra_bm25_model`, the fixed-vocab
--   probe — tokenize('Kubernetes deployments cluster pods', …) → {} for each, so neither
--   is production-usable.) Retrying step 3's create_tokenizer AS `zekra` still errors
--   exactly: `ERROR: permission denied for table tokenizer (SQLSTATE 42501)`. So this
--   remains a SUPERUSER action; the app must stay on the default tokenizer until then.

\set app_role zekra

-- 1. Use the extension schemas + call their functions (tokenize / to_bm25query /
--    the bm25 type + opclass). These are what the app role needs at runtime.
GRANT USAGE ON SCHEMA bm25_catalog      TO :app_role;
GRANT USAGE ON SCHEMA tokenizer_catalog TO :app_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA bm25_catalog      TO :app_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tokenizer_catalog TO :app_role;

-- 2. Read the tokenizer/model catalog (tokenize() looks up the tokenizer by name).
--    The app role stays READ-ONLY on these — it does NOT create tokenizers.
GRANT SELECT ON ALL TABLES IN SCHEMA tokenizer_catalog TO :app_role;

-- 3. PRODUCTION TOKENIZER (superuser). `llmlingua2` is preloaded and multilingual
--    (list_preload_models() → {llmlingua2}). It is a PRE-TRAINED subword model, so a
--    plain `tokenize(text, 'zekra_ml')` works INLINE — no per-row trigger and no
--    text_analyzer are required (triggers are only for *custom* vocab models like the
--    current zekra_bm25_tok). Config format below is VERIFIED against this live DB's
--    pg_tokenizer 0.1.1: `create_tokenizer` parses+validates the TOML before it writes,
--    so the model-only config was accepted (it stopped only at the INSERT). See the
--    "verified" notes for the exact byte-for-byte errors that pin the schema.
--
--    The app role `zekra` has SELECT (not INSERT) on tokenizer_catalog.tokenizer, so
--    running the block below AS zekra fails with:
--        ERROR:  permission denied for table tokenizer   (SQLSTATE 42501)
--    Hence it MUST be run by a superuser / the extension owner.
--
--   SET search_path TO public, bm25_catalog, tokenizer_catalog;
--
--   -- Canonical, recommended form: llmlingua2 does its own multilingual subword
--   -- tokenization, so no analyzer is needed. (VERIFIED: this exact TOML validated;
--   -- create_tokenizer's field set is {text_analyzer, character_filters,
--   -- pre_tokenizer, token_filters, model}.)
--   SELECT tokenizer_catalog.create_tokenizer('zekra_ml', $$
--   model = "llmlingua2"
--   $$);
--
--   -- Re-grant SELECT so the app role can read the new tokenizer row (tokenize()
--   -- looks the tokenizer up by name at query time).
--   GRANT SELECT ON ALL TABLES IN SCHEMA tokenizer_catalog TO :app_role;
--
--   -- Sanity check (run as anyone with SELECT): English now yields non-empty tokens,
--   -- unlike the fixed-vocab probe which returns {} here.
--   SELECT tokenizer_catalog.tokenize('PostgreSQL cluster pods scale out', 'zekra_ml');
--
--   Then set BRAIN_BM25_TOKENIZER=zekra_ml in the app env (this var already drives
--   the app's tokenize() calls) and re-run `zekractl bm25 && zekractl bm25-test` —
--   "cluster pods" should now score English rows too. Leave the existing default
--   `zekra_bm25_tok` in place; switching is purely the env var.
--
--   OPTIONAL (only if you want unicode word pre-splitting BEFORE llmlingua2 subwording
--   — not recommended for llmlingua2, which is trained to consume raw text). The
--   analyzer row must be created FIRST or create_tokenizer errors
--   "TextAnalyzer not found: zekra_ml_analyzer" (VERIFIED). text_analyzer's field set
--   is {character_filters, pre_tokenizer, token_filters}.
--     SELECT tokenizer_catalog.create_text_analyzer('zekra_ml_analyzer', $$
--     pre_tokenizer = "unicode_segmentation"
--     $$);
--     SELECT tokenizer_catalog.create_tokenizer('zekra_ml', $$
--     model = "llmlingua2"
--     text_analyzer = "zekra_ml_analyzer"
--     $$);
--     GRANT SELECT ON ALL TABLES IN SCHEMA tokenizer_catalog TO :app_role;

-- NOTE on partitioning: the app builds the bm25 index on the DEFAULT PARTITION
-- (memories_default_bm25), because a bm25 index on the partitioned parent is an
-- empty template that breaks to_bm25query. Phase 2 (partman monthly partitions)
-- must add a bm25 index per new partition. No superuser action needed for that —
-- `zekra` owns the tables.
