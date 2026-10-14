-- Local business leads (Google Places). Additive only: nullable columns on public.leads, plus a
-- unique index so one Google place is saved at most once per user and project. The live table has
-- no place_id rows, so the index cannot fail on existing data. Not applied from this branch.

alter table public.leads add column if not exists address text;
alter table public.leads add column if not exists website text;
alter table public.leads add column if not exists rating numeric;
alter table public.leads add column if not exists review_count integer;
alter table public.leads add column if not exists whatsapp text;
alter table public.leads add column if not exists contact_url text;
alter table public.leads add column if not exists description text;
alter table public.leads add column if not exists maps_url text;
alter table public.leads add column if not exists fit_reason text;
alter table public.leads add column if not exists fit_score numeric;
alter table public.leads add column if not exists enrichment_status text;

create unique index if not exists leads_project_place_uidx
  on public.leads (user_id, project_id, place_id)
  where place_id is not null;
