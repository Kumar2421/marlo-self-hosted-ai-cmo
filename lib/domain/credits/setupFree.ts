/**
 * First-project setup is free. Pure decision helpers only; the server gathers
 * the facts from the database (see lib/credits.ts) and never trusts a client
 * flag.
 */

/** Setup-chain actions that run automatically when a project is created. */
export const SETUP_FREE_AGENT_TYPES: readonly string[] = [
  "seo_audit",
  "marketing_strategy",
  "competitor_analysis",
  "competitor_comparison",
  "content_strategy",
  "design_guide",
];

/** Ledger reason written for a zero-cost setup action. */
export const SETUP_FREE_REASON = "setup_free";

export const SETUP_WINDOW_MINUTES = 60;

/** App and DB clocks can disagree by a few seconds. */
const CLOCK_SKEW_MS = 60_000;

export interface FirstProjectSetupInput {
  /** How many projects the user owns right now (this one included). */
  projectCount: number;
  projectCreatedAt: string | Date | null | undefined;
  now: Date;
  windowMinutes?: number;
  /**
   * The user already received a free setup for a different (possibly since
   * deleted) project. Stops create -> delete -> create from re-earning it.
   */
  otherSetupUsed?: boolean;
}

export function isFirstProjectSetup(input: FirstProjectSetupInput): boolean {
  const { projectCount, projectCreatedAt, now, windowMinutes = SETUP_WINDOW_MINUTES, otherSetupUsed = false } = input;
  if (projectCount !== 1) return false;
  if (otherSetupUsed) return false;
  if (projectCreatedAt == null) return false;
  const created = projectCreatedAt instanceof Date ? projectCreatedAt.getTime() : Date.parse(projectCreatedAt);
  if (!Number.isFinite(created)) return false;
  const ageMs = now.getTime() - created;
  return ageMs >= -CLOCK_SKEW_MS && ageMs <= windowMinutes * 60_000;
}

export function isSetupFreeAgentType(agentType: string): boolean {
  return SETUP_FREE_AGENT_TYPES.includes(agentType);
}

export interface SetupFacts {
  projectCount: number;
  projectCreatedAt: string | null;
  /** Delivered (status ok) events of this agent type already on this project. */
  priorSameTypeEvents: number;
  otherSetupUsed: boolean;
}

/** One free run per setup action per project, inside the window. */
export function isSetupFree(agentType: string, facts: SetupFacts, now: Date): boolean {
  if (!isSetupFreeAgentType(agentType)) return false;
  if (facts.priorSameTypeEvents > 0) return false;
  return isFirstProjectSetup({
    projectCount: facts.projectCount,
    projectCreatedAt: facts.projectCreatedAt,
    now,
    otherSetupUsed: facts.otherSetupUsed,
  });
}
