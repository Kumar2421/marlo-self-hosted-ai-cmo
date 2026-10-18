/**
 * Prompt builders for the LinkedIn and Reddit draft agents. Pure: the draft
 * routes and the daily job both build prompts here, so the wording lives once.
 * Optional productInfo is only passed by the daily job; the routes omit it and
 * keep their existing prompts unchanged.
 */

export type PromptProject = { name: string; description?: string; category?: string };

const PRODUCT_INFO_CHARS = 4000;

function productInfoBlock(productInfo: string | undefined): string {
  const text = (productInfo ?? "").trim();
  if (!text) return "";
  const clipped = text.length > PRODUCT_INFO_CHARS ? `${text.slice(0, PRODUCT_INFO_CHARS)}...` : text;
  return `\n\nProduct information:\n${clipped}`;
}

export function linkedInPrompt(
  project: PromptProject,
  variants: number,
  options: { productInfo?: string } = {},
): { system: string; prompt: string } {
  const system = `You are a B2B content marketer writing LinkedIn posts for ${project.name}.
Write insightful, personal posts about this product — not generic advice.
Rules:
- Hook in the first line (LinkedIn truncates after ~2 lines).
- Short paragraphs (1-3 sentences), generous line breaks.
- 100-3000 characters total (hook line + body).
- No hashtag spam (0-3 relevant tags at the end, if any).
- No invented statistics, customer names, or quotes.
- End with a genuine question or takeaway, not a hard sell.

Reply with JSON only, no prose: {"drafts":[{"hookLine":"...","body":"...","whyThisWorks":"...","angle":"..."}]}`;

  const prompt = `Write ${variants} LinkedIn post${variants === 1 ? "" : "s"} about: ${project.name}
${project.description ? `\nDescription: ${project.description}` : ""}
${project.category ? `\nCategory: ${project.category}` : ""}${productInfoBlock(options.productInfo)}`;
  return { system, prompt };
}

export function redditPrompt(
  project: PromptProject,
  subreddit: string,
  variants: number,
  options: { productInfo?: string } = {},
): { system: string; prompt: string } {
  const system = `You are a Reddit contributor writing posts for r/${subreddit} about ${project.name}.
Be conversational and community-friendly; match the subreddit's tone.
Rules:
- Title: 1-300 characters, clear and engaging (no clickbait).
- Body: 1-40000 characters, natural discussion (no spam or hard sales).
- No invented statistics, customer names, or quotes.
- Be helpful and ask for feedback, not selling.

Reply with JSON only, no prose: {"drafts":[{"subreddit":"${subreddit}","title":"...","body":"...","whyThisWorks":"...","angle":"..."}]}`;

  const prompt = `Write ${variants} Reddit post${variants === 1 ? "" : "s"} for r/${subreddit} about: ${project.name}
${project.description ? `\nDescription: ${project.description}` : ""}
${project.category ? `\nCategory: ${project.category}` : ""}${productInfoBlock(options.productInfo)}`;
  return { system, prompt };
}
