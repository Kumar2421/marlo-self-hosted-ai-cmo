import type { Finding } from "./findingTypes.ts";
import { runWithBudget } from "../../jobs/jobRunner.ts";
import { auditFindingInputs, saveAuditFindings, type AuditFindingInput, type AuditLike } from "./auditFindings.ts";
import { needsPageSpeed } from "./verifyFinding.ts";
import { BACKGROUND_AUDIT_TIMEOUT_MS, MIN_AUDIT_BUDGET_MS, timedCall } from "./timedAudit.ts";

/**
 * The regression watch. Once a project's monitor marker is older than six days,
 * its home page and up to two pages that already have findings are re-audited.
 * New issues are upserted with the same identity the audit route uses. A
 * verified finding whose issue comes back moves verified -> fixing (the
 * store's upsert does this) and gets a "Reappeared on" note. Findings that
 * disappear are left alone.
 */

export const MONITOR_INTERVAL_MS = 6 * 24 * 60 * 60 * 1000;
export const MONITOR_MAX_EXTRA_PAGES = 2;
/** Below this budget, at most one project is monitored per call. */
export const MONITOR_MANY_PROJECTS_MIN_MS = 15_000;
export const REAPPEARED_PREFIX = "Reappeared on ";

export type MonitorScope = {
  userId: string;
  projectId: string;
  siteUrl: string;
  /** ISO time of the last monitor pass for this project, or null. */
  lastRunAt: string | null;
};

export type MonitorBudget = {
  budgetMs: number;
  /** Global cap on page audits in one run. */
  maxAudits: number;
  clock?: () => number;
  /** Per-page timeout ceiling (defaults to BACKGROUND_AUDIT_TIMEOUT_MS). */
  auditTimeoutMs?: number;
  /** Minimum budget left before a page audit may start (defaults to MIN_AUDIT_BUDGET_MS). */
  minAuditMs?: number;
};

export type MonitorPorts = {
  listTargets(): Promise<MonitorScope[]>;
  /** Every finding the project has, any source. */
  knownFindings(scope: MonitorScope): Promise<Finding[]>;
  /** Re-runs the SEO audit of one page. */
  audit(scope: MonitorScope, url: string): Promise<AuditLike>;
  /** Upserts one audit finding through the store (the store owns the status transition). */
  upsert(scope: MonitorScope, input: AuditFindingInput): Promise<unknown>;
  /** Records that a pass completed at least one page audit, so the project is not audited again for six days. */
  writeMarker(scope: MonitorScope, now: Date): Promise<void>;
};

export type MonitorSummary = {
  monitored: number;
  audited: number;
  /** Pages that timed out or failed; skipped, not retried in this pass. */
  skippedPages: number;
  newIssues: number;
  regressions: number;
  budgetSkipped: number;
  /** Projects whose pass threw; isolated, the rest of the run continues. */
  errored: number;
};

function sameUrl(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

function identityKey(category: string, entityId: string, url: string | null): string {
  return `${category}|${entityId}|${url ?? ""}`;
}

/** The home page first, then up to two other pages that already carry SEO-audit findings (most recently seen first). */
export function pagesToAudit(siteUrl: string, known: Finding[], maxExtra = MONITOR_MAX_EXTRA_PAGES): string[] {
  const seen = known
    .filter((f) => f.source === "seo-audit" && f.url && !sameUrl(f.url, siteUrl))
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  const pages = [siteUrl];
  for (const f of seen) {
    if (pages.length > maxExtra) break;
    if (!pages.some((p) => sameUrl(p, f.url ?? ""))) pages.push(f.url as string);
  }
  return pages;
}

function isDue(lastRunAt: string | null, nowMs: number): boolean {
  if (lastRunAt === null) return true;
  const last = Date.parse(lastRunAt);
  return Number.isNaN(last) || nowMs - last >= MONITOR_INTERVAL_MS;
}

export async function runMonitorAudit(ports: MonitorPorts, now: Date, budget: MonitorBudget): Promise<MonitorSummary> {
  const summary: MonitorSummary = { monitored: 0, audited: 0, skippedPages: 0, newIssues: 0, regressions: 0, budgetSkipped: 0, errored: 0 };
  const clock = budget.clock ?? Date.now;
  const deadline = clock() + budget.budgetMs;
  const minAuditMs = budget.minAuditMs ?? MIN_AUDIT_BUDGET_MS;
  const auditTimeoutMs = budget.auditTimeoutMs ?? BACKGROUND_AUDIT_TIMEOUT_MS;
  const day = now.toISOString().slice(0, 10);

  const due = (await ports.listTargets())
    .filter((t) => isDue(t.lastRunAt, now.getTime()))
    .sort((a, b) => (a.lastRunAt ?? "").localeCompare(b.lastRunAt ?? "") || a.projectId.localeCompare(b.projectId));

  const maxProjects = budget.budgetMs < MONITOR_MANY_PROJECTS_MIN_MS ? 1 : due.length;
  const picked = due.slice(0, maxProjects);
  summary.budgetSkipped += due.length - picked.length;

  let auditsLeft = Math.max(0, budget.maxAudits);
  const run = await runWithBudget(
    picked,
    async (scope) => {
      // Budget first: a project that cannot start an audit this run gets no marker, so it stays first in line for the next run.
      if (auditsLeft <= 0 || deadline - clock() < minAuditMs) {
        summary.budgetSkipped += 1;
        return;
      }
      const known = await ports.knownFindings(scope);
      let markerWritten = false;
      const byKey = new Map(known.map((f) => [identityKey(f.category, f.entityId, f.url), f]));
      const pages = pagesToAudit(scope.siteUrl, known).slice(0, 1 + Math.min(MONITOR_MAX_EXTRA_PAGES, auditsLeft - 1));

      for (const url of pages) {
        // Stop before a page audit that cannot finish inside the budget.
        const left = deadline - clock();
        if (auditsLeft <= 0 || left < minAuditMs) break;
        // Hard timeout per page: a page that times out or fails is skipped, the rest of the project continues.
        const timed = await timedCall(() => ports.audit(scope, url), Math.min(auditTimeoutMs, left));
        auditsLeft -= 1;
        if (!timed.ok) {
          summary.skippedPages += 1;
          continue;
        }
        summary.audited += 1;
        // The marker is written only once a page audit has completed. A project whose
        // audits all timed out or failed gets none, so it is retried on the next run.
        if (!markerWritten) {
          await ports.writeMarker(scope, now);
          markerWritten = true;
        }
        // PageSpeed-only issues never come from a crawl audit: never create or touch them here.
        const audit: AuditLike = { url: timed.value.url, findings: timed.value.findings.filter((f) => !needsPageSpeed({ category: f.category, entityId: f.issueId })) };

        const previousFor = (issueId: string, category: string) => byKey.get(identityKey(category, issueId, audit.url)) ?? null;
        const inputs = auditFindingInputs(scope.projectId, audit, (issueId) => {
          const category = audit.findings.find((f) => f.issueId === issueId)?.category ?? "";
          const previous = previousFor(issueId, category);
          if (!previous) return null;
          if (previous.status === "verified") return { regression: `${REAPPEARED_PREFIX}${day}` };
          return previous.evidence.autoVerify ? { autoVerify: previous.evidence.autoVerify } : null;
        });
        for (const input of inputs) {
          const previous = previousFor(input.entityId, input.category);
          if (!previous) summary.newIssues += 1;
          else if (previous.status === "verified") summary.regressions += 1;
        }
        await saveAuditFindings((input) => ports.upsert(scope, input), inputs);
      }
      summary.monitored += 1;
    },
    { budgetMs: budget.budgetMs, now: clock },
  );

  summary.budgetSkipped += run.skipped;
  summary.errored += run.failed.length;
  return summary;
}
