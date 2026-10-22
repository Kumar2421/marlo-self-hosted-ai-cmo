/**
 * View-model for the "Fix first" strip at the top of the Analytics panel. Pure: it reuses
 * `rankNextActions` (findings only, so the ranking is the same one the Today overview uses) and
 * decides which honest state to show. It never invents work: no findings and no audit says so.
 */
import type { RankFinding } from "./rankNextActions.ts";
import { rankNextActions } from "./rankNextActions.ts";

export type FixFirstItem = { findingId: string; sentence: string; button: string };

export type FixFirstView =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "no_audit" }
  | { kind: "clear" }
  | { kind: "actions"; items: FixFirstItem[] };

export type FixFirstInput = {
  /** No website on the project: there is nothing to audit, so the strip stays out of the way. */
  hasWebsite: boolean;
  findings: { status: "pending" | "error" | "ready"; data?: readonly RankFinding[]; message?: string };
  audit: "pending" | "error" | "missing" | "present";
  now: string | Date;
};

export const FIX_FIRST_MAX = 3;
export const FIX_FIRST_ERROR = "Couldn't load your findings.";

export function buildFixFirstView(input: FixFirstInput): FixFirstView {
  if (!input.hasWebsite) return { kind: "hidden" };
  if (input.findings.status === "error") return { kind: "error", message: FIX_FIRST_ERROR };
  if (input.findings.status === "pending") return { kind: "loading" };

  // Only the finding-based actions: integrations, outreach and "run an audit" are handled elsewhere.
  const ranked = rankNextActions(
    {
      findings: input.findings.data ?? [],
      openFixPullRequests: [],
      pendingActions: [],
      integrations: { gsc: true, ga4: true, github: true, gmail: true, cms: true },
      leads: { count: 0, withEmail: 0, unsent: 0 },
      lastAuditAt: typeof input.now === "string" ? input.now : input.now.toISOString(),
      now: input.now,
    },
    { max: FIX_FIRST_MAX },
  );
  const items: FixFirstItem[] = ranked.flatMap((a) =>
    (a.kind === "fix_finding" || a.kind === "verify_fix") && a.cta.target.type === "finding" && a.cta.target.id
      ? [{ findingId: a.cta.target.id, sentence: a.title, button: a.cta.label }]
      : [],
  );
  if (items.length > 0) return { kind: "actions", items };

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
