-- linkedin_drafts.hook_line: the LinkedIn writer stores the opening line of each draft separately
-- (lib/domain/linkedin/linkedInDraftStoreSupabase.ts), and the SQLite twin already has the column,
-- but no hosted migration ever added it, so saving a draft failed with
-- "Could not find the 'hook_line' column of 'linkedin_drafts' in the schema cache".
-- Additive and safe to re-run: existing rows get an empty hook line.
alter table public.linkedin_drafts add column if not exists hook_line text not null default '';

-- Make PostgREST pick up the new column without waiting for a restart.
notify pgrst, 'reload schema';
