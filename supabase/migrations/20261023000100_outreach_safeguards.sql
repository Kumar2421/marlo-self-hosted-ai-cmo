-- Outreach safeguards: a per-user stop list and a send log.
--   outreach_optouts: addresses a user must never email again (clicked unsubscribe, or replied "stop").
--   outreach_sends:   one row per outreach email actually sent; drives the daily cap (25 per user per UTC day,
--                     across projects) and the 30-day no-repeat rule. Test sends are never logged here.
-- Server-only: RLS is on with no policies, and anon/authenticated have no table privileges. The app reads and
-- writes through the service role (the unsubscribe link is public but goes through a server route).

create table if not exists public.outreach_optouts (
  user_id    uuid not null references auth.users(id) on delete cascade,
  email      text not null check (email = lower(email)),
  reason     text not null check (reason in ('unsubscribed', 'reply_stop')),
  created_at timestamptz not null default now(),
  primary key (user_id, email)
);

create table if not exists public.outreach_sends (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid null,
  lead_id    text null,
  email      text not null check (email = lower(email)),
  sent_at    timestamptz not null default now(),
  message_id text null
);
create index if not exists outreach_sends_user_sent_idx on public.outreach_sends (user_id, sent_at desc);
create index if not exists outreach_sends_user_email_idx on public.outreach_sends (user_id, email, sent_at desc);

alter table public.outreach_optouts enable row level security;
alter table public.outreach_sends enable row level security;
revoke all on public.outreach_optouts from anon, authenticated;
revoke all on public.outreach_sends from anon, authenticated;

-- Credit registry entry for the 'outreach_send' action: 1 credit per 5 emails sent, recorded as one usage
-- event per credit after sending. Billing is off in beta, so this is metering only and never blocks.
insert into public.credit_costs (agent_type, credits, description) values
  ('outreach_send', 1, 'Outreach email: 1 credit per 5 emails sent')
on conflict (agent_type) do nothing;
