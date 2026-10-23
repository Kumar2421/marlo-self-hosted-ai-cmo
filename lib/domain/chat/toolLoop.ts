import { rankFindingsForChat } from "./rankedFindings.ts";
import { CHAT_TOOLS, MAX_RESULT_CHARS, runTool, type ChatPorts } from "./tools.ts";

/** Minimal slice of the LlmDriver contract this module needs (structural, so it can be faked). */
export type ToolDefLike = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<string>;
};
export type DriverLike = (req: {
  apiKey: string; model: string; system?: string; baseUrl?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  tools?: ToolDefLike[];
}) => Promise<{ text?: string }>;

/**
 * Bounds. The OpenAI-compatible driver already stops after 4 model rounds
 * (then forces a tool-free answer); these cap what a round can pull in.
 */
export const MAX_TOOL_CALLS = 8;
export const MAX_TOTAL_RESULT_CHARS = 12_000;

const BUDGET_MESSAGE = "Tool budget used up. Answer now from what you already have, and say what you could not check.";

export const TOOL_SYSTEM_RULES = `You can look things up with read-only tools: search performance, search opportunities, findings, the latest SEO audit, tracked competitors, tracked actions and their measured outcomes, leads, and the AI-search (GEO) check. Zero findings can mean the site was never audited rather than that nothing is wrong: when a tool says neverAudited, tell the user to run an SEO audit. Call a tool whenever the question depends on the user's data, and call only what the question needs. Never invent numbers, dates, findings, or results. If a tool says data is not available, or you did not look it up, say so plainly. Mention how recent the data is when it matters. Do not claim an action worked unless its outcome says it improved. When listing findings or what to fix first, keep the exact order and count the tool returned (rank 1 first); never re-sort them, and never add or drop items. If several items share the same issue, you may combine them into one line with the page count, at the position of the first.`;

export type ChatRunInput = {
  driver: DriverLike;
  apiKey: string;
  model: string;
  baseUrl?: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  ports: ChatPorts;
  /** Whether this provider's driver runs a tool-call loop (providerSupportsTools). */
  supportsTools: boolean;
};

export type ChatRunResult = { text: string; toolsUsed: string[]; lookedAt: string[]; mode: "tools" | "context" };

/** Tool definitions for the driver, wrapped to enforce call/char budgets and record what was used. */
export function buildToolDefs(ports: ChatPorts, used: string[]): ToolDefLike[] {
  let calls = 0;
  let chars = 0;
  return CHAT_TOOLS.map((spec) => ({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    execute: async (input: Record<string, unknown>) => {
      if (calls >= MAX_TOOL_CALLS || chars >= MAX_TOTAL_RESULT_CHARS) return BUDGET_MESSAGE;
      calls += 1;
      if (!used.includes(spec.name)) used.push(spec.name);
      // Reserve budget BEFORE awaiting so parallel calls cannot overshoot the cap.
      const reserved = Math.min(MAX_RESULT_CHARS, MAX_TOTAL_RESULT_CHARS - chars);
      chars += reserved;
      let content: string;
      try {
        const result = await runTool(ports, spec.name, input && typeof input === "object" ? input : {});
        content = result.content.length > reserved ? `${result.content.slice(0, Math.max(reserved - 20, 0))}...[truncated]` : result.content;
        content = content.slice(0, reserved);
      } catch (err) {
        chars -= reserved;
        throw err;
      }
      chars -= reserved - content.length;
      return content;
    },
  }));
}

/**
 * Compact, auto-built overview used when the provider can't call tools:
 * a few counts only, so the model has something real without a bigger prompt.
 */
export async function buildAutoSummary(ports: ChatPorts): Promise<string> {
  const lines: string[] = [];
  const safe = async <T,>(fn: () => Promise<T>): Promise<T | null> => { try { return await fn(); } catch { return null; } };

  const snap = await safe(() => ports.getSearchSnapshot());
  if (snap) {
    const w = snap.payload.windows.d28;
    const clicks = w.queries.reduce((s, q) => s + q.clicks, 0);
    const views = w.queries.reduce((s, q) => s + q.impressions, 0);
    lines.push(`Search (${w.startDate} to ${w.endDate}, data from ${snap.snapshotDate}): ${Math.round(clicks)} clicks, ${Math.round(views)} views. Top queries: ${w.queries.slice(0, 5).map((q) => q.query).join("; ") || "none"}.`);
  } else {
    lines.push("Search: no Search Console data stored yet.");
  }

  const findings = await safe(() => ports.listFindings());
  if (findings) {
    const by: Record<string, number> = {};
    for (const f of findings) by[f.status] = (by[f.status] ?? 0) + 1;
    lines.push(`Findings: ${findings.length} total (${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}).`);
    const top = rankFindingsForChat(findings, ports.now()).filter((r) => r.rank !== null).slice(0, 5);
    if (top.length > 0) lines.push(`Fix first, in priority order (keep this order): ${top.map((r) => `${r.rank}. ${r.issue}`).join(" | ")}.`);
  }

  let auditOk = true;
  const audit = await ports.getAuditSummary().catch(() => { auditOk = false; return null; });
  if (auditOk) {
    lines.push(audit ? `Site audit (${audit.checkedAt.slice(0, 10)}): ${audit.errors} errors, ${audit.warnings} warnings.` : "Site audit: never run for this project (zero findings does not mean the site is fine).");
  }

  const actions = await safe(() => ports.listActionsWithOutcomes());
  if (actions) {
    const by: Record<string, number> = {};
    for (const a of actions) { const k = a.outcome?.status ?? a.status; by[k] = (by[k] ?? 0) + 1; }
    lines.push(`Tracked actions: ${actions.length} (${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}).`);
  }

  const leads = await safe(() => ports.getLeadSummary(0));
  if (leads) lines.push(`Leads: ${leads.truncated ? `${leads.total}+` : leads.total} total, ${leads.emailed} emailed, ${leads.replied} replied.`);

  const geo = await safe(() => ports.getGeoStatus());
  lines.push(geo ? `GEO check (${geo.checkedAt.slice(0, 10)}): cited for ${geo.rows.filter((r) => r.found).length} of ${geo.rows.length} queries.` : "GEO check: not run yet.");

  return `Overview of stored project data (counts only; say when you lack detail):\n${lines.join("\n")}`;
}

/** Run one chat turn: tool-calling when the driver supports it, otherwise a context summary. */
export async function runChatTurn(input: ChatRunInput): Promise<ChatRunResult> {
  const { driver, apiKey, model, baseUrl, messages, ports } = input;

  if (input.supportsTools) {
    const used: string[] = [];
    try {
      const result = await driver({
        apiKey, model, baseUrl, messages,
        system: `${input.system}\n\n${TOOL_SYSTEM_RULES}`,
        tools: buildToolDefs(ports, used),
      });
      return { text: result.text ?? "", toolsUsed: used, lookedAt: labelsFor(used), mode: "tools" };
    } catch (err) {
      // A model/server that rejects tool calling (some local models) degrades to the
      // context path. Auth, rate-limit and other errors still surface to the caller.
      // A transient provider failure after tools ran (rate limit, 5xx, timeout) gets ONE
      // retry on the cheaper no-tools path, inside the same turn (one credit).
      const retryable = isToolUnsupportedError(err) || (used.length > 0 && isTransientProviderError(err));
      if (!retryable) throw err;
    }
  }

  const summary = await buildAutoSummary(ports);
  const result = await driver({
    apiKey, model, baseUrl, messages,
    system: `${input.system}\n\n${summary}\n\nYou cannot look up more detail in this chat. Never invent figures; if the overview above does not cover the question, say you do not have that data here.`,
  });
  return { text: result.text ?? "", toolsUsed: [], lookedAt: [], mode: "context" };
}

export function labelsFor(names: string[]): string[] {
  const labels: string[] = [];
  for (const n of names) {
    const label = CHAT_TOOLS.find((t) => t.name === n)?.label;
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

export function isToolUnsupportedError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  if (/tool_use_failed|failed to call a function/i.test(raw)) return true;
  return /tool|function.?call/i.test(raw) && /(not support|unsupported|does not support|invalid)/i.test(raw);
}

/** 429 / 5xx / timeout / overloaded style provider errors. */
export function isTransientProviderError(err: unknown): boolean {
  const e = err as { status?: unknown; code?: unknown } | null;
  const status = typeof e?.status === "number" ? e.status : NaN;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  const raw = `${err instanceof Error ? err.message : String(err)} ${typeof e?.code === "string" ? e.code : ""}`;
  return /(?:^|\D)(?:429|5\d\d)(?:\D|$)|rate.?limit|too many requests|overloaded|timed? ?out|timeout|ETIMEDOUT|ECONNRESET|unavailable|bad gateway/i.test(raw);
}
