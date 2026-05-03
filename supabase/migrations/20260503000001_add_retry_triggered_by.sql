-- ─── Migration: Allow 'retry' as triggered_by value ──────────────────────────
-- The retry route calls enqueue_run with p_triggered_by = 'retry', but the
-- CHECK constraint on runs.triggered_by only allowed 'manual','schedule','webhook'.
-- This caused the RPC to fail with a constraint violation, surfacing as
-- "Failed to enqueue retry" in the UI.

ALTER TABLE public.runs
  DROP CONSTRAINT IF EXISTS runs_triggered_by_check;

ALTER TABLE public.runs
  ADD CONSTRAINT runs_triggered_by_check
  CHECK (triggered_by IN ('manual', 'schedule', 'webhook', 'retry'));
