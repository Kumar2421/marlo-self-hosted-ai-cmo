-- Connection health for Google (GSC/GA4) rows: lets the daily job stop retrying a revoked or
-- mismatched grant and lets the UI say "reconnect". Additive and nullable; app code tolerates
-- the columns being absent until this is applied.
alter table public.integration_connections
  add column if not exists status text not null default 'connected'
    check (status in ('connected', 'needs_reconnect')),
  add column if not exists last_error_code text,
  add column if not exists last_error_at timestamptz;
