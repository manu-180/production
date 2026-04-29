-- Migration: 20260428000001_initial_schema.sql
-- Core schema for Conductor: plans, prompts, runs, executions, events, decisions, logs

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── auth_tokens ──────────────────────────────────────────────────────────────
CREATE TABLE public.auth_tokens (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider        text        NOT NULL DEFAULT 'claude_code',
  encrypted_token text        NOT NULL,
  iv              text        NOT NULL,
  expires_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── plans ────────────────────────────────────────────────────────────────────
CREATE TABLE public.plans (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                text        NOT NULL,
  description         text,
  default_working_dir text,
  default_settings    jsonb       NOT NULL DEFAULT '{}',
  tags                text[]      NOT NULL DEFAULT '{}',
  is_template         boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ─── prompts ──────────────────────────────────────────────────────────────────
CREATE TABLE public.prompts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id      uuid        NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  order_index  integer     NOT NULL,
  filename     text,
  title        text,
  content      text        NOT NULL,
  frontmatter  jsonb       NOT NULL DEFAULT '{}',
  content_hash text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, order_index)
);

-- ─── runs ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.runs (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id              uuid          NOT NULL REFERENCES public.plans(id),
  user_id              uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  working_dir          text          NOT NULL,
  status               text          NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','paused','completed','failed','cancelled')),
  checkpoint_branch    text,
  started_at           timestamptz,
  finished_at          timestamptz,
  current_prompt_index integer,
  total_cost_usd       numeric(10,4) NOT NULL DEFAULT 0,
  total_input_tokens   bigint        NOT NULL DEFAULT 0,
  total_output_tokens  bigint        NOT NULL DEFAULT 0,
  total_cache_tokens   bigint        NOT NULL DEFAULT 0,
  triggered_by         text          NOT NULL DEFAULT 'manual'
    CHECK (triggered_by IN ('manual','schedule','webhook')),
  cancellation_reason  text,
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now()
);

-- ─── prompt_executions ────────────────────────────────────────────────────────
CREATE TABLE public.prompt_executions (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            uuid          NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  prompt_id         uuid          NOT NULL REFERENCES public.prompts(id),
  attempt           integer       NOT NULL DEFAULT 1,
  status            text          NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','succeeded','failed','skipped','rolled_back','awaiting_approval')),
  claude_session_id text,
  checkpoint_sha    text,
  started_at        timestamptz,
  finished_at       timestamptz,
  duration_ms       integer,
  cost_usd          numeric(10,4) NOT NULL DEFAULT 0,
  input_tokens      bigint        NOT NULL DEFAULT 0,
  output_tokens     bigint        NOT NULL DEFAULT 0,
  cache_tokens      bigint        NOT NULL DEFAULT 0,
  error_code        text,
  error_message     text,
  error_raw         text,
  created_at        timestamptz   NOT NULL DEFAULT now()
);

-- ─── run_events (event log for SSE/Realtime) ──────────────────────────────────
CREATE TABLE public.run_events (
  id                  bigserial   PRIMARY KEY,
  run_id              uuid        NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  prompt_execution_id uuid        REFERENCES public.prompt_executions(id),
  event_type          text        NOT NULL,
  payload             jsonb       NOT NULL DEFAULT '{}',
  sequence            bigint      NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, sequence)
);

-- ─── guardian_decisions ───────────────────────────────────────────────────────
CREATE TABLE public.guardian_decisions (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_execution_id uuid          NOT NULL REFERENCES public.prompt_executions(id) ON DELETE CASCADE,
  question_detected   text,
  context_snippet     text,
  reasoning           text,
  decision            text,
  confidence          numeric(3,2),
  strategy            text          CHECK (strategy IN ('heuristic','llm','rule')),
  reviewed_by_human   boolean       NOT NULL DEFAULT false,
  human_override      text,
  created_at          timestamptz   NOT NULL DEFAULT now()
);

-- ─── output_chunks (raw logs, partitionable later) ────────────────────────────
CREATE TABLE public.output_chunks (
  id                  bigserial   PRIMARY KEY,
  prompt_execution_id uuid        NOT NULL REFERENCES public.prompt_executions(id) ON DELETE CASCADE,
  channel             text        NOT NULL CHECK (channel IN ('stdout','stderr','tool','meta')),
  content             text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ─── settings (per-user key-value) ───────────────────────────────────────────
CREATE TABLE public.settings (
  user_id               uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_channels jsonb       NOT NULL DEFAULT '{}',
  default_model         text        NOT NULL DEFAULT 'claude-sonnet-4-7',
  auto_approve_low_risk boolean     NOT NULL DEFAULT true,
  git_auto_commit       boolean     NOT NULL DEFAULT true,
  git_auto_push         boolean     NOT NULL DEFAULT false,
  theme                 text        NOT NULL DEFAULT 'dark',
  updated_at            timestamptz NOT NULL DEFAULT now()
);
