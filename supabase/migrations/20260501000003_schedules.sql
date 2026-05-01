-- ─────────────────────────────────────────────────────────────────────────────
-- schedules table
-- Stores cron-based schedules that trigger plan runs automatically.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.schedules (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  plan_id               uuid not null references public.plans(id) on delete cascade,
  name                  text not null check (char_length(name) between 1 and 100),
  cron_expression       text not null,
  enabled               boolean not null default true,
  working_dir           text,
  skip_if_running       boolean not null default false,
  skip_if_recent_hours  integer check (skip_if_recent_hours between 1 and 168),
  quiet_hours_start     integer check (quiet_hours_start between 0 and 23),
  quiet_hours_end       integer check (quiet_hours_end between 0 and 23),
  next_run_at           timestamptz,
  last_run_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- RLS
alter table public.schedules enable row level security;

create policy "schedules_owner_all" on public.schedules
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- updated_at trigger
create or replace function public.schedules_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger schedules_updated_at
  before update on public.schedules
  for each row execute function public.schedules_set_updated_at();

-- Index for scheduler tick (poll enabled schedules due to run)
create index if not exists idx_schedules_user_enabled
  on public.schedules (user_id, enabled, next_run_at)
  where enabled = true;
