# Security review: bot handling, SSRF, authorization (2026-10)

Scope: current `main` at `678126e` (read-only audit, no exploitation, no production traffic). Sections A-G of the audit brief.
Evidence levels: CONFIRMED = read in code and/or verified against live catalog; HYPOTHETICAL = pattern present, preconditions not shown.

## Findings

| ID | Sev | Finding | Evidence | Status | Fix |
|---|---|---|---|---|---|
| SEC-01 | P1 | Signed-in users can edit their own `profiles` row (`plan_tier`, `credits_balance`): UPDATE policy without WITH CHECK, table-wide UPDATE grant | live `pg_policies` (`with_check = null`), live grants | CONFIRMED | S1 migration `20261019000000_lock_trusted_tables.sql` |
| SEC-02 | P1 (conditional) | Users can write server-trusted rows in `user_settings` (GitHub App link, used-ticket nonces, `active_project_id`) and secret-id columns in `provider_connections` / `integration_connections` | live policies; `githubAppService.ts:87-101` trusts stored link | CONFIRMED (0 links today) | same migration; server re-checks link ownership |
| SEC-03 | P1 | Anonymous SSRF on `/api/public/audit`: redirect hops name-only, no DNS pinning, robots.txt follows redirects, verbose crawl errors | `SEOAgent.ts:210-212`, `:293`, `:337` | CONFIRMED | S2 (supersedes #115) |
| SEC-04 | P2 | Per-instance, never-evicted in-memory rate limiter; no cross-instance limit | `public/audit/route.ts:8-28` | CONFIRMED | S3 shared limiter |
| SEC-05 | P2 | Unbounded crawl cost: idle-only timeout, no body cap, no concurrency cap | `SEOAgent.ts` | CONFIRMED | S2/S3 |
| SEC-06 | P2 | `/api/public/audit/events` unthrottled; table policy only checks id length and counts | `events/route.ts`, migration `20260928000000` | CONFIRMED | S3 |
| SEC-07 | P2 | Other unguarded outbound fetches (competitors, site crawl, reachability, link check, favicon) | see fetch table below | CONFIRMED | S2 |
| SEC-08 | P2 | Old GitHub and GA OAuth callbacks do not bind state to the browser session | `auth/github/callback`, `auth/google-analytics/callback` | CONFIRMED | S4 |
| SEC-09 | P2 | `leads-refresh` cron authorizes `Bearer ${CRON_SECRET}` directly ("Bearer undefined" if unset) | `cron/leads-refresh/route.ts:35` | CONFIRMED (latent) | S4 |
| SEC-10 | P2 | `PLATFORM_MODE` falls back to self-host mode when env is missing | `lib/features.ts:30-36` | CONFIRMED (deploy-time) | S4 |
| SEC-11 | P2 | Unmetered project lead generation; chat route has no input caps | `project/[id]/generate-leads`, `chat/route.ts` | CONFIRMED | S4 |
| SEC-12 | P2 | No security headers (CSP/frame-ancestors, XFO, nosniff, Referrer-Policy) | `next.config.ts` | CONFIRMED | S4 |
| SEC-13 | P2 | `next@16.3.3` in a critical advisory range (RCE path not reachable: no `next/og`/`use cache`); undici, sharp, source-map-js advisories | `npm audit --omit=dev` | CONFIRMED (reachability low) | S4 upgrade |
| SEC-14 | P2 | No branch protection, no Dependabot alerts, no CodeQL | GitHub API | CONFIRMED | GitHub settings (see PR body) |

P3: ticket released after a PR was opened (retry opens a second PR); charge before a failing proposal; non-constant-time cron compare; leads-refresh has no claim/time budget; GET handlers with side effects and no Origin check on JSON POSTs; plan lookup fails open (by design); global audit cache; actions pinned by tag; self-host env route unauthenticated; `npm test` found 0 tests on local Node 22 (CI Node 24 expected to pick up `tests/*.test.mts`, unverified).

Correction to an early hypothesis: on Vercel, `X-Forwarded-For` is overwritten by the platform (https://vercel.com/docs/headers/request-headers), so it is not client-spoofable there. It matters only for self-host or proxied deployments.

## Outbound fetch paths (user-influenced URLs) on `main`

Public audit crawl (name-only per hop, no body cap); SEO robots.txt (none); SiteCrawl `cheapFetchPage` (seed literal only); `checkUrlReachable` (none); competitor snippet/comparison (none, content returned); competitor discover (none); favicon (none); GEO `safeFetch` (per-hop name check, no DNS); CMS `cmsFetch` (DNS + per-hop, no pinning, strongest).

## Verified OK

Signed tokens and approval tickets (HMAC, purpose-separated, expiring, single-use nonces, bound to user/project/finding/content hash); vault RPC grants; cron work time-boxed and resumable; WordPress/Webflow guards; draft-only PRs, no merge path; no committed secrets; RLS on the user tables; `next build` type-checks.

## Not verified

Live Vercel headers (HSTS), GEO overview/history route auth, self-host exposure, Node 24 test discovery, anything requiring production traffic.

## Rollback

Each security PR is independent. S1 rollback SQL is in the migration header. Code PRs revert with `git revert <merge commit>`.
