# Plans and pricing

> **Beta.** Hosted plans are defined in code but **not sold yet**. There is no payment gateway. The paid plans have a waitlist at [app.marlo.mlforge.in/pricing](https://app.marlo.mlforge.in/pricing). **Plan enforcement is off**, so none of the limits below apply today. **Self-host is never limited.**

The single source of truth is [`lib/domain/plans/planMatrix.ts`](../lib/domain/plans/planMatrix.ts). Server gates, UI locks and the pricing page all read it. The tables below were generated from that file at #180. If the file changes, the file wins.

## Prices (suggested beta prices, USD per website)

| Plan | Monthly | Annual, per month | Annual total |
|---|---:|---:|---:|
| Free | $0 | $0 | $0 |
| Lite | $29 | $24 | $290 |
| Pro | $79 | $66 | $790 |

Annual billing charges 10 months for 12 (`ANNUAL_MONTHS_CHARGED = 10`). These are suggestions, still to be checked against real provider bills before anyone is charged. Price is **per website** ("one AI CMO per website"), so more websites means more subscriptions.

## Features by plan

`—` means not included. A number is that plan's limit for the feature.

| Feature | Free | Lite | Pro | Notes |
|---|:---:|:---:|:---:|---|
| Websites | 1 | 1 | 1 | One AI CMO per website. More websites means more subscriptions. |
| Credits per month | 20 | 300 | 1000 | Monthly allowance for AI actions. Does not roll over. |
| Website analysis and context docs | ✓ | ✓ | ✓ | Product info, positioning and ICP. Setup of your first website is free. |
| SEO audit (manual) | ✓ | ✓ | ✓ | Run an audit on demand (5 credits). |
| Daily SEO monitor | — | ✓ | ✓ | Daily monitoring with automatic re-checks. |
| Findings and recommendations | ✓ | ✓ | ✓ | Read, track and manually verify fixes. |
| Automatic fix verification | — | ✓ | ✓ | Findings are re-checked and verified for you. |
| GEO tracking (prompts) | 3 | 10 | 10 | Free: 3 prompts, manual, 1 run per week. Paid: 10 prompts, weekly auto runs. |
| Weekly automatic GEO runs | — | ✓ | ✓ | GEO prompts run on a weekly schedule. |
| Traffic (Search Console and GA4), days visible | 28 | Unlimited | Unlimited | Connect Google data and see the last 28 days. |
| Traffic history and opportunities | — | ✓ | ✓ | History, opportunities and weekly snapshots. |
| Competitors and strategy docs | — | ✓ | ✓ | Competitor analysis, marketing, content and design strategy documents. |
| Coding agent | — | ✓ | ✓ | Opens GitHub pull requests that fix findings (15 credits per PR). |
| X (Twitter) drafts | — | ✓ | ✓ | AI-drafted posts and threads for X. |
| In-app notifications | ✓ | ✓ | ✓ | Notifications inside the dashboard. |
| Email digest | — | ✓ | ✓ | Weekly digest and notifications by email. |
| Leads finder (daily leads) | — | — | Unlimited | Find and refresh qualified leads. |
| Outreach email | — | — | ✓ | Draft and send outreach emails to leads. |
| Reddit drafts | — | — | ✓ | Opportunities and AI-drafted replies for Reddit. |
| LinkedIn drafts | — | — | ✓ | AI-drafted LinkedIn posts. |
| Hacker News drafts | — | — | ✓ | AI-drafted Hacker News posts. |
| AI article writer | — | — | ✓ | Long-form articles written from your strategy. |
| CMS publishing | — | — | ✓ | Publish articles to your CMS after your approval. |
| Chat messages per month | 10 | 150 | 600 | Platform-key messages per UTC month; bring-your-own-key and self-host are unlimited. |
| Start an SEO audit from chat | - | Yes | Yes | Paid chat feature (`chat_start_audit`). |
| Deeper chat tools | - | Yes | Yes | GEO, audit detail (`chat_deep_tools`). |
| Community support | ✓ | ✓ | ✓ | Help from the community. |
| Email support | — | ✓ | ✓ | Support by email. |
| Priority email support | — | — | ✓ | Priority support by email. |

## Numeric limits (`PLAN_LIMITS`)

`-1` in code means unlimited, and `0` means not included.

| Limit key | Free | Lite | Pro |
|---|:---:|:---:|:---:|
| `websites` | 1 | 1 | 1 |
| `credits_per_month` | 20 | 300 | 1000 |
| `geo_prompts` | 3 | 10 | 10 |
| `geo_manual_runs_per_week` | 1 | Unlimited | Unlimited |
| `chat_messages_per_month` | 10 | 150 | 600 |
| `traffic_view_days` | 28 | Unlimited | Unlimited |
| `daily_leads` | 0 | 0 | Unlimited |

The `websites` limit only blocks **new** websites. Accounts that already have more are grandfathered.

## How enforcement works

The enforcement switch is one database flag, `app_config.billing_enabled`. It is `false` by default (baseline migration).

| Deployment | Plan in effect | Limits |
|---|---|---|
| Self-host (SQLite mode) | `selfhost` | None, ever (`lib/entitlements.ts`) |
| Hosted, `billing_enabled = false` (**today**) | Treated as unlocked for features (`resolvePlan` returns `pro`) | Plan-matrix limits are **off**. Older safety caps stay on: `LEGACY_LIMITS` allows 4 websites and 10 daily leads on the Free tier (10 and 50 on Lite). Credits never block. GEO has per-user daily caps on platform keys (20 real Gemini runs and 60 simulated runs, adjustable with `GEMINI_DAILY_CAP` and `SIMULATED_DAILY_CAP`) |
| Hosted, `billing_enabled = true` (not turned on anywhere yet) | `profiles.plan_tier`. An unknown or missing value counts as `free`, and a failed lookup fails **closed** to `free` | The plan matrix above |

- `lib/domain/plans/planPolicy.ts` holds `resolvePlan`, `can(plan, feature)`, `limit(plan, key)` and `normalizePlan`. They are pure and unit-tested.
- `GET /api/plan` returns the caller's plan and per-feature access **for UI locks only**. It is not an enforcement point.
- UI locks (`usePlan`, `LockedLine`, `PlanBadge`, #171) stay dark while enforcement is off.
- Wiring server-side gates feature by feature is planned but **not started**. Turning the flag on today would change only the checks that already read it: the website cap on project creation, the daily-leads cap, and credit spending. Per-feature locks would not apply.
- Plans are assigned by hand (`profiles.plan_tier`) until a payment gateway exists.

## Credits

Credits are a monthly, non-rollover allowance for metered AI actions. Setting up your **first** website is free, and failed actions are refunded (#166). While `billing_enabled` is false, spending is recorded but never blocks, and the UI shows "Unlimited during beta" (`lib/credits-display.ts`).

## Waitlist

**Join the waitlist** on `/pricing` sends an email address (plus an optional website) to `POST /api/waitlist`. The route validates the input, applies a rate limit that fails closed, and stores the entry in `marketing_leads`. Self-host has no waitlist.
