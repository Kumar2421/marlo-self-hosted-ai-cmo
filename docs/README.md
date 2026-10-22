<img src="images/logo.svg" alt="Marlo logo" width="48">

# Marlo documentation

Start with the [project README](../README.md). This page maps every doc in the repository.

## Use and run Marlo

| Doc | What it covers |
|---|---|
| [self-hosting.md](self-hosting.md) | Self-host step by step: SQLite or your own Supabase, cron recipe, troubleshooting |
| [hosted-setup.md](hosted-setup.md) | Ordered checklist for a hosted (Supabase + Vercel) deployment |
| [environment.md](environment.md) | Every environment variable, what it enables, what happens without it |
| [google-cloud-setup.md](google-cloud-setup.md) | Google OAuth client, APIs to enable, consent screen |
| [plans-and-pricing.md](plans-and-pricing.md) | Free / Lite / Pro matrix from `planMatrix.ts`, limits, the enforcement flag |
| [FAQ.md](FAQ.md) | Common questions |

## How it works

| Doc | What it covers |
|---|---|
| [architecture.md](architecture.md) | Data flow, store pairs, setup state, findings lifecycle, crons, GitHub App loop |
| [security.md](security.md) | Protections in place and known gaps |
| [../security-review.md](../security-review.md) | Full security audit with findings and evidence |
| [production-readiness.md](production-readiness.md) | Runtime contract between self-host and platform mode, deployment gate |
| [design/agents-feed-flow.md](design/agents-feed-flow.md) | Design proposal for an Agents Feed (not built; parked) |

## Product and process

| Doc | What it covers |
|---|---|
| [product-direction.md](product-direction.md) | Product promise and phase gate |
| [usecase.md](usecase.md) | Use cases and scope boundaries |
| [current-state.md](current-state.md) | Current engineering state and coordination model |
| [acceptance-gates.md](acceptance-gates.md) | Definition of done for every change |
| [agent-protocol.md](agent-protocol.md) | How agents hand off work in this repo |
| [../AGENTS.md](../AGENTS.md) | Operating contract for coding agents |

## Repository files

| File | What it covers |
|---|---|
| [../CHANGELOG.md](../CHANGELOG.md) | Changes by theme, with PR links |
| [../SECURITY.md](../SECURITY.md) | How to report a vulnerability |
| [../e2e/README.md](../e2e/README.md) | Playwright suites: layout, accessibility, vitals, visual |
| [../LICENSE](../LICENSE) | AGPL-3.0 |
| [readme-claims-checklist.md](readme-claims-checklist.md) | Each README claim mapped to the code or PR that proves it |
