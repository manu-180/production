-- Migration: 20260428000004_functions_and_triggers.sql

-- ─── updated_at auto-maintenance ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_auth_tokens_updated_at
  BEFORE UPDATE ON public.auth_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_plans_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_prompts_updated_at
  BEFORE UPDATE ON public.prompts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_runs_updated_at
  BEFORE UPDATE ON public.runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_settings_updated_at
  BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── compute_run_totals ───────────────────────────────────────────────────────
-- Recalculates aggregated cost/token counters on runs from all its executions.
CREATE OR REPLACE FUNCTION public.compute_run_totals(p_run_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.runs SET
    total_cost_usd      = COALESCE((SELECT SUM(cost_usd)      FROM public.prompt_executions WHERE run_id = p_run_id), 0),
    total_input_tokens  = COALESCE((SELECT SUM(input_tokens)  FROM public.prompt_executions WHERE run_id = p_run_id), 0),
    total_output_tokens = COALESCE((SELECT SUM(output_tokens) FROM public.prompt_executions WHERE run_id = p_run_id), 0),
    total_cache_tokens  = COALESCE((SELECT SUM(cache_tokens)  FROM public.prompt_executions WHERE run_id = p_run_id), 0)
  WHERE id = p_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_compute_run_totals()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.compute_run_totals(NEW.run_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER compute_run_totals_on_execution_change
  AFTER INSERT OR UPDATE ON public.prompt_executions
  FOR EACH ROW EXECUTE FUNCTION public.trigger_compute_run_totals();

-- ─── next_event_sequence ──────────────────────────────────────────────────────
-- Returns the next monotonic sequence number for a run.
-- Advisory lock prevents races under concurrent inserts.
CREATE OR REPLACE FUNCTION public.next_event_sequence(p_run_id uuid)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  v_seq bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_run_id::text));
  SELECT COALESCE(MAX(sequence), 0) + 1 INTO v_seq
  FROM public.run_events WHERE run_id = p_run_id;
  RETURN v_seq;
END;
$$;

-- ─── enqueue_run ──────────────────────────────────────────────────────────────
-- Creates a run + one pending prompt_execution per prompt in the plan.
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

  RETURN v_run_id;
END;
$$;
