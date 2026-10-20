-- Schema delta for #59 (contradiction detection), #60 (derived provenance) and
-- #61 (per-call audit log). Those PRs added these objects to
-- plugins/brain/internal/brain/schema.sql and auto-deployed, but the delta was
-- never applied to production, so list_conflicts / resolve_conflict fail with
-- `relation "memory_conflicts" does not exist`, memory_provenance with
-- `relation "memory_derivations" does not exist`, and every conflict / stale /
-- per-call event insert is rejected by the old memory_events_op_chk.
--
-- Identical to the matching blocks of schema.sql and idempotent: safe to re-run,
-- and a no-op on a database migrated with `zekractl migrate`.
--
-- Run as postgres (memory_events is owned by postgres, so the constraint swap
-- needs it), in one transaction, after a pg_dump (DEPLOY.md, schema before binary):
--
--   pct exec 109 -- docker exec -i zekra-pg psql -U postgres -d zekra -v ON_ERROR_STOP=1 -1 \
--     < infra/migrations/20261019_conflicts_provenance_audit.sql
--
-- Then verify with `zekractl schema-check` (expects "database matches schema.sql").

CREATE TABLE IF NOT EXISTS public.memory_conflicts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace       text        NOT NULL,
  memory_a        uuid        NOT NULL,
  memory_b        uuid        NOT NULL,
  kind            text        NOT NULL DEFAULT 'factual',
  reason          text        NOT NULL DEFAULT '',
  confidence      real        NOT NULL DEFAULT 0,
  detector        text        NOT NULL DEFAULT 'llm',
  status          text        NOT NULL DEFAULT 'open',
  preferred_id    uuid,
  credibility     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  detected_by     text,
  resolution_note text,
  resolved_by     text,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memory_conflicts_pair UNIQUE (memory_a, memory_b),
  CONSTRAINT memory_conflicts_status_chk
    CHECK (status IN ('open','resolved_keep_new','resolved_keep_old','both_valid_scoped')),
  CONSTRAINT memory_conflicts_detector_chk CHECK (detector IN ('llm','heuristic','negation','manual'))
);
CREATE INDEX IF NOT EXISTS memory_conflicts_ns_status ON public.memory_conflicts (namespace, status, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_conflicts_a ON public.memory_conflicts (memory_a);
CREATE INDEX IF NOT EXISTS memory_conflicts_b ON public.memory_conflicts (memory_b);

CREATE TABLE IF NOT EXISTS public.memory_derivations (
  namespace    text        NOT NULL,
  derived_kind text        NOT NULL,
  derived_id   text        NOT NULL,
  source_id    uuid        NOT NULL,
  via          text        NOT NULL DEFAULT 'retain',
  stale_at     timestamptz,
  stale_reason text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (derived_kind, derived_id, source_id),
  CONSTRAINT memory_derivations_kind_chk CHECK (derived_kind IN ('memory','presentation')),
  CONSTRAINT memory_derivations_via_chk
    CHECK (via IN ('retain','chat','presentation','summary','consolidation'))
);
CREATE INDEX IF NOT EXISTS memory_derivations_source ON public.memory_derivations (source_id);
CREATE INDEX IF NOT EXISTS memory_derivations_ns ON public.memory_derivations (namespace);

-- The app connects as zekra; hand it the new tables when they were created as postgres.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zekra') AND current_user <> 'zekra' THEN
    EXECUTE 'ALTER TABLE public.memory_conflicts OWNER TO zekra';
    EXECUTE 'ALTER TABLE public.memory_derivations OWNER TO zekra';
  END IF;
END $$;

-- memory_events ops: conflict, resolve_conflict (#59), stale (#60), call (#61).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.memory_events'::regclass AND conname = 'memory_events_op_chk'
                   AND pg_get_constraintdef(oid) LIKE '%''call''%') THEN
    ALTER TABLE public.memory_events DROP CONSTRAINT IF EXISTS memory_events_op_chk;
    ALTER TABLE public.memory_events ADD CONSTRAINT memory_events_op_chk
      CHECK (op IN ('retain','recall','recall_archive','reflect','forget','reconsolidate','demote','share','search','adopt','edit','dedup','conflict','resolve_conflict','stale','call'));
  END IF;
END $$;
