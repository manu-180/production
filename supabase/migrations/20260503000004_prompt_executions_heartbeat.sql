-- Migration: 20260503000004_prompt_executions_heartbeat.sql
-- Adds per-prompt heartbeat column so workers can signal liveness
-- while a prompt is running, enabling recovery of hung prompts.

ALTER TABLE public.prompt_executions
  ADD COLUMN IF NOT EXISTS last_progress_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS prompt_executions_running_progress_idx
  ON public.prompt_executions (status, last_progress_at)
  WHERE status = 'running';

COMMENT ON COLUMN public.prompt_executions.last_progress_at IS
  'Worker updates this every 5s while the prompt is active (has stdout/stderr). Recovery detects stalls when this is < now() - 2 min.';
