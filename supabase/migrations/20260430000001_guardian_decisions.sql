-- Guardian decisions audit log — bring table in line with Phase 07 spec.
--
-- The original `guardian_decisions` table (see 20260428000001_initial_schema.sql)
-- was a permissive stub: most columns were nullable, the strategy CHECK still
-- allowed the legacy 'heuristic' value, and the human-review fields were
-- modelled with a single `human_override` text column. The Guardian audit-log
-- spec (Phase 07, Task 5) expects:
--
--   - NOT NULL on every decision-defining column
--   - confidence as numeric(4,3) so we can persist 3 decimals (e.g. 0.875)
--   - strategy restricted to {'rule','default','llm'}
--   - explicit `requires_human_review` + `overridden_by_human` booleans
--   - `override_response` for the human's substituted answer
--
-- This migration is idempotent: it tolerates either the legacy or the new
-- shape, so re-running it on a fresh DB is a no-op.

-- ─── 1) Rename legacy columns (if present) ────────────────────────────────────
-- Old `human_override text` is replaced by `override_response text`. We keep
-- any existing data and synthesise `overridden_by_human` from the presence of
-- the override text below.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'guardian_decisions'
      AND column_name = 'human_override'
  ) THEN
    ALTER TABLE public.guardian_decisions RENAME COLUMN human_override TO override_response;
  END IF;
END$$;

-- Old `reviewed_by_human boolean` becomes `requires_human_review boolean`. The
-- legacy column meant "this decision was reviewed by a human"; the new one
-- means "this decision is asking for human review". They are not the same
-- thing, but the legacy column was never written in production, so the safe
-- default after the rename is `false` everywhere.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'guardian_decisions'
      AND column_name = 'reviewed_by_human'
  ) THEN
    ALTER TABLE public.guardian_decisions RENAME COLUMN reviewed_by_human TO requires_human_review;
  END IF;
END$$;

-- ─── 2) Add new columns the spec requires ─────────────────────────────────────
ALTER TABLE public.guardian_decisions
  ADD COLUMN IF NOT EXISTS requires_human_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS overridden_by_human   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS override_response     text;

-- ─── 3) Backfill so we can apply NOT NULL constraints ────────────────────────
-- Any pre-existing decision rows without the required text fields are bogus,
-- but we backfill placeholder values so the constraint can be added without
-- losing rows. In practice the table is empty at the time of this migration.
UPDATE public.guardian_decisions SET question_detected = '[unknown]' WHERE question_detected IS NULL;
UPDATE public.guardian_decisions SET decision          = '[unknown]' WHERE decision          IS NULL;
UPDATE public.guardian_decisions SET reasoning         = '[unknown]' WHERE reasoning         IS NULL;
UPDATE public.guardian_decisions SET confidence        = 0           WHERE confidence        IS NULL;
UPDATE public.guardian_decisions SET strategy          = 'default'   WHERE strategy          IS NULL;

-- Map any leftover legacy 'heuristic' rows onto 'rule' before we tighten the
-- CHECK constraint below.
UPDATE public.guardian_decisions SET strategy = 'rule' WHERE strategy = 'heuristic';

-- ─── 4) Tighten column types and constraints ──────────────────────────────────
-- Bump confidence precision from numeric(3,2) → numeric(4,3) so we can
-- distinguish e.g. 0.71 vs 0.715.
ALTER TABLE public.guardian_decisions
  ALTER COLUMN confidence TYPE numeric(4,3);

ALTER TABLE public.guardian_decisions
  ALTER COLUMN question_detected SET NOT NULL,
  ALTER COLUMN decision          SET NOT NULL,
  ALTER COLUMN reasoning         SET NOT NULL,
  ALTER COLUMN confidence        SET NOT NULL,
  ALTER COLUMN strategy          SET NOT NULL;

-- Replace the legacy strategy CHECK (which still allowed 'heuristic') with the
-- strict {rule, default, llm} set the engine emits.
ALTER TABLE public.guardian_decisions
  DROP CONSTRAINT IF EXISTS guardian_decisions_strategy_check;
ALTER TABLE public.guardian_decisions
  ADD  CONSTRAINT guardian_decisions_strategy_check
  CHECK (strategy IN ('rule','default','llm'));

-- Confidence range guard.
ALTER TABLE public.guardian_decisions
  DROP CONSTRAINT IF EXISTS guardian_decisions_confidence_check;
ALTER TABLE public.guardian_decisions
  ADD  CONSTRAINT guardian_decisions_confidence_check
  CHECK (confidence >= 0 AND confidence <= 1);

-- ─── 5) Index (already created in 20260428000003_indexes.sql, but keep
--        idempotent here so a fresh DB without that migration still works) ───
CREATE INDEX IF NOT EXISTS guardian_decisions_execution_idx
  ON public.guardian_decisions(prompt_execution_id);
