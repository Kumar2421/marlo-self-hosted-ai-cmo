import type { Finding, FindingSeverity, FindingStatus } from "./findingTypes.ts";
import { canTransitionFinding, FindingLifecycleError, invalidTransitionError, isEvidenceOnlyStatus } from "./findingTypes.ts";

export type FindingRepository = {
  get(projectId: string, id: string): Promise<Finding | null> | Finding | null;
  list(projectId: string): Promise<Finding[]> | Finding[];
  /** Moves the status only while the row still has `from` (a stale read throws a conflict). */
  transition(projectId: string, id: string, status: FindingStatus, from?: FindingStatus): Promise<Finding | null> | Finding | null;
  refresh(projectId: string, id: string, input: {
    severity: FindingSeverity;
    evidence: Record<string, unknown>;
    recommendation: string;
    status: FindingStatus;
    /** The status the caller read. A store must apply the update only while the row still has it, else throw a conflict. */
    expectedStatus?: FindingStatus;
  }): Promise<Finding | null> | Finding | null;
};

export type FindingRecheckResult = {
  severity: FindingSeverity;
  evidence: Record<string, unknown>;
  recommendation: string;
  issueDetected: boolean;
};

export async function getFinding(
  repository: FindingRepository,
  projectId: string,
  id: string,
): Promise<Finding | null> {
  return repository.get(projectId, id);
}

export async function listFindings(
  repository: FindingRepository,
  projectId: string,
): Promise<Finding[]> {
  return repository.list(projectId);
}

/**
 * A direct status change asked for by a user. "verified" and "failed" are
 * evidence statuses: they are set only by applyRecheck (or the auto-verify
 * job), never by a plain transition.
 */
export async function transitionFinding(
  repository: FindingRepository,
  projectId: string,
  id: string,
  status: FindingStatus,
): Promise<Finding | null> {
  if (isEvidenceOnlyStatus(status)) {
    throw new FindingLifecycleError("rejected", "Verified and failed are set only by a re-check.");
  }
  const finding = await repository.get(projectId, id);
  if (!finding) return null;
  if (!canTransitionFinding(finding.status, status)) {
    throw invalidTransitionError(finding.status, status);
  }
  return repository.transition(projectId, id, status, finding.status);
}

/**
 * Records the result of a real re-check. The target status follows the
 * evidence (issue still there -> failed, gone -> verified) and must be a legal
 * edge; re-checking a finding that is already in that status only refreshes it.
 */
export async function applyRecheck(
  repository: FindingRepository,
  projectId: string,
  id: string,
  result: FindingRecheckResult,
): Promise<Finding | null> {
  const finding = await repository.get(projectId, id);
  if (!finding) return null;

  const status: FindingStatus = result.issueDetected ? "failed" : "verified";
  if (finding.status !== status && !canTransitionFinding(finding.status, status)) {
    throw invalidTransitionError(finding.status, status);
  }
  return repository.refresh(projectId, id, {
    severity: result.severity,
    evidence: result.evidence,
    recommendation: result.recommendation,
    status,
    expectedStatus: finding.status,
  });
}
