/**
 * Which chat providers can actually call tools (read the user's data).
 *
 * Kept free of driver/SDK imports so client components can use it too. Only the
 * OpenAI-compatible driver implements the tool-call loop (openai.ts); groq and
 * mistral reuse it. anthropic.ts and google.ts ignore a `tools` array, so those
 * providers only ever get the counts-only overview (see toolLoop.ts).
 */
const TOOL_CAPABLE_PROVIDERS = new Set(["openai", "groq", "mistral", "lmstudio", "ollama", "custom"]);

export function providerSupportsTools(providerId: string): boolean {
  return TOOL_CAPABLE_PROVIDERS.has(providerId);
}

/** Notice the chat UI shows when the selected provider has no tool loop; null when it has full access. */
export const LIMITED_DATA_NOTICE = "Limited data access with this model";

export function limitedDataNotice(providerId: string | null | undefined): string | null {
  if (!providerId) return null;
  return providerSupportsTools(providerId) ? null : LIMITED_DATA_NOTICE;
}
