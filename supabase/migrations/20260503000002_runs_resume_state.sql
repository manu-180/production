-- ─── Migration: Add resume state columns to runs ──────────────────────────────
-- Enables retry-from-last-OK: instead of re-running the whole plan, a retry
-- can resume from the prompt after the last successful one.

ALTER TABLE public.runs
  ADD COLUMN IF NOT EXISTS last_succeeded_prompt_index INTEGER;

ALTER TABLE public.runs
  ADD COLUMN IF NOT EXISTS resume_from_index INTEGER;

ALTER TABLE public.runs
  ADD COLUMN IF NOT EXISTS resume_session_id TEXT;

-- Useful for dashboard queries: "resumable runs" (failed with at least one OK prompt)
CREATE INDEX IF NOT EXISTS runs_status_resume_idx
  ON public.runs (status, resume_from_index)
  WHERE resume_from_index IS NOT NULL;

COMMENT ON COLUMN public.runs.last_succeeded_prompt_index IS
  'Índice 0-based del último prompt completado exitosamente. NULL si ninguno.';
COMMENT ON COLUMN public.runs.resume_from_index IS
  'Si != NULL, orchestrator arranca desde este índice (resume desde último OK).';
COMMENT ON COLUMN public.runs.resume_session_id IS
  'claude_session_id del último prompt exitoso del run anterior, para --resume.';
