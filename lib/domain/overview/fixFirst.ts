/**
 * View-model for the "Fix first" strip at the top of the Analytics panel. Pure: it reuses
 * `rankNextActions` (findings only, so the ranking is the same one the Today overview uses) and
 * decides which honest state to show. It never invents work: no findings and no audit says so.
 */
import type { RankFinding } from "./rankNextActions.ts";
import { rankNextActions } from "./rankNextActions.ts";
import { COPY } from "./copy.ts";

/** The ranking prefixes titles ("Fix: ", "Let Marlo fix: "); the row already says it is work to do. */
export function plainSentence(title: string): string {
  const t = title.replace(/^(let marlo fix|fix):\s*/i, "").trim().replace(/\.$/, "");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : title;
}

export type FixFirstItem = {
  /** The finding the button opens: the highest-ranked one in the group. */
  findingId: string;
  /** One readable sentence; carries "(3 pages)" when several findings are the same issue. */
  sentence: string;
  button: string;
  count: number;
};

export type FixFirstView =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "no_audit" }
  | { kind: "clear" }
  | { kind: "actions"; items: FixFirstItem[]; moreCount: number };

export type FixFirstInput = {
  /** No website on the project: there is nothing to audit, so the strip stays out of the way. */
  hasWebsite: boolean;
  findings: { status: "pending" | "error" | "ready"; data?: readonly RankFinding[]; message?: string };
  audit: "pending" | "error" | "missing" | "present";
  now: string | Date;
};

/** Rows shown; further groups collapse into one "N more in Findings" link. */
export const FIX_FIRST_MAX = 2;
export const FIX_FIRST_ERROR = "Couldn't load your findings.";

export function buildFixFirstView(input: FixFirstInput): FixFirstView {
  if (!input.hasWebsite) return { kind: "hidden" };
  if (input.findings.status === "error") return { kind: "error", message: FIX_FIRST_ERROR };
  if (input.findings.status === "pending") return { kind: "loading" };

  // Only the finding-based actions: integrations, outreach and "run an audit" are handled elsewhere.
  const all = input.findings.data ?? [];
  const ranked = rankNextActions(
    {
      findings: all,
      openFixPullRequests: [],
      pendingActions: [],
      integrations: { gsc: true, ga4: true, github: true, gmail: true, cms: true },
      leads: { count: 0, withEmail: 0, unsent: 0 },
      lastAuditAt: typeof input.now === "string" ? input.now : input.now.toISOString(),
      now: input.now,
    },
    { max: Math.max(1, all.length) },
  );
  const byId = new Map(all.map((f) => [f.id, f]));
  const groups = new Map<string, { action: (typeof ranked)[number]; findingId: string; count: number; pages: boolean }>();
  for (const a of ranked) {
    if (!(a.kind === "fix_finding" || a.kind === "verify_fix") || a.cta.target.type !== "finding" || !a.cta.target.id) continue;
    const f = byId.get(a.cta.target.id);
    const key = `${a.kind}|${f?.source ?? ""}|${f?.category ?? ""}|${plainSentence(a.title)}`;
    const g = groups.get(key);
    if (g) {
      g.count += 1;
      g.pages = g.pages && Boolean(f?.url);
    } else groups.set(key, { action: a, findingId: a.cta.target.id, count: 1, pages: Boolean(f?.url) });
  }
  const list = [...groups.values()];
  const items: FixFirstItem[] = list.slice(0, FIX_FIRST_MAX).map((g) => ({
    findingId: g.findingId,
    sentence: g.count > 1 ? `${plainSentence(g.action.title)} (${g.count} ${g.pages ? "pages" : "items"})` : plainSentence(g.action.title),
    button: g.action.kind === "verify_fix" ? "Check" : g.action.cta.label === COPY.fixFinding.ctaFixable ? "Fix this" : "Open",
    count: g.count,
  }));
  if (items.length > 0) return { kind: "actions", items, moreCount: Math.max(0, list.length - items.length) };

  if (input.audit === "pending") return { kind: "loading" };
  if (input.audit === "error") return { kind: "error", message: FIX_FIRST_ERROR };
  if (input.audit === "missing") return { kind: "no_audit" };
  return { kind: "clear" };
}

export const ANALYTICS_TAB_STORAGE_KEY = "marlo:analytics-tab";

/**
 * Which Analytics tab to open. A tab the user picked earlier always wins; otherwise Findings when
 * something is open, else the SEO tab as before. Null means "not decidable yet" (findings loading).
 */
export function pickInitialTab<T extends string>(args: {
  saved: string | null;
  tabs: readonly T[];
  openFindings: number | null;
  fallback: T;
  findingsTab: T;
}): T | null {
  const saved = args.tabs.find((t) => t === args.saved);
  if (saved) return saved;
  if (args.openFindings === null) return null;
  return args.openFindings > 0 ? args.findingsTab : args.fallback;
}
