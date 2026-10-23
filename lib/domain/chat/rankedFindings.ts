/**
 * Orders findings for the chat exactly as the dashboard's Fix-first strip does: it reuses
 * `rankNextActions` (same scores, same tie-breaks). Findings that have nothing left to do
 * (e.g. verified) are not ranked and go last, in their original order. Pure.
 */
import type { Finding } from "../findings/findingTypes.ts";
import { rankNextActions } from "../overview/rankNextActions.ts";
import { plainSentence } from "../overview/fixFirst.ts";

export type RankedFinding = { finding: Finding; rank: number | null; issue: string | null };

export function rankFindingsForChat(findings: readonly Finding[], now: Date): RankedFinding[] {
  const actions = rankNextActions(
    {
      findings,
      openFixPullRequests: [],
      pendingActions: [],
      integrations: { gsc: true, ga4: true, github: true, gmail: true, cms: true },
      leads: { count: 0, withEmail: 0, unsent: 0 },
      lastAuditAt: now.toISOString(),
      now,
    },
    { max: Math.max(1, findings.length) },
  );
  const byId = new Map(findings.map((f) => [f.id, f]));
  const out: RankedFinding[] = [];
  const used = new Set<string>();
  for (const a of actions) {
    if (!(a.kind === "fix_finding" || a.kind === "verify_fix") || a.cta.target.type !== "finding" || !a.cta.target.id) continue;
    const f = byId.get(a.cta.target.id);
    if (!f || used.has(f.id)) continue;
    used.add(f.id);
    out.push({ finding: f, rank: out.length + 1, issue: plainSentence(a.title) });
  }
  for (const f of findings) if (!used.has(f.id)) out.push({ finding: f, rank: null, issue: null });
  return out;
}
