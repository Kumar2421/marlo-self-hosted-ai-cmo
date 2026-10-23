import type { Finding } from "../../findings/findingTypes.ts";
import { readOutcomes, type OutcomePorts } from "../../search/outcomeService.ts";
import type { ChatPorts } from "../../chat/tools.ts";
import { logLineAuditSink, type ToolAuditSink } from "../../chat/toolAudit.ts";
import type { GatewayScope } from "./scope.ts";
import type { DataGateway } from "./types.ts";

/**
 * Binds the read-only gateway to ONE scope and presents it as the ChatPorts the tools use.
 * The tools therefore never see a scope, a client or a table: only these named reads.
 */
export type GatewayPortsOptions = {
  /** Derives recommendations from a finding (pure; injected so this module stays free of app aliases). */
  recommendationsFor: ChatPorts["recommendationsFor"];
  audit?: ToolAuditSink;
  now?: () => Date;
};

type Snapshot = Awaited<ReturnType<ChatPorts["getSearchSnapshot"]>>;

/**
 * Outcome reading with every write disabled: readOutcomes() normally saves verdicts and fetches
 * live page fingerprints. Chat is read-only, so writes throw/no-op and no network fetch happens.
 */
function readOnlyOutcomePorts(getSnapshot: () => Promise<Snapshot>, getFinding: (id: string) => Promise<Finding | null>): OutcomePorts {
  const forbidden = async (): Promise<never> => { throw new Error("read-only"); };
  return {
    projectUrl: null,
    getAction: async () => null,
    getFinding,
    getSnapshot,
    completeAction: forbidden,
    saveResult: async () => undefined,
    resetAction: forbidden,
    moveFinding: forbidden,
    fetchFingerprint: async () => null,
  };
}

export function gatewayChatPorts(gateway: DataGateway, scope: GatewayScope, opts: GatewayPortsOptions): ChatPorts {
  const bound: GatewayScope = { userId: scope.userId, projectId: scope.projectId };
  const getSearchSnapshot = () => gateway.getSearchSnapshot(bound);
  const getFinding = (id: string) => gateway.getFinding(bound, id);
  const outcomePorts = readOnlyOutcomePorts(getSearchSnapshot, getFinding);
  const sink = opts.audit ?? logLineAuditSink();
  return {
    getSearchSnapshot,
    listFindings: () => gateway.listFindings(bound),
    getFinding,
    recommendationsFor: opts.recommendationsFor,
    listActionsWithOutcomes: async (findingId) => readOutcomes(outcomePorts, await gateway.listActions(bound, findingId)),
    getLeadSummary: (n) => gateway.getLeadSummary(bound, n),
    getGeoStatus: () => gateway.getGeoStatus(bound),
    getAuditSummary: () => gateway.getAuditSummary(bound),
    listCompetitors: () => gateway.listCompetitors(bound),
    now: opts.now ?? (() => new Date()),
    audit: (entry) => sink({ ...entry, userId: bound.userId, projectId: bound.projectId }),
  };
}
