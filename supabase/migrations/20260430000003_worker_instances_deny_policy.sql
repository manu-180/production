-- Migration: 20260430000003_worker_instances_deny_policy.sql
-- Phase 09 (Recovery): explicit deny-all policy on worker_instances so
-- non-service-role roles can't read or write the registry.
--
-- worker_instances should ONLY be touched by the worker (service-role db).
-- Without an explicit policy, RLS-enabled tables silently deny everything,
-- but having the policy in the schema is documentation: "this table is
-- intentionally service-role only, do not add public policies."

CREATE POLICY "deny_all_non_service_role"
  ON public.worker_instances
  FOR ALL
  USING (false)
  WITH CHECK (false);
