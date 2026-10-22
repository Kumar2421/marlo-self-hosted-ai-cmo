# Hosted setup checklist

Ordered steps for running the hosted (platform) build. Variable names are in [environment.md](environment.md). For the runtime contract and acceptance gate, see [production-readiness.md](production-readiness.md).

1. **Supabase project.** Create one. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SECRET_KEY` (server only).

2. **Apply migrations in filename order.** The repo has 14 files in `supabase/migrations/`:
   - `20260916000000_baseline_core.sql` (captured from the live project; idempotent)
   - `20260919000000_actions.sql`
   - `20260928000000_marketing_funnel_events.sql`
   - `20260928010000_marketing_funnel_readout.sql`
   - `20261004000000_search_snapshots.sql`
   - `20261010000000_geo_runs.sql`
   - `20261011000000_x_drafts_review.sql`
   - `20261011010000_x_drafts_pending_status.sql`
   - `20261012000000_notifications.sql`
   - `20261013000000_vault_delete_secret.sql`
   - `20261016000000_social_drafts.sql`
   - `20261018000000_notifications_social_kind.sql`
   - `20261019000000_lock_trusted_tables.sql`
   - `20261020000000_rate_limits.sql`

   The baseline header says it does not create every table the code uses. Check the header before assuming a fresh project is complete.

3. **Google Cloud OAuth.** Create the OAuth client and set the consent screen to **Production** for a hosted deployment. Testing status limits sign-in to listed test users. Full steps: [google-cloud-setup.md](google-cloud-setup.md).

4. **GitHub App** (for "Connect GitHub" and fix PRs):
   - Callback URL: `https://<your-domain>/api/github/app/callback`.
   - Setup URL: the same URL, with "Redirect on update" ON.
   - "Request user authorization (OAuth) during installation": ON.
   - Marlo first sends the user through GitHub user authorization to find an installation they already have, because GitHub does not redirect back from the install page of an already-installed app. If none exists, it continues to the install page. If the Callback URL is not registered, GitHub rejects the authorization step. If the Setup URL or "Redirect on update" is off, users who change the app's repositories on GitHub are not sent back to Marlo and can click Connect GitHub again. If user authorization is off, installs cannot be verified and the connection fails with a plain message.
   - Repository permissions: Contents read and write, Pull requests read and write, Metadata read.
   - Set `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, and `NOTIFY_SIGNING_SECRET` (or rely on the client secret for signing).

5. **Resend** (email notifications). Verify the sending domain in Resend. Set `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`, `NEXT_PUBLIC_APP_URL`, and `NOTIFY_SIGNING_SECRET`. Without these, emails are not sent and in-app notifications still work.

6. **Cron.** `vercel.json` defines three crons: `leads-refresh` (daily), `search-monitor` (daily), and `geo-weekly` (weekly). On Hobby, each runs at most once per day. Set `CRON_SECRET`; Vercel sends it as a bearer token.

7. **Vercel environment, then redeploy.** Add the variables above to the project environment, then trigger a new deployment. Variables are read at build and runtime, so an old deployment will not see new values.

8. **Smoke checks after deploy.**
   - The login page returns HTTP 200.
   - Each cron route returns HTTP 401 without the `CRON_SECRET` bearer token. Example: `curl -i https://<your-domain>/api/cron/search-monitor` should return 401.
   - Sign in, create a project, and confirm the dashboard loads.

Keep the self-host database out of hosted deployments. Platform mode never reads `data/okara.db` ([production-readiness.md](production-readiness.md)).
