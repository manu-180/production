-- Migration: 20260430000002_realtime_publication_and_dev_rls.sql
-- Phase 11: enable Supabase Realtime on the tables the dashboard subscribes to,
-- and TEMPORARILY grant the anon role read access for single-user dev mode.
--
-- ⚠️ REVERT BEFORE MULTI-USER: the `_dev_only_` policies below give the anon
-- role SELECT access to ALL rows in the listed tables. They exist solely so
-- the browser client (which has no auth session yet) can subscribe to
-- realtime events and read run state. Drop them as part of the multi-user
-- migration. Tracked in docs/plans/2026-04-30-fase-11-ui-dashboard.md §0.6.

-- ─── 1. Add tables to the supabase_realtime publication ──────────────────────
-- postgres_changes only fires for tables explicitly added to this publication.
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.runs,
  public.prompt_executions,
  public.run_events,
  public.output_chunks,
  public.guardian_decisions;

-- REPLICA IDENTITY FULL ensures DELETE/UPDATE payloads carry the OLD row.
-- We mostly INSERT, but cheap insurance against future filters needing it.
ALTER TABLE public.runs               REPLICA IDENTITY FULL;
ALTER TABLE public.prompt_executions  REPLICA IDENTITY FULL;
ALTER TABLE public.run_events         REPLICA IDENTITY FULL;
ALTER TABLE public.output_chunks      REPLICA IDENTITY FULL;
ALTER TABLE public.guardian_decisions REPLICA IDENTITY FULL;

-- ─── 2. Dev-only anon SELECT policies ────────────────────────────────────────
-- Browser client (no auth session yet) connects as `anon`. Without these
-- policies, every realtime row event is filtered out by RLS and the
-- subscription silently delivers zero events.
CREATE POLICY "_dev_only_runs_select_anon"               ON public.runs
  FOR SELECT TO anon USING (true);
CREATE POLICY "_dev_only_prompt_executions_select_anon"  ON public.prompt_executions
  FOR SELECT TO anon USING (true);
CREATE POLICY "_dev_only_run_events_select_anon"         ON public.run_events
  FOR SELECT TO anon USING (true);
CREATE POLICY "_dev_only_output_chunks_select_anon"      ON public.output_chunks
  FOR SELECT TO anon USING (true);
CREATE POLICY "_dev_only_guardian_decisions_select_anon" ON public.guardian_decisions
  FOR SELECT TO anon USING (true);
