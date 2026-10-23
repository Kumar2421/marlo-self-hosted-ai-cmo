import type { Finding } from "../../findings/findingTypes.ts";
import type { Action } from "../../actions/actionTypes.ts";
import type { SearchSnapshotPayload } from "../../search/searchSnapshot.ts";
import type { AuditSummary, GeoStatus, LeadSummary } from "../../chat/tools.ts";
import type { GatewayScope } from "./scope.ts";

/**
 * THE read-only data gateway for the assistant. One typed function per dataset, each taking a
 * GatewayScope as its first argument. There is deliberately no generic query/table/SQL function,
 * and no write method. Results are re-checked against the scope before they are returned.
 */
export interface DataGateway {
  getSearchSnapshot(scope: GatewayScope): Promise<{ snapshotDate: string; payload: SearchSnapshotPayload } | null>;
  listFindings(scope: GatewayScope): Promise<Finding[]>;
  /** null when the id does not exist in THIS user's project (other projects look identical to missing). */
  getFinding(scope: GatewayScope, id: string): Promise<Finding | null>;
  /** Newest first, optionally for one finding. */
  listActions(scope: GatewayScope, findingId?: string): Promise<Action[]>;
  /** Counts plus a short recent list. Never email addresses. */
  getLeadSummary(scope: GatewayScope, recentLimit: number): Promise<LeadSummary>;
  getGeoStatus(scope: GatewayScope): Promise<GeoStatus>;
  getAuditSummary(scope: GatewayScope): Promise<AuditSummary>;
  listCompetitors(scope: GatewayScope): Promise<string[]>;
}

export const GATEWAY_METHODS = [
  "getSearchSnapshot", "listFindings", "getFinding", "listActions",
  "getLeadSummary", "getGeoStatus", "getAuditSummary", "listCompetitors",
] as const satisfies ReadonlyArray<keyof DataGateway>;
