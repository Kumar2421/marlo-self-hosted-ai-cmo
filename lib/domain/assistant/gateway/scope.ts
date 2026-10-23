import { isFindingId } from "../../chat/toolSchema.ts";

/**
 * Every gateway function takes an explicit scope. There is no "current user" global and no
 * default: a missing or malformed scope throws before any query is built.
 */
export type GatewayScope = {
  /** Authenticated user (hosted). null only for self-host, which has no accounts. */
  userId: string | null;
  projectId: string;
};

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Hosted: both ids must be UUIDs. */
export function requireHostedScope(scope: unknown): { userId: string; projectId: string } {
  const s = scope as Partial<GatewayScope> | null | undefined;
  if (!s || typeof s !== "object") throw new ScopeError("Missing data scope.");
  if (!isUuid(s.userId)) throw new ScopeError("Invalid user scope.");
  if (!isUuid(s.projectId)) throw new ScopeError("Invalid project scope.");
  return { userId: s.userId, projectId: s.projectId };
}

/** Self-host: one local project; ids are not always UUIDs (legacy id 'active'). */
export function requireLocalScope(scope: unknown): { projectId: string } {
  const s = scope as Partial<GatewayScope> | null | undefined;
  if (!s || typeof s !== "object") throw new ScopeError("Missing data scope.");
  if (typeof s.projectId !== "string" || s.projectId.length === 0 || s.projectId.length > 128) {
    throw new ScopeError("Invalid project scope.");
  }
  return { projectId: s.projectId };
}

/** Finding ids the model may pass back (UUID, optionally "finding_"-prefixed). */
export { isFindingId };
