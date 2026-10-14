import { assertSafeUserUrl, INVALID_USER_URL_MESSAGE, MAX_USER_URL_LENGTH } from "./publicUrl.ts";
import type { LookupFn } from "./ssrf.ts";

/**
 * Save-time check for a provider base URL. Providers whose base URL only ever points at a local model
 * server (ollama, lmstudio, custom) may use localhost in self-host mode, because that server runs on
 * the user's own machine. Every other base URL is an outbound target the server calls, so it must
 * pass assertSafeUserUrl (public address, default ports, no credentials). Hosted mode rejects
 * private addresses for every provider.
 */

export const LOCAL_BASE_URL_PROVIDERS: ReadonlySet<string> = new Set(["ollama", "lmstudio", "custom"]);

export async function assertProviderBaseUrl(providerId: string, raw: string, opts: { platformMode: boolean; lookup?: LookupFn }): Promise<void> {
  if (!opts.platformMode && LOCAL_BASE_URL_PROVIDERS.has(providerId)) {
    if (raw.length > MAX_USER_URL_LENGTH) throw new Error(INVALID_USER_URL_MESSAGE);
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new Error(INVALID_USER_URL_MESSAGE);
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(INVALID_USER_URL_MESSAGE);
    if (u.username || u.password) throw new Error("Remove the username and password from the URL.");
    return;
  }
  await assertSafeUserUrl(raw, opts.lookup);
}
