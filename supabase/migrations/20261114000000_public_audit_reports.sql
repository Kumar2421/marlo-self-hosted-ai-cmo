-- Shareable copies of public audit results (/audit/r/<id>).
-- Read and written by the server through the service role only: anon and authenticated get nothing.
-- Apply BEFORE deploying the code that saves or reads reports.

create table if not exists public.public_audit_reports (
  id text primary key,
  url text not null,
  host text not null,
  score integer not null check (score between 0 and 100),
  summary jsonb not null,
  findings jsonb not null,
  owner_token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists public_audit_reports_expires_at_idx on public.public_audit_reports (expires_at);

alter table public.public_audit_reports enable row level security;
-- No policies on purpose.
revoke all on public.public_audit_reports from public, anon, authenticated;
grant select, insert, delete on public.public_audit_reports to service_role;

-- Two new funnel events for shared reports. A missing migration only makes those event inserts fail (the
-- events endpoint answers 500 and the browser ignores it); nothing else depends on them.
alter table public.marketing_funnel_events drop constraint if exists marketing_funnel_events_event_check;
alter table public.marketing_funnel_events add constraint marketing_funnel_events_event_check
  check (event in ('audit_started','audit_completed','audit_failed','signup_cta_clicked','signup_completed','report_viewed','report_shared'));
