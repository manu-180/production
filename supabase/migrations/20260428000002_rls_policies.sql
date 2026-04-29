-- Migration: 20260428000002_rls_policies.sql
-- RLS: each user sees only their own data. Service role bypasses all policies.
-- Performance: (SELECT auth.uid()) evaluated once per query (initPlan cache), not once per row.

ALTER TABLE public.auth_tokens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.runs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_executions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.run_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.output_chunks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings           ENABLE ROW LEVEL SECURITY;

-- ─── auth_tokens ──────────────────────────────────────────────────────────────
CREATE POLICY "auth_tokens_select_own" ON public.auth_tokens
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "auth_tokens_insert_own" ON public.auth_tokens
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "auth_tokens_update_own" ON public.auth_tokens
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "auth_tokens_delete_own" ON public.auth_tokens
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ─── plans ────────────────────────────────────────────────────────────────────
CREATE POLICY "plans_select_own" ON public.plans
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "plans_insert_own" ON public.plans
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "plans_update_own" ON public.plans
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "plans_delete_own" ON public.plans
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ─── prompts (cascade: visible if parent plan belongs to user) ────────────────
CREATE POLICY "prompts_select_own" ON public.prompts
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.plans
    WHERE plans.id = prompts.plan_id AND (SELECT auth.uid()) = plans.user_id
  ));
CREATE POLICY "prompts_insert_own" ON public.prompts
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.plans
    WHERE plans.id = prompts.plan_id AND (SELECT auth.uid()) = plans.user_id
  ));
CREATE POLICY "prompts_update_own" ON public.prompts
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.plans
    WHERE plans.id = prompts.plan_id AND (SELECT auth.uid()) = plans.user_id
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.plans
    WHERE plans.id = prompts.plan_id AND (SELECT auth.uid()) = plans.user_id
  ));
CREATE POLICY "prompts_delete_own" ON public.prompts
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.plans
    WHERE plans.id = prompts.plan_id AND (SELECT auth.uid()) = plans.user_id
  ));

-- ─── runs ─────────────────────────────────────────────────────────────────────
CREATE POLICY "runs_select_own" ON public.runs
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "runs_insert_own" ON public.runs
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "runs_update_own" ON public.runs
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "runs_delete_own" ON public.runs
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ─── prompt_executions (cascade through runs) ─────────────────────────────────
CREATE POLICY "prompt_executions_select_own" ON public.prompt_executions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.runs
    WHERE runs.id = prompt_executions.run_id AND (SELECT auth.uid()) = runs.user_id
  ));
CREATE POLICY "prompt_executions_insert_own" ON public.prompt_executions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.runs
    WHERE runs.id = prompt_executions.run_id AND (SELECT auth.uid()) = runs.user_id
  ));
CREATE POLICY "prompt_executions_update_own" ON public.prompt_executions
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.runs
    WHERE runs.id = prompt_executions.run_id AND (SELECT auth.uid()) = runs.user_id
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.runs
    WHERE runs.id = prompt_executions.run_id AND (SELECT auth.uid()) = runs.user_id
  ));
CREATE POLICY "prompt_executions_delete_own" ON public.prompt_executions
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.runs
    WHERE runs.id = prompt_executions.run_id AND (SELECT auth.uid()) = runs.user_id
  ));

-- ─── run_events (cascade through runs) ───────────────────────────────────────
CREATE POLICY "run_events_select_own" ON public.run_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.runs
    WHERE runs.id = run_events.run_id AND (SELECT auth.uid()) = runs.user_id
  ));
CREATE POLICY "run_events_insert_own" ON public.run_events
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.runs
    WHERE runs.id = run_events.run_id AND (SELECT auth.uid()) = runs.user_id
  ));
CREATE POLICY "run_events_delete_own" ON public.run_events
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.runs
    WHERE runs.id = run_events.run_id AND (SELECT auth.uid()) = runs.user_id
  ));

-- ─── guardian_decisions (cascade: prompt_executions → runs) ───────────────────
CREATE POLICY "guardian_decisions_select_own" ON public.guardian_decisions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.prompt_executions pe
    JOIN public.runs r ON r.id = pe.run_id
    WHERE pe.id = guardian_decisions.prompt_execution_id
      AND (SELECT auth.uid()) = r.user_id
  ));
CREATE POLICY "guardian_decisions_insert_own" ON public.guardian_decisions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.prompt_executions pe
    JOIN public.runs r ON r.id = pe.run_id
    WHERE pe.id = guardian_decisions.prompt_execution_id
      AND (SELECT auth.uid()) = r.user_id
  ));
CREATE POLICY "guardian_decisions_delete_own" ON public.guardian_decisions
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.prompt_executions pe
    JOIN public.runs r ON r.id = pe.run_id
    WHERE pe.id = guardian_decisions.prompt_execution_id
      AND (SELECT auth.uid()) = r.user_id
  ));

-- ─── output_chunks (cascade: prompt_executions → runs) ───────────────────────
CREATE POLICY "output_chunks_select_own" ON public.output_chunks
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.prompt_executions pe
    JOIN public.runs r ON r.id = pe.run_id
    WHERE pe.id = output_chunks.prompt_execution_id
      AND (SELECT auth.uid()) = r.user_id
  ));
CREATE POLICY "output_chunks_insert_own" ON public.output_chunks
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.prompt_executions pe
    JOIN public.runs r ON r.id = pe.run_id
    WHERE pe.id = output_chunks.prompt_execution_id
      AND (SELECT auth.uid()) = r.user_id
  ));
CREATE POLICY "output_chunks_delete_own" ON public.output_chunks
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.prompt_executions pe
    JOIN public.runs r ON r.id = pe.run_id
    WHERE pe.id = output_chunks.prompt_execution_id
      AND (SELECT auth.uid()) = r.user_id
  ));

-- ─── settings ─────────────────────────────────────────────────────────────────
CREATE POLICY "settings_select_own" ON public.settings
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "settings_insert_own" ON public.settings
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "settings_update_own" ON public.settings
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "settings_delete_own" ON public.settings
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
