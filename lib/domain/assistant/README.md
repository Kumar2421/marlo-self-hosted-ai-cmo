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

## Security model

The model never has database access. The only path is:

`MODEL -> named tools (chat/tools.ts) -> ONE read-only data gateway (assistant/gateway/) -> database under the user's own identity`

What the model can do: call the nine named read-only tools with validated arguments. What it cannot do: write SQL, name a table, pick a user or project, write anything, or see credentials, vault secrets or email addresses.

- **No generic query.** `DataGateway` has one typed function per dataset, each taking `{ userId, projectId }` as its first argument. A missing or malformed scope throws `ScopeError` before any query is built. Tools, `toolLoop.ts` and the gateway cannot import `getDb`, `createServiceClient`, the vault or credential helpers (enforced by `tests/assistantSecurityGuard.test.mts`).
- **Hosted:** reads use the signed-in user's own session client (`utils/supabase/server createClient`), so Postgres row level security enforces tenancy. Every query also carries explicit `user_id` and `project_id` filters, the project is verified as owned once per turn, and every returned row is re-checked against the scope (rows that are not this user's and this project's are dropped, even if the backend ignored the filters). The service-role client is used in `platformAdapters.ts` only for credential/vault/credit work.
- **Self-host:** parameterised SQLite queries scoped to the project; the DB handle is injected by `selfHostAdapters.ts`, never imported by the gateway.
- **Tool arguments** are validated per tool (`chat/toolSchema.ts`, `TOOL_ARG_SCHEMAS`): unknown keys dropped, enums enforced, strings bounded, `limit` clamped, finding ids must be a UUID (optionally `finding_`-prefixed) and are then ownership-checked through the gateway. Another project's id looks the same as a missing one.
- **Untrusted data:** crawled titles, evidence, competitor and lead names, queries are attacker-controllable. `chat/untrusted.ts` strips control and zero-width characters, defangs `<`, `>` and backticks, caps length, and wraps every non-trusted string in `⟦ ... ⟧` (the markers are removed from the content so it cannot close the wrapper). `TOOL_SYSTEM_RULES` tells the model that wrapped text is data, never instructions.
- **Audit trail:** one record per tool call `{ userId, projectId, tool, argsHash, ok, durationMs }` (hash of the arguments, no content, emails or secrets). `platform_audit_log` does not exist in `supabase/migrations`, so records are structured JSON log lines (`event: "assistant.tool_call"`) via `logLineAuditSink`. A failing sink never breaks a turn.
- **Rate limit:** 12 chat requests per user per minute (`chatRateLimit.ts`, in-process `memoryRateLimiter`, so per server instance). Plan and monthly limits are separate.

### Tables the chat reads (hosted)

| Table | Owner RLS policy | Notes |
| --- | --- | --- |
| `projects` | yes (`projects_all_own`, `owner_id`) | ownership check |
| `user_settings` | yes, select only (`user_settings_select_own`) | active project id |
| `project_documents` | yes (`project_documents_all_own`) | project context in the prompt |
| `search_snapshots` | yes (`search_snapshots_all_own`) | |
| `findings` | yes (`findings_all_own`) | |
| `actions` | yes (`actions_all_own`, via `projects.owner_id`) | no `user_id` column |
| `leads` | yes (`leads_all_own`) | emails read for counts only, never returned |
| `geo_checks` | yes (`geo_checks_all_own`) | |
| `seo_audits` | yes (`seo_audits_all_own`) | |
| `project_competitors` | yes (`project_competitors_all_own`) | |

Every table the chat reads has an owner policy, so none needs the service-role fallback. Not read by the chat path any more with the service client: all of the above.
