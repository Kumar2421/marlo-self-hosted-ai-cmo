# README claims checklist

Each factual claim in [README.md](../README.md) mapped to the file or PR on `main` (at `11a2228`, #180) that backs it. Use it to review the README. "Owner" marks a claim that comes from the owner and cannot be proven from the code.

## Hero and intro

| Claim | Proof |
|---|---|
| Name Marlo, tagline "Open-source AI CMO" | `app/pricing/page.tsx`, `lib/domain/plans/planMatrix.ts` ("One AI CMO per website"); owner |
| CI badge uses the `CI` workflow | `.github/workflows/ci.yml` (`name: CI`) |
| AGPL-3.0 | `LICENSE` |
| Pricing is beta | `lib/domain/plans/pricingView.ts` (`PRICING_BETA = true`) |
| Hosted at app.marlo.mlforge.in; repo `Kumar2421/marlo-self-hosted-ai-cmo` | Owner. The repository was renamed from `okara-alternative` (GitHub redirects the old URL); the product is named Marlo |
| Self-host: every feature unlocked, no plan limits | `lib/entitlements.ts` (`plan: "selfhost"`, `UNLIMITED_CHECK`), `lib/domain/plans/planPolicy.ts` (`resolvePlan`: selfHost → pro), `lib/domain/geo/dailyCap.ts` (self-host uncapped) |
| Inspired by Okara, not affiliated | Previous README; owner |

## What Marlo does

| Claim | Proof |
|---|---|
| Loop discover → understand → act → verify | `AGENTS.md`, `docs/current-state.md` |
| Verified only with evidence; a click never verifies | `lib/domain/findings/findingTypes.ts` (`EVIDENCE_ONLY_STATUSES`, `canUserTransitionFinding`); #151 |
| Setup: audit, description, competitors, Context docs (5 named) | `lib/domain/project/setupState.ts` (`SETUP_STEPS`) |
| Setup progress saved per project, resumes on return | #174; `app/api/project/setup/route.ts`, `lib/setup-client.ts`, `e2e/setup-resume.spec.ts` |
| Findings ranked; Fix first strip | `lib/domain/overview/fixFirst.ts`, `components/dashboard/FixFirstStrip.tsx`; #175 |
| Recommendation matches the issue | #152, #164 |
| Traffic tab (GSC, GA4), GEO tracking | `components/dashboard/AnalyticsPanel.tsx` (`TABS`), `lib/domain/shared/googleAnalyticsOAuth.ts` |
| Draft PRs through the GitHub App; nothing merges by itself | `lib/domain/codefix/githubApi.ts:169` (`draft: true`); no merge call in `lib/` |
| WordPress or Webflow publish with approval | #112; `lib/cmsServer.ts` |
| Re-check manual, automatic on hosted | `lib/domain/findings/recheckDecision.ts`; `autoVerifyJob.ts` called only from `app/api/cron/search-monitor/route.ts` (platform only) |
| "No longer detected", never auto-verified | `lib/domain/findings/vanishedFindings.ts` (header comment); #177 |
| GEO gap closes only on a later run that names you | `lib/domain/geo/geoGaps.ts` (header); #178, #179 |

## Status table

| Claim | Proof |
|---|---|
| Audit: 1 page; site crawl up to 8 pages, one link deep, on the Links tab | `lib/domain/seo/SiteCrawlAgent.ts:57` (`MAX_PAGES = 8`); `AnalyticsPanel.tsx` (site-crawl triggered from Links) |
| "Not measured" without PageSpeed | `lib/domain/seo/auditDisplay.ts`, `pageSpeedInsights.ts` |
| A failed or skipped check never verifies | `lib/domain/findings/recheckDecision.ts` (skipped changes nothing); #180 |
| GEO real (Gemini grounded) vs simulated (Tavily + Groq), never mixed; no ChatGPT/Perplexity/Claude | `lib/domain/geo/engines.ts`, `geoService.ts:104-116`, `geoGaps.ts` |
| Self-host fix PRs via saved token | `components/settings/GitHubCodeFixCard.tsx` |
| Resumable setup needs migration on hosted; does not run with tab closed | `supabase/migrations/20261022000300_project_setup_state.sql`; `lib/project-store.tsx` (client-orchestrated) |
| Email only with Resend | `lib/domain/notifications/runtime.ts` |
| Chat read-only tools, scoped to active project | #150, #110 |
| WordPress needs Yoast/Rank Math meta; Webflow unverified | Previous README "Limits" (not re-verified on a live site) |
| X/LinkedIn/Reddit: drafts, Post opens compose page | Previous README; #114, #117 |
| Local business search: Coming soon on hosted | `lib/features.ts` (`isLocalBusinessSearchBlocked`); #125 |
| No payment gateway, enforcement off | `lib/domain/plans/pricingView.ts` (`PRICING_BETA_NOTE`), `lib/entitlements.ts`, baseline migration (`billing_enabled` default false) |

## Hosted vs self-host

| Claim | Proof |
|---|---|
| Hosted legacy caps: 4 websites, 10 daily leads on Free | `lib/entitlements.ts` (`LEGACY_LIMITS`) |
| GEO daily caps 20 Gemini / 60 simulated (hosted) | `lib/domain/geo/dailyCap.ts` |
| Self-host has no sign-in | `proxy.ts` (no Supabase config → `NextResponse.next()`) |
| SQLite at `data/okara.db` | `lib/db.ts:52` |
| Crons hosted-only | `app/api/cron/*/route.ts` (`if (!FEATURES.PLATFORM_MODE)` → 404) |
| Hosted jobs list | `vercel.json`; `app/api/cron/search-monitor/route.ts` phases |

## Quick start

| Claim | Proof |
|---|---|
| Node ≥ 24.12 | `package.json` `engines` |
| `npm install`, `npm run dev`, `npm run build`, `npm start` | `package.json` scripts |
| `NEXT_PUBLIC_SELF_HOST=true` forces SQLite | `lib/features.ts` (`resolvePlatformMode`) |
| `/` redirects to `/login` (needs Supabase) → open `/dashboard` | `app/page.tsx`, `utils/supabase/client.ts`. Read in code, **not run** in this session |
| Storage diagnostics returns `storageMode: sqlite`, `sqlite.available` | `app/api/system/storage-diagnostics/route.ts` |
| Provider list (only providers with a driver), API Credentials cards | `lib/llm/index.ts` (`DRIVERS`: anthropic, openai, google, groq, mistral, lmstudio, ollama, custom). xAI and OpenRouter appear in `lib/mock-providers.ts` but have no driver, so they are left out. `app/settings/api-credentials/page.tsx` |
| No env vars required in self-host | `lib/features.ts`; `proxy.ts` |

## How it works / Security

| Claim | Proof |
|---|---|
| Mode chosen in `lib/features.ts`; 503 fail closed | `lib/features.ts`, `proxy.ts` |
| Store pairs | `lib/domain/**/*Store.ts` + `*StoreSupabase.ts` |
| Lifecycle transitions | `lib/domain/findings/findingTypes.ts` (`FINDING_TRANSITIONS`); merged PR → fixed via `lib/domain/fixes/reconcileFixPullRequests.ts:106` + `lib/domain/findings/pathToFixed.ts` |
| `auth.getUser()`, no `getSession()` on the server | grep: 0 `getSession()` in `app/ lib/ utils/ proxy.ts` |
| RLS; trusted tables locked | `supabase/migrations/20261019000000_lock_trusted_tables.sql`; #120 |
| Ownership-checked project routes | `lib/domain/shared/project-context.ts` |
| Guarded fetch: DNS pin, redirect re-check, deadline, body cap | `lib/domain/net/safeFetch.ts` (header; `DEFAULT_MAX_BYTES = 2_000_000`); #122 |
| OAuth state single-use, expiring; hosted bound to user | `lib/domain/integrations/oauthState.ts`, `app/api/auth/google-analytics/callback/route.ts:46-51`; #123 |
| Signed expiring unsubscribe tokens | `lib/domain/notifications/tokens.ts` |
| Operator keys never sent to user base URL | #170; `supabase/migrations/20261022000200_provider_baseurl_guard.sql`, `lib/domain/net/providerBaseUrl.ts` |
| Signed approval for external writes | `lib/domain/github/signedPayload.ts`, `.env.example` comment |
| Cron bearer, constant time | `lib/jobs/jobRunner.ts` (`isAuthorizedCron`) |
| CSP report-only | `lib/security/securityHeaders.ts:41` |

## Pricing, roadmap, contributing

| Claim | Proof |
|---|---|
| Free/Lite/Pro per website; Lite $29 ($24 annual), Pro $79 ($66 annual) | `lib/domain/plans/planMatrix.ts` (`PLAN_PRICES`, `price()`; 10 months charged per year) |
| Waitlist at /pricing | `app/pricing/page.tsx`, `app/api/waitlist/route.ts`; #168 |
| Roadmap order (core loop → audit → hardening) | Owner plan (2026-10-22) |
| Cron coverage limited at large fleets | `app/api/cron/*` budgets (45 to 50 s, one invocation per day or week); scale audit P4 |
| Full crawl not built | `SiteCrawlAgent.ts` `MAX_PAGES = 8` |
| Lead SMTP checks blocked on most clouds | `lib/domain/leads/emailVerify.ts` (comment on TCP/25) |
| Some a11y/visual e2e specs red | **Owner-reported; not run in this session.** `e2e/README.md` documents `test.fixme` gaps and that visual baselines are Windows-only; `.github/workflows/e2e.yml` is manual |
| CI: lint changed files, `npm test` (+ zero-tests guard), build; full lint informational; `pr-base-guard` | `.github/workflows/ci.yml` |
| Test commands | `package.json` scripts, `e2e/README.md` |
