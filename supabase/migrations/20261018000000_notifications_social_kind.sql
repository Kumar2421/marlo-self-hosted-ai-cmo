-- Adds the social notification kinds (in-app items for the daily social drafts):
-- social_drafts_ready (drafts created) and social_drafts_paused (out of credits).
-- Additive only: the kind check is widened, existing rows stay valid. Must be applied by hand.

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('weekly_digest', 'outcome_measured', 'credits_low', 'approval_needed', 'integration_disconnected', 'social_drafts_ready', 'social_drafts_paused'));
