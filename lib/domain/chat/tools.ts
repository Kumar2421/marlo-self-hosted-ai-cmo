import type { Finding, FindingStatus } from "../findings/findingTypes.ts";
import { FINDING_STATUSES } from "../findings/findingTypes.ts";
import type { Action } from "../actions/actionTypes.ts";
import type { Outcome } from "../search/actionOutcome.ts";
import { buildOpportunities, type OpportunityType, type SearchOpportunity } from "../search/searchOpportunities.ts";
import type { SearchSnapshotPayload } from "../search/searchSnapshot.ts";
import { summaryTotals } from "../search/summaryTotals.ts";
import { weekChanges } from "../search/weekChanges.ts";
import { rankFindingsForChat } from "./rankedFindings.ts";
import { isFindingId, validateArgs, type ArgSchema } from "./toolSchema.ts";
import { wrapResult } from "./untrusted.ts";

/**
 * Read-only tools the chat model can call to fetch facts about the ACTIVE
 * project. Everything goes through `ChatPorts`; the adapters (chatPorts.ts)
 * are already scoped to one user + project, so a tool can never name another
 * project. Results are compact JSON strings: capped rows and characters,
 * always with the date the data is from, never credentials or raw emails.
 */

export type ActionWithOutcomeLite = Action & { outcome: Outcome | null };

export type LeadSummary = {
  total: number;
  /** True when total is capped by the scan limit (real count is higher). */
  truncated?: boolean;
  withEmail: number;
  emailVerified: number;
  emailed: number;
  replied: number;
  recent: Array<{
    name: string; title: string; company: string; location: string; leadType: string;
    hasEmail: boolean; emailVerified: boolean; emailed: boolean; replied: boolean; createdAt: string;
  }>;
};

export type GeoStatus = {
  checkedAt: string;
  rows: Array<{ query: string; found: boolean; matchedUrl?: string }>;
} | null;

/** Latest stored SEO audit of the project's site, boiled down for the model. */
export type AuditSummary = {
  url: string;
  checkedAt: string;
  errors: number;
  warnings: number;
  indexable: boolean;
  /** Top issues, errors first. */
  topIssues: Array<{ label: string; level: "Warning" | "Error" }>;
  /** Lighthouse category scores (0-100, mobile) - null when no PageSpeed data was captured. */
  scores: { performance: number; accessibility: number; bestPractices: number; seo: number } | null;
} | null;

export type ChatPorts = {
  getSearchSnapshot(): Promise<{ snapshotDate: string; payload: SearchSnapshotPayload } | null>;
  listFindings(): Promise<Finding[]>;
  getFinding(id: string): Promise<Finding | null>;
  /** Recommendations are derived (pure) from a finding. */
  recommendationsFor(finding: Finding): Array<{ title: string; summary: string; priority: string }>;
  /** Newest first; optionally for one finding. Outcomes are read without writing anything. */
  listActionsWithOutcomes(findingId?: string): Promise<ActionWithOutcomeLite[]>;
  getLeadSummary(recentLimit: number): Promise<LeadSummary>;
  getGeoStatus(): Promise<GeoStatus>;
  /** Latest SEO audit for this project, or null when it was never audited. */
  getAuditSummary(): Promise<AuditSummary>;
  /** Competitor site URLs the user tracks (empty when none). */
  listCompetitors(): Promise<string[]>;
  now(): Date;
  /** Optional per-call audit hook (metadata only: no arguments, no content). */
  audit?: (entry: ToolAuditEntry) => void;
};

/** What the audit trail records about one tool call. argsHash is a hash, never the arguments. */
export type ToolAuditEntry = { tool: string; argsHash: string; ok: boolean; durationMs: number };

export type ToolSpec = {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  /** Short human label for the UI's "Looked at:" line. */
  label: string;
};

export const MAX_RESULT_CHARS = 3500;
const MAX_ROWS = 10;

const noArgs = { type: "object" as const, properties: {} };
const limitProp = { type: "integer", minimum: 1, maximum: MAX_ROWS, description: "Optional: how many rows (default 10, max 10)." };
const OPPORTUNITY_TYPES = ["ranking", "ctr", "declining", "new_query", "lost_query"] as const;

/** Server-side argument validation for every tool. Unknown keys are dropped; see toolSchema.ts. */
const limitField = { kind: "int", min: 1, max: MAX_ROWS, default: MAX_ROWS } as const;
export const TOOL_ARG_SCHEMAS: Record<string, ArgSchema> = {
  get_search_summary: {},
  list_opportunities: { type: { kind: "enum", values: OPPORTUNITY_TYPES }, limit: limitField },
  list_findings: { status: { kind: "enum", values: FINDING_STATUSES }, limit: limitField },
  get_finding: { id: { kind: "id", test: isFindingId, required: true } },
  list_actions_and_outcomes: {},
  list_leads: { limit: limitField },
  get_geo_status: {},
  get_audit_summary: {},
  list_competitors: {},
};

export const CHAT_TOOLS: ToolSpec[] = [
  {
    name: "get_search_summary",
    label: "search data",
    description: "Google search performance for the last 28 days: total clicks, views (impressions), average position, the top queries, and what changed vs the previous period. Use for any question about traffic, rankings, or search.",
    parameters: noArgs,
  },
  {
    name: "list_opportunities",
    label: "search opportunities",
    description: "Search opportunities found from the latest snapshot: ranking (almost page one), ctr (weak snippets), declining, new and lost queries.",
    parameters: {
      type: "object",
      properties: { type: { type: "string", enum: [...OPPORTUNITY_TYPES], description: "Optional: only this kind." }, limit: limitProp },
    },
  },
  {
    name: "list_findings",
    label: "findings",
    description: "Issues Marlo has found on the site (SEO problems, search opportunities), most important first. Optional status filter.",
    parameters: {
      type: "object",
      properties: { status: { type: "string", enum: [...FINDING_STATUSES], description: "Optional status filter." }, limit: limitProp },
    },
  },
  {
    name: "get_finding",
    label: "a finding",
    description: "One finding in detail: evidence, recommended fixes, and the actions and measured outcomes tied to it. Needs an id from list_findings.",
    parameters: { type: "object", properties: { id: { type: "string", maxLength: 80, description: "A finding id returned by list_findings." } }, required: ["id"] },
  },
  {
    name: "list_actions_and_outcomes",
    label: "actions and outcomes",
    description: "Changes the user tracked or applied and whether they worked (improved, unchanged, regressed, still waiting). Use for 'did my fixes work?'.",
    parameters: noArgs,
  },
  {
    name: "list_leads",
    label: "leads",
    description: "Lead counts (total, with email, emailed, replied) and the most recent leads. Emails are not shown.",
    parameters: { type: "object", properties: { limit: limitProp } },
  },
  {
    name: "get_geo_status",
    label: "AI-search (GEO) check",
    description: "Whether the site is being cited for the queries checked by the latest GEO (AI search) citation check.",
    parameters: noArgs,
  },
  {
    name: "get_audit_summary",
    label: "site audit",
    description: "The latest SEO audit of the site: when it ran, how many errors and warnings, the top issues, indexability and PageSpeed scores if captured. Use for 'what is wrong with my site' and to tell 'never audited' from 'audited and clean'.",
    parameters: noArgs,
  },
  {
    name: "list_competitors",
    label: "competitors",
    description: "Competitor sites the user tracks for this project (URLs only).",
    parameters: noArgs,
  },
];

export type ToolResult = { ok: boolean; content: string };

const SECRET_KEY = /token|secret|password|api.?key|authorization|cookie|email|phone/i;

/** Drop credential/contact-looking keys and long strings from arbitrary stored JSON. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 200 ? `${value.slice(0, 197)}...` : value;
  if (depth >= 3) return undefined;
  if (Array.isArray(value)) return value.slice(0, 5).map((v) => sanitize(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) continue;
      const s = sanitize(v, depth + 1);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  return undefined;
}

function pack(data: unknown): ToolResult {
  let text = JSON.stringify(wrapResult(data));
  if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS - 40)}...[truncated]`;
  return { ok: true, content: text };
}

const round = (n: number, d = 1) => Number(n.toFixed(d));

function oppRow(o: SearchOpportunity) {
  return {
    type: o.type, query: o.query, page: o.pageUrl, why: o.reasons.slice(0, 2),
    views: Math.round(o.metrics.impressions), clicks: Math.round(o.metrics.clicks), position: round(o.metrics.position),
  };
}

function findingRow(f: Finding, rank?: number | null, issue?: string | null) {
  return { ...(rank ? { rank, issue } : {}), id: f.id, severity: f.severity, status: f.status, category: f.category, url: f.url, summary: f.recommendation.slice(0, 160), lastSeen: f.lastSeen };
}

function outcomeRow(a: ActionWithOutcomeLite) {
  return {
    id: a.id, findingId: a.findingId, title: a.title, status: a.status, type: a.type, createdAt: a.createdAt, completedAt: a.completedAt,
    outcome: a.outcome ? { status: a.outcome.status, headline: a.outcome.headline, daysSince: a.outcome.daysSince, confidence: a.outcome.confidence } : null,
  };
}

const noData = (what: string, hint: string): ToolResult => ({ ok: true, content: JSON.stringify({ available: false, what, note: hint }) });

/** Run one read-only tool. Never throws: errors come back as `{ok:false}` text for the model. */
export async function runTool(ports: ChatPorts, name: string, rawArgs: unknown = {}): Promise<ToolResult> {
  const schema = Object.prototype.hasOwnProperty.call(TOOL_ARG_SCHEMAS, name) ? TOOL_ARG_SCHEMAS[name] : null;
  if (!schema) return { ok: false, content: `Unknown tool: ${name}` };
  const checked = validateArgs(schema, rawArgs);
  if (!checked.ok) return { ok: false, content: checked.error };
  const args = checked.value;
  const limit = typeof args.limit === "number" ? args.limit : MAX_ROWS;
  try {
    switch (name) {
      case "get_search_summary": {
        const snap = await ports.getSearchSnapshot();
        if (!snap) return noData("search data", "No Search Console data stored yet. The user needs to connect Google Search Console.");
        const w = snap.payload.windows;
        const totals = summaryTotals(w.d28);
        const prev = summaryTotals(w.prev28);
        return pack({
          dataDate: snap.snapshotDate,
          window: { from: w.d28.startDate, to: w.d28.endDate },
          totals: { clicks: Math.round(totals.clicks), views: Math.round(totals.impressions), avgPosition: round(totals.position) },
          previous28Days: { clicks: Math.round(prev.clicks), views: Math.round(prev.impressions), avgPosition: round(prev.position) },
          topQueries: w.d28.queries.slice(0, MAX_ROWS).map((q) => ({ query: q.query, clicks: q.clicks, views: q.impressions, position: round(q.position) })),
          weekChanges: weekChanges(w.d28, w.prev28, 5),
        });
      }
      case "list_opportunities": {
        const snap = await ports.getSearchSnapshot();
        if (!snap) return noData("search opportunities", "No Search Console data stored yet.");
        const g = buildOpportunities(snap.payload);
        const only = typeof args.type === "string" ? (args.type as OpportunityType) : null;
        const all = [...g.ranking, ...g.ctr, ...g.declining, ...g.newQueries, ...g.lostQueries];
        const rows = (only ? all.filter((o) => o.type === only) : all).slice(0, limit).map(oppRow);
        return pack({ dataDate: snap.snapshotDate, changeCounts: g.changes, opportunities: rows });
      }
      case "list_findings": {
        const status = typeof args.status === "string" ? args.status : null;
        const all = await ports.listFindings();
        if (all.length === 0) {
          // Zero rows is ambiguous: never audited vs audited and clean. Say which.
          const audit = await ports.getAuditSummary();
          if (!audit) {
            return pack({
              available: false, neverAudited: true, totalFindings: 0,
              note: "No SEO audit has been run for this project yet, so there are no findings. This does NOT mean the site is fine. Tell the user to run an SEO audit first.",
            });
          }
          return pack({
            asOf: ports.now().toISOString().slice(0, 10), totalFindings: 0, byStatus: {}, findings: [], auditedAt: audit.checkedAt,
            note: "The site was audited and no findings are stored for it. Use get_audit_summary for the audit itself.",
          });
        }
        // Ranked exactly like the dashboard's Fix-first strip; rank 1 is what to fix first.
        const ranked = rankFindingsForChat(status ? all.filter((f) => f.status === (status as FindingStatus)) : all, ports.now());
        const rows = ranked.map((r) => r.finding);
        const byStatus: Record<string, number> = {};
        for (const f of all) byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;
        return pack({ asOf: ports.now().toISOString().slice(0, 10), totalFindings: all.length, byStatus, shown: Math.min(rows.length, limit), order: "Findings are listed in priority order (rank 1 = fix first), the same order as the dashboard's Fix-first list. Keep this order.", findings: ranked.slice(0, limit).map((r) => findingRow(r.finding, r.rank, r.issue)) });
      }
      case "get_audit_summary": {
        const a = await ports.getAuditSummary();
        if (!a) return { ok: true, content: JSON.stringify({ available: false, neverAudited: true, what: "site audit", note: "No SEO audit has been run for this project yet. Tell the user to run one; do not guess what is wrong with the site." }) };
        return pack({ ...a, topIssues: a.topIssues.slice(0, MAX_ROWS) });
      }
      case "list_competitors": {
        const urls = await ports.listCompetitors();
        if (urls.length === 0) return noData("competitors", "No competitors are tracked for this project yet.");
        return pack({ total: urls.length, competitors: urls.slice(0, MAX_ROWS) });
      }
      case "get_finding": {
        const id = args.id as string;
        const f = await ports.getFinding(id);
        if (!f) return { ok: false, content: "No finding with that id in this project." };
        const actions = await ports.listActionsWithOutcomes(f.id);
        return pack({
          ...findingRow(f), firstSeen: f.firstSeen, resolvedAt: f.resolvedAt, entity: `${f.entityType}:${f.entityId}`,
          evidence: sanitize(f.evidence),
          recommendations: ports.recommendationsFor(f).slice(0, 4).map((r) => ({ title: r.title, summary: r.summary.slice(0, 240), priority: r.priority })),
          actions: actions.slice(0, 5).map(outcomeRow),
        });
      }
      case "list_actions_and_outcomes": {
        const actions = await ports.listActionsWithOutcomes();
        if (actions.length === 0) return noData("actions", "No actions have been tracked yet, so there are no outcomes to report.");
        const counts: Record<string, number> = {};
        for (const a of actions) {
          const k = a.outcome?.status ?? a.status;
          counts[k] = (counts[k] ?? 0) + 1;
        }
        return pack({ asOf: ports.now().toISOString().slice(0, 10), totalActions: actions.length, counts, actions: actions.slice(0, MAX_ROWS).map(outcomeRow) });
      }
      case "list_leads": {
        const s = await ports.getLeadSummary(limit);
        if (s.total === 0) return noData("leads", "No leads yet for this project.");
        return pack({
          ...s,
          ...(s.truncated ? { totalDisplay: `${s.total}+`, note: "Counts cover only the most recent leads scanned; the real totals are higher." } : {}),
          recent: s.recent.slice(0, limit),
        });
      }
      case "get_geo_status": {
        const g = await ports.getGeoStatus();
        if (!g) return noData("GEO check", "No GEO citation check has been run for this project yet.");
        const found = g.rows.filter((r) => r.found).length;
        return pack({
          checkedAt: g.checkedAt, queriesChecked: g.rows.length, cited: found, notCited: g.rows.length - found,
          results: g.rows.slice(0, MAX_ROWS).map((r) => ({ query: r.query, cited: r.found, page: r.matchedUrl ?? null })),
        });
      }
      default:
        return { ok: false, content: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, content: `Tool error: ${e instanceof Error ? e.message : "failed"}` };
  }
}
