# Assistant service

`app/api/chat/route.ts` is a thin handler: parse body, `runAssistantTurn(ports, ctx, input)`, map `AssistantError` to `NextResponse`.
Everything with a side effect goes through a port, so tests use fakes and PRs touch different files.

Flow in `assistantService.ts`: validate -> authenticate (401) -> project scope (409) -> model plan (422 when empty) -> per candidate (max 3, ~52s total, first gets ~55% of the time left): credentials -> credit check (402) -> prompt -> data ports -> answer -> on transient failure or empty reply, next candidate -> charge ONCE after success (platform key only; BYOK never).

Model policy: the SERVER chooses. Plan = user's preferred model (BYOK + saved primary) -> platform Groq default -> platform Mistral. Fallback only on rate_limit/server/timeout/network/model_unavailable/empty reply (502 provider failures); any other AssistantError (auth, bad_request, 402, 409, 400, 401) stops the turn. The client's providerId/model are ignored. The user is never told which model answered; the observer and one `[assistant] turn ...` log line carry that.

| File | Seam | Owner (future PR) |
| --- | --- | --- |
| `assistantTypes.ts` | turn input/result, `TurnContext`, `AssistantError` | shared, keep stable |
| `modelSelection.ts` | `resolveModelPlan` (ordered candidates), `shouldFallback` | model policy / fallback |
| `credentialResolver.ts` | `CredentialPort`, `CreditPort` (charge point) | model policy (canAfford before, charge once after success) |
| `errorMapping.ts` | `friendlyProviderError`, `classifyProviderError` | model policy (fallback decisions) |
| `promptBuilder.ts` | `PromptPort`, system prompts | prompt / persistence |
| `toolRegistry.ts` | `CHAT_TOOLS`/`runTool` re-exports, `DataPort`, `createDataPorts` | security data gateway; action cards (propose tools) |
| `assistantService.ts` | orchestration, `attemptWithCandidate`, `TurnObserver` (no-op) | streaming (response mode), monitoring (observer) |
| `platformAdapters.ts`, `selfHostAdapters.ts` | real ports (Supabase / SQLite) | only files here importing DB / vault / Next |

Persistence PR: add a `threadStore` port to `AssistantPorts` and call it in `runAssistantTurn`.
`TurnObserver` events carry metadata only (model, tools, duration, error kind), never message content or secrets.
