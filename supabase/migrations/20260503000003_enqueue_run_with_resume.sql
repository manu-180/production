-- ─── Migration: Extend enqueue_run with optional resume params ───────────────
-- Adds p_resume_from_index and p_resume_session_id as optional params.
-- Default NULL = fresh run (existing callers unaffected).
-- Retry endpoint passes these to skip already-completed prompts.

CREATE OR REPLACE FUNCTION public.enqueue_run(
  p_plan_id            uuid,
  p_user_id            uuid,
  p_working_dir        text,
  p_triggered_by       text    DEFAULT 'manual',
  p_resume_from_index  integer DEFAULT NULL,
  p_resume_session_id  text    DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_run_id uuid;
BEGIN
  INSERT INTO public.runs (
    plan_id, user_id, working_dir, triggered_by, status,
    resume_from_index, resume_session_id
  )
  VALUES (
    p_plan_id, p_user_id, p_working_dir, p_triggered_by, 'queued',
    p_resume_from_index, p_resume_session_id
  )
  RETURNING id INTO v_run_id;

  INSERT INTO public.prompt_executions (run_id, prompt_id, status)
  SELECT v_run_id, id, 'pending'
  FROM public.prompts
  WHERE plan_id = p_plan_id
  ORDER BY order_index;

  PERFORM pg_notify('conductor_runs_queued', v_run_id::text);

  RETURN v_run_id;
END;
$$;
