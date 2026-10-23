import type { TurnContext } from "./assistantTypes.ts";

/** ChatPanel has no full markdown renderer: it draws paragraphs plus simple lists (see lib/chatText.ts).
 * Lists must use one fixed syntax so they always render the same way. */
export const STYLE_INSTRUCTION = `Write in plain conversational text. No markdown formatting: no **bold**, no # headers, no code fences, no tables. If you need a list, put each item on its own line starting with "1. ", "2. " (for ordered or ranked things, in the order you mean) or "- " (for unordered things). Use one list style per answer, never "1)", "*" or bullet symbols, no nested lists, and keep each item to one or two short sentences. Put a blank line between a list and the sentences around it. Don't use emoji unless the user uses them first. Be concise: skip preamble and filler.`;

/** Builds the system prompt for a turn. */
export interface PromptPort {
  build(ctx: TurnContext): Promise<string>;
}

export type SelfHostPromptDeps = {
  /** Project Information / Marketing Strategy block for the active project. */
  projectBlock: () => string;
  /** Cached real Traffic data for the project, or null/empty when none. */
  trafficBlock: (activeId: string) => string | null | undefined;
};

/** Chat had zero project awareness before this — no system prompt at all,
 * so it didn't know the product's name, let alone its real Product
 * Information/Marketing Strategy docs or how it's actually performing in
 * search. Reuses the same context block the content agents (Articles,
 * LinkedIn, Reddit, X) already ground their prompts in, plus real cached
 * Traffic data on top — nothing fabricated when either is missing. */
export function buildChatSystemPrompt(activeId: string | null, deps: SelfHostPromptDeps): string {
  if (!activeId) return STYLE_INSTRUCTION;

  const block = deps.projectBlock();

  const traffic = deps.trafficBlock(activeId);
  const trafficBlock = traffic
    ? `\nReal traffic/ranking data:\n${traffic}`
    : "\nNo real Traffic data cached yet — the user hasn't opened Analytics → Traffic for this project. Don't invent traffic or ranking numbers; say so if asked.";

  return `${STYLE_INSTRUCTION}\n\n${block}\n${trafficBlock}`;
}

/** Platform-mode equivalent of buildChatSystemPrompt() - Supabase-scoped to
 * one user instead of the shared local SQLite file. Search data comes from
 * the chat tools (search_snapshots), so no "not cached" claim is made here. */
export async function buildChatSystemPromptSupabase(
  activeId: string | null,
  deps: { projectBlock: () => Promise<string> },
): Promise<string> {
  if (!activeId) return STYLE_INSTRUCTION;
  return `${STYLE_INSTRUCTION}

${await deps.projectBlock()}`;
}
