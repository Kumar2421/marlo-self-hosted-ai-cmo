<div align="center">

# Marlo

**An open-source AI CMO: audit a site, watch search, fix what matters, measure the result.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

Hosted app: https://app.marlo.mlforge.in | Website: https://marlo.mlforge.in/marlo

</div>

## What it is

Marlo is a Next.js app (App Router, one deploy) that audits your website, monitors Google Search Console, proposes fixes, and tracks whether they worked. It runs self-hosted on SQLite or as the hosted build on Supabase.

Marlo is inspired by [Okara (okara.ai)](https://okara.ai). It is an independent project, not affiliated with or endorsed by Okara, and not derived from Okara's source code.

Every feature is meant to rest on real data or an honest "not available". Missing keys show a clear state instead of placeholder numbers.

## The loop

- **Audit.** Crawl a site for SEO, technical, link, and multi-page issues.
- **Monitor.** Take daily Search Console snapshots and track trends and query opportunities.
- **Fix, with a preview.** Propose changes, review a preview, then open a draft pull request on GitHub or publish through WordPress or Webflow after approval.
- **Measure.** Compare search data before and after each implemented change.

## What works today

Self-host = `NEXT_PUBLIC_SELF_HOST=true`, local SQLite. Hosted = Supabase build. "Yes" means the code path exists in that mode; see [environment.md](docs/environment.md) for the variables behind each "Needs" entry.

| Feature | Self-host | Hosted | Needs |
|---|---|---|---|
| Audit: SEO, technical, links, site crawl | Yes | Yes | Nothing required; PageSpeed key optional |
| Search Console monitoring: snapshots, trends, opportunities | Manual refresh | Daily snapshots (cron) | Google OAuth with Search Console access |
| Findings and tracked actions with before/after outcomes | Yes | Yes | Snapshots to measure outcomes |
| GEO visibility history | Yes | Yes | Gemini key for grounded answers; otherwise "simulated" (Tavily + Groq keys). No ChatGPT or Perplexity API |
| Fix PRs (GitHub) | Yes, via a stored GitHub token | Yes, via the GitHub App; drafts only | GitHub token or GitHub App |
| CMS publish: WordPress, Webflow | Yes | Yes | Site credentials; preview and approval before writing |
| Leads: people search | Yes | Yes | Tavily key (Google CSE optional) |
| Leads: local businesses | Yes | Yes | Google Cloud key with Places API (New) enabled, saved in Settings |
| Gmail outreach and reply checks | Yes | Yes | Gmail OAuth, using your own Gmail account |
| Social drafts: X, LinkedIn, Reddit | Manual drafts | Manual drafts + daily draft job | LLM key. Post opens the network's compose page; nothing posts automatically |
| Notifications: in-app bell, email | In-app; email if Resend is set | In-app + email | Resend key and sender for email |
| Chat over your project data | Yes | Yes | LLM key. Read-only tools: summary, opportunities, findings, actions and outcomes, leads, GEO |
| Plans and credits | Unlimited | Free, Lite, Pro tiers and credits | Supabase (hosted). No payment provider is wired in this repo |

## Quick start

### Self-host

Requires Node.js 24.12 or newer (`engines` in `package.json`).

```bash
git clone https://github.com/Kumar2421/okara-alternative.git
cd okara-alternative
npm install
npm run dev
```

Self-host stores projects and provider settings in SQLite at `data/okara.db`. For a production-style self-host build, set `NEXT_PUBLIC_SELF_HOST=true` and run `npm run build` then `npm start`.

### Hosted

Follow [docs/hosted-setup.md](docs/hosted-setup.md) for the ordered checklist, and [docs/environment.md](docs/environment.md) for variable names. Google setup is in [docs/google-cloud-setup.md](docs/google-cloud-setup.md). The runtime contract and acceptance gate are in [docs/production-readiness.md](docs/production-readiness.md).

## Security

- Row-level security on user tables. Server-trusted tables are read-only to end users ([migration](supabase/migrations/20261019000000_lock_trusted_tables.sql)).
- Outbound fetches for user-influenced URLs go through a guarded fetcher that pins DNS and checks every redirect hop. Some older fetch paths are still being hardened (see the review).
- Hosted public, anonymous endpoints share rate limits in Postgres; self-host uses a per-process limiter.
- External writes (fix PRs, CMS publishes) require a signed, expiring approval ticket.
- No automatic posting and no automatic merging. Fix PRs are drafts; no code path merges them.

Full review notes: [security-review.md](security-review.md).

**Reporting a vulnerability:** use GitHub private vulnerability reporting (Security tab) if it is enabled on the repository. If it is not, open an issue that asks for a private channel, without including details.

## Project layout

```
app/           Next.js routes: api/ (backend), dashboard/, audit/, settings/, login/
components/    UI: dashboard panels, settings, shared components
lib/           domain logic (lib/domain/*), LLM drivers (lib/llm/), jobs, security helpers
utils/         Supabase clients (utils/supabase/)
supabase/      SQL migrations
docs/          environment, hosted setup, product and runtime docs
scripts/       one-off scripts (outcome seeding)
tests/         node:test suites (npm test)
public/        static assets
```

## Limits

Not built, or built with caveats:

- No direct posting to X, LinkedIn, or Reddit. The X client has a posting method, but no route calls it.
- No real ChatGPT, Perplexity, or Claude visibility measurement. GEO uses Gemini-grounded answers or a labelled simulation.
- WordPress SEO fields only save when the site exposes Yoast or Rank Math meta through the REST API.
- Webflow field names are not verified on live sites.
- Local business search needs a Google Cloud key with Places API (New) enabled. Google bills that API.
- The Content-Security-Policy header is report-only, so violations are logged, not blocked.
- Hosted plans are stored as tiers; there is no billing integration in this repository.

## Contributing

Issues and pull requests are welcome. The bar is the same as the code's: **real data or an honest "not available", never a plausible-looking fake.** If you add a feature, show the empty and error states too.

## License

Licensed under the [GNU Affero General Public License v3.0](./LICENSE). If you run a modified version as a network service, you must make its source available to its users.

---

<div align="center">

Marlo is independent and not affiliated with Okara.ai.

</div>
