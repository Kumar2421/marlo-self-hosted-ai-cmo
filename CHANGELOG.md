# Changelog

Marlo has no versioned releases yet. `main` is deployed to [app.marlo.mlforge.in](https://app.marlo.mlforge.in). This file groups merged pull requests by theme. PR numbers link to `github.com/Kumar2421/marlo` (formerly `okara-alternative`).

## Beta hardening phase: 2026-10-14 to 2026-10-22 (#116 to #180)

This phase focused on making the core loop (discover → understand → act → verify) honest and complete, and on getting the hosted app ready for many users.

### Onboarding and setup

- Setup progress is saved per project and resumes when you return. The finish-setup checklist has a Retry for each step ([#174](https://github.com/Kumar2421/marlo/pull/174)).
- Setup no longer dead-ends on unverifiable URLs or auth errors ([#159](https://github.com/Kumar2421/marlo/pull/159)).
- Project data is refetched on sign-in and cleared on sign-out. `setupRunning` is exposed ([#158](https://github.com/Kumar2421/marlo/pull/158)).
- Truthful project setup, a finish-setup checklist, and honest Context stubs ([#154](https://github.com/Kumar2421/marlo/pull/154)).
- Sign-in asks only for identity scopes. Gmail and Google data scopes are requested when you connect them ([#148](https://github.com/Kumar2421/marlo/pull/148)).
- Honest login errors, resend confirmation, and an auth e2e suite ([#133](https://github.com/Kumar2421/marlo/pull/133)). Email codes of 6 to 10 digits are accepted ([#134](https://github.com/Kumar2421/marlo/pull/134)).

### Dashboard

- A **Fix first** strip, a collapsed Google card, and a cleaner finding drawer ([#175](https://github.com/Kumar2421/marlo/pull/175)).
- The Status Log shows only honest lines ([#176](https://github.com/Kumar2421/marlo/pull/176)), and the header stays quiet when idle. Phones and tablets open on Analytics when an audit exists ([#173](https://github.com/Kumar2421/marlo/pull/173)).
- The dashboard reads only real documents ([#172](https://github.com/Kumar2421/marlo/pull/172)).
- Fetches are bounded by a timeout, the document viewer is a real dialog, and a11y landmarks were added ([#169](https://github.com/Kumar2421/marlo/pull/169)).
- Honest Traffic and Google health UI for revoked connections ([#165](https://github.com/Kumar2421/marlo/pull/165)). Bad Google connections fail loudly and can recover ([#156](https://github.com/Kumar2421/marlo/pull/156)).
- Honest data states for Traffic, overview, snapshots and PageSpeed ([#153](https://github.com/Kumar2421/marlo/pull/153)).
- Beta credits display, document tables, settings copy ([#163](https://github.com/Kumar2421/marlo/pull/163)).
- Chat is scoped to the active project, with honest no-data hints ([#150](https://github.com/Kumar2421/marlo/pull/150)).
- Design tokens, shared Radix primitives, and a dev gallery ([#146](https://github.com/Kumar2421/marlo/pull/146)).
- Persistent mobile shell, a two-pane tablet layout, and an accessible tab bar ([#142](https://github.com/Kumar2421/marlo/pull/142)). A compact one-row header with an on-demand log overlay ([#136](https://github.com/Kumar2421/marlo/pull/136)).
- Narrow-panel layout fixes ([#157](https://github.com/Kumar2421/marlo/pull/157)), grid and scroll fixes ([#135](https://github.com/Kumar2421/marlo/pull/135)), and responsive settings ([#137](https://github.com/Kumar2421/marlo/pull/137)).
- Next-action ranking and a today checklist ([#141](https://github.com/Kumar2421/marlo/pull/141)). Findings loading, error and empty states ([#139](https://github.com/Kumar2421/marlo/pull/139)). A shared type scale ([#138](https://github.com/Kumar2421/marlo/pull/138)). Website icon fixes ([#144](https://github.com/Kumar2421/marlo/pull/144)).

### Findings loop

- A Re-check explains why it did not verify, and the Status Log shows plain errors ([#180](https://github.com/Kumar2421/marlo/pull/180)).
- Re-check and auto-verify cover GEO gaps and vanished findings ([#179](https://github.com/Kumar2421/marlo/pull/179)).
- Findings that a newer audit no longer reports are flagged **No longer detected**. A Re-check is needed to verify them ([#177](https://github.com/Kumar2421/marlo/pull/177)).
- An evidence-based lifecycle: Re-check goes through `verifyFinding`, the client cannot set verified or failed, and updates are conditional ([#151](https://github.com/Kumar2421/marlo/pull/151)).
- Recommendations that match their finding, one counting path, and honest labels ([#164](https://github.com/Kumar2421/marlo/pull/164), [#152](https://github.com/Kumar2421/marlo/pull/152)).
- Fixes are auto-verified 24 hours after they ship, with a watch for regressions ([#127](https://github.com/Kumar2421/marlo/pull/127)).
- Fix PRs: no duplicates or orphans ([#129](https://github.com/Kumar2421/marlo/pull/129)), measurement starts on the merge day ([#126](https://github.com/Kumar2421/marlo/pull/126)), the reconcile sweep has a deadline ([#130](https://github.com/Kumar2421/marlo/pull/130)), and users stay inside the finding while connecting GitHub ([#128](https://github.com/Kumar2421/marlo/pull/128)).

### GEO

- AI-answer gaps become findings, verified only by a later real run ([#178](https://github.com/Kumar2421/marlo/pull/178)).
- Honest mention detection, provider failures and timeouts, and weekly coverage ([#155](https://github.com/Kumar2421/marlo/pull/155)).

### Security

- The operator's LLM key is never sent to a base URL that a user supplied ([#170](https://github.com/Kumar2421/marlo/pull/170)).
- Allow-listed generic settings writes. Social daily drafts are opt-in ([#149](https://github.com/Kumar2421/marlo/pull/149)).
- Hardening for SEC-08 to SEC-13: OAuth state, cron auth, fail-closed platform mode, input caps, security headers, dependency upgrades ([#123](https://github.com/Kumar2421/marlo/pull/123)).
- Every user-URL fetch is pinned and capped (SSRF) ([#122](https://github.com/Kumar2421/marlo/pull/122)).
- The public audit is rate-limited with shared Supabase counters ([#121](https://github.com/Kumar2421/marlo/pull/121)).
- Trusted tables (profiles, user_settings, connections) are locked, and the audit report was added ([#120](https://github.com/Kumar2421/marlo/pull/120)).

### Scale and performance

- Every cron selection read is paged, and the capture-time lookup is chunked ([#162](https://github.com/Kumar2421/marlo/pull/162)).
- PageSpeed and Jina time is bounded, the PSI route returns partial results, and scale indexes were added ([#161](https://github.com/Kumar2421/marlo/pull/161)).
- A slimmer `/api/project/data`, and documents refresh without a full reload ([#160](https://github.com/Kumar2421/marlo/pull/160)).
- Parallel project data loading, shared auth and provider queries, a self-hosted Lottie animation, and reserved loading space ([#143](https://github.com/Kumar2421/marlo/pull/143)).
- Old cron marker rows are pruned ([#172](https://github.com/Kumar2421/marlo/pull/172)).

### Pricing and plans (beta, payments not live)

- A public pricing page and waitlist ([#168](https://github.com/Kumar2421/marlo/pull/168)).
- The plan matrix and policy core. It stays dark, and behavior is unchanged while billing is off ([#167](https://github.com/Kumar2421/marlo/pull/167)).
- A foundation for dark plan-lock UI: `/api/plan`, `usePlan`, `LockedLine`, `PlanBadge` ([#171](https://github.com/Kumar2421/marlo/pull/171)).
- First-project setup is free, failed actions are refunded, and there is one shared `InsufficientCreditsError` ([#166](https://github.com/Kumar2421/marlo/pull/166)).

### Leads and social (experimental)

- A compact lead list, an email filter, a collapsible profile, and a slim Gmail bar ([#140](https://github.com/Kumar2421/marlo/pull/140)).
- Local business leads in the Leads tab ([#118](https://github.com/Kumar2421/marlo/pull/118)). It shows "Coming soon" on hosted, with an honest SMTP label ([#125](https://github.com/Kumar2421/marlo/pull/125)).
- Rule-first LinkedIn parsing in lead search ([#119](https://github.com/Kumar2421/marlo/pull/119)).
- Daily social drafts, one per network per project ([#117](https://github.com/Kumar2421/marlo/pull/117)). Social drafts moved to a top-bar menu ([#116](https://github.com/Kumar2421/marlo/pull/116)).

### Docs and testing

- An e2e UI quality harness: axe a11y gate, vitals, and visual snapshots ([#147](https://github.com/Kumar2421/marlo/pull/147)).
- An Agents Feed design spec. It is a proposal and is not built ([#145](https://github.com/Kumar2421/marlo/pull/145)).
- README rewritten for Marlo, plus environment and hosted-setup docs ([#124](https://github.com/Kumar2421/marlo/pull/124)).

## Earlier (2026-09 to 2026-10-07)

This is a summary. See `git log` for the full history.

- **Core platform:** Supabase mode with RLS and Vault secrets alongside self-host SQLite. A baseline schema migration ([#88](https://github.com/Kumar2421/marlo/pull/88)). Fail-closed platform auth ([#78](https://github.com/Kumar2421/marlo/pull/78)).
- **Findings and actions:** SEO audit to findings ([#74](https://github.com/Kumar2421/marlo/pull/74)), tracked actions ([#80](https://github.com/Kumar2421/marlo/pull/80)), outcome measurement, and search opportunities as findings ([#101](https://github.com/Kumar2421/marlo/pull/101)).
- **Search:** daily Search Console snapshots ([#90](https://github.com/Kumar2421/marlo/pull/90)), trends and opportunities ([#91](https://github.com/Kumar2421/marlo/pull/91)), and the shared TanStack Query data layer ([#94](https://github.com/Kumar2421/marlo/pull/94)).
- **Act:** GitHub App connect and code fixes ([#111](https://github.com/Kumar2421/marlo/pull/111)), GitHub fix delivery ([#103](https://github.com/Kumar2421/marlo/pull/103)), and CMS publishing to WordPress and Webflow ([#112](https://github.com/Kumar2421/marlo/pull/112)).
- **GEO** tracking with history ([#108](https://github.com/Kumar2421/marlo/pull/108)). **Notifications** through Resend and the in-app bell ([#109](https://github.com/Kumar2421/marlo/pull/109)). **Chat** over everything Marlo stores ([#110](https://github.com/Kumar2421/marlo/pull/110)).
- **Public quick audit** and the acquisition funnel ([#29](https://github.com/Kumar2421/marlo/pull/29), [#52](https://github.com/Kumar2421/marlo/pull/52), [#55](https://github.com/Kumar2421/marlo/pull/55)).
