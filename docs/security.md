# Security

This page summarizes the protections on `main` (as of #180) and where each one lives. The full audit, with severities and evidence, is in [security-review.md](../security-review.md). To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## Authentication and sessions (hosted)

- Supabase Auth handles sign-in: email and password with a one-time email code, and Google sign-in when `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`. Signing in asks only for identity scopes. Gmail and Google data scopes are requested only when you connect those services (#148).
- `proxy.ts` refreshes the session on every non-static request. Server routes check the user with `supabase.auth.getUser()`, which validates against Supabase Auth, and never trust a cookie-only session.
- **Fail closed.** If a deployment is in platform mode without Supabase config, `proxy.ts` answers 503 instead of serving an unauthenticated app. On Vercel, a deployment with no mode flag defaults to platform mode (`lib/features.ts`).

## Authorization and isolation

- **Row-level security** on user tables, written as `(select auth.uid()) = user_id`. Server-trusted tables (`profiles`, `user_settings`, connection tables) are read-only to end users ([`20261019000000_lock_trusted_tables.sql`](../supabase/migrations/20261019000000_lock_trusted_tables.sql)), so a user cannot raise their own plan or credits.
- **Project ownership.** `getAuthenticatedProjectContext()` (`lib/domain/shared/project-context.ts`) establishes the user, the project, and that the user owns it. Supabase stores filter by both `user_id` and `project_id`. Client-supplied identity is never trusted.
- **Evidence-only statuses.** A user cannot set a finding to `verified` or `failed`. Only a check can (#151).
- **Settings writes** go through an allow-list (#149).

## Outbound requests (SSRF)

- `lib/domain/net/safeFetch.ts` is the single guarded fetcher for any URL a user can influence. It validates every DNS answer and pins the connection to one checked address, blocking private and reserved ranges and DNS rebinding. It re-checks every redirect hop, enforces one total deadline, caps the body at 2 MB, and returns fixed error messages that never reveal hosts or IPs (#122).
- **Model base URLs.** A user-supplied base URL must be a public address on hosted (`providerBaseUrl.ts`). The operator's platform key is **never** sent to a base URL the user supplied, and rows that were saved that way are cleared by [`20261022000200_provider_baseurl_guard.sql`](../supabase/migrations/20261022000200_provider_baseurl_guard.sql) (#170).

## OAuth, tokens and signatures

- The Gmail, Google Analytics and Search Console, Google Cloud, and GitHub connect flows use a random, single-use, expiring `state` value. On hosted, only the signed-in user who started a flow can complete it (#123). The GitHub App install state is signed and bound to the user and project.
- **Email links** (unsubscribe) use HMAC-SHA256 tokens that expire, checked with constant-time comparison. A missing or short secret (under 16 characters) signs nothing and verifies nothing (`lib/domain/notifications/tokens.ts`).
- **External writes** (fix PRs, CMS publishes) need a signed, expiring approval ticket, and hosted fails closed without a signing secret. Fix PRs are opened as **drafts**, and no code path merges them. Nothing posts to social networks automatically.
- **Cron routes** accept only `Authorization: Bearer $CRON_SECRET`. The check compares SHA-256 digests in constant time and rejects empty, `undefined` or `null` secrets (`lib/jobs/jobRunner.ts`).

## Abuse limits

- The public, anonymous endpoints (`/api/public/audit` and its events) use shared Postgres counters on hosted ([`20261020000000_rate_limits.sql`](../supabase/migrations/20261020000000_rate_limits.sql)) and an in-process limiter on self-host. Proxy headers are trusted only when `TRUST_PROXY_HOPS` is set.
- GEO has per-user daily caps on platform keys. The waitlist is rate-limited and fails closed.

## Headers

`next.config.ts` sets security headers (`lib/security/securityHeaders.ts`). The **Content-Security-Policy is report-only** for now, so violations are logged, not blocked.

## Self-host (SQLite) caveat

SQLite mode has **no authentication**, and your provider keys are stored in `data/okara.db`. Keep it on your own machine or behind a VPN or an authenticating reverse proxy. See [self-hosting.md](self-hosting.md#keep-it-private).

## Known gaps

- CSP is report-only.
- GitHub repository settings (branch protection, Dependabot, CodeQL) are tracked in the security review as SEC-14. They are GitHub settings, not code.
- Several minor (P3) items are listed in [security-review.md](../security-review.md).

## Reporting

Use **GitHub private vulnerability reporting**: go to the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue with details. See [SECURITY.md](../SECURITY.md).
