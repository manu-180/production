-- Migration: 20260501000006_webhook_endpoints_and_push.sql
-- Adds webhook_endpoints and web_push_subscriptions tables (Phase 14)

-- ─── webhook_endpoints ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id             uuid        NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  name                text        NOT NULL,
  secret              text        NOT NULL,
  source              text        NOT NULL DEFAULT 'generic',
  github_event        text,
  enabled             boolean     NOT NULL DEFAULT true,
  last_triggered_at   timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.webhook_endpoints
  DROP CONSTRAINT IF EXISTS webhook_endpoints_source_check;
ALTER TABLE public.webhook_endpoints
  ADD CONSTRAINT webhook_endpoints_source_check
  CHECK (source IN ('github', 'generic'));

ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='webhook_endpoints' AND policyname='webhook_endpoints_select_own') THEN
    CREATE POLICY "webhook_endpoints_select_own" ON public.webhook_endpoints FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='webhook_endpoints' AND policyname='webhook_endpoints_insert_own') THEN
    CREATE POLICY "webhook_endpoints_insert_own" ON public.webhook_endpoints FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='webhook_endpoints' AND policyname='webhook_endpoints_update_own') THEN
    CREATE POLICY "webhook_endpoints_update_own" ON public.webhook_endpoints FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='webhook_endpoints' AND policyname='webhook_endpoints_delete_own') THEN
    CREATE POLICY "webhook_endpoints_delete_own" ON public.webhook_endpoints FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS webhook_endpoints_user_id_idx ON public.webhook_endpoints(user_id);
CREATE INDEX IF NOT EXISTS webhook_endpoints_plan_id_idx ON public.webhook_endpoints(plan_id);

-- ─── web_push_subscriptions ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.web_push_subscriptions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint    text        NOT NULL UNIQUE,
  p256dh      text        NOT NULL,
  auth        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='web_push_subscriptions' AND policyname='web_push_subscriptions_select_own') THEN
    CREATE POLICY "web_push_subscriptions_select_own" ON public.web_push_subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='web_push_subscriptions' AND policyname='web_push_subscriptions_insert_own') THEN
    CREATE POLICY "web_push_subscriptions_insert_own" ON public.web_push_subscriptions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='web_push_subscriptions' AND policyname='web_push_subscriptions_update_own') THEN
    CREATE POLICY "web_push_subscriptions_update_own" ON public.web_push_subscriptions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='web_push_subscriptions' AND policyname='web_push_subscriptions_delete_own') THEN
    CREATE POLICY "web_push_subscriptions_delete_own" ON public.web_push_subscriptions FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS web_push_subscriptions_user_id_idx ON public.web_push_subscriptions(user_id);
