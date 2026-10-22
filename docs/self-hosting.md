# Self-hosting Marlo

Marlo is free to self-host under the AGPL-3.0, with every feature unlocked and no plan limits. You bring your own API keys.

There are two ways to self-host:

| | Option A: SQLite (local) | Option B: your own Supabase |
|---|---|---|
| Who it is for | One person on their own machine or a private server | A team, or a public deployment with sign-in |
| Storage | `data/okara.db` (SQLite, created on first run) | Your Supabase Postgres, with row-level security |
| Sign-in | **None**. Anyone who can reach the app can use it | Supabase Auth (email with a one-time code; Google optional) |
| Scheduled jobs | None. The cron routes answer 404 in this mode | Three cron routes, called by Vercel Cron or your own scheduler |
| Plan gating | Never | Off unless you turn on `app_config.billing_enabled` (see [plans-and-pricing.md](plans-and-pricing.md)) |
| Setup effort | About 5 minutes | About an hour (Supabase, Google OAuth, optional GitHub App and Resend) |

`lib/features.ts` (`resolvePlatformMode`) decides the mode:

1. `NEXT_PUBLIC_PLATFORM_MODE=true` → Supabase mode.
2. Otherwise, `NEXT_PUBLIC_SELF_HOST=true` → SQLite mode.
3. Otherwise, on Vercel (the `VERCEL` variable is set) → Supabase mode, failing closed with HTTP 503 if Supabase is not configured.
4. Otherwise, Supabase mode when `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are both set, and SQLite mode when they are not.

## Option A: SQLite

### Requirements

- Node.js **24.12.0 or newer** (`engines` in `package.json`; CI runs Node 24).
- git and npm.
- A build toolchain only if npm cannot download a prebuilt `better-sqlite3` binary for your platform (see troubleshooting below).

### Steps

```bash
git clone https://github.com/Kumar2421/okara-alternative.git
cd okara-alternative
npm install
echo "NEXT_PUBLIC_SELF_HOST=true" > .env.local
npm run dev            # development server on http://localhost:3000
```

For a production-style server:

```bash
npm run build
npm start              # serves on port 3000; set PORT to change it
```

1. Open `http://localhost:3000/dashboard`. The root path `/` redirects to `/login`, which is the hosted sign-in page and needs Supabase.
2. **Check the setup.** `GET http://localhost:3000/api/system/storage-diagnostics` should return `"storageMode":"sqlite"` and `"sqlite":{"available":true,...}`.
3. **Add a model.** In **Settings → LLM Providers**, connect at least one provider. A local Ollama or LM Studio server on `localhost` is allowed in this mode.
4. **Add optional keys** in **Settings → API Credentials**:

   | Key | Unlocks | Without it |
   |---|---|---|
   | Tavily | Web search for competitors, leads, simulated GEO | Lead search reports that a search key is not configured. Competitor discovery and documents have less web context |
   | PageSpeed Insights | Lighthouse scores in the audit | The audit shows "Not measured" for those scores |
   | Gemini | Real GEO answers grounded in Google Search | GEO uses the simulated method (needs Tavily and a Groq provider) or shows nothing |
   | Google Cloud | Local business search (Places API (New)), Custom Search | Lead search uses Tavily only |
   | GitHub token + repository | Draft fix PRs | "Fix in code" is unavailable |
   | Gmail, Google Analytics | Outreach email, Traffic tab | Those panels show a connect prompt |

   Gmail and Google Analytics or Search Console use OAuth, so they also need `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` in `.env.local`. See [google-cloud-setup.md](google-cloud-setup.md).
5. **Add your website.** Setup runs in your browser tab. If you close the tab, open the project again and setup resumes from the steps that are still missing. The finish-setup checklist has a Retry button for each failed step.

Optional email notifications: set `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`, `NOTIFY_SIGNING_SECRET` (at least 16 characters) and `NOTIFY_TO_EMAIL` (otherwise the connected Gmail address is used). Every variable is listed in [environment.md](environment.md).

### Keep it private

SQLite mode has **no sign-in**. Your provider keys are stored in `data/okara.db`. Run it on your own machine, or behind a VPN or an authenticating reverse proxy. Never put it on the open internet as is. Back up `data/okara.db` (WAL mode, so copy it while the server is stopped, or copy the `-wal` and `-shm` files with it).

### What you do by hand in this mode

The scheduled jobs (daily Search Console snapshot, automatic re-check after a fix, regression watch, daily leads refresh, weekly GEO run, daily social drafts, notification digest) run only in Supabase mode. In SQLite mode:

- Refresh Traffic from the Traffic tab.
- Click **Re-check** on a finding after you ship a fix.
- Run GEO prompts from the GEO tab.

## Option B: your own Supabase

This runs the same build as [app.marlo.mlforge.in](https://app.marlo.mlforge.in) on your own infrastructure. The ordered checklist is [hosted-setup.md](hosted-setup.md). This section adds what that checklist does not cover.

1. **Create a Supabase project.** Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SECRET_KEY` (server only).
2. **Apply every file in `supabase/migrations/` in filename order.** As of #180 there are 20 files, ending with `20261022000300_project_setup_state.sql`. The list in hosted-setup.md predates the last six.
3. **Email codes.** Sign-up uses a one-time code. The Supabase "Confirm signup" email template must include `{{ .Token }}`, or users will get a link and no code to type.
4. **Waitlist table.** `/api/waitlist` writes to `marketing_leads`, which the baseline migration does not create. Create that table, or expect the waitlist form to fail.
5. **Platform model keys.** These are optional. `GROQ_API_KEY` and `MISTRAL_API_KEY` give new users a working default model. Without them, users bring their own key.
6. **Optional integrations.** Google OAuth ([google-cloud-setup.md](google-cloud-setup.md)), the GitHub App for fix PRs, Resend for email, and `GEMINI_API_KEY` for real GEO answers.
7. **Plan enforcement** stays off unless you set `app_config.billing_enabled = true`. Self-hosters normally leave it off.

### Cron recipe

There are three cron routes. Each one is idempotent per day (GEO: per week), stops before 60 seconds, and continues on its next call. Each one needs `Authorization: Bearer $CRON_SECRET`.

| Route | `vercel.json` schedule (UTC) | What it does |
|---|---|---|
| `/api/cron/leads-refresh` | `0 0 * * *` | Daily leads for projects with a confirmed lead profile |
| `/api/cron/search-monitor` | `0 3 * * *` | Search Console snapshots, daily proposals, fix-PR reconcile, social drafts, auto-verify and monitor, notifications |
| `/api/cron/geo-weekly` | `0 5 * * 1` | Weekly GEO prompt runs |

On Vercel, `vercel.json` already defines these. Set `CRON_SECRET` and Vercel sends it for you. Hobby runs each cron at most once a day.

Anywhere else, use crontab or any scheduler:

```cron
# m h dom mon dow   command
0 0 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://marlo.example.com/api/cron/leads-refresh  >/dev/null
0 3 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://marlo.example.com/api/cron/search-monitor >/dev/null
0 5 * * 1  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://marlo.example.com/api/cron/geo-weekly     >/dev/null
```

Because each run is time-boxed, a deployment with many sites gets better coverage if you call `search-monitor` more often, for example every 30 minutes. Repeat calls only do the work that is still left that day.

**Smoke check:** `curl -i https://<your-domain>/api/cron/search-monitor` without the header must return **401**.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `npm install` fails while building `better-sqlite3` | No prebuilt binary for your Node or OS, and no compiler | Use Node 24.12+ on a mainstream OS, or install Python 3 and a C++ toolchain (Windows: VS Build Tools; macOS: Xcode CLT; Linux: `build-essential`) |
| `npm` warns about `engines` or the app crashes on start | Node older than 24.12 | Upgrade Node |
| `http://localhost:3000` shows a sign-in page that cannot work | `/` redirects to `/login`, which needs Supabase | Open `/dashboard` directly |
| Every page answers **503 "Platform authentication is not configured"** | Supabase mode without Supabase variables (for example on Vercel with no mode flag) | Set the Supabase variables, or `NEXT_PUBLIC_SELF_HOST=true` for SQLite mode |
| Cron route answers **404** "Not available in self-host mode" | Crons are Supabase-mode only | Expected in SQLite mode. Use the manual actions above |
| Cron route answers **401** | Missing or wrong `CRON_SECRET` | Set the same value in the app and in the scheduler |
| Setup stopped partway | The tab was closed or reloaded. Setup runs in the browser | Reopen the project. It resumes, or use Retry in the finish-setup checklist |
| Setup does not resume on Supabase | `project_setup_state` table missing | Apply `20261022000300_project_setup_state.sql`. Without it, setup still runs but cannot resume |
| Audit shows "Not measured" for performance | No PageSpeed key, or PageSpeed timed out | Add a PageSpeed key. Timeouts are reported, never filled in |
| GEO tab has no runs | No Gemini key, and no Tavily + Groq pair | Add a Gemini key (real) or Tavily and Groq (simulated) |
| Lead emails stay "unverified" | SMTP checks need outbound port 25, which most cloud hosts block | Expected on Vercel and most PaaS hosts |
| "Fix in code" fails with an approval error (Supabase mode) | No signing secret | Set `GITHUB_APP_CLIENT_SECRET` or `NOTIFY_SIGNING_SECRET` |
| No email is sent | Resend not configured or signing secret missing | Set `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`, `NOTIFY_SIGNING_SECRET` (16+ chars) |
| Waitlist form fails on your Supabase | `marketing_leads` table missing | Create it (see step 4 above) |
| Google sign-in limited to a few accounts | OAuth consent screen in Testing | Publish the consent screen ([google-cloud-setup.md](google-cloud-setup.md)) |
