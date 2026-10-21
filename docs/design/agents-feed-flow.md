# Agents Feed flow: design spec

Status: proposal for review. No feature code in this PR. Decisions already taken by the owner are marked **[D]**; everything else is a recommendation that section (h) asks the owner to confirm.

Inputs: Okara research notes (R1-R5, user-flow), `components/dashboard/*`, `lib/project-store.tsx` (`createProject`), `lib/domain/overview/rankNextActions.ts` (branch `feat/today-ranking`), `components/ui/*` (branch `feat/ui-foundation`), `lib/credits.ts`, `lib/features.ts`, `lib/entitlements.ts`, `lib/llm/platformKeys.ts`, notifications, findings/actions stores, fix-PR loop.

## 0. Decisions and principles

**[D1]** The Agents Feed replaces the third (Leads) panel as the structure of the dashboard column. Leads becomes one agent row inside it (expanded card = today's `LeadsPanel` content, or a link to the Leads tab when that ships).
**[D2]** The feed has two sections: `Needs your attention` (top 3 ranked actions) and `Agents` (one row per agent with a count).
**[D3]** On hosted, the FIRST RUN uses the platform free Groq model, so a new user lands on a populated dashboard without configuring any LLM.
**[D4]** Locked / connect-to-unlock states show real counts. Plan-based locks are designed in now for a future paid tier, but default to "everything unlocked" for self-host/OSS.
**[D5]** Reversible rollout: feature flag plus per-user preference, with an always-visible way back.
**[D6]** Stability work ships first (section g, PR 0.x), because the Okara audit and our own R5 audit show the shell issues that this feature would sit on top of.

Principles taken from the research:

1. Zero-click start: the user lands on a populated screen, never on "No audit yet".
2. Value before paywall: show "2 citation gaps detected", then the lock.
3. One always-visible next action.
4. Guided connect (one choice, one button), not a settings hunt.
5. Ambient status: dots and a visible progress card, not silence.
6. Do NOT copy Okara's defects: real data under CSS blur, drag-only reorder, div rows with no semantics, 1-5 s notification polling, duplicated requests, banner pop-in shift (~80 px), "#0" position, tablets on a stretched phone layout.

## (a) Information architecture and component tree

### a.1 Where it sits

Today `app/dashboard/page.tsx` renders `TerminalLog` header + 4 panels: Context | Analytics | Leads | Chat, and on mobile (<768 px, `useIsMobile`) one panel plus `MobileTabBar`. `components/dashboard/AgentsFeedPanel.tsx` exists but is hidden and reads `lib/mock-data.ts` (`agents` array, hard-coded statuses and `locked` flags). The new panel replaces it with a data-driven one and takes the Leads slot:

```
app/dashboard/page.tsx
  DashboardShell                     (new, owns breakpoint layout + tab state, section f)
    TerminalLog (compact header, existing)
    ContextPanel (existing)
    AnalyticsPanel (existing)
    AgentsFeedPanel (rewritten)      <- slot of LeadsPanel
    ChatPanel (existing)
    MobileTabBar (existing, gains tablist semantics)
```

### a.2 Component tree (new files under `components/dashboard/feed/`)

```
AgentsFeedPanel.tsx            panel chrome + data hook + collapse rail (keeps the existing CollapsedRail contract)
  SetupProgress.tsx            first-run checklist card (section c); renders only while setup is incomplete or <24 h old
  AttentionQueue.tsx           "Needs your attention", max 3 AttentionItem, "N of M done", empty "You're all caught up"
    AttentionItem.tsx          title, why, impact chip, one CTA button
  AgentList.tsx                "Agents" section, owns order/archive state and the roving-focus group
    AgentRow.tsx               <button aria-expanded aria-controls>; icon, label, status line, countLabel, lock pill, chevron
    AgentCard.tsx              expanded region (role="region" aria-labelledby=row id); per-agent body via registry
    AgentLockedPreview.tsx     INERT dummy preview + CTA (section d)
    agentRegistry.ts           id -> { label, icon, color, Card component, openModal }
  FeedSettingsSheet.tsx        per-agent toggles, uses components/ui/Sheet (replaces the dead Settings icon)
  ArchivedAgentsMenu.tsx       components/ui/DropdownMenu: "Restore <agent>" items (keyboard-first, no drag zone)
useAgentsFeed.ts               single data hook: fetch + ETag + dedupe + backoff (section b/f)
lib/domain/overview/feed/
  buildFeed.ts                 PURE: (FeedFacts, now) -> FeedResponse; unit-testable, no I/O
  agentSummaries.ts            PURE per-agent summarizers, one function per agent
  feedTypes.ts                 shared types (below), imported by client and server
```

Primitives come from `components/ui` (branch `feat/ui-foundation`): `Card`, `Badge`, `Skeleton`, `EmptyState`, `IconButton`, `Sheet`, `Popover`/`DropdownMenu`, `Tooltip`, `Tabs`. The feed must not hand-roll any of these. PR 1 depends on `feat/ui-foundation` being merged.

### a.3 Per-agent summary contract

```ts
// lib/domain/overview/feed/feedTypes.ts
export type AgentId =
  | "leads" | "seo" | "geo" | "fixes" | "reddit" | "x" | "linkedin" | "hn" | "articles" | "outreach";

export type AgentStatus = "ready" | "working" | "needs_setup" | "locked" | "idle";

export type AgentLock = {
  reason: "integration" | "model" | "plan";
  cta: { label: string; action: "connect" | "choose_model" | "upgrade"; target?: string }; // target: integration key / settings path
  /** Plain sentence about the value, no data. e.g. "Connect GitHub to apply SEO fixes as pull requests." */
  valueLine: string;
};

export type AgentSummary = {
  id: AgentId;
  label: string;                 // "Reddit"
  status: AgentStatus;
  countLabel: string;            // "2 opportunities ready" | "Connect GitHub to apply fixes" | "All caught up"
  count: number | null;          // raw number for sorting/badge; null when not computable
  lastRunAt: string | null;      // ISO
  lock?: AgentLock;              // present iff status === "locked" or "needs_setup"
  deepLink: { panel: "analytics" | "leads" | "chat" | "context" | "modal"; tab?: string; modal?: string };
};

export type AttentionItem = {
  id: string;                    // stable: `${kind}:${entityId}`, same as NextAction.id
  kind: NextActionKind;          // from rankNextActions
  title: string; why: string;
  impact: "high" | "medium" | "low";
  cta: { label: string; target: NextActionTarget };
  agentId: AgentId | null;       // lets the UI highlight the owning row
};

export type FeedResponse = {
  projectId: string;
  generatedAt: string;           // ISO, server clock
  attention: { items: AttentionItem[]; total: number; done: number };  // total/done drive "N of M done"
  agents: AgentSummary[];        // already ordered (server default order; client may override with user order)
  setup: SetupState | null;      // null once setup is complete and dismissed (section c)
};
```

Status semantics (the single source of truth, tested in `tests/agentSummaries.test.mts`):

| status | meaning | row shows |
|---|---|---|
| `ready` | has >=1 reviewable output | count label, teal dot |
| `working` | a job is in flight (claim row exists) | "Finding leads..." + spinner, no CTA |
| `needs_setup` | can run but a one-time setup is missing and it is cheap (brand voice, subreddits) | "Set up brand voice", CTA opens the agent modal |
| `locked` | cannot produce output until `lock` is resolved | lock pill, count if known, CTA from `lock.cta` |
| `idle` | nothing pending, nothing wrong | "All caught up" / last run time |

Row ordering default (server): `ready` with highest count first, then `working`, `needs_setup`, `idle`, `locked` last. User reorder overrides it (section f). Sorting never depends on the lock *reason*.

## (b) Data contract

### b.1 Endpoint

`GET /api/dashboard/feed?projectId=<uuid>` -> `FeedResponse` (file `app/api/dashboard/feed/route.ts`).

- Auth: `createClient().auth.getUser()`, then the project is verified with `owner_id = user.id` (same pattern as `app/api/project/[id]/generate-leads/route.ts`). Reads use `createServiceClient()` only after ownership is proven, scoped by `project_id`.
- One request, server fan-out with `Promise.all` of **count-only / head queries and tiny selects**. No row payloads except the top-3 attention candidates (<=50 findings, see rankNextActions input).
- Self-host: same route, same shape; `plan` lock never appears (section d), `model` lock appears if no provider is connected.
- Response time target: p50 < 300 ms, p95 < 800 ms on hosted. Budget is part of the PR 2 acceptance test (measure with the e2e fake Supabase and log the Postgres timings).

### b.2 Caching and conditional requests

- `ETag`: weak hash of `JSON.stringify({agents, attention, setup})` excluding `generatedAt`. `Cache-Control: private, max-age=0, must-revalidate`; client sends `If-None-Match`, server returns `304` with no body when unchanged. 304 is the steady state.
- Server memo: per `(userId, projectId)` for 5 s in-process (`Map` with max 500 keys, same bounded-key idea as `lib/domain/shared/fixedWindowLimiter.ts`). It exists only to collapse the 2-4 near-simultaneous callers (focus, mount, invalidation); it is not a correctness boundary.
- Invalidation is by version, not by polling: mutating routes already exist (audit, generate-leads, drafts, PR link). They do not need to call the feed. The client calls `invalidateFeed()` after its own mutations (the project-store already has `auditVersion`, `leadsVersion`, `documentsVersion`, `competitorsVersion` counters; the hook subscribes to them).

### b.3 Exact sources per agent

All counts are `select count(*)` with `head: true` unless stated; all filter by `project_id`. "Reviewable" statuses are the ones the existing agent UIs list as actionable.

| Agent id | Table / source | Count rule | `lastRunAt` | status derivation |
|---|---|---|---|---|
| `leads` | `leads` (scope='customer') | ready = rows with `email is not null and emailed_at is null and unsubscribed_at is null`; label "12 leads ready to contact" | `max(created_at)`; `projects.leads_auto_last_at` for auto batch | `working` if `lead_refresh` claim active (`lib/jobs/leadRefreshClaim.ts`); `locked` (integration) if Gmail not connected and count>0, label keeps the count; `idle` when 0 |
| `outreach` | `leads` | replies = `last_reply_at is not null and reply_classification is null` -> "3 replies to review"; sent = `emailed_at is not null` | `max(last_reply_at)` | `needs_setup` when Gmail not connected; may be folded into `leads` row in v1 (open question h.4) |
| `seo` | `findings` where `status in ('new','acknowledged','failed')` and `source` is audit/monitor; `seo_audits` for last run | count = open findings; label "5 recommendations ready"; critical count shown as chip | `max(seo_audits.created_at)` | `working` while first audit runs (setup step); `idle` + "Run audit" when `lastRunAt` older than 7 days (reuses `DEFAULT_STALE_AUDIT_DAYS`) |
| `fixes` | `findings.status='fixing'` + `github_prs` (status draft/open) + `actions` (status proposed/pending approval) | "2 pull requests to review"; "1 fix to verify" (`fixed` not yet `verified`) | `max(github_prs.created_at)` | `locked` (integration:github) if GitHub App not installed and fixable findings exist: "Connect GitHub to apply 3 fixes"; count is real (derived from `classifyFinding` fixability) |
| `geo` | `geo_runs` latest per prompt (`geo_last_runs` RPC already exists) | gaps = prompts where latest run `mentioned=false`; "2 citation gaps detected" | `max(run_at)` | `needs_setup` when no `geo_prompts`; `locked` (model) when only simulated runs possible and no model; `idle` if all mentioned. Daily caps from `lib/domain/geo/dailyCap.ts` surface as `locked` w/ `reason:'plan'` only when plan locks are enabled |
| `reddit` | `reddit_opportunities` status='draft' + `reddit_post_drafts` status in ('pending','draft') | "2 opportunities ready" | `max(created_at)` | `needs_setup` if no subreddits/keywords in `app/api/agents/reddit/settings` store; `locked` (model) if no LLM |
| `x` | `x_drafts` status in ('draft','pending') | "2 ideas ready" | `max(created_at)` | `needs_setup` if no brand voice; X posting needs X connect -> `lock.reason='integration'` only for *publishing*, drafts stay visible |
| `linkedin` | `linkedin_drafts` status='draft' | "1 post drafted" | same | same as x |
| `hn` | `hn_drafts` status='draft' | "Ready to draft Show HN" when 0 | same | `idle` |
| `articles` | `articles` status='draft' (and `pr_open`) | "1 topic ready" / "1 article awaiting review" | `max(created_at)` | `locked` (integration) only for publishing to CMS/GitHub; drafting never locked |
| *(attention only)* | notifications `approval_needed`, `integration_disconnected`, `credits_low` | feed into `AttentionItem` via `kind` mapping | | see b.4 |

Self-host with in-memory/file stores (`findingStore`, `actionStore`, `geoStore` have non-Supabase variants): `buildFeed` takes a `FeedFacts` object assembled by one adapter per mode: `feedFactsSupabase.ts` (hosted) and `feedFactsSelfHost.ts`. The pure functions never import a client. This is the same port/adapter style as `lib/domain/notifications/{ports,platformSource,selfHostSource}.ts`.

### b.4 Attention queue

`buildFeed` builds `RankInput` from the same facts (findings, open fix PRs, pending actions, integrations, leads aggregate, `lastAuditAt`, `now`) and calls `rankNextActions(input, { max: 3 })`. The queue is therefore deterministic and unit-testable. `total` = number of ranked candidates before slicing to 3; `done` = items completed in the last 7 days (findings moved to fixed/verified, PRs merged, replies handled) so the header can say "3 of 12 done this week". A `celebrate` action only appears when nothing else ranks; the empty state then reads "You're all caught up" with next check time.

Integration facts come from `integration_connections` (gsc, ga4, github, gmail, cms keys exactly as `IntegrationKey`). Never read tokens; select `provider, status` only.

### b.5 Error and partial-failure rules

- Each agent summarizer is wrapped: a failing source yields `{status:"idle", countLabel:"Couldn't load", count:null}` for that row plus `X-Feed-Partial: seo,geo` header; the response is still 200 so the rest renders. Never block the panel on one table.
- 401 -> existing auth redirect. 404 "No active project" -> existing `OnboardingGate` path. 5xx -> panel shows the last good payload (kept in the hook) with a small "Showing earlier data. Retry" row.
- Counts are non-negative integers; `null` renders as "-". Never render `NaN`, "#0", or "-1280%".

## (c) First-run flow

### c.1 Today and the gap

`createProject()` in `lib/project-store.tsx` is a client-side orchestrator that logs and, in order: POST `/api/project`; POST `/api/agents/seo/audit`; (if `primaryModel`) POST `/api/project/{id}/generate-description`; `maybeDiscoverCompetitors`; (platform mode) POST `/api/project/{id}/generate-leads` on the platform Groq key; un-awaited `autoGenerateContextDocuments`; final `logDone("Setup complete")`. Problems: it only runs if the browser tab stays open; the description and competitors steps are skipped when the user has no `primaryModel` (a new hosted user has none until `/api/providers` auto-assigns one); there is no persisted state, so a reload mid-setup loses progress; and nothing visible besides the terminal log.

### c.2 Step model (persisted)

Keep the client orchestrator for v1 (no new infra) but make every step record its state server-side so the card survives reload and a second tab.

```ts
type SetupStepId = "project" | "crawl" | "audit" | "description" | "competitors" | "leads" | "documents" | "geo_prompts";
type SetupStepState = "pending" | "running" | "done" | "skipped" | "failed";
type SetupState = {
  startedAt: string; completedAt: string | null; dismissedAt: string | null;
  steps: { id: SetupStepId; state: SetupStepState; model: "platform" | "user" | "none"; detail?: string; attempts: number }[];
};
```

Storage: `user_settings` row `(user_id, key='setup:<projectId>', value=json)` (table exists, key/value, no migration needed). Written by a small `POST /api/project/[id]/setup` (`{stepId, state, detail}`) called from `createProject` at each existing `log()`/`logDone()` call site. The feed returns it as `setup`. Idempotency: the setup route is `upsert` keyed by step; the step *work* routes already guard themselves (leads 24 h cooldown via `leads_auto_last_at`; audit is re-runnable). A retry never duplicates leads or documents (`dedupe_key` unique index on leads; documents are upserted by type).

### c.3 SetupProgress card

Top of the Agents Feed column, above Attention, height-reserved (min-height 132 px, rendered from the first paint of the dashboard to avoid CLS; shows skeleton checklist rows if `setup` is not yet known).

```
+--------------------------------------------+
| Setting up Marlo.mlforge.in       3 of 6   |
| [x] Read your site                          |
| [x] SEO audit            5 issues found     |
| [~] Writing your description...             |
| [ ] Finding competitors                     |
| [ ] Finding first leads                     |
| [ ] Writing strategy documents              |
+--------------------------------------------+
```

- Live checkmarks are fed by the same events already emitted via `log()`/`logDone()`: add a typed `emitSetup(stepId, state, detail)` next to each, and have `terminal-log-store` stay unchanged (the card is a second consumer, not a replacement).
- `role="status"` with `aria-live="polite"` on the count ("3 of 6"), not on every row. Steps are an ordered list `<ol>`; state is conveyed by text + icon (not color alone): "done", "in progress", "skipped", "failed".
- Failed step shows "Retry" (re-runs only that step, `attempts+1`, max 3, then "Skip"). Skipped-by-design steps (no model) show "Needs a model: add one in Settings" as a locked row, not as a silent skip.
- Auto-collapses to a one-line "Setup complete (6/6)" 10 s after completion, hides after the user dismisses or 24 h. Dismissal writes `dismissedAt`.
- Time-to-first-insight (section e): the first of `seo audit done` / `leads found` / `attention item rendered` timestamps.

### c.4 What runs on which model

**[D3]** Hosted first run uses the platform free model for everything that is part of "land populated". Platform key and model come from `lib/llm/platformKeys.ts` (`PLATFORM_PROVIDER_KEYS.groq`, `PLATFORM_DEFAULT_MODELS.groq = openai/gpt-oss-120b`), resolved server-side, never sent to the client.

| Step | Hosted, no BYOK | Hosted/self-host with user's model | Needs LLM? |
|---|---|---|---|
| project, crawl, audit | server code, no LLM | same | no |
| description | platform Groq | user's `primaryModel` | yes |
| competitors | platform Groq (change `maybeDiscoverCompetitors` to accept `"platform"`) | user model | yes |
| first leads (<=10) | platform Groq (already) | platform Groq (already, deliberate) | yes |
| strategy documents (6) | **only the first two** (Product Information, Marketing Strategy) on platform; the rest wait for a user model or credits | all six | yes, heaviest |
| GEO prompts | from Search Console if connected; else skipped (`needs_setup`) | same | no |
| Reddit/X/LinkedIn/HN/articles drafts | NOT part of first run; appear as `needs_setup` with count "Ready to draft" | user model, charged via `chargeCredits` | yes |

Rationale: the first run must be cheap and bounded (about 4-5 Groq calls per user). Documents are the heavy part (each route `maxDuration` 60 s); capping to two on the free model keeps the shared budget alive and still fills the Context panel. Remaining documents show a "Generate with your model" CTA, never a blank.

Self-host: the platform path does not exist (`PLATFORM_MODE` false; routes 404). With no provider connected the LLM steps become `locked` (reason `model`, CTA `choose_model` -> `/settings/llm-providers`), and non-LLM steps still run. So even a fresh self-host install shows the audit and SEO agent populated.

### c.5 Abuse and cost controls (hosted)

Budget facts: Groq free tier is about 120 requests/day shared across ALL users on one key; Mistral about 2 req/min as fallback. This is the binding constraint, so the design assumes it will be exhausted.

1. **Per-user first-run allowance**: at most 6 platform-model calls per user per UTC day for onboarding, 1 project's first run per 24 h (existing leads cooldown generalised). Enforced with the existing `rate_limit_hit(key, window, limit)` RPC (`supabase/migrations/20261020000000_rate_limits.sql`), key `firstrun:<userId>`. New projects beyond the first in 24 h get the audit but not the LLM steps (state `skipped`, detail "Daily free-model limit reached").
2. **Shared budget counter**: `rate_limit_hit('groq:global', 86400, GROQ_DAILY_BUDGET)` with `GROQ_DAILY_BUDGET` default 100 (20 held back for chat/paid users). Checked before each platform call in one helper `lib/llm/platformBudget.ts` (`reserveFirstRunCall(userId): {ok, reason}`), so no route calls Groq for onboarding without it.
3. **Circuit breaker**: on 3 consecutive 429/5xx from Groq within 60 s, open the breaker for 5 min (process-local plus a `rate_limits` row `groq:breaker` so instances agree). While open: try Mistral fallback only if its own limiter (2/min) allows, else skip.
4. **Exhaustion behaviour** (must never fail setup): step -> `skipped` with `detail` "Free model is busy right now". Card shows "We'll finish this automatically tomorrow, or add your own model now" with CTA. A cron (`app/api/cron/` pattern, as `leads-refresh`) retries `skipped` first-run steps oldest-first once the budget window rolls, max 2 retries per step. The feed still renders everything non-LLM, and attention shows "Add your own AI model" as a ranked `connect_integration`-style item.
5. **Retry**: client retries only network errors (2x, 1 s/3 s backoff via `lib/query/retry.ts`); never retries 429 (respect `Retry-After`); server steps are idempotent as in c.2.
6. **Abuse**: signup is the abuse vector (many accounts to farm free LLM). Controls: first-run requires verified email (already enforced by auth), IP-bucket limit `firstrun-ip:<ip>` 3/day, URL must pass `assertSafeUserUrl` (SSRF guard already used by favicon), crawl uses `crawl_slot_acquire`. Credits (`credit_costs`, `spend_credits`) continue to meter everything after first run; first-run calls are logged to `usage_events` with `status='free_firstrun'` for cost accounting but charge 0 credits.
7. **Observability**: counters `firstrun_started/completed/skipped_budget/breaker_open` emitted as analytics events (section e) and visible in `app/api/platform/diagnostics`.

## (d) Locked states and plan-based locks

### d.1 Lock reasons (all share one UI)

| reason | example | CTA | resolves when |
|---|---|---|---|
| `integration` | "Connect GitHub to apply 3 SEO fixes" | opens a one-step Sheet (property/repo picker), not Settings | `integration_connections.status='connected'` |
| `model` | "Add an AI model to draft Reddit replies" | `/settings/llm-providers` deep link | provider connected or platform model allowed for this agent |
| `plan` | "GEO tracking is part of Pro" | "See plans" | entitlement flips |

The counts are REAL (computed on the server from the user's own data, section b.3). Value before paywall.

### d.2 UI pattern: inert dummy preview, never blur real data

Okara renders the user's real checklist/site files under `blur-sm` with the values still in the DOM and no `aria-hidden`/`inert` (R2 bug 3). Marlo rule: **a locked card never receives the user's rows at all.**

- The server strips detail: for `locked` agents the feed returns only `{count, lock}`; the detail endpoints (`/api/agents/geo/*`, `/api/agents/codefix/*`) independently enforce the same lock, so removing CSS in devtools reveals nothing.
- `AgentLockedPreview` renders a fixed synthetic layout from `agentRegistry.previewFor(agentId)`: static, obviously fake rows (placeholder bars, "Example" label, no bracket text like `[pain point]`), wrapped in `<div inert aria-hidden="true">`. The overlay is a normal region with a heading, the one-line `valueLine`, the real count ("2 citation gaps detected") and one CTA button. The preview carries a visible "Example" chip so nobody mistakes it for their data.
- No blur dependency: preview looks fine unblurred; an optional `opacity-60` only. Works without `backdrop-filter`, in forced-colors mode, and in print.
- Locked rows remain keyboard-focusable buttons (users must be able to reach the CTA). Their expanded region contains the CTA only; settings toggles for a locked agent are disabled (Okara leaves them ON).

### d.3 Copy rules

1. Lead with the benefit and the count: "2 citation gaps detected" then "Connect Search Console to see which prompts". 2. Say what unlocks and how: verb-first CTA ("Connect GitHub", "Add a model", "See plans"), never a bare "Upgrade" for an integration lock. 3. No fear/scarcity wording, no "Locked feature" as the headline; the lock is a small pill with an accessible name ("GEO, locked: needs Search Console"). 4. Never imply data is hidden behind the lock when it is not computed ("Pro unlocks the full list" only when a list exists). 5. Plan locks name the plan; integration/model locks never mention pricing. 6. One CTA per card.

### d.4 Entitlement hook: `lib/entitlements.ts`

`lib/entitlements.ts` already has `Plan` (`free|lite|pro|selfhost`), `PLAN_LIMITS`, `getUserPlan`, `can`, `limitFor`. Extend it, do not fork it:

```ts
export type AgentFeature = "geo_tracking" | "fix_prs" | "outreach_send" | "auto_drafts" | "premium_model";
export type AgentAccess = { allowed: true } | { allowed: false; reason: "plan"; requiredPlan: Plan; upgradeCta: string };

/** Pure. Default policy is "everything unlocked". */
export function agentAccess(ctx: EntitlementContext, feature: AgentFeature, policy: AgentPolicy = DEFAULT_POLICY): AgentAccess;
```

- `DEFAULT_POLICY` is `{}` (no feature requires a plan), so today nothing is plan-locked on hosted either. A future paid tier only changes the policy table (`const AGENT_PLAN_POLICY: Partial<Record<AgentFeature, Plan>>`), selected by a server env `AGENT_PLAN_LOCKS=on|off` (default off) so the lock can be dark-launched and rolled back without a deploy of UI.
- `FEATURES.PLATFORM_MODE === false` (self-host/OSS) always returns `allowed: true`: consistent with the file's stated rule "logic is open, operations/scale are paid; self-host must never be crippled". Unit test: for every `AgentFeature` x `Plan`, `selfhost` is allowed.
- Fails open on lookup error, as `getUserPlan` does (returns `pro`). Document that this is deliberate.
- The feed route calls `agentAccess` per agent and merges with integration/model locks using precedence `plan > model > integration` for the *displayed* lock (so one CTA), while keeping the others in `lock.also?: AgentLock["reason"][]` for analytics.

## (e) Rollout

### e.1 Flags

- Build/env flag `NEXT_PUBLIC_AGENTS_FEED` = `off` | `opt-in` | `default` (read in `lib/features.ts` as `FEATURES.AGENTS_FEED`, literal `process.env` read so Next inlines it, like the other flags). `off`: code path never rendered (dead-code eliminated), Leads panel as today. `opt-in`: banner offered, default old. `default`: new for everyone, old available via preference.
- Per-user preference stored server-side so it follows the user across devices: `user_settings` row `key='dashboard:layout'`, value `"feed" | "classic"`; plus `key='dashboard:feed_prompt'` value `{ "state": "shown"|"accepted"|"snoozed", "at": ISO }`. No migration needed (table exists). Routes: `GET/PUT /api/settings/dashboard-layout` (under `app/api/settings/`). Cached in the Supabase session payload is NOT used (stale risk); the dashboard fetches it with `/api/project/data` bundle in PR 4 to avoid an extra request and a layout flash (see e.3).
- Precedence: explicit user preference > env default > classic. Self-host default `classic` until the feed is declared stable.

### e.2 "Try the new dashboard / Later" prompt

- Rendered as a non-modal toast-style card inside the dashboard (`components/ui` Toast-like region, `role="status"`), not a blocking dialog, shown only when flag is `opt-in`, the user has no preference, and `setup` is complete (never interrupt first run).
- **Try it**: optimistic switch. Local state flips to `feed` immediately; `PUT` sent; on failure revert to previous layout and show "Couldn't save your choice. Using the previous layout." The panel for the unselected layout stays unmounted (not hidden).
- **Later**: writes `{state:"snoozed", at: now}`; re-prompt after 7 days (constant `FEED_SNOOZE_DAYS = 7`), max 3 snoozes then never again. Timestamp is server-side so snooze survives devices and cleared storage.
- A permanent switch lives in the Feed settings Sheet and in the user menu: "Use classic dashboard". Switching back is one click, applies instantly, confirmed by announce text "Classic dashboard". No data is lost: both layouts read the same stores.
- Rollback levers, in order of speed: (1) set env to `off` (redeploy), (2) server-side `app_config.agents_feed_enabled=false` read by `GET dashboard-layout` (no deploy; returns `classic` for everyone), (3) users toggle themselves.

### e.3 No layout flash

The layout choice is resolved before first paint of panels: `DashboardShell` renders the stable header + a neutral skeleton sized for the 4-column grid until the preference is known, so switching never reflows (CLS budget in g). The skeleton for Agents Feed has exactly the count of rows in `agentRegistry` (Okara's 6 vs 8 skeleton mismatch).

### e.4 Analytics events

Reuse the sanitised-payload approach of `lib/analytics/auditFunnel.ts` and the `marketing_funnel_events` table pattern, but a separate authenticated table `dashboard_events` (migration in PR 4; RLS insert own, no select) with `event` check-list, `user_id`, `project_id`, `session_id`, `props jsonb` (whitelisted keys), `created_at`. No third-party pixel. Events:

| event | props | measures |
|---|---|---|
| `setup_started` / `setup_step` / `setup_completed` | step, state, model | funnel + failure points |
| `first_insight_seen` | source: `attention`\|`agent_row`\|`audit`, msFromSetupStart | **time-to-first-insight (TTFI)** |
| `feed_loaded` | itemCount, agentCount, ms, cached | latency |
| `attention_item_viewed` / `attention_item_clicked` | kind, position, impact | **attention click-through = clicked / viewed** (viewed = in viewport >= 1 s, once per item per day) |
| `agent_row_expanded` / `agent_cta_clicked` | agentId, status, lockReason | agent engagement |
| `lock_viewed` / `lock_cta_clicked` / `lock_resolved` | agentId, reason, count | value-before-paywall conversion |
| `layout_prompt_shown/accepted/snoozed`, `layout_switched` | from, to | rollout health |
| `layout_reverted_within_24h` (derived) | | kill-switch signal |

Rollout gates (decide go/no-go): TTFI p50 improves vs classic (target < 60 s on hosted, baseline measured in PR 0), attention CTR >= 25% of viewers per week, `layout_reverted_within_24h` < 10%, feed p95 < 800 ms, error rate < 1%.

## (f) State, keyboard, ARIA, polling, zero-data

### f.1 State ownership

- Server state (feed payload): one `useAgentsFeed(projectId)` hook; the Query layer in `lib/query/` (`QueryProvider`, `keys.ts`, `fetchJson.ts`, `retry.ts`) is the cache; key `['feed', projectId]`. Components never fetch on their own for counts.
- Client UI state: expanded row id (single-expand accordion, remembered per project in `sessionStorage`), user row order and archived ids (server-side `user_settings` key `feed:order:<projectId>` so it follows the user; optimistic with revert), active mobile tab in the URL (`?tab=agents`, `router.replace`, no history spam; fixes R4 "tab not in URL").
- Panels stay mounted on mobile (hidden with `hidden` + `inert`), so scroll, drafts, filters survive tab switches (R5 #10). Memory cost is acceptable (4 panels).

### f.2 Keyboard and ARIA

- Each `AgentRow` is a real `<button type="button" aria-expanded aria-controls="<id>-card">`. The card is `role="region" aria-labelledby="<rowId>"`. Row icon is decorative (`aria-hidden`); the lock pill text is inside the button's accessible name.
- The list is `role="list"`/`<ul>` with `<li>`; no composite widget role, so Tab moves row to row (10 rows is fine). Section headers are `<h2>`/`<h3>` and the accordion toggles use `aria-expanded` as well.
- **Reorder without drag**: row has a "Move" menu (`IconButton` with `aria-haspopup="menu"`, `DropdownMenu`: Move up, Move down, Move to top, Archive) AND shortcuts when the row is focused: `Alt+ArrowUp/Down` move, `Delete`/`Backspace` archive with an undo toast (8 s). Every move/archive announces via a polite live region ("Reddit moved to position 2 of 9"). Drag with pointer is optional sugar added later (via `@dnd-kit` only if approved; not in v1: no new dependency).
- Archive: `ArchivedAgentsMenu` is a `DropdownMenu` with a count in its accessible name ("Archived agents, 2"); "Restore" items. No drop-zone-only archive (Okara defect).
- Attention items: `<ol>` of `<li>` each containing a heading, a why line and one CTA `<button>`/`<a>`; CTA names include the item ("Fix: Missing meta description"), not a bare "Fix".
- `SetupProgress`: see c.3. Focus ring: `FOCUS_RING` from `components/ui/variants.ts` everywhere; hit targets >= 44 px on touch, >= 24 px on desktop (R5 #12: 64 of 103 targets were under 24 px); 11 px text only for non-essential labels; contrast >= 4.5:1 (use `--ui-text-muted`, not gray-400; teal text uses `--ui-accent-strong`).
- Hover-only controls (per-agent menu, dismiss) are visible on `:focus-within` and always visible on touch, and never `opacity-0` with `tabindex` active (R5 #3).
- `prefers-reduced-motion`: accordion height animation off; chevron rotates instantly.

### f.3 Polling policy

1. **No polling on locked agents** or on `idle` agents with no job claim. The feed has ONE request; there are no per-agent endpoints on the dashboard.
2. Default refresh triggers (no timer): mount, window `focus`/`visibilitychange` visible if last fetch > 60 s, project switch, after any local mutation (`invalidateFeed`), manual Refresh.
3. While `setup` is incomplete or any agent is `working` (job claim present): conditional GET every 3 s for the first 30 s, then 5 s, 10 s, 20 s, cap 30 s (exponential backoff, jitter +-20%), always with `If-None-Match` so unchanged = 304. Stops as soon as nothing is working or the tab is hidden. Hard ceiling: 5 minutes, then manual Refresh.
4. Dedupe: the Query layer shares one in-flight promise per key; the mount, focus and invalidation triggers within 1 s collapse into one request. Acceptance: at most 1 `/api/dashboard/feed` request at load (Okara fires channel-access 5-7x).
5. Prefer SSE later: `GET /api/dashboard/feed/stream` (text/event-stream) emitting `feed-changed` with the ETag; client then does one conditional GET. Not in v1 (Vercel serverless streaming limits); the polling policy above is the fallback and is what ships first (open question h.5).
6. Notification bell keeps its own existing endpoint; the feed must not add a second poller on `/api/notifications`. Bell and feed share one `visibility` listener.
7. Backoff on errors: 429 honours `Retry-After`; 5xx doubles the interval up to 60 s; 3 failures pause and show "Retry".

### f.4 Empty and zero-data guards

- Shared formatters in `lib/domain/overview/feed/format.ts` (pure, tested): `formatPosition(n)`: `null|undefined|0|NaN` -> "-" (never "#0"); `formatDelta(cur, prev)`: if `prev` is 0/null/NaN or either is not finite -> "-" (never "-1280%", "Infinity%"); clamp displayed percentage to +-999% with a "+999%+" style; `formatCount(n)`: null -> "-", locale grouping, `1 lead` vs `2 leads` via one `pluralize()` helper.
- A section with no data shows an `EmptyState` (components/ui) with a reason and one action, not a flat zero chart. Reasons come from status: `needs_setup`, `locked`, `idle`.
- "Data through" note: any metric derived from Search Console shows the last data date (GSC lags 2-3 days).
- Row height is fixed (min-height 64 px, status line truncates to one line with `title`), so the subtitle changing (Okara LinkedIn 64/80 px flicker) never moves rows.
- `scrollbar-gutter: stable` on every panel body (kills the 16 px reflow Okara and Marlo Analytics have between tabs). Only one vertical scroller per panel; the Agents Feed column is one scroller containing Setup, Attention, Agents.

## Layout wireframes

Breakpoints: `>=1280` desktop 4 panels; `1024-1279` tablet (two columns, see wireframe); `<1024` single panel + bottom tab bar. (Okara switches only at 1280, leaving tablets on a stretched phone layout; this spec moves the multi-column threshold down.) Replaces `useIsMobile` (<768) with a `useLayoutMode()` returning `"desktop" | "tablet" | "mobile"` via `matchMedia`, initial state computed in an effect-safe way (no `window` read during render; SSR renders the desktop skeleton).

### Desktop >= 1280 (4 panels, 1536x674 reference)

```
+--------------------------------------------------------------------------------------+
| Marlo  [project v]  status: auditing site...        credits 84   Log   (bell) (user) |
+-----------+--------------------+------------------------+----------------------------+
| CONTEXT   | ANALYTICS          | AGENTS FEED       [o][g]| CHAT                       |
| 280px     | 340px              | 360px                  | flex (min 360)             |
|           | [Traffic|SEO|GEO|..| +--------------------+ |                            |
| Project   |                    | |Setting up   3 of 6 | | Assistant: Hi, I read      |
| name/desc | PageSpeed rings    | |[x] Read your site  | | your site...               |
| [Edit]    |  (91) (88) (100)   | |[x] SEO audit       | |                            |
|           | Core Web Vitals    | |[~] Description     | |                            |
| Documents | ...                | +--------------------+ |                            |
|  Product  |                    | NEEDS YOUR ATTENTION   |                            |
|  Strategy |                    | 1 Review PR #12  [Open]| |                            |
|  ...      |                    | 2 Fix 3 titles   [Fix] |                            |
|           |                    | 3 Connect GSC [Connect]| +----------------------------+
|           |                    | AGENTS                 | | Ask your CMO...        [>] |
|           |                    | > Leads    12 ready    | +----------------------------+
|           |                    | > SEO      5 recs      |
|           |                    | > Reddit   2 opps      |
|           |                    | > GEO  [lock] 2 gaps   |
|           |                    | > Fix PRs  Connect GH  |
+-----------+--------------------+------------------------+
```
Collapsing a panel keeps today's 56px `CollapsedRail`. One scroller inside the Agents Feed column; the Setup card has a reserved height so the queue below does not jump when it collapses (it collapses to a 40 px summary line, replaced in place).

### Tablet 1024-1279

```
+----------------------------------------------------------------+
| Marlo [project v]  status line                  (bell) (user)  |
+--------------------------------+-------------------------------+
| [Context|Analytics] tabs       | AGENTS FEED                   |
| (left column = tabbed pair)    | Setup card / Attention / Rows |
|  active panel body             |                               |
|                                +-------------------------------+
|                                | CHAT (collapsible drawer,     |
|                                |  opens over feed, 420px)      |
+--------------------------------+-------------------------------+
| Context | Analytics | Agents | Chat   (bottom bar hidden >=1024)|
+----------------------------------------------------------------+
```
Left column (about 52%) hosts Context and Analytics as a `Tabs` pair (ui `Tabs`), right column (about 48%) hosts Agents Feed always visible; Chat is a right-side `Sheet` toggled from the header, because it is the only panel that is needed on demand. The Agents Feed is always visible at tablet size: it is the primary daily surface.

### Mobile < 1024 (390x844 reference)

```
+--------------------------------+
| Marlo [project v]     (bell)(u)|  72px header (no banner pop-in)
+--------------------------------+
| AGENTS FEED                    |
| +----------------------------+ |
| |Setting up       3 of 6  [v]| |
| +----------------------------+ |
| NEEDS YOUR ATTENTION           |
| 1 Review PR #12        [Open]  |
| 2 Fix 3 titles          [Fix]  |
| 3 Connect Search Console [Go]  |
| AGENTS                         |
| (L) Leads        12 ready   v  |
| (S) SEO          5 recs     v  |
| (G) GEO [lock]   2 gaps     v  |
|   ...                          |
+--------------------------------+
| Context Analytics [Agents] Chat|  48px targets, role=tablist
+--------------------------------+
```
`?tab=agents` default for returning users with attention items, `?tab=context` right after setup for first-time (so the user sees the populated Context); tab bar `role="tablist"`, `aria-selected`, roving arrows, safe-area padding `max(0.5rem, env(safe-area-inset-bottom))`, 16 px side gutters (not Okara's 4 px). Tab dot = "something new" (accent dot, no number), hidden when count is 0.

## (g) Migration plan (small PRs)

Each PR is one concern, flag-protected, independently revertable. Owners are roles; map to names in planning. Common acceptance for all: `node --experimental-strip-types --test tests/*.test.mts` green, `tsc --noEmit` only the known `LayoutProps` error, `eslint` clean on touched files, CRLF preserved, no new dependency.

### Phase 0: stability first [D6]

| PR | Owner | Scope | Acceptance | Tests |
|---|---|---|---|---|
| 0.1 Settings responsive | frontend | `app/settings/layout.tsx`, `components/settings/SettingsNav.tsx`: sidebar -> top select/drawer below 768 (R5 #1) | no horizontal overflow on 12 settings routes at 390 | Playwright: scrollWidth == innerWidth at 390 for each route |
| 0.2 Request hygiene | frontend | dedupe `/auth/v1/user` and `/api/providers` calls; lottie asset self-hosted (not jsdelivr); favicon 400 fix in `WebsiteIcon` (R5 #8,#9) | <= 1 call each at load; 0 console errors | Playwright network count assertions |
| 0.3 Layout stability | frontend | reserved heights for Context skeleton and header status line (R5 #7); `scrollbar-gutter: stable` | desktop CLS < 0.05, mobile < 0.03 over 10 s | Playwright CLS via `PerformanceObserver` |
| 0.4 A11y baseline | frontend | tab semantics (`role=tablist`) on `AnalyticsPanel` tabs and `MobileTabBar`; names on icon buttons/checkboxes in `LeadsPanel`; Escape closes project switcher (R5 #3-#6) | 0 unnamed buttons/inputs on dashboard; arrow keys move tabs | Playwright + axe-style DOM checks (no new dep: custom assertions) |
| 0.5 Panels stay mounted | frontend | mobile shell hides instead of unmounts; `?tab=` in URL; `useLayoutMode` (replaces `useIsMobile`) | scroll/draft survive tab switch; reload keeps tab | Playwright mobile project |
| 0.6 First-run baseline | analytics | add `dashboard_events` + measure current TTFI on classic (no UI change) | baseline TTFI recorded | unit: payload sanitiser; Playwright smoke |

Depends on branches `feat/ui-foundation` (primitives) and `feat/today-ranking` (rankNextActions, copy, todayChecklist) landing; PRs 0.4 and 1.x use them.

### Phase 1: feed behind a flag

| PR | Owner | Scope | Acceptance | Tests |
|---|---|---|---|---|
| 1.1 Pure core | backend | `lib/domain/overview/feed/{feedTypes,buildFeed,agentSummaries,format}.ts`; `AgentAccess` in `lib/entitlements.ts` | pure, no I/O; every status derivation + format guard covered; selfhost always allowed | unit: `agentSummaries.test.mts`, `buildFeed.test.mts`, `feedFormat.test.mts` (position 0 -> "-", delta from 0 -> "-"), extend `entitlements.test.mts` |
| 1.2 Feed route | backend | `app/api/dashboard/feed/route.ts`, `feedFactsSupabase.ts`, `feedFactsSelfHost.ts`, ETag + 5 s memo | owner-only access; 304 on unchanged; partial failure -> 200 + header; p95 target | unit: ETag stability, ownership 404; integration against e2e fake Supabase; cross-user access returns 404 |
| 1.3 Feed UI static | frontend | `components/dashboard/feed/*` (Panel, Attention, AgentRow/Card, EmptyState), flag `FEATURES.AGENTS_FEED`, slot swap in `app/dashboard/page.tsx` | flag off = zero change; on = renders from route; rows are buttons w/ `aria-expanded`; keyboard reorder/archive | Playwright: layout at 1536x674 / 1100x800 / 390x844 (no overflow, one scroller), a11y (names, roles, Tab order, no hidden tab stops), CLS < 0.05 |
| 1.4 Agent cards wiring | frontend | `agentRegistry.ts` opens existing modals (`ArticleAgentModal`, `RedditAgentModal`, `XWriterPanel`, `LinkedInAgentModal`, `HNAgentModal`, `GitHubAgentModal`); Leads card embeds `LeadsPanel` content | each row's CTA opens the right surface; Leads parity with today | Playwright: open/close each modal with focus return |
| 1.5 Hook + polling | frontend | `useAgentsFeed` with ETag, dedupe, backoff, visibility pause | exactly 1 feed request at load; idle 30 s = 0 requests when nothing working | Playwright network counter; unit: backoff schedule |

### Phase 2: first run

| PR | Owner | Scope | Acceptance | Tests |
|---|---|---|---|---|
| 2.1 Setup state | backend+frontend | `POST /api/project/[id]/setup`, `emitSetup` at each `log()` site in `lib/project-store.tsx`, `SetupProgress.tsx` | card survives reload; steps match log events | unit: step reducer; Playwright: mocked slow steps show live checkmarks, reload mid-setup resumes |
| 2.2 Platform model + budget | backend | `lib/llm/platformBudget.ts`, breaker, caps via `rate_limit_hit`, description/competitors on platform model, 2 documents on platform | new hosted user without BYOK gets description, competitors, leads, 2 docs; budget exhausted -> steps `skipped`, setup completes | unit: budget, breaker state machine, per-user cap; Playwright: fake Groq 429 -> card shows retry/tomorrow copy |
| 2.3 Retry cron | backend | `app/api/cron/firstrun-retry` (cron secret pattern like `leads-refresh`) | skipped steps retried oldest first, max 2 | unit: selection + idempotency |

### Phase 3: locks and rollout

| PR | Owner | Scope | Acceptance | Tests |
|---|---|---|---|---|
| 3.1 Locked previews | frontend | `AgentLockedPreview`, per-agent static previews, lock pill, one-step connect Sheet | locked card DOM contains no user rows; preview `inert` + `aria-hidden`; CTA keyboard reachable | Playwright: assert DOM text of locked card lacks seeded user data; unit: summarizer strips detail for locked |
| 3.2 Plan lock policy | backend | `agentAccess`, `AGENT_PLAN_LOCKS` env, lock merge precedence | default off = unchanged; on = `reason:'plan'` locks, detail endpoints also refuse | unit: matrix feature x plan; route test: locked agent detail endpoint returns 403 |
| 3.3 Preference + prompt | full-stack | `GET/PUT /api/settings/dashboard-layout`, `app_config.agents_feed_enabled`, "Try the new dashboard / Later" card, user-menu switch | optimistic switch, revert on 500, snooze 7 days stored with timestamp, max 3 | unit: snooze logic; Playwright: switch/revert/reload persists, no CLS on switch |
| 3.4 Analytics | analytics | events in section e.4 wired | TTFI and CTR queryable from `dashboard_events` | unit: sanitiser whitelist; Playwright: event emitted once per viewed item |
| 3.5 Tablet layout | frontend | `useLayoutMode`, 1024-1279 two-column | no horizontal overflow 1024..1279 sweep | Playwright width sweep (360..1440) |

### Phase 4: default on, then remove

Flip env to `default` after gates in e.4 hold for 2 weeks; remove `LeadsPanel` slot code and `lib/mock-data.ts` `agents` only after one release with `classic` still selectable. Delete dead `components/dashboard/TabNav.tsx` here.

## (h) Risks and open questions

### Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Groq free tier (about 120 req/day shared) exhausted by a signup spike | first runs partially empty, "populated" promise broken | per-user cap, global budget with 20% reserve, breaker, non-LLM steps (crawl, SEO audit, findings) still run, so the SEO audit is the guaranteed floor; cron retry; messaging in c.5 |
| Client-side orchestrator dies when tab closes | half-finished setup | persisted step state + retry cron (2.3); phase 2 can later move to a server job (`lib/jobs/jobRunner.ts`) without changing the card |
| Feed fan-out query cost per dashboard load | DB load, slow TTFB (Okara 5-7 s) | head-only counts, ETag/304, 5 s memo, indexes on `(project_id, status)` (add via migration in PR 1.2 where missing, e.g. `x_drafts`, `linkedin_drafts`, `articles`) |
| Count disagrees with the agent's own list | trust loss | summarizers use the same status filters as the agent routes; contract test per agent comparing to the route's list query |
| Plan locks leak data | revenue + trust | server strips detail, detail endpoints enforce the same lock (3.1/3.2 tests) |
| Rollout flash/CLS | perceived jank | preference bundled with project data, neutral sized skeleton |
| Two panel codepaths during rollout | maintenance | shared `useAgentsFeed`; classic layout frozen, deleted in phase 4 |
| New hosted users with no `primaryModel` currently skip description/competitors | empty first run (today's bug) | fixed by 2.2 |

### Open questions for the owner

1. **Which agents ship in v1 rows?** Proposed: Leads, SEO, Fix PRs, GEO, Reddit, X, LinkedIn, Articles, HN. Is GitHub agent (`GitHubAgentModal`) a separate row from Fix PRs, or merged? And are UGC/Influencer rows (present in `lib/mock-data.ts`) dropped for v1?
2. **First-run model scope.** Is "2 documents + description + competitors + 10 leads" the right free allowance, or should all six documents run free if the budget allows (about 6 more Groq calls per user)?
3. **Budget numbers.** Confirm `GROQ_DAILY_BUDGET` default 100 and the 6-call per-user cap, or provide a paid Groq/Mistral key so the shared ceiling can be raised.
4. **Outreach as its own row or part of Leads?** Proposed: part of Leads in v1 (reply count in the Leads row), split later.
5. **SSE vs polling.** OK to ship conditional-GET polling first and revisit SSE only if Vercel limits and cost allow?
6. **Plan tiers.** Which agents/features are candidate paid locks (my guess: GEO tracking, auto-apply fix PRs, auto-send outreach, premium models)? Until decided the policy stays empty and `AGENT_PLAN_LOCKS=off`.
7. **Rollout default.** Hosted `opt-in` first for all users, or default-on for new signups only (simplest, no prompt for them) while existing users get the prompt?
8. **Mobile default tab.** Agents (Okara) vs Context right after setup. Proposed: Context first-time, Agents afterwards.
9. **Dashboard events storage.** OK to add an authenticated `dashboard_events` table (first-party only), or should we reuse an existing analytics sink?
10. **Drag reorder.** Is keyboard + menu reorder enough for v1 (no `@dnd-kit` dependency)?

## Appendix: file map

New: `docs/design/agents-feed-flow.md` (this file), `components/dashboard/feed/*`, `lib/domain/overview/feed/*`, `lib/llm/platformBudget.ts`, `app/api/dashboard/feed/route.ts`, `app/api/project/[id]/setup/route.ts`, `app/api/settings/dashboard-layout/route.ts`, `app/api/cron/firstrun-retry/route.ts`, migration `dashboard_events` (+ indexes), tests under `tests/` (`agentSummaries`, `buildFeed`, `feedFormat`, `platformBudget`, `layoutPreference`, `snooze`) and `e2e/` (`agents-feed-layout`, `agents-feed-a11y`, `agents-feed-cls`, `first-run`, `locked-inert`).
Modified: `app/dashboard/page.tsx`, `lib/project-store.tsx` (emit setup events, platform-model calls), `lib/features.ts` (`AGENTS_FEED`), `lib/entitlements.ts` (`agentAccess`), `components/dashboard/AgentsFeedPanel.tsx` (rewrite), `components/dashboard/MobileTabBar.tsx`, `components/dashboard/LeadsPanel.tsx` (becomes the Leads card body).
