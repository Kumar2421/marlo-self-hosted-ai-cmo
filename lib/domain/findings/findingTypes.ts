export const FINDING_STATUSES = ["new", "acknowledged", "fixing", "fixed", "verified", "failed"] as const;
export const FINDING_SEVERITIES = ["info", "warning", "critical"] as const;

export type FindingStatus = (typeof FINDING_STATUSES)[number];
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export type FindingIdentity = {
  projectId: string;
  source: string;
  category: string;
  entityType: string;
  entityId: string;
  url: string | null;
};

export type Finding = FindingIdentity & {
  id: string;
  severity: FindingSeverity;
  evidence: Record<string, unknown>;
  recommendation: string;
  status: FindingStatus;
  firstSeen: string;
  lastSeen: string;
  resolvedAt: string | null;
};

/**
 * The one lifecycle table. The user-driven edges are the forward path
 * (new -> acknowledged -> fixing -> fixed) and re-opening. The edges into
 * "verified" and "failed" exist only for evidence: a re-check or the
 * auto-verify job, which re-ran the check and saw the result. A client may
 * never ask for them directly (see canUserTransitionFinding).
 */
export const FINDING_TRANSITIONS: Record<FindingStatus, FindingStatus[]> = {
  new: ["acknowledged", "verified", "failed"],
  acknowledged: ["fixing", "verified", "failed"],
  fixing: ["fixed", "failed", "verified"],
  fixed: ["verified", "failed"],
  verified: ["fixing"],
  failed: ["fixing", "verified"],
};

/** Statuses that only a verification (re-check or auto-verify) may set. */
export const EVIDENCE_ONLY_STATUSES: readonly FindingStatus[] = ["verified", "failed"];

export function isEvidenceOnlyStatus(status: FindingStatus): boolean {
  return EVIDENCE_ONLY_STATUSES.includes(status);
}

export function canTransitionFinding(from: FindingStatus, to: FindingStatus): boolean {
  return FINDING_TRANSITIONS[from].includes(to);
}

/** A transition a user may request directly: legal, and not an evidence-only status. */
export function canUserTransitionFinding(from: FindingStatus, to: FindingStatus): boolean {
  return !isEvidenceOnlyStatus(to) && canTransitionFinding(from, to);
}

/**
 * A lifecycle failure the caller can map to an HTTP status without reading
 * message text: "invalid" (illegal edge, 409), "conflict" (the row changed
 * since it was read, 409) or "rejected" (a status the caller may not set, 400).
 */
export type FindingLifecycleErrorKind = "invalid" | "conflict" | "rejected";

export class FindingLifecycleError extends Error {
  kind: FindingLifecycleErrorKind;
  constructor(kind: FindingLifecycleErrorKind, message: string) {
    super(message);
    this.name = "FindingLifecycleError";
    this.kind = kind;
  }
}

export function invalidTransitionError(from: FindingStatus, to: FindingStatus): FindingLifecycleError {
  return new FindingLifecycleError("invalid", `Invalid finding status transition: ${from} -> ${to}`);
}

export function staleFindingError(): FindingLifecycleError {
  return new FindingLifecycleError("conflict", "This finding changed since it was loaded. Refresh and try again.");
}

export function isFindingStatus(value: unknown): value is FindingStatus {
  return typeof value === "string" && FINDING_STATUSES.includes(value as FindingStatus);
}

export function isFindingSeverity(value: unknown): value is FindingSeverity {
  return typeof value === "string" && FINDING_SEVERITIES.includes(value as FindingSeverity);
}
