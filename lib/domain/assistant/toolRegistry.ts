import type { TurnContext } from "./assistantTypes.ts";
import type { ChatPorts } from "../chat/tools.ts";

// Wiring points for the tool set. The security-gateway PR swaps what createDataPorts returns;
// the action-cards PR adds propose tools to CHAT_TOOLS / runTool.
export { CHAT_TOOLS, runTool } from "../chat/tools.ts";
export type { ChatPorts } from "../chat/tools.ts";

/** Read-only data access for the chat tools; null when there is no active project (plain model call, no tools). */
export interface DataPort {
  create(ctx: TurnContext): ChatPorts | null | Promise<ChatPorts | null>;
}

/** Concrete backends, supplied by the adapters (the only files that touch the DB). */
export type DataBackends = {
  platform: (userId: string, projectId: string) => ChatPorts | Promise<ChatPorts>;
  selfHost: (projectId: string) => ChatPorts | Promise<ChatPorts>;
};

/** The ports factory: picks the platform (Supabase, user-scoped) or self-host (SQLite) implementation. */
export function createDataPorts(ctx: TurnContext, backends: DataBackends): ChatPorts | null | Promise<ChatPorts> {
  if (!ctx.activeProjectId) return null;
  if (ctx.mode === "platform") {
    // Platform ports are always scoped to an authenticated user.
    return backends.platform(ctx.userId as string, ctx.activeProjectId);
  }
  return backends.selfHost(ctx.activeProjectId);
}
