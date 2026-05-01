-- Migration: 20260501000001_observability.sql
-- Phase 13 (Observability): audit_log WORM table, three materialized views
-- for run/prompt/guardian metrics, and pg_cron refresh jobs every 5 minutes.
--
-- Idempotent: uses IF NOT EXISTS, DO $$ blocks for conditional DDL, and
-- cron.schedule (which upserts by job name), so it is safe to run more
-- than once on the same database.

-- ─── 1) audit_log (Write-Once-Read-Many) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_log (
  id            bigserial    PRIMARY KEY,
  user_id       uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  actor         text         NOT NULL,
  action        text         NOT NULL,
  resource_type text,
  resource_id   text,
  metadata      jsonb        NOT NULL DEFAULT '{}',
  ip_address    inet,
  created_at    timestamptz  NOT NULL DEFAULT now()
);

-- actor and action value constraints (drop first for idempotency)
ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_actor_check;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_actor_check
  CHECK (actor IN ('user', 'worker', 'guardian', 'system'));

ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_action_check
  CHECK (action ~ '^[a-z_]+\.[a-z_]+$');

-- ─── 2) RLS: INSERT-only (WORM semantics) ─────────────────────────────────────

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Users can read only their own audit log entries
-- TO authenticated ensures anon sessions cannot match NULL user_id system-actor rows
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'audit_log'
      AND policyname = 'audit_log_select_own'
  ) THEN
    CREATE POLICY "audit_log_select_own"
      ON public.audit_log
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END$$;

-- Revoke UPDATE and DELETE from all roles — service_role inserts via service key
REVOKE UPDATE, DELETE ON public.audit_log FROM service_role;
REVOKE UPDATE, DELETE ON public.audit_log FROM authenticated;
REVOKE UPDATE, DELETE ON public.audit_log FROM anon;

-- WORM trigger: hard-blocks UPDATE/DELETE even for service_role (which bypasses RLS)
CREATE OR REPLACE FUNCTION public.audit_log_deny_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is insert-only (WORM): % is not permitted', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS audit_log_worm_guard ON public.audit_log;
CREATE TRIGGER audit_log_worm_guard
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_deny_mutation();

-- ─── 3) Indexes on audit_log ──────────────────────────────────────────────────

-- Primary lookup: "show me my recent entries" — user_id + recency
CREATE INDEX IF NOT EXISTS audit_log_user_created_at_idx
  ON public.audit_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx
  ON public.audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_resource_idx
  ON public.audit_log(resource_type, resource_id);

-- Separate index for action filtering
CREATE INDEX IF NOT EXISTS audit_log_action_idx
  ON public.audit_log(action);

-- ─── 4) Materialized view: metrics_runs_daily ────────────────────────────────
-- Drop and recreate is the only safe idempotent pattern for materialized views
-- when the SELECT list or GROUP BY might change between migration runs.

DROP MATERIALIZED VIEW IF EXISTS public.metrics_runs_daily;
CREATE MATERIALIZED VIEW public.metrics_runs_daily AS
SELECT
  date_trunc('day', started_at)                                              AS day,
  user_id,
  count(*)                                                                   AS total_runs,
  count(*) FILTER (WHERE status = 'completed')                               AS successful,
  count(*) FILTER (WHERE status = 'failed')                                  AS failed,
  count(*) FILTER (WHERE status = 'cancelled')                               AS cancelled,
  avg(extract(epoch FROM finished_at - started_at))
    FILTER (WHERE status = 'completed')                                      AS avg_duration_s,
  sum(total_cost_usd)                                                        AS total_cost_usd,
  sum(total_input_tokens)                                                    AS total_input,
  sum(total_output_tokens)                                                   AS total_output
FROM public.runs
WHERE started_at IS NOT NULL
GROUP BY 1, 2;

CREATE UNIQUE INDEX metrics_runs_daily_pk
  ON public.metrics_runs_daily(day, user_id);

-- ─── 5) Materialized view: metrics_prompts_aggregate ─────────────────────────

DROP MATERIALIZED VIEW IF EXISTS public.metrics_prompts_aggregate;
CREATE MATERIALIZED VIEW public.metrics_prompts_aggregate AS
SELECT
  p.id,
  p.title,
  p.plan_id,
  count(pe.*)                                                                AS total_executions,
  count(*) FILTER (WHERE pe.status = 'succeeded')                            AS succeeded,
  count(*) FILTER (WHERE pe.status = 'failed')                               AS failed,
  avg(pe.duration_ms)  FILTER (WHERE pe.status = 'succeeded')                AS avg_duration_ms,
  avg(pe.cost_usd)     FILTER (WHERE pe.status = 'succeeded')                AS avg_cost_usd,
  avg(pe.input_tokens + pe.output_tokens)                                    AS avg_tokens
FROM public.prompts p
LEFT JOIN public.prompt_executions pe ON pe.prompt_id = p.id
GROUP BY p.id, p.title, p.plan_id;

CREATE UNIQUE INDEX metrics_prompts_aggregate_pk
  ON public.metrics_prompts_aggregate(id);

-- ─── 6) Materialized view: metrics_guardian_daily ────────────────────────────

DROP MATERIALIZED VIEW IF EXISTS public.metrics_guardian_daily;
CREATE MATERIALIZED VIEW public.metrics_guardian_daily AS
SELECT
  date_trunc('day', created_at)                                              AS day,
  strategy,
  avg(confidence)                                                            AS avg_confidence,
  count(*)                                                                   AS total_decisions,
  count(*) FILTER (WHERE requires_human_review)                              AS human_reviewed,
  count(*) FILTER (WHERE overridden_by_human)                                AS overridden
FROM public.guardian_decisions
GROUP BY 1, 2;

CREATE UNIQUE INDEX metrics_guardian_daily_pk
  ON public.metrics_guardian_daily(day, strategy);

-- ─── 7) pg_cron refresh jobs (every 5 minutes) ───────────────────────────────
-- cron.schedule upserts by job name, so this block is inherently idempotent.
-- The pg_cron extension is pre-installed on Supabase; no CREATE EXTENSION needed.

SELECT cron.schedule(
  'refresh-metrics-runs',
  '*/5 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.metrics_runs_daily$$
);

SELECT cron.schedule(
  'refresh-metrics-prompts',
  '*/5 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.metrics_prompts_aggregate$$
);

SELECT cron.schedule(
  'refresh-metrics-guardian',
  '*/5 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.metrics_guardian_daily$$
);

-- ─── 8) Initial population (so views are not empty after migration) ───────────

REFRESH MATERIALIZED VIEW public.metrics_runs_daily;
REFRESH MATERIALIZED VIEW public.metrics_prompts_aggregate;
REFRESH MATERIALIZED VIEW public.metrics_guardian_daily;
