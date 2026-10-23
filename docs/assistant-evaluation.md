# Assistant evaluation

Two layers, with different jobs.

## 1. CI: pipeline checks (deterministic)

`tests/assistantEval.test.mts` replays 60 realistic questions (`tests/fixtures/assistantEval.ts`) against fake project states (`tests/fixtures/assistantEvalStates.ts`). The "model" is a **script** per case (which tools it calls, what it replies). It proves the **pipeline**, not the real model's judgement:

- tool-call and character budgets hold (`MAX_TOOL_CALLS`, per-result and total caps), also under parallel calls
- unknown tools never execute and are never reported as used
- tool errors become text, the turn still finishes
- "never audited" reaches the model as `neverAudited: true`, distinct from "audited and clean"
- plan locks (assumed policy, simulated) come back as a lock message
- `checkReplyGrounding` flags the replies that invent figures and passes grounded ones

Coverage: fix-first (6), traffic (8), did-my-fix-work (6), site health (7), never-audited (2), competitors (5), leads (4), GEO (4), out-of-scope (6), prompt injection (6), pipeline/tool failure (3), gating (3).

Run: `node --experimental-strip-types --test tests/assistantEval.test.mts`

## 2. Manual: live model scoring

`scripts/assistant-eval.mts` sends the same questions to a real model through the real `runAssistantTurn` (fake data, no DB). It costs tokens and is never run in CI.

```
ASSISTANT_EVAL_API_KEY=... node --experimental-strip-types scripts/assistant-eval.mts \
  --provider openai --model gpt-4o-mini [--only ff-1,tr-1] [--limit 10] [--json out.json]
```

- Refuses to run without `ASSISTANT_EVAL_API_KEY` (env only, never a flag) and refuses when `CI` is set.
- `ASSISTANT_EVAL_BASE_URL` for lmstudio / ollama / custom.
- `--dry` replays the CI scripts through the same report (no key, no network) to check the script itself. Three cases fail on purpose there: they are the invented-number replies.
- Anthropic and Google have no tool loop in this codebase, so the tool column is `n/a` for them (the model only sees the counts overview).

Output: JSON on stdout (and `--json file`), a table on stderr. Columns: tool selection (expected tools called, nothing outside expected + allowed, nothing forbidden), grounding flags (figures in the reply found in no tool result), claims (reply matched a `mustNotClaim` pattern), latency, errors. A case passes only if all are clean.

Reading the grounding column: it is a log-only heuristic. Figures the model derives itself (a percent change it computed) are flagged too, so look at `unverified` in the JSON before judging a model.

Adding a case: append to `EVAL_CASES`; give it a `script` that matches the data so CI stays green.
