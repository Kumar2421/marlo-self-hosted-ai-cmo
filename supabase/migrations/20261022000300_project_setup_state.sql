-- Persisted project-setup progress so setup can resume after a reload or a closed tab.
-- One row per project. steps is {stepKey: {status: pending|running|done|failed|skipped, at, error?}};
-- the step list and transition rules live in lib/domain/project/setupState.ts.
-- Writes go through server routes (service role); owners may read their own row.

create table if not exists public.project_setup_state (
  project_id  uuid primary key references public.projects(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  steps       jsonb not null default '{}'::jsonb,
  started_at  timestamptz,
  finished_at timestamptz,
  updated_at  timestamptz not null default now()
);
create index if not exists project_setup_state_user_id_idx on public.project_setup_state (user_id);

alter table public.project_setup_state enable row level security;
drop policy if exists project_setup_state_select_own on public.project_setup_state;
create policy project_setup_state_select_own on public.project_setup_state for select
  using ((select auth.uid()) = user_id);
