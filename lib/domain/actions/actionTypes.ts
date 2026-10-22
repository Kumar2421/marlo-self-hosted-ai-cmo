export const ACTION_TYPES = [
  "add_canonical",
  "remove_noindex",
  "improve_content_relevance",
  "investigate_ttfb",
  // Search-opportunity findings: rewrite title/description, or work out why a search moved.
  "rewrite_snippet",
  "investigate_ranking_change",
  // Every other finding type (the 11 SEOAgent issueIds with no dedicated
  // automated type — meta title/description, headings, OG/Twitter tags,
  // robots-txt) had no representable ActionType at all before this, which
  // silently made "create an action" impossible for the majority of the
  // product's findings. Not tied to any automated fix — actions here are a
  // user-facing tracked TODO, not autonomous execution.
  "manual_fix",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];
export type ActionStatus = "proposed" | "approved" | "running" | "completed" | "failed" | "cancelled";

export type ActionTarget = {
  url?: string;
  repository?: string;
  branch?: string;
  file?: string;
};

export type Action = {
  id: string;
  projectId: string;
  findingId: string;
  recommendationId?: string;
  type: ActionType;
  status: ActionStatus;
  title: string;
  target: ActionTarget;
  parameters: Record<string, unknown>;
  result: Record<string, unknown> | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export const ACTION_TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  // A user can report a tracked change as made without Marlo ever running it
  // (the manual path); an integration like a GitHub PR goes approved -> running -> completed.
  proposed: ["approved", "cancelled", "completed"],
  approved: ["running", "cancelled", "completed"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["approved", "cancelled"],
  cancelled: [],
};

export function canTransitionAction(from: ActionStatus, to: ActionStatus): boolean {
  return ACTION_TRANSITIONS[from].includes(to);
}

/** A lifecycle failure the route maps without reading text: an illegal edge or a row that changed since it was read (both 409). */
export class ActionLifecycleError extends Error {
  kind: "invalid" | "conflict";
  constructor(kind: "invalid" | "conflict", message: string) {
    super(message);
    this.name = "ActionLifecycleError";
    this.kind = kind;
  }
}

export function invalidActionTransitionError(from: ActionStatus, to: ActionStatus): ActionLifecycleError {
  return new ActionLifecycleError("invalid", `Invalid action status transition: ${from} -> ${to}`);
}

export function staleActionError(): ActionLifecycleError {
  return new ActionLifecycleError("conflict", "This action changed since it was loaded. Refresh and try again.");
}

export function isActionType(value: unknown): value is ActionType {
  return typeof value === "string" && ACTION_TYPES.includes(value as ActionType);
}

export function isActionStatus(value: unknown): value is ActionStatus {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ACTION_TRANSITIONS, value);
}
