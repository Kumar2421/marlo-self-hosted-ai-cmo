# Current engineering state

## Product loop

DISCOVER → UNDERSTAND → ACT → VERIFY

## Where main is (as of #180, 2026-10-22)

- **Discover:** setup is orchestrated by the browser, and per-step progress is saved and resumed (#174). It needs migration `20261022000300_project_setup_state.sql` on hosted.
- **Understand:** findings are ranked, and a Fix first strip shows the top ones (#175). Traffic (Search Console, GA4) and GEO (real and simulated, never mixed) are in place.
- **Act:** draft GitHub PRs through the GitHub App, and CMS publishing after approval.
- **Verify:** evidence-only statuses (#151). Manual Re-check everywhere, and automatic re-check on hosted. "No longer detected" flags (#177). GEO gaps become findings (#178), covered by Re-check and auto-verify (#179). A Re-check explains why it did not verify (#180).
- **Pricing:** plan matrix and pricing page in beta. Enforcement is off (`app_config.billing_enabled = false`), and there is no payment gateway.
- **Open limits:** setup does not run with the tab closed. Cron coverage is limited for a large fleet. The audit covers 1 page and the site crawl samples up to 8. CSP is report-only.

The status per area is in the [README](../README.md#status). The change history is in [CHANGELOG.md](../CHANGELOG.md).

## Coordination model

GitHub is the shared engineering state. Agents should inspect current main, recent commits, open PRs, CI, deployment state, and production evidence before proposing or implementing changes.

## Current agent roles

- GPT: architecture, product strategy, task selection, acceptance criteria.
- Claude Code: implementation and debugging.
- Harmis: independent review and adversarial validation.
- GitHub Actions: automated quality gate.
- Vercel and production checks: runtime evidence.

## Operating principle

Prefer the smallest reliable change that advances the product loop. Avoid speculative infrastructure and unrelated refactors.
