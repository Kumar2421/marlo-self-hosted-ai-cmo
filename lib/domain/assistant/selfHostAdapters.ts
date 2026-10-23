import { getDb } from "@/lib/db";
import { getDriver, providerSupportsTools } from "@/lib/llm";
import { providers as PROVIDER_DEFS } from "@/lib/mock-providers";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { getActiveProjectContext } from "@/lib/domain/shared/getActiveProject";
import { buildProjectContextBlock } from "@/lib/domain/shared/projectContextPrompt";
import { buildTrafficContextBlock } from "@/lib/domain/shared/trafficContextPrompt";
import { getFindingRecommendations } from "@/lib/domain/recommendations/recommendationService";
import type { AssistantPorts } from "./assistantService";
import { pickPreferredModel } from "./credentialResolver";
import { buildChatSystemPrompt } from "./promptBuilder";
import { createDataPorts } from "./toolRegistry";
import { createSqliteGateway } from "./gateway/sqliteGateway";
import { gatewayChatPorts } from "./gateway/gatewayPorts";

/** Real self-host (local SQLite) ports. No auth, no credits. */
export function createSelfHostPorts(): AssistantPorts {
  return {
    scope: {
      authenticate: async () => ({ userId: null }),
      activeProjectId: async () => getActiveProjectId(),
    },
    llm: { getDriver, supportsTools: providerSupportsTools },
    credentials: {
      async resolve(_ctx, providerId) {
        const row = getDb()
          .prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?")
          .get(providerId) as { api_key: string; base_url: string | null } | undefined;
        if (!row) return { kind: "missing" };
        return { kind: "byok", apiKey: row.api_key, baseUrl: row.base_url ?? undefined };
      },
      async preferredModel() {
        const db = getDb();
        const setting = db.prepare("SELECT value FROM settings WHERE key = 'primaryModel'").get() as { value: string } | undefined;
        const rows = db.prepare("SELECT provider_id FROM provider_connections").all() as Array<{ provider_id: string }>;
        return pickPreferredModel(setting?.value, rows.map((r) => r.provider_id), PROVIDER_DEFS);
      },
      // Self-host has no operator keys: users always bring their own.
      platformAvailable: () => false,
    },
    // Self-host never charges credits and never resolves a platform credential.
    credits: { canAfford: async () => ({ ok: true }), charge: async () => ({ ok: true }) },
    prompts: {
      build: async (ctx) =>
        buildChatSystemPrompt(ctx.activeProjectId, {
          projectBlock: () => buildProjectContextBlock(getActiveProjectContext()),
          trafficBlock: (id) => buildTrafficContextBlock(id),
        }),
    },
    data: {
      create: (ctx) =>
        createDataPorts(ctx, {
          platform: () => { throw new Error("platform data ports requested in self-host mode"); },
          selfHost: (projectId) =>
            gatewayChatPorts(createSqliteGateway(getDb()), { userId: null, projectId }, { recommendationsFor: getFindingRecommendations }),
        }),
    },
  };
}
