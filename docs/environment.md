# Environment variables

Names only. Never commit values. Hosted values go in the Vercel project settings; self-host values go in a local `.env.local` (not committed).

## Required for hosted (platform) mode

| Variable | Required for | Used by |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Hosted auth and data | `proxy.ts`, `utils/supabase/*`, `lib/features.ts` (fails closed with 503 when missing in platform mode) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Hosted auth and data | Same as above |
| `SUPABASE_SECRET_KEY` | Server-side trusted DB access | `utils/supabase/serviceClient.ts` (server only) |

## Mode flags

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SELF_HOST` | `true` forces self-host mode (SQLite, no Supabase) |
| `NEXT_PUBLIC_PLATFORM_MODE` | `true` forces hosted mode even without the self-host flag |
| `NEXT_PUBLIC_SHOW_LLM_SETTINGS`, `NEXT_PUBLIC_SHOW_API_CREDENTIALS` | Show LLM and credential settings sections (self-host UI) |
| `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` | Show the Google sign-in button on the login page (hosted) |
| `VERCEL` | Set by Vercel; default-deny hosted mode when neither mode flag is set |

## Optional, by feature

Each feature degrades when its variables are missing. The exact behaviour is in the code path named.

| Feature | Variables | If missing |
|---|---|---|
| Transactional email (Resend) | `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`, `NEXT_PUBLIC_APP_URL` | No email is sent; in-app notifications still work (`lib/domain/notifications/runtime.ts`) |
| Email links and unsubscribe tokens | `NOTIFY_SIGNING_SECRET` | Emails are not sent without a signing secret; the test-email route says so (`app/api/notifications/send-test/route.ts`) |
| Self-host notification recipient | `NOTIFY_TO_EMAIL` | Falls back to the connected Gmail address (`lib/domain/notifications/selfHostSource.ts`) |
| GitHub App (connect GitHub, fix PRs) | `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` | Connect and fix-in-code are unavailable (`lib/domain/github/githubApp.ts`) |
| Fix approval tickets | `GITHUB_APP_CLIENT_SECRET` or `NOTIFY_SIGNING_SECRET` | Fix approvals fail closed with an error (`lib/githubAppServer.ts`) |
| Legacy GitHub OAuth (legacy) | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Legacy GitHub OAuth callback is unavailable (`lib/domain/shared/githubOAuth.ts`) |
| Gemini (GEO, grounded answers) | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_DAILY_CAP`, `SIMULATED_DAILY_CAP` | GEO uses the simulated engine (needs Tavily and Groq keys) or shows nothing (`lib/domain/geo/geoService.ts`, `dailyCap.ts`) |
| Web search (competitors, leads, content) | `TAVILY_API_KEY` | Free lead generation reports that a search key is not configured (`lib/domain/leads/autoGenerateLeads.ts`) |
| Groq / Mistral platform models | `GROQ_API_KEY`, `MISTRAL_API_KEY` | Platform-managed model calls are unavailable; users can bring their own key (`lib/llm/platformKeys.ts`) |
| PageSpeed Insights | `PAGESPEED_API_KEY` | SEO audit uses the crawl-derived substitute instead of PageSpeed scores (`app/api/agents/seo/audit/route.ts`) |
| Gmail outreach and reply checks | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` | Gmail connect is unavailable (`lib/domain/shared/gmailOAuth.ts`) |
| Google Cloud key (lead fallback, CSE) | `GOOGLE_CLOUD_API_KEY`, `GOOGLE_CSE_ID` | Lead search uses Tavily only (`app/api/agents/leads/search/route.ts`) |
| Local business search (Places API New) | None in env. Needs a Google Cloud API key with Places API (New) enabled, saved in Settings > API credentials | Route asks the user to connect the key (`app/api/agents/leads/places-search/route.ts`) |
| Cron jobs | `CRON_SECRET` | Cron routes return 401 (`lib/jobs/jobRunner.ts`) |
| Public audit rate limits | `AUDIT_GLOBAL_PER_MIN`, `AUDIT_UNKNOWN_PER_MIN` | Built-in defaults apply (`lib/domain/net/publicGuard.ts`) |
| Client IP behind a proxy | `TRUST_PROXY_HOPS` | Unset means proxy headers are not trusted (`lib/domain/net/publicGuard.ts`) |

## Not on main yet

- `GOOGLE_PLACES_API_KEY`: not read anywhere on `main`. Local business search currently uses the Google Cloud key saved in Settings.
