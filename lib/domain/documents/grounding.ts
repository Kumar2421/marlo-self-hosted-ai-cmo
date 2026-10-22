/**
 * Honesty guard for generated strategy documents.
 *
 * Live testing showed the models inventing "internal metrics", pilots, traffic
 * spikes and ICP statistics that appear nowhere in the crawl or search data.
 * Two layers: GROUNDING_RULES is injected into every generator prompt, and
 * findUnverifiedClaims is a cheap deterministic check on the finished markdown.
 */

export const GROUNDING_RULES = `GROUNDING RULES (these override everything else in this brief):
- Use ONLY facts present in the crawled page text, search results, and supplied documents above. If a fact is not there, you do not know it.
- NEVER invent statistics, percentages, dollar amounts, metrics, customer names, case studies, pilots, quotes, dates, traffic, downloads, GitHub forks/stars, or social-media/forum signals. Never attribute made-up numbers to the company or to third parties.
- If you need a fact that is absent, write exactly "Not stated on the site" or phrase it as a clearly labelled "Hypothesis: ..." or "Idea to test: ...".
- Any ICP, sizing, or strategy number (company size, revenue, headcount, budget, conversion rate) is an ASSUMPTION to validate, not a finding. Label it as one and list it under a short "Assumptions to validate" section at the end.
- Content ideas are ideas, not claims about events that already happened. Write "Idea: ..." and never describe a launch, spike, announcement or discussion as having occurred unless it appears in the supplied data.
- A plain "Not stated on the site" is always better than a plausible-sounding guess.`;

export const UNVERIFIED_NOTE_HEADLINE = "Contains unverified claims: review before use";

const HEDGE =
  /\b(hypothesis|hypotheses|hypothesise|assum(?:e|es|ed|ing|ption|ptions)|idea to test|idea:|to validate|to test|illustrative|for example|e\.g\.|not stated)/i;
const HEDGED_HEADING = /assumption|hypothes|idea|to validate|to test/i;

const PCT = /\d+(?:[.,]\d+)?\s?%/g;
const MONEY = /[$€£]\s?\d[\d,]*(?:\.\d+)?\s?(?:[kmb]\b|million|billion|thousand)?\+?/gi;
const YEAR_RANGE = /\b(?:19|20)\d\d\s?[-–/]\s?(?:(?:19|20)?\d\d)\b/g;
const RANGE =
  /\b\d[\d,]*\s?[-–]\s?\d[\d,]*\+?(?=\s+(?:employees|people|staff|engineers|seats|users|customers|companies|teams|revenue|arr|mrr))/gi;
const COUNT_NOUN = /\b\d[\d,]*\+?\s+(?:employees|engineers|customers|companies|teams|users|stars|forks|downloads|installs|pilots?)\b/gi;

const NUMERIC_CONTEXT =
  /\b(internal|metrics?|pilot|customers?|clients?|case stud(?:y|ies)|traffic|forks?|stars|downloads?|installs?|revenue|arr|mrr|employees|headcount|incidents?|reduction|increase|growth|conversion|adoption|survey|benchmark|users|budget|ops team|teams?)\b/i;

const PLATFORM = /\b(hacker news|reddit|twitter|linkedin|product hunt|github|x\.com|youtube|discord|slack community)\b/i;
const EVENT =
  /\b(spike|surge|went viral|trending|praising|praised|have posted|has posted|posted on|announced|hackathon|launched|raving|buzz|flood of)\b/i;

function normNumbers(token: string): string[] {
  return token.match(/\d[\d,]*(?:\.\d+)?/g)?.map((n) => n.replace(/,/g, "").replace(/\.0+$/, "")) ?? [];
}

function sourceHasNumber(source: string, n: string): boolean {
  const esc = n.replace(/\./g, "\\.");
  return new RegExp(`(?<![\\d.])${esc}(?!\\d|\\.\\d)`).test(source.replace(/(\d),(\d{3})/g, "$1$2"));
}

function words(s: string): string[] {
  return s.toLowerCase().match(/[a-z][a-z0-9'-]{4,}/g) ?? [];
}

export type UnverifiedClaim = { sentence: string; reason: string };

function splitSentences(line: string): string[] {
  return line
    .split(/(?<=[.!?])\s+(?=[A-Z"'(*\[])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Flags sentences that present numbers or events as fact when the numbers
 * are not in `source`. Hedged sentences and sentences under an
 * "Assumptions"/"Ideas" heading are never flagged. Sentences that cite a URL
 * are skipped because web-search results are not part of `source`. */
export function findUnverifiedClaims(markdown: string, source: string): UnverifiedClaim[] {
  const out: UnverifiedClaim[] = [];
  const srcWords = new Set(words(source));
  let hedgedSection = false;

  for (const rawLine of markdown.split("\n")) {
    const heading = rawLine.match(/^\s{0,3}#{1,6}\s+(.*)$/);
    if (heading) {
      hedgedSection = HEDGED_HEADING.test(heading[1]);
      continue;
    }
    if (hedgedSection) continue;
    const line = rawLine.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim();
    if (!line || /^\|?[\s:|-]+\|?$/.test(line)) continue;

    for (const sentence of splitSentences(line)) {
      if (HEDGE.test(sentence) || /https?:\/\//.test(sentence)) continue;

      const figures = [
        ...(sentence.match(PCT) ?? []),
        ...(sentence.match(MONEY) ?? []),
        ...(sentence.match(YEAR_RANGE) ?? []),
        ...(sentence.match(RANGE) ?? []),
        ...(sentence.match(COUNT_NOUN) ?? []),
      ];
      if (figures.length && NUMERIC_CONTEXT.test(sentence)) {
        const missing = figures.filter((f) => normNumbers(f).some((n) => !sourceHasNumber(source, n)));
        if (missing.length) {
          out.push({ sentence, reason: `figure not found in source data: ${missing[0].trim()}` });
          continue;
        }
      }

      if (PLATFORM.test(sentence) && EVENT.test(sentence)) {
        const w = words(sentence);
        const known = w.filter((x) => srcWords.has(x)).length;
        if (!w.length || known / w.length < 0.6) {
          out.push({ sentence, reason: "describes an event or social signal not found in source data" });
        }
      }
    }
  }
  return out;
}

const clip = (s: string) => (s.length > 220 ? `${s.slice(0, 217)}...` : s).replace(/\s+/g, " ");

/** Visible footer appended to a document that contains flagged claims. Empty
 * string when nothing was flagged. */
export function buildUnverifiedFooter(claims: UnverifiedClaim[]): string {
  if (!claims.length) return "";
  const list = claims.slice(0, 8).map((c) => `> - "${clip(c.sentence)}" (${c.reason})`).join("\n");
  const more = claims.length > 8 ? `\n> - ...and ${claims.length - 8} more` : "";
  return `\n\n---\n> **${UNVERIFIED_NOTE_HEADLINE}.** (${claims.length} unverified claim${claims.length === 1 ? "" : "s"} flagged) These statements cite figures or events that are not in the site content or your other documents. Treat them as hypotheses until verified:\n${list}${more}\n`;
}

/** Reads the flagged-claim count back out of a generated document. */
export function countUnverifiedClaims(text: string): number {
  const m = text.match(/\((\d+) unverified claims? flagged\)/);
  return m ? Number(m[1]) : 0;
}

/** Non-streaming path: returns the text with the footer appended when needed. */
export function guardDocumentText(text: string, source: string): { text: string; flagged: number } {
  const claims = findUnverifiedClaims(text, source);
  return { text: text + buildUnverifiedFooter(claims), flagged: claims.length };
}

/** Streaming path: passes chunks through untouched (keeps live streaming) and
 * appends the footer when the stream closes. */
export function guardDocumentStream(stream: ReadableStream<Uint8Array>, source: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let acc = "";
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        acc += decoder.decode(chunk, { stream: true });
        controller.enqueue(chunk);
      },
      flush(controller) {
        const footer = buildUnverifiedFooter(findUnverifiedClaims(acc, source));
        if (footer) controller.enqueue(encoder.encode(footer));
      },
    })
  );
}

const NON_SOURCE_KEYS = new Set(["model", "tavilyApiKey", "apiKey", "baseUrl", "providerId"]);

/** Flattens every string in a generator request (page text, meta, supplied
 * documents, competitor snippets) into the text numbers are checked against. */
export function sourceFromRequest(req: unknown): string {
  const parts: string[] = [];
  const walk = (v: unknown, key?: string) => {
    if (key && NON_SOURCE_KEYS.has(key)) return;
    if (typeof v === "string") parts.push(v);
    else if (typeof v === "number") parts.push(String(v));
    else if (Array.isArray(v)) v.forEach((x) => walk(x));
    else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => walk(x, k));
  };
  walk(req);
  return parts.join("\n");
}

/** Applies the claim guard to whichever of stream/text a driver returned. */
export function guardCompletionResult<T extends { stream?: ReadableStream<Uint8Array> | null; text?: string | null }>(
  result: T,
  request: unknown
): T {
  const source = sourceFromRequest(request);
  if (result.stream) return { ...result, stream: guardDocumentStream(result.stream, source) };
  if (typeof result.text === "string") return { ...result, text: guardDocumentText(result.text, source).text };
  return result;
}
