-- seed.sql — runs on every `supabase db reset` (local dev only)
-- Mirrors migration 20260428000005_seed_dev_data.sql — keep in sync.

DO $$
DECLARE
  v_user_id uuid := '00000000-0000-0000-0000-000000000001';
  v_plan_id uuid;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    is_super_admin, created_at, updated_at
  ) VALUES (
    v_user_id, 'authenticated', 'authenticated', 'dev@conductor.local',
    crypt('conductor123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"name":"Dev User"}',
    false, now(), now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.settings (user_id)
  VALUES (v_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.plans (user_id, name, description, is_template, tags)
  SELECT v_user_id, 'Hello Conductor',
    'A simple 3-prompt template to verify your Conductor setup.',
    true, ARRAY['template','demo']
  WHERE NOT EXISTS (
    SELECT 1 FROM public.plans WHERE user_id = v_user_id AND name = 'Hello Conductor'
  )
  RETURNING id INTO v_plan_id;

  IF v_plan_id IS NOT NULL THEN
    INSERT INTO public.prompts (plan_id, order_index, title, content) VALUES
      (v_plan_id, 0, 'Setup check',
       'List the files in the current directory and report how many there are.'),
      (v_plan_id, 1, 'Create hello file',
       'Create a file called hello.txt with the content "Hello from Conductor!".'),
      (v_plan_id, 2, 'Verify and report',
       'Read hello.txt and confirm its contents match exactly "Hello from Conductor!".');
  END IF;
END;
$$;
