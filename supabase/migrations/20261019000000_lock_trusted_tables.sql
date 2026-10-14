-- SEC-01 / SEC-02: users must not be able to write server-trusted state through the public
-- database API (PostgREST with the anon key + their own session).
--
-- Before: profiles had an UPDATE policy with no WITH CHECK, and user_settings,
-- provider_connections, integration_connections and integration_resources had FOR ALL own-row
-- policies. A signed-in user could therefore set their own plan_tier / credits_balance, forge
-- the per-project GitHub link (installation id, repo), delete used approval-ticket nonces, or
-- point secret ids at someone else's vault entry.
--
-- After: end users can only READ their own rows on these tables. Every write in the app already
-- goes through the service-role client (which bypasses RLS and is unaffected), and no browser
-- code reads or writes these tables.
--
-- Rollback (restores the previous, unsafe behaviour; do not run unless something breaks):
--   create policy profiles_update_own on public.profiles for update using ((select auth.uid()) = id);
--   grant update on public.profiles to authenticated;
--   -- and for each table T below: drop policy T_select_own; create policy T_all_own for all
--   --   using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
--   --   grant insert, update, delete on public.T to authenticated;

-- profiles: read own row only.
drop policy if exists profiles_update_own on public.profiles;
revoke insert, update, delete, truncate on table public.profiles from anon, authenticated;
revoke select on table public.profiles from anon;

do $$
declare
  t text;
begin
  foreach t in array array['user_settings', 'provider_connections', 'integration_connections', 'integration_resources']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_all_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      t || '_select_own', t
    );
    execute format('revoke insert, update, delete, truncate on table public.%I from anon, authenticated', t);
    execute format('revoke select on table public.%I from anon', t);
  end loop;
end $$;
