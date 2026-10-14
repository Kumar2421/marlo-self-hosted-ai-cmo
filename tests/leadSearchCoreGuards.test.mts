import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateTokens,
  fillMissingCompanies,
  GAP_FILL_PROMPT_TOKEN_CAP,
  GAP_FILL_SINGLE_CALL_TOKEN_CAP,
  type CompletionDriver,
} from "../lib/domain/leads/leadSearchCore.ts";
import type { ParsedLinkedInProfile } from "../lib/domain/leads/profileParse.ts";

function profile(i: number, over: Partial<ParsedLinkedInProfile> = {}): ParsedLinkedInProfile {
  return {
    name: `Person Number${i}`,
    headline: `Head of Sales at Acme${i} building growth`,
    title: "Head of Sales",
    seniority: "",
    location: "Austin, Texas",
    followers: null,
    company: null,
    description: "B2B sales.",
    sourceUrl: `https://www.linkedin.com/in/person-${i}`,
    ...over,
  };
}

/** Run fill-in on one profile whose headline is `headline` and whose model answer is `answer`. */
async function answerFor(headline: string, answer: string): Promise<Map<number, string>> {
  const driver: CompletionDriver = async () => ({ text: JSON.stringify([{ id: 0, company: answer }]) });
  const out = await fillMissingCompanies(driver, [profile(0, { headline, title: "" })], { apiKey: "k", model: "m" });
  return out.companies;
}

test("LLM placeholders are rejected: Freelance, Stealth, Self-employed, Confidential, Independent, Consultant", async () => {
  const headline = "Freelance Stealth Self-employed Confidential Independent Consultant marketer";
  for (const answer of ["Freelance", "Stealth", "Self-employed", "Confidential", "Independent", "Consultant"]) {
    assert.equal((await answerFor(headline, answer)).size, 0, answer);
  }
});

test("LLM output is cleaned like rule output: separators and trailing stopwords are cut", async () => {
  const companies = await answerFor("Head of Sales at Acme Corp, Austin", "Acme Corp, Austin");
  assert.deepEqual([...companies.entries()], [[0, "Acme Corp"]]);
});

test("LLM geography answers are rejected", async () => {
  assert.equal((await answerFor("Marketing Manager, Berlin, Germany", "Berlin")).size, 0);
  assert.equal((await answerFor("Sales Director, Europe", "Europe")).size, 0);
});

test("an LLM company must be a whole word in the profile text, case-insensitively", async () => {
  // "Company" is only a fragment of "Company1", so it is not named by the profile.
  assert.equal((await answerFor("Head of Sales at Company1 growth", "Company")).size, 0);
  // Substring of a longer word is not a match either.
  assert.equal((await answerFor("Head of Sales at Acmeland", "Acme")).size, 0);
  // Whole word, different case: accepted.
  assert.deepEqual([...(await answerFor("Head of Sales at ACME growth", "acme")).entries()], [[0, "acme"]]);
});

test("a single-character company is never accepted", async () => {
  assert.equal((await answerFor("Head of Sales at A growth", "A")).size, 0);
});

test("estimateTokens: ASCII stays at about 4 characters per token", () => {
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
  assert.equal(estimateTokens(""), 0);
});

test("estimateTokens: each CJK character, accent or emoji counts as about one token", () => {
  assert.equal(estimateTokens("日本語"), 3, "three CJK characters");
  assert.equal(estimateTokens("\u{1F600}"), 1, "one emoji");
  assert.equal(estimateTokens("café"), 2, "three ASCII-ish letters round up to one, plus the accent");
});

test("CJK profiles cannot push any prompt past the token budget", async () => {
  const cjk = "市场营销总监负责人".repeat(8);
  const many = Array.from({ length: 40 }, (_, i) =>
    profile(i, { headline: `${cjk} ${i}`, title: cjk, description: cjk, name: `张三${i}` })
  );
  const prompts: string[] = [];
  const driver: CompletionDriver = async (req) => {
    prompts.push(req.system + req.messages[0].content);
    return { text: "[]" };
  };
  const outcome = await fillMissingCompanies(driver, many, { apiKey: "k", model: "m" });
  assert.equal(outcome.error, null);
  assert.ok(prompts.length >= 2, "many CJK profiles need several calls");
  for (const p of prompts) {
    const tokens = estimateTokens(p);
    assert.ok(tokens <= GAP_FILL_PROMPT_TOKEN_CAP, `prompt was ${tokens} tokens`);
    assert.ok(tokens + 400 <= GAP_FILL_SINGLE_CALL_TOKEN_CAP, "one call stays under the minute budget");
  }
});
