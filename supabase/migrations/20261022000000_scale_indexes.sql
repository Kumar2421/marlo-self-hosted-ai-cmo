-- Scale indexes (audit F12) plus covering indexes for the foreign keys the Supabase
-- performance advisor reports as unindexed. Additive and idempotent: every statement is
-- CREATE INDEX IF NOT EXISTS, nothing is dropped or rewritten, and app code does not depend
-- on any of them (they only change query plans). Plain CREATE INDEX takes a short write lock
-- on each table; run it in a quiet window on a large database.

-- ───────── Cron / global queries (audit F12) ─────────

-- Cron reads filter project_documents by doc_type alone (marker rows, product_info, social_daily_%);
-- the primary key leads with project_id so those were sequential scans.
create index if not exists project_documents_doc_type_project_id_idx
  on public.project_documents (doc_type, project_id);

-- search-monitor selects "snapshots taken today" and "since <date>"; the primary key leads with project_id.
create index if not exists search_snapshots_snapshot_date_idx
  on public.search_snapshots (snapshot_date);

-- listFixedFindingRows reads every fixed finding ordered by id, once per cron run.
create index if not exists findings_fixed_id_idx
  on public.findings (id) where status = 'fixed';

-- search-monitor finds GitHub-linked projects with user_settings key LIKE 'github_app:%'.
-- text_pattern_ops makes the prefix LIKE indexable under any collation; the partial predicate keeps it tiny.
create index if not exists user_settings_github_app_key_idx
  on public.user_settings (key text_pattern_ops) where key like 'github_app:%';

-- Dashboard loads leads ORDER BY created_at DESC LIMIT 1000 per project without a sort.
-- leads_project_id_idx is now redundant for most reads; it is left in place, drop it separately once verified.
create index if not exists leads_project_id_created_at_idx
  on public.leads (project_id, created_at desc);

-- ───────── Unindexed foreign keys (Supabase advisor 0001_unindexed_foreign_keys) ─────────
-- Without these, deleting a user or project scans the child table, and joins on the key are slow.

create index if not exists findings_user_id_idx
  on public.findings (user_id);

create index if not exists geo_locks_user_id_idx
  on public.geo_locks (user_id);

create index if not exists integration_oauth_states_project_id_idx
  on public.integration_oauth_states (project_id);

create index if not exists integration_oauth_states_user_id_idx
  on public.integration_oauth_states (user_id);

create index if not exists integration_resources_user_id_idx
  on public.integration_resources (user_id);
