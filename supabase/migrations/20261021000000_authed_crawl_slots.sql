-- Per-key concurrency slots for signed-in crawl-type jobs (one running job per project).
-- Separate from public.crawl_slots so these never count against the anonymous audit cap.
-- Apply BEFORE deploying code that calls authed_crawl_slot_acquire / authed_crawl_slot_release.

create table if not exists public.authed_crawl_slots (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  acquired_at timestamptz not null default now()
);

create index if not exists authed_crawl_slots_key_idx on public.authed_crawl_slots (key);

alter table public.authed_crawl_slots enable row level security;
revoke all on public.authed_crawl_slots from public, anon, authenticated;
grant select, insert, update, delete on public.authed_crawl_slots to service_role;

-- Takes a slot for p_key if fewer than p_max unexpired slots exist for it; returns its id, or null when full.
-- A slot older than its ttl is treated as free, so a crashed request cannot hold a slot forever.
create or replace function public.authed_crawl_slot_acquire(p_key text, p_max integer, p_ttl_seconds integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('public.authed_crawl_slots:' || p_key));

  delete from public.authed_crawl_slots
  where key = p_key
    and acquired_at < now() - make_interval(secs => p_ttl_seconds);

  select count(*)::integer into v_count from public.authed_crawl_slots where key = p_key;
  if v_count >= p_max then
    return null;
  end if;

  insert into public.authed_crawl_slots (key) values (p_key) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.authed_crawl_slot_release(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.authed_crawl_slots where id = p_id;
$$;

revoke execute on function public.authed_crawl_slot_acquire(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.authed_crawl_slot_release(uuid) from public, anon, authenticated;
grant execute on function public.authed_crawl_slot_acquire(text, integer, integer) to service_role;
grant execute on function public.authed_crawl_slot_release(uuid) to service_role;
