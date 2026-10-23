<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Okara agent operating contract

## Mission
Help a website owner move through DISCOVER → UNDERSTAND → ACT → VERIFY.

## Shared source of truth
GitHub main, pull requests, CI, deployment state, and production validation are the authoritative engineering state. Agent chat context is not shared state.

## Roles
- GPT / architect: product direction, architecture, task selection, acceptance criteria, final synthesis.
- Claude Code / implementer: repository investigation, implementation, tests, debugging, focused PRs.
- Harmis / independent reviewer: adversarial review, correctness, security isolation, UX trust, regression and production-risk analysis.
- GitHub Actions: mechanical quality gate.
- Vercel / production checks: deployment and runtime evidence.

## Before changing code
1. Read current main and recent history.
2. Inspect relevant existing code and open PRs.
3. Identify existing abstractions before adding new ones.
4. State the smallest problem being solved.
5. Do not duplicate or redesign unrelated systems.

## Change rules
- One coherent problem per PR.
- Prefer small, reviewable diffs.
- Preserve project/user isolation in platform mode.
- Never trust client-supplied identity or project ownership.
- Do not introduce speculative infrastructure.
- Do not rewrite unrelated code.
- Production correctness matters more than local compilation.

## Completion gate
A task is complete only when applicable evidence exists for:
1. implementation,
2. focused tests,
3. lint/typecheck/build,
4. deployment,
5. production or real-site validation for user-facing/runtime-sensitive behavior.

If a gate is not applicable, record why. If it is pending, the task is not fully verified.

## Handoff
Every agent handoff should state:
- objective,
- current status,
- changed areas,
- tests/evidence,
- known risks,
- unresolved questions,
- recommended next action.

## Failure protocol
When CI, review, deployment, or production validation fails:
- investigate the actual failure,
- make the smallest corrective change,
- rerun the relevant gate,
- update the handoff with what was learned.
Do not hide failures or mark work complete based only on code generation.
