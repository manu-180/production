-- Migration: 20260429000004_recovery_heartbeat.sql
-- Phase 09 (Recovery): heartbeat tracking on runs + worker_instances table

-- ─── runs.last_heartbeat_at ───────────────────────────────────────────────────
ALTER TABLE public.runs
  ADD COLUMN last_heartbeat_at timestamptz;

CREATE INDEX runs_running_heartbeat_idx
  ON public.runs (last_heartbeat_at)
  WHERE status = 'running';

COMMENT ON COLUMN public.runs.last_heartbeat_at IS
  'Updated by worker every ~10s while a run is active. Used to detect orphaned runs after worker crash.';

-- ─── worker_instances (optional, multi-worker observability) ──────────────────
CREATE TABLE public.worker_instances (
  id           text        PRIMARY KEY,
  hostname     text,
  pid          integer,
  started_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  metadata     jsonb       NOT NULL DEFAULT '{}'
);

CREATE INDEX worker_instances_last_seen_idx
  ON public.worker_instances (last_seen_at);

COMMENT ON TABLE public.worker_instances IS
  'Registers each worker process. last_seen_at updated on heartbeat tick. Used to detect dead workers.';

-- RLS: worker_instances is service-role only (no user policy needed; default deny)
ALTER TABLE public.worker_instances ENABLE ROW LEVEL SECURITY;
