import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGapFillChunks,
  buildLinkedInQueries,
  collectProfiles,
  describeFailure,
  estimateTokens,
  fillMissingCompanies,
  GAP_FILL_MAX_PROFILES_PER_CALL,
  GAP_FILL_PROMPT_TOKEN_CAP,
  GAP_FILL_SINGLE_CALL_TOKEN_CAP,
  type CompletionDriver,
} from "../lib/domain/leads/leadSearchCore.ts";
import { rankProfiles } from "../lib/domain/leads/leadFit.ts";
import type { LinkedInSearchResult, ParsedLinkedInProfile } from "../lib/domain/leads/profileParse.ts";
import { parseLinkedInResult } from "../lib/domain/leads/profileParse.ts";

const TARGET = { role: "Head of Marketing", companyOrIndustry: "B2B SaaS", location: "Austin, TX" };

function profile(i: number, over: Partial<ParsedLinkedInProfile> = {}): ParsedLinkedInProfile {
  return {
    name: `Person Number${i}`,
    headline: `Head of Marketing at Company${i} building a long headline that keeps going to exercise the clipping limit for prompts in B2B SaaS Austin`,
    title: `Head of Marketing ${i}`,
    seniority: "Head, Marketing",
    location: "Austin, Texas",
    followers: null,
    company: null,
    description: "B2B SaaS growth.",
    sourceUrl: `https://www.linkedin.com/in/person-${i}`,
    ...over,
  };
}

const forty = Array.from({ length: 40 }, (_, i) => profile(i));

test("buildLinkedInQueries makes the three LinkedIn-targeted queries, and two without a location", () => {
  assert.deepEqual(buildLinkedInQueries(TARGET), [
    '"Head of Marketing" B2B SaaS Austin, TX site:linkedin.com/in',
    '"Head of Marketing" B2B SaaS linkedin profile',
    '"Head of Marketing" B2B SaaS linkedin',
  ]);
  const noLocation = buildLinkedInQueries({ ...TARGET, location: "" });
  assert.equal(noLocation.length, 2);
  assert.ok(noLocation.every((q) => !q.includes("email") && !q.includes("directory") && !q.includes("contact")));
  assert.deepEqual(buildLinkedInQueries({ role: "", companyOrIndustry: "SaaS", location: "" }), ["SaaS site:linkedin.com/in", "SaaS linkedin profile"]);
});

const personHit = (slug: string, title: string): LinkedInSearchResult => ({
  title,
  url: `https://www.linkedin.com/in/${slug}`,
  content: "# X | Headline: Head of Marketing at Crystal | Current role: Head of Marketing | Location: Austin, Texas, United States",
});

test("collectProfiles keeps only person profiles, dedupes URLs, and survives a failing source", async () => {
  const seenQueries: string[] = [];
  const googleQueries: string[] = [];
  const { profiles, stats } = await collectProfiles(buildLinkedInQueries(TARGET), {
    tavily: async (q) => {
      seenQueries.push(q);
      if (q.includes("linkedin profile")) throw new Error("Tavily down");
      return [
        personHit("kim-cook", "Kim Cook - Head of Marketing at Crystal"),
        { title: "Crystal | LinkedIn", url: "https://www.linkedin.com/company/crystal", content: "" },
        { title: "Top 10 SaaS CMOs", url: "https://blog.example.com/cmos", content: "article" },
        personHit("kim-cook", "Kim Cook - Head of Marketing at Crystal"),
      ];
    },
    google: async (q) => {
      googleQueries.push(q);
      return [{ title: "Lee Park - Marketing Director | LinkedIn", url: "https://www.linkedin.com/in/lee-park", content: "" }];
    },
  });
  assert.equal(seenQueries.length, 3, "all three Tavily queries were attempted");
  assert.equal(googleQueries.length, 1, "Google CSE runs for the first query only");
  assert.equal(googleQueries[0], buildLinkedInQueries(TARGET)[0]);
  assert.deepEqual(profiles.map((p) => p.sourceUrl), ["https://www.linkedin.com/in/kim-cook", "https://www.linkedin.com/in/lee-park"]);
  assert.equal(profiles[0].company, "Crystal");
  assert.equal(stats.queriesRun, 3);
});

test("buildGapFillChunks: 40 profiles lacking a company go in chunks of <=25 under the prompt cap", () => {
  const chunks = buildGapFillChunks(forty);
  assert.equal(chunks.flat().length, 40);
  assert.ok(chunks.every((c) => c.length <= GAP_FILL_MAX_PROFILES_PER_CALL));
  assert.ok(chunks.length >= 2);
});

test("buildGapFillChunks skips profiles that already have a company", () => {
  const mixed = forty.map((p, i) => (i % 2 === 0 ? { ...p, company: "Known" } : p));
  const flat = buildGapFillChunks(mixed).flat();
  assert.equal(flat.length, 20);
  assert.ok(flat.every((i) => mixed[i].company === null));
});

test("fillMissingCompanies never sends more than the token cap, even with 40 long profiles", async () => {
  const prompts: { system: string; content: string }[] = [];
  const driver: CompletionDriver = async (req) => {
    prompts.push({ system: req.system, content: req.messages[0].content });
    return { text: "[]" };
  };
  const outcome = await fillMissingCompanies(driver, forty, { apiKey: "k", model: "m" });
  assert.equal(outcome.error, null);
  assert.equal(outcome.calls, prompts.length);
  assert.ok(prompts.length >= 2);
  for (const p of prompts) {
    const promptTokens = estimateTokens(p.system) + estimateTokens(p.content);
    assert.ok(promptTokens <= GAP_FILL_PROMPT_TOKEN_CAP, `prompt was ${promptTokens} tokens`);
    assert.ok(promptTokens + 400 <= GAP_FILL_SINGLE_CALL_TOKEN_CAP, "one call stays under the Groq free-tier minute budget");
  }
  const sent = prompts.map((p) => p.content).join("\n");
  assert.ok(!sent.includes("https://"), "no URLs or snippets are sent, only id|name|headline|title");
});

test("fillMissingCompanies accepts a company only when the profile text names it", async () => {
  const few = [profile(0), profile(1), profile(2)];
  const driver: CompletionDriver = async () => ({
    text: '```json\n[{"id": 0, "company": "Company0"}, {"id": 1, "company": "Invented Inc"}, {"id": 2, "company": null}, {"id": 99, "company": "Company2"}]\n```',
  });
  const outcome = await fillMissingCompanies(driver, few, { apiKey: "k", model: "m" });
  assert.deepEqual([...outcome.companies.entries()], [[0, "Company0"]]);
  assert.equal(outcome.error, null);
});

test("LLM throws on a later chunk: keep earlier answers, stop, no throw", async () => {
  let call = 0;
  const driver: CompletionDriver = async (req) => {
    call += 1;
    if (call === 2) throw new Error("413 Request too large for model openai/gpt-oss-120b in organization on tokens per minute (TPM): Limit 8000");
    const ids = [...req.messages[0].content.matchAll(/^(\d+)\|/gm)].map((m) => Number(m[1]));
    return { text: JSON.stringify(ids.map((id) => ({ id, company: `Company${id}` }))) };
  };
  const outcome = await fillMissingCompanies(driver, forty, { apiKey: "k", model: "m" });
  assert.equal(call, 2, "no third call after the failure");
  assert.ok(outcome.companies.size > 0 && outcome.companies.size < 40);
  assert.match(outcome.error ?? "", /^HTTP 413/);
});

test("the error reason never contains the API key", async () => {
  const secret = "gsk_TESTSECRET_12345";
  const driver: CompletionDriver = async () => {
    throw new Error(`429 rate limited for key ${secret} please retry`);
  };
  const outcome = await fillMissingCompanies(driver, [profile(0)], { apiKey: secret, model: "m" });
  assert.ok(outcome.error);
  assert.ok(!outcome.error.includes(secret));
  assert.match(outcome.error, /HTTP 429/);
  assert.equal(describeFailure(new Error("plain"), ""), "plain");
});

test("non-JSON or empty model output gives no companies and no error", async () => {
  const driver: CompletionDriver = async () => ({ text: "Sorry, I cannot help." });
  const outcome = await fillMissingCompanies(driver, [profile(0)], { apiKey: "k", model: "m" });
  assert.equal(outcome.companies.size, 0);
  assert.equal(outcome.error, null);
});

test("a rule-parsed result with a known company never reaches the LLM", async () => {
  const known = parseLinkedInResult(personHit("kim-cook", "Kim Cook - Head of Marketing at Crystal"));
  assert.ok(known);
  let calls = 0;
  const driver: CompletionDriver = async () => {
    calls += 1;
    return { text: "[]" };
  };
  await fillMissingCompanies(driver, [known], { apiKey: "k", model: "m" });
  assert.equal(calls, 0);
});

test("end to end: rank, then fill only the gaps; profile count and prompt size stay bounded", async () => {
  const ranked = rankProfiles(forty, TARGET);
  let promptTokens = 0;
  let maxCall = 0;
  const driver: CompletionDriver = async (req) => {
    const t = estimateTokens(req.system) + estimateTokens(req.messages[0].content);
    promptTokens += t;
    maxCall = Math.max(maxCall, t);
    return { text: "[]" };
  };
  await fillMissingCompanies(driver, ranked, { apiKey: "k", model: "m" });
  assert.ok(maxCall <= GAP_FILL_PROMPT_TOKEN_CAP);
  assert.ok(promptTokens <= 2 * GAP_FILL_PROMPT_TOKEN_CAP);
  console.log(`# gap-fill for 40 profiles missing company: ${promptTokens} prompt tokens across ${buildGapFillChunks(ranked).length} calls (max ${maxCall} per call)`);
});
