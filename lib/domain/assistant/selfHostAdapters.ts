import { getDb } from "@/lib/db";
import { getDriver, providerSupportsTools } from "@/lib/llm";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { getActiveProjectContext } from "@/lib/domain/shared/getActiveProject";
import { buildProjectContextBlock } from "@/lib/domain/shared/projectContextPrompt";
import { buildTrafficContextBlock } from "@/lib/domain/shared/trafficContextPrompt";
import { selfHostChatPorts } from "@/lib/domain/chat/chatPorts";
import type { AssistantPorts } from "./assistantService";
import { buildChatSystemPrompt } from "./promptBuilder";
import { createDataPorts } from "./toolRegistry";
import { sqliteThreadStore } from "./threadStore";

/** Real self-host (local SQLite) ports. No auth, no credits. */
export function createSelfHostPorts(): AssistantPorts {
  return {
    scope: {
      authenticate: async () => ({ userId: null }),
      activeProjectId: async () => getActiveProjectId(),
    },
    llm: { getDriver, supportsTools: providerSupportsTools },
    threads: sqliteThreadStore(getDb),
    credentials: {
      async resolve(_ctx, providerId) {
        const row = getDb()
          .prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?")
          .get(providerId) as { api_key: string; base_url: string | null } | undefined;
        if (!row) return { kind: "missing" };
        return { kind: "byok", apiKey: row.api_key, baseUrl: row.base_url ?? undefined };
      },
    },
    // Self-host never charges credits and never resolves a platform credential.
    credits: { chargeBeforeAnswer: async () => ({ ok: true }) },
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
          selfHost: (projectId) => selfHostChatPorts(projectId),
        }),
    },
  };
}
