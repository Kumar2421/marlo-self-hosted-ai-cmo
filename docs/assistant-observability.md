# Assistant observability

Every assistant turn writes **one** JSON line to stdout (`lib/domain/assistant/turnLog.ts`), wired in BOTH `app/api/chat/route.ts` and `app/api/chat/stream/route.ts` via `getAssistantTelemetry().run(...)` + `wrapPorts(...)`. `runAssistantTurn` fires the observer once per turn, and the stream route calls it once, so a turn is logged and counted once. Both routes pass `SILENT_TURN_OPTIONS`, which silences the legacy `[assistant] turn ok=...` text line, so there is exactly one line per turn (tested for ok, fallback and failed turns).

```json
{"evt":"assistant_turn","t":"2026-10-23T10:00:00.000Z","ok":true,"provider":"openai","model":"gpt-4o-mini","candidateIndex":0,"fallback":false,"attempts":1,"tools":["list_findings"],"toolMs":42,"totalMs":1840,"errorKind":null,"groundingFlags":0,"plan":"unknown","u":"3f9a1c0b7d2e"}
```

| Field | Meaning |
| --- | --- |
| `t` | ISO time of the end of the turn |
| `ok` / `errorKind` | success, or `rate_limit`, `auth`, `timeout`, `http_422`, `internal`, ... |
| `provider`, `model`, `candidateIndex`, `fallback`, `attempts` | which model answered, how many models and driver calls the turn took |
| `tools`, `toolMs` | tool names used (never inputs or results), total time inside tools |
| `totalMs` | whole turn |
| `groundingFlags` | number of figures in the reply found in no tool result (log-only, see `replyGrounding.ts`) |
| `plan` | the plan from the entitlement lookup the service already makes for the turn (`free`, `lite`, `pro`, ...), `selfhost` on self-host, `unknown` if that lookup did not run |
| `u` | first 12 hex chars of sha256(`ASSISTANT_LOG_SALT` + user id); set the salt in production |

## Never logged

Message text, history, the reply, stream deltas, thread ids, tool inputs or results, emails, names, URLs, project ids, raw user ids, API keys, error messages. The line is built from an allow-list; free-form strings (provider, model, tool names, error kind, plan) must match a strict pattern and look nothing like a token, or they are replaced by `other` / dropped. `tests/turnLog.test.mts` feeds a turn containing an email, a token and message text and asserts none appear.

## Reading it in Vercel

Logs -> filter by message `assistant_turn`, or search `"errorKind":"rate_limit"`. Useful searches: `"ok":false`, `"fallback":true`, `"groundingFlags":` (non-zero), a `u` value to follow one (hashed) user. The log drain / export carries the same JSON.

## Counters

In-memory per server instance: turns, errors by kind, fallbacks, turns with grounding flags, p50/p95 latency over the last 200 turns. Other instances and restarts have their own counters, so treat them as a sample, not a total.

`GET /api/admin/assistant-health` with `Authorization: Bearer $CRON_SECRET` (same check as the cron routes) returns the snapshot; anything else gets 401. The response is `Cache-Control: no-store`.

## Limits

- `groundingFlags` over-counts figures the model derived itself (e.g. a percent change it calculated).
- On the real-token streaming path the driver returns a stream, not text, so `groundingFlags` is 0 there (only tool-path and non-streamed replies are checked).
- `plan` reflects the plan, not whether limits are enforced (billing off still reports the resolved plan).
- Turns that fail before the driver is called (400/401/409) log `provider`/`model` as null.
