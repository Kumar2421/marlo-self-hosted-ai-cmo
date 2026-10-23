# Assistant service

`app/api/chat/route.ts` is a thin handler: parse body, `runAssistantTurn(ports, ctx, input)`, map `AssistantError` to `NextResponse`.
Everything with a side effect goes through a port, so tests use fakes and PRs touch different files.

Flow in `assistantService.ts`: validate -> model plan (422/501) -> authenticate (401) -> project scope (409) -> per candidate: credentials (422) -> credits (402) -> prompt -> data ports -> answer -> map errors (502).

| File | Seam | Owner (future PR) |
| --- | --- | --- |
| `assistantTypes.ts` | turn input/result, `TurnContext`, `AssistantError` | shared, keep stable |
| `modelSelection.ts` | `resolveModelPlan` (ordered candidates), `shouldFallback` | model policy / fallback |
| `credentialResolver.ts` | `CredentialPort`, `CreditPort` (charge point) | model policy (move charge after success) |
| `errorMapping.ts` | `friendlyProviderError`, `classifyProviderError` | model policy (fallback decisions) |
| `promptBuilder.ts` | `PromptPort`, system prompts | prompt / persistence |
| `toolRegistry.ts` | `CHAT_TOOLS`/`runTool` re-exports, `DataPort`, `createDataPorts` | security data gateway; action cards (propose tools) |
| `assistantService.ts` | orchestration, `attemptWithCandidate`, `TurnObserver` (no-op) | streaming (response mode), monitoring (observer) |
| `platformAdapters.ts`, `selfHostAdapters.ts` | real ports (Supabase / SQLite) | only files here importing DB / vault / Next |

Persistence PR: add a `threadStore` port to `AssistantPorts` and call it in `runAssistantTurn`.
`TurnObserver` events carry metadata only (model, tools, duration, error kind), never message content or secrets.

## Streaming
`POST /api/chat/stream` (SSE) wraps the SAME `runAssistantTurn` via `runAssistantTurnStream` (`assistantStream.ts`) using optional `TurnHooks` (`onToolStart`, `onDelta`, `signal`, `hasStreamed`); `POST /api/chat` stays as the JSON fallback. Wire format and decoder: `sse.ts`. Real token streaming happens only on a driver's no-tools path (no project data, or Anthropic/Google context path); the tool path (OpenAI-compatible drivers) shows live tool status and then types the finished answer out in chunks. Once text has streamed, `hasStreamed()` blocks model fallback (it would duplicate text). Credit timing is whatever `attemptWithCandidate` does; the stream layer adds none.
