import type { SupabaseClient } from "@supabase/supabase-js";
import { getDriver, providerSupportsTools } from "@/lib/llm";
import { getActiveProjectContextSupabase } from "@/lib/domain/shared/getActiveProjectSupabase";
import { buildProjectContextBlock } from "@/lib/domain/shared/projectContextPrompt";
import { platformChatPorts } from "@/lib/domain/chat/chatPorts";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { chargeCredits, InsufficientCreditsError } from "@/lib/credits";
import { getEntitlement } from "@/lib/entitlements";
import { platformKeyFor, resolveLlmCredential } from "@/lib/llm/platformKeys";
import type { AssistantPorts } from "./assistantService";
import type { EntitlementPort } from "./chatEntitlements";
import { buildChatSystemPromptSupabase } from "./promptBuilder";
import { createDataPorts } from "./toolRegistry";

async function activeProjectIdSupabase(db: SupabaseClient, userId: string): Promise<string | null> {
  const { data: setting } = await db
    .from("user_settings")
    .select("value")
    .eq("user_id", userId)
    .eq("key", "active_project_id")
    .maybeSingle();
  return (setting?.value as string | undefined) ?? null;
}

/** Chat plan/usage reads. Usage = the usage_events rows spend_credits() already writes (BYOK turns write none). */
export function platformEntitlementPort(getDb: () => SupabaseClient): EntitlementPort {
  return {
    entitlement: (ctx) => getEntitlement(ctx.userId as string),
    async countPlatformChatMessages(ctx, from, to) {
      const { count, error } = await getDb()
        .from("usage_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", ctx.userId as string)
        .eq("agent_type", "chat_message")
        .eq("status", "ok")
        .gte("created_at", from.toISOString())
        .lt("created_at", to.toISOString());
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  };
}

/** Real platform-mode (hosted, Supabase) ports. Lazy: nothing touches the DB until a turn asks. */
export function createPlatformPorts(): AssistantPorts {
  // Lazy: the service client is created only when a turn first needs it (after validation/auth), as before.
  let cached: SupabaseClient | null = null;
  const getDbClient = () => (cached ??= createServiceClient());

  return {
    scope: {
      async authenticate() {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        return user ? { userId: user.id } : null;
      },
      activeProjectId: (ctx) => activeProjectIdSupabase(getDbClient(), ctx.userId as string),
    },
    llm: { getDriver, supportsTools: providerSupportsTools },
    credentials: {
      async resolve(ctx, providerId) {
        const db = getDbClient();
        const { data: conn } = await db
          .from("provider_connections")
          .select("api_key_secret_id, base_url")
          .eq("user_id", ctx.userId as string)
          .eq("provider_id", providerId)
          .maybeSingle();

        if (conn?.api_key_secret_id) {
          const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
          return { kind: "byok", apiKey: (secret as string) ?? "", baseUrl: conn.base_url ?? undefined };
        }
        if (platformKeyFor(providerId)) {
          return { kind: "platform", loadApiKey: () => resolveLlmCredential({ providerId }).apiKey };
        }
        return { kind: "missing" };
      },
    },
    credits: {
      async chargeBeforeAnswer(ctx, model) {
        try {
          await chargeCredits(ctx.userId as string, "chat_message", { model });
          return { ok: true };
        } catch (err) {
          if (err instanceof InsufficientCreditsError) return { ok: false, reason: "insufficient" };
          throw err;
        }
      },
    },
    entitlements: platformEntitlementPort(getDbClient),
    prompts: {
      build: (ctx) =>
        buildChatSystemPromptSupabase(ctx.activeProjectId, {
          projectBlock: async () => buildProjectContextBlock(await getActiveProjectContextSupabase(getDbClient(), ctx.userId as string)),
        }),
    },
    data: {
      create: (ctx) =>
        createDataPorts(ctx, {
          platform: (userId, projectId) => platformChatPorts(getDbClient(), userId, projectId),
          selfHost: () => { throw new Error("self-host data ports requested in platform mode"); },
        }),
    },
  };
}
