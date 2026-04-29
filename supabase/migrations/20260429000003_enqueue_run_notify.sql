-- ─── Migration: Add NOTIFY to enqueue_run ─────────────────────────────────────
-- The worker polls for queued runs via Supabase REST, but we also emit a
-- Postgres NOTIFY so that a future native pg-listen backend can wake up
-- immediately without waiting for the next poll interval.
-- Channel: conductor_runs_queued
-- Payload: the new run UUID (as text)

CREATE OR REPLACE FUNCTION public.enqueue_run(
  p_plan_id      uuid,
  p_user_id      uuid,
  p_working_dir  text,
  p_triggered_by text DEFAULT 'manual'
)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_run_id uuid;
BEGIN
  INSERT INTO public.runs (plan_id, user_id, working_dir, triggered_by, status)
  VALUES (p_plan_id, p_user_id, p_working_dir, p_triggered_by, 'queued')
  RETURNING id INTO v_run_id;

  INSERT INTO public.prompt_executions (run_id, prompt_id, status)
  SELECT v_run_id, id, 'pending'
  FROM public.prompts
  WHERE plan_id = p_plan_id
  ORDER BY order_index;

  -- Notify the worker that a new run is queued.
  -- Payload is the run UUID so the worker can target it directly if needed.
  PERFORM pg_notify('conductor_runs_queued', v_run_id::text);

  RETURN v_run_id;
END;
$$;
