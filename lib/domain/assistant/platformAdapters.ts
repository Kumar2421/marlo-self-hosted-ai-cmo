import type { SupabaseClient } from "@supabase/supabase-js";
import { getDriver, providerSupportsTools } from "@/lib/llm";
import { getActiveProjectContextSupabase } from "@/lib/domain/shared/getActiveProjectSupabase";
import { buildProjectContextBlock } from "@/lib/domain/shared/projectContextPrompt";
import { getFindingRecommendations } from "@/lib/domain/recommendations/recommendationService";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { chargeCredits, InsufficientCreditsError } from "@/lib/credits";
import { platformKeyFor, resolveLlmCredential } from "@/lib/llm/platformKeys";
import type { AssistantPorts } from "./assistantService";
import { buildChatSystemPromptSupabase } from "./promptBuilder";
import { createDataPorts } from "./toolRegistry";
import { createSupabaseGateway } from "./gateway/supabaseGateway";
import { gatewayChatPorts } from "./gateway/gatewayPorts";

async function activeProjectIdSupabase(db: SupabaseClient, userId: string): Promise<string | null> {
  const { data: setting } = await db
    .from("user_settings")
    .select("value")
    .eq("user_id", userId)
    .eq("key", "active_project_id")
    .maybeSingle();
  return (setting?.value as string | undefined) ?? null;
}

/**
 * Real platform-mode (hosted, Supabase) ports. Lazy: nothing touches the DB until a turn asks.
 *
 * Two clients, two jobs:
 * - userDb: the signed-in user's own session client. ALL data reads (project id, project context,
 *   every chat tool via the data gateway) use it, so Postgres RLS enforces tenancy.
 * - the service client: ONLY for the credential/vault/credits work below. Never for data reads.
 */
export function createPlatformPorts(): AssistantPorts {
  let cachedUser: Promise<SupabaseClient> | null = null;
  const getUserDb = () => (cachedUser ??= createClient() as Promise<SupabaseClient>);
  // Lazy: the service client is created only when a turn first needs credentials (after validation/auth).
  let cached: SupabaseClient | null = null;
  const getServiceDb = () => (cached ??= createServiceClient());

  return {
    scope: {
      async authenticate() {
        const supabase = await getUserDb();
        const { data: { user } } = await supabase.auth.getUser();
        return user ? { userId: user.id } : null;
      },
      activeProjectId: async (ctx) => activeProjectIdSupabase(await getUserDb(), ctx.userId as string),
    },
    llm: { getDriver, supportsTools: providerSupportsTools },
    credentials: {
      async resolve(ctx, providerId) {
        const db = getServiceDb();
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
    prompts: {
      build: (ctx) =>
        buildChatSystemPromptSupabase(ctx.activeProjectId, {
          projectBlock: async () => buildProjectContextBlock(await getActiveProjectContextSupabase(await getUserDb(), ctx.userId as string)),
        }),
    },
    data: {
      create: (ctx) =>
        createDataPorts(ctx, {
          platform: async (userId, projectId) =>
            gatewayChatPorts(createSupabaseGateway(await getUserDb()), { userId, projectId }, { recommendationsFor: getFindingRecommendations }),
          selfHost: () => { throw new Error("self-host data ports requested in platform mode"); },
        }),
    },
  };
}
