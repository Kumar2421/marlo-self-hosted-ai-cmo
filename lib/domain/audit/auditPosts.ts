import type { LlmDriver } from "../../llm/types.ts";
import { buildDraftPrompt, parseDraftBatch } from "../x/draftPost.ts";
import { linkedInPrompt } from "../social/platformPrompts.ts";
import { parseLinkedInBatch } from "../social/draftParse.ts";
import { companyNameFrom } from "../leads/company/companySites.ts";
import type { SamplePosts } from "../seo/publicReportShared.ts";

/**
 * Sample posts for an audited site: one X post and one LinkedIn post, written from the site's own text with the same
 * prompts and checks the Social agents use (no invented numbers, customers or quotes; X within its limit). They are
 * examples on a public page. Marlo never posts them, and the page says so.
 */

export type AuditPostsPage = { host: string; title: string; description: string; bodyText: string };

export type WriteInput = { driver: LlmDriver; apiKey: string; model: string; page: AuditPostsPage; timeoutMs?: number };

const PAGE_CHARS = 3000;

async function ask<T>(input: WriteInput, prompt: { system: string; prompt: string }, parse: (raw: string) => T | null): Promise<T | null> {
  const call = async (extra?: string): Promise<T | null> => {
    const res = await input.driver({
      apiKey: input.apiKey,
      model: input.model,
      system: prompt.system,
      messages: [{ role: "user" as const, content: extra ? `${prompt.prompt}\n\n${extra}` : prompt.prompt }],
      stream: false,
      timeoutMs: input.timeoutMs,
    });
    return parse(res.text ?? "");
  };
  // One repair retry, like the other model steps. A failed call is "no post", never a thrown error.
  try {
    return (await call()) ?? (await call("Your last reply could not be used. Reply with ONLY the JSON object asked for, and keep to the rules."));
  } catch {
    return null;
  }
}

export async function writeAuditPosts(input: WriteInput): Promise<SamplePosts | null> {
  const name = companyNameFrom(input.page.title, input.page.host);
  const description = input.page.description.trim().slice(0, 600) || undefined;
  // The site's own words are the only source: the prompts forbid anything not in them.
  const productInfo = `Text from the website itself:\n${input.page.bodyText.trim().slice(0, PAGE_CHARS)}`;

  const [x, linkedin] = await Promise.all([
    ask(input, buildDraftPrompt({ name, description, productInfo, variants: 1 }), (raw) => {
      const first = parseDraftBatch(raw, 1).drafts[0];
      return first ? { text: first.text } : null;
    }),
    ask(input, linkedInPrompt({ name, description }, 1, { productInfo }), (raw) => {
      const first = parseLinkedInBatch(raw, 1).drafts[0];
      return first ? { hookLine: first.hookLine, body: first.body } : null;
    }),
  ]);

  return x || linkedin ? { x, linkedin } : null;
}
