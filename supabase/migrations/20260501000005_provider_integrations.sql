-- Migration: provider_integrations
-- Stores per-user connections to external services (GitHub, Slack, Discord, Telegram).
-- Distinct from the existing `integrations` table which is used for notification channel configs.

CREATE TABLE IF NOT EXISTS public.provider_integrations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL,
  provider   text        NOT NULL,
  name       text        NOT NULL DEFAULT '',
  config     jsonb       NOT NULL DEFAULT '{}',
  enabled    boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, provider),

  CONSTRAINT provider_integrations_provider_check
    CHECK (provider IN ('github', 'slack', 'discord', 'telegram'))
);

CREATE INDEX IF NOT EXISTS provider_integrations_user_idx
  ON public.provider_integrations (user_id);

-- ── RLS (dev: permissive for single-user mode) ────────────────────────────────
ALTER TABLE public.provider_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_dev" ON public.provider_integrations FOR ALL USING (true) WITH CHECK (true);

-- ── Realtime ──────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.provider_integrations;

-- ── Auto-update updated_at ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_provider_integrations_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER provider_integrations_updated_at
  BEFORE UPDATE ON public.provider_integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_provider_integrations_updated_at();
