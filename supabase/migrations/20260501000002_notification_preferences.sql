-- Migration: notification_preferences + integrations
-- Adds tables required by the notifications settings page.

-- ── notification_preferences ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL,
  event_type    text        NOT NULL,
  channel       text        NOT NULL,
  enabled       boolean     NOT NULL DEFAULT true,
  severity_threshold text   NOT NULL DEFAULT 'info',
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, event_type, channel),

  CONSTRAINT notification_preferences_event_type_check
    CHECK (event_type IN (
      'run.completed', 'run.failed', 'auth.invalid',
      'circuit.open', 'rate_limit.long', 'approval.required', 'cost.threshold'
    )),
  CONSTRAINT notification_preferences_channel_check
    CHECK (channel IN ('desktop', 'email', 'slack', 'discord', 'telegram')),
  CONSTRAINT notification_preferences_severity_check
    CHECK (severity_threshold IN ('info', 'warning', 'critical'))
);

CREATE INDEX IF NOT EXISTS notification_preferences_user_event_idx
  ON public.notification_preferences (user_id, event_type);

-- ── integrations ─────────────────────────────────────────────────────────────
-- Stores per-user channel configs (webhook URLs, email address, bot tokens).
-- Config is stored as JSONB keyed by channel name.
CREATE TABLE IF NOT EXISTS public.integrations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL,
  channel    text        NOT NULL,
  config     jsonb       NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, channel),

  CONSTRAINT integrations_channel_check
    CHECK (channel IN ('desktop', 'email', 'slack', 'discord', 'telegram'))
);

-- ── RLS (dev: permissive for single-user mode) ────────────────────────────────
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_dev" ON public.notification_preferences FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_dev" ON public.integrations FOR ALL USING (true) WITH CHECK (true);

-- ── Realtime ──────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_preferences;
ALTER PUBLICATION supabase_realtime ADD TABLE public.integrations;
