-- Shared rate limiting and crawl concurrency for public, anonymous endpoints.
-- Hosted (Supabase) deployments use these tables through the service role only.
-- Apply BEFORE deploying the code that calls rate_limit_hit / crawl_slot_*.

-- Fixed-window counters. One row per (key, window start).
create table if not exists public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

alter table public.rate_limits enable row level security;
-- No policies: anon and authenticated get nothing; the service role bypasses RLS.
revoke all on public.rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.rate_limits to service_role;

-- Atomically counts one hit against the current fixed window.
-- Windows are aligned to the epoch, so every instance agrees on the boundary.
create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer, p_limit integer)
returns table (allowed boolean, remaining integer, retry_after integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if p_window_seconds < 1 or p_limit < 1 then
    raise exception 'rate_limit_hit: window and limit must be positive';
  end if;

  v_window := date_bin(make_interval(secs => p_window_seconds), now(), 'epoch'::timestamptz);

  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into v_count;

  return query select
    (v_count <= p_limit),
    greatest(p_limit - v_count, 0),
    greatest(ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds)) - now()))::integer, 0);
end;
$$;

revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- Deletes counter windows older than one day. Returns the number of rows removed.
-- Call from the daily cron as the service role: select public.rate_limits_cleanup();
create or replace function public.rate_limits_cleanup()
returns integer
language sql
security definer
set search_path = public
as $$
  with removed as (
    delete from public.rate_limits
    where window_start < now() - interval '1 day'
    returning 1
  )
  select count(*)::integer from removed;
$$;

revoke execute on function public.rate_limits_cleanup() from public, anon, authenticated;
grant execute on function public.rate_limits_cleanup() to service_role;

-- Concurrency slots for crawls. A slot older than its ttl is treated as free,
-- so a crashed request cannot hold a slot forever.
create table if not exists public.crawl_slots (
  id uuid primary key default gen_random_uuid(),
  acquired_at timestamptz not null default now()
);

alter table public.crawl_slots enable row level security;
revoke all on public.crawl_slots from public, anon, authenticated;
grant select, insert, update, delete on public.crawl_slots to service_role;

-- Takes a slot if fewer than p_max unexpired slots exist; returns its id, or null when full.
-- The transaction-scoped advisory lock serialises concurrent acquires so the count is exact.
create or replace function public.crawl_slot_acquire(p_max integer, p_ttl_seconds integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('public.crawl_slots'));

  delete from public.crawl_slots
  where acquired_at < now() - make_interval(secs => p_ttl_seconds);

  select count(*)::integer into v_count from public.crawl_slots;
  if v_count >= p_max then
    return null;
  end if;

  insert into public.crawl_slots default values returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.crawl_slot_release(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.crawl_slots where id = p_id;
$$;

revoke execute on function public.crawl_slot_acquire(integer, integer) from public, anon, authenticated;
revoke execute on function public.crawl_slot_release(uuid) from public, anon, authenticated;
grant execute on function public.crawl_slot_acquire(integer, integer) to service_role;
grant execute on function public.crawl_slot_release(uuid) to service_role;
