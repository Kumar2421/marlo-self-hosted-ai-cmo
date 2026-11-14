-- Businesses shown under a public audit (teaser only: name, host, fit sentence, which contact kinds exist).
-- Written by the server through the service role once, when the report's owner asks for them.
-- Apply BEFORE deploying the code that saves leads.

alter table public.public_audit_reports add column if not exists leads jsonb;
grant update (leads) on public.public_audit_reports to service_role;
