-- Sample social posts shown under a public audit (an X post and a LinkedIn post written for the audited site).
-- Written by the server through the service role once, when the report's owner asks for them.
-- Apply BEFORE deploying the code that saves posts.

alter table public.public_audit_reports add column if not exists posts jsonb;
grant update (posts) on public.public_audit_reports to service_role;
