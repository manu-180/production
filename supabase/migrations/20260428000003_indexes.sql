-- Migration: 20260428000003_indexes.sql

-- ─── runs ─────────────────────────────────────────────────────────────────────
CREATE INDEX runs_user_status_created_idx ON public.runs (user_id, status, created_at DESC);
CREATE INDEX runs_active_partial_idx      ON public.runs (status) WHERE status IN ('queued','running');
CREATE INDEX runs_plan_id_idx             ON public.runs (plan_id);
CREATE INDEX runs_user_id_idx             ON public.runs (user_id);

-- ─── prompts ──────────────────────────────────────────────────────────────────
CREATE INDEX prompts_plan_order_idx ON public.prompts (plan_id, order_index);

-- ─── prompt_executions ────────────────────────────────────────────────────────
CREATE INDEX prompt_executions_run_started_idx ON public.prompt_executions (run_id, started_at DESC);
CREATE INDEX prompt_executions_run_id_idx      ON public.prompt_executions (run_id);
CREATE INDEX prompt_executions_prompt_id_idx   ON public.prompt_executions (prompt_id);

-- ─── run_events ───────────────────────────────────────────────────────────────
CREATE INDEX run_events_run_sequence_idx ON public.run_events (run_id, sequence DESC);
CREATE INDEX run_events_run_id_idx       ON public.run_events (run_id);

-- ─── output_chunks (BRIN — append-only time-series, high write volume) ────────
CREATE INDEX output_chunks_brin_idx        ON public.output_chunks USING brin (prompt_execution_id, created_at);

-- ─── plans ────────────────────────────────────────────────────────────────────
CREATE INDEX plans_tags_gin_idx ON public.plans USING gin (tags);
CREATE INDEX plans_user_id_idx  ON public.plans (user_id);

-- ─── FK indexes (Postgres does not auto-create these) ─────────────────────────
CREATE INDEX auth_tokens_user_id_idx          ON public.auth_tokens (user_id);
CREATE INDEX guardian_decisions_execution_idx ON public.guardian_decisions (prompt_execution_id);
