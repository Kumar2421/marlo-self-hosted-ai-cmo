import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { AssistantPorts, TurnObserver } from "./assistantService.ts";
import { checkReplyGrounding } from "./replyGrounding.ts";

/**
 * Turn observability: ONE structured log line per assistant turn plus in-memory counters.
 *
 * The line carries metadata only. It is built from an allow-list of fields, and every free-form string
 * (provider, model, tool names, error kind, plan) is validated against a strict pattern, so message
 * text, replies, tool results, emails or secrets cannot reach it even by accident. The user is a hash.
 * No assistantService edit is needed: `wrapPorts` instruments the existing ports and observer seam.
 */

export type TurnLogLine = {
  evt: "assistant_turn";
  t: string;
  ok: boolean;
  provider: string | null;
  model: string | null;
  candidateIndex: number;
  fallback: boolean;
  attempts: number;
  tools: string[];
  toolMs: number;
  totalMs: number;
  errorKind: string | null;
  groundingFlags: number;
  plan: string;
  /** Hashed user id, or null when the turn failed before authentication. */
  u: string | null;
};

/** What the observer receives: a tolerant view of assistantService's TurnEvent (only timing is required). */
export type TurnLogEvent = {
  modelUsed?: { providerId: string; model: string } | null;
  toolsUsed?: string[];
  fallbackUsed?: boolean;
  durationMs: number;
  errorKind?: string | null;
  /** Provided by assistantService; when absent the wrapper's own count is used. */
  candidateIndex?: number | null;
  attempts?: number;
};

/** Per-turn facts only the wrappers can see. */
export type TurnProbe = {
  userId: string | null;
  plan: string;
  toolMs: number;
  groundingFlags: number;
  attempts: number;
  candidates: string[];
  lastCandidate: { provider: string; model: string } | null;
};

// ---- sanitising -------------------------------------------------------------------------------------------

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;
const SAFE_TOOL = /^[a-z][a-z0-9_]{0,39}$/;
// Reject anything that looks like a secret even if it matches SAFE_ID.
const SECRETISH = /(?:sk|pk|rk|ghp|gho|xox[bap]|eyJ|AIza)[-_A-Za-z0-9]{12,}|[A-Za-z0-9+/=_-]{32,}/;

export function safeLabel(v: unknown, fallback: string | null = null): string | null {
  return typeof v === "string" && SAFE_ID.test(v) && !SECRETISH.test(v) ? v : fallback;
}
const safeTool = (v: unknown): string | null => (typeof v === "string" && SAFE_TOOL.test(v) ? v : null);
const count = (n: unknown, max = 1_000_000): number => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), max) : 0);

/** sha256(salt + id), 12 hex chars. Without a salt env it is a plain truncated sha256 (still not the raw id). */
export function hashUserId(id: string, salt: string | undefined = process.env.ASSISTANT_LOG_SALT): string {
  return createHash("sha256").update(`${salt ?? ""}${id}`, "utf8").digest("hex").slice(0, 12);
}

/** Pure: build the log line from an event and the probe. Exported for tests. */
export function buildTurnLogLine(e: TurnLogEvent, probe: TurnProbe, now: Date, salt?: string): TurnLogLine {
  const provider = e.modelUsed ? safeLabel(e.modelUsed.providerId, "other") : probe.lastCandidate ? safeLabel(probe.lastCandidate.provider, "other") : null;
  const model = e.modelUsed ? safeLabel(e.modelUsed.model, "other") : probe.lastCandidate ? safeLabel(probe.lastCandidate.model, "other") : null;
  const candidateIndex = typeof e.candidateIndex === "number" ? Math.max(0, e.candidateIndex) : Math.max(0, probe.candidates.length - 1);
  const errorKind = e.errorKind ? (safeLabel(e.errorKind, "other") as string) : null;
  return {
    evt: "assistant_turn",
    t: now.toISOString(),
    ok: errorKind === null,
    provider, model,
    candidateIndex,
    fallback: Boolean(e.fallbackUsed) || candidateIndex > 0,
    attempts: count(typeof e.attempts === "number" ? e.attempts : probe.attempts, 50),
    tools: (e.toolsUsed ?? []).map(safeTool).filter((x): x is string => x !== null).slice(0, 20),
    toolMs: count(probe.toolMs, 3_600_000),
    totalMs: count(e.durationMs, 3_600_000),
    errorKind,
    groundingFlags: count(probe.groundingFlags, 1000),
    plan: safeLabel(probe.plan, "unknown") as string,
    u: probe.userId ? hashUserId(probe.userId, salt) : null,
  };
}

// ---- counters ---------------------------------------------------------------------------------------------

/** Nearest-rank percentile of a numeric sample; null for an empty sample. p in (0, 100]. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1];
}

export type MetricsSnapshot = {
  scope: "per-instance";
  since: string;
  turns: number;
  errors: number;
  errorsByKind: Record<string, number>;
  fallbacks: number;
  groundingFlaggedTurns: number;
  latencyMs: { samples: number; p50: number | null; p95: number | null };
};

export function createMetrics(windowSize = 200, now: () => Date = () => new Date()) {
  const since = now().toISOString();
  let turns = 0; let errors = 0; let fallbacks = 0; let flagged = 0;
  const errorsByKind: Record<string, number> = {};
  const latencies: number[] = [];
  return {
    record(line: TurnLogLine): void {
      turns += 1;
      if (!line.ok) { errors += 1; const k = line.errorKind ?? "other"; errorsByKind[k] = (errorsByKind[k] ?? 0) + 1; }
      if (line.fallback) fallbacks += 1;
      if (line.groundingFlags > 0) flagged += 1;
      latencies.push(line.totalMs);
      if (latencies.length > windowSize) latencies.shift();
    },
    snapshot(): MetricsSnapshot {
      return {
        scope: "per-instance", since, turns, errors, errorsByKind: { ...errorsByKind }, fallbacks, groundingFlaggedTurns: flagged,
        latencyMs: { samples: latencies.length, p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
      };
    },
  };
}
export type Metrics = ReturnType<typeof createMetrics>;

// ---- telemetry (observer + port wrappers) ------------------------------------------------------------------

export type TelemetryOptions = {
  write?: (line: string) => void;
  salt?: string;
  now?: () => Date;
  metrics?: Metrics;
};

const newProbe = (plan = "unknown"): TurnProbe => ({ userId: null, plan, toolMs: 0, groundingFlags: 0, attempts: 0, candidates: [], lastCandidate: null });

export function createTurnTelemetry(opts: TelemetryOptions = {}) {
  const als = new AsyncLocalStorage<TurnProbe>();
  const now = opts.now ?? (() => new Date());
  const metrics = opts.metrics ?? createMetrics(200, now);
  const write = opts.write ?? ((l: string) => { console.log(l); });

  const observer: TurnObserver = {
    onTurn(event) {
      const probe = als.getStore() ?? newProbe();
      const line = buildTurnLogLine(event as TurnLogEvent, probe, now(), opts.salt ?? process.env.ASSISTANT_LOG_SALT);
      metrics.record(line);
      write(JSON.stringify(line));
    },
  };

  /** Run one turn inside its own probe, so concurrent turns never mix. */
  function run<T>(fn: () => Promise<T>, info: { plan?: string } = {}): Promise<T> {
    return als.run(newProbe(info.plan), fn);
  }

  /** Same ports with instrumented scope/llm and the observer attached (an existing observer still runs). */
  function wrapPorts(ports: AssistantPorts): AssistantPorts {
    const prior = ports.observer;
    return {
      ...ports,
      scope: {
        ...ports.scope,
        authenticate: async (ctx) => {
          const s = await ports.scope.authenticate(ctx);
          const p = als.getStore();
          if (p && s?.userId) p.userId = s.userId;
          if (p && ctx.mode === "selfhost" && p.plan === "unknown") p.plan = "selfhost";
          return s;
        },
      },
      // The plan is read from the entitlement lookup the service already makes for the turn (no extra query).
      ...(ports.entitlements ? {
        entitlements: {
          ...ports.entitlements,
          entitlement: async (ctx) => {
            const ent = await ports.entitlements!.entitlement(ctx);
            const p = als.getStore();
            if (p && ent && typeof ent.plan === "string") p.plan = ent.plan;
            return ent;
          },
        },
      } : {}),
      llm: {
        ...ports.llm,
        getDriver: (providerId) => {
          const driver = ports.llm.getDriver(providerId);
          if (!driver) return driver;
          return async (req) => {
            const p = als.getStore();
            if (!p) return driver(req);
            p.attempts += 1;
            const key = `${providerId}/${req.model}`;
            if (!p.candidates.includes(key)) p.candidates.push(key);
            p.lastCandidate = { provider: providerId, model: req.model };
            const results: string[] = [];
            const tools = req.tools?.map((t) => ({
              ...t,
              execute: async (input: Record<string, unknown>) => {
                const t0 = Date.now();
                try { const out = await t.execute(input); results.push(out); return out; } finally { p.toolMs += Date.now() - t0; }
              },
            }));
            const out = await driver(tools ? { ...req, tools } : req);
            try {
              const lastUser = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
              p.groundingFlags = checkReplyGrounding(out.text ?? "", results, { today: now(), extraGrounded: [req.system ?? "", lastUser] }).unverified.length;
            } catch { /* log-only */ }
            return out;
          };
        },
      },
      observer: { onTurn: (e) => { try { prior?.onTurn(e); } catch { /* ignore */ } observer.onTurn(e); } },
    };
  }

  return { observer, run, wrapPorts, metrics };
}
/**
 * Pass as the turn options of runAssistantTurn / runAssistantTurnStream in BOTH chat routes: it silences the
 * legacy "[assistant] turn ok=..." text line so the structured line from this file is the ONE line per turn.
 */
export const SILENT_TURN_OPTIONS: { log: (line: string) => void } = { log: () => {} };

export type TurnTelemetry = ReturnType<typeof createTurnTelemetry>;

let shared: TurnTelemetry | null = null;
/** Process-wide instance (per serverless instance). */
export function getAssistantTelemetry(): TurnTelemetry {
  return (shared ??= createTurnTelemetry());
}
