import assert from "node:assert/strict";
import test from "node:test";
import { writeAuditPosts, type AuditPostsPage } from "../lib/domain/audit/auditPosts.ts";
import type { LlmDriver } from "../lib/llm/types.ts";

const PAGE: AuditPostsPage = {
  host: "acme-plumbing.test",
  title: "Acme Plumbing | Chennai",
  description: "Emergency plumbers in Chennai, 24 hours.",
  bodyText: "We fix leaks, burst pipes and blocked drains across Chennai. Call any time.",
};

const X_REPLY = JSON.stringify({ drafts: [{ angle: "Problem", text: "A burst pipe at 2am is not a Monday problem.\nWe pick up the phone.", whyThisWorks: "Specific." }] });
const LI_BODY = "Most plumbing emergencies are not emergencies at first. A slow drip becomes a flooded floor when nobody checks it. ".repeat(2);
const LI_REPLY = JSON.stringify({ drafts: [{ hookLine: "A slow drip is a bill that has not arrived yet", body: LI_BODY, whyThisWorks: "Hook.", angle: "Insight" }] });

/** A driver that answers by which prompt it was given: the X prompt mentions "X (Twitter)", the LinkedIn one "LinkedIn". */
function driver(replies: { x: string[]; li: string[] }): { driver: LlmDriver; calls: { x: number; li: number } } {
  const calls = { x: 0, li: 0 };
  const d = (async (req: { system?: string }) => {
    if (req.system?.includes("X (Twitter)")) return { text: replies.x[Math.min(calls.x++, replies.x.length - 1)] };
    return { text: replies.li[Math.min(calls.li++, replies.li.length - 1)] };
  }) as unknown as LlmDriver;
  return { driver: d, calls };
}

test("a good model answer gives one X post and one LinkedIn post", async () => {
  const t = driver({ x: [X_REPLY], li: [LI_REPLY] });
  const posts = await writeAuditPosts({ driver: t.driver, apiKey: "k", model: "m", page: PAGE });
  assert.ok(posts);
  assert.equal(posts.x?.text, "A burst pipe at 2am is not a Monday problem.\nWe pick up the phone.");
  assert.equal(posts.linkedin?.hookLine, "A slow drip is a bill that has not arrived yet");
  assert.ok(posts.linkedin!.body.length > 100);
  assert.deepEqual(t.calls, { x: 1, li: 1 });
});

test("an X post over the limit is dropped, the LinkedIn post is still returned", async () => {
  const tooLong = JSON.stringify({ drafts: [{ angle: "A", text: "x".repeat(400), whyThisWorks: "w" }] });
  const t = driver({ x: [tooLong], li: [LI_REPLY] });
  const posts = await writeAuditPosts({ driver: t.driver, apiKey: "k", model: "m", page: PAGE });
  assert.equal(posts?.x, null);
  assert.ok(posts?.linkedin);
  assert.equal(t.calls.x, 2, "the X step was retried once");
});

test("a reply that is not JSON is repaired once, then given up without throwing", async () => {
  const t = driver({ x: ["sorry, here you go", X_REPLY], li: ["nope"] });
  const posts = await writeAuditPosts({ driver: t.driver, apiKey: "k", model: "m", page: PAGE });
  assert.ok(posts?.x, "the repaired X reply was used");
  assert.equal(posts?.linkedin, null);
  assert.equal(t.calls.li, 2);
});

test("when nothing usable comes back the result is null, not an empty object", async () => {
  const t = driver({ x: ["no"], li: ["no"] });
  assert.equal(await writeAuditPosts({ driver: t.driver, apiKey: "k", model: "m", page: PAGE }), null);
});

test("a driver that throws is 'no post', not a crash", async () => {
  const boom = (async () => {
    throw new Error("rate limited");
  }) as unknown as LlmDriver;
  assert.equal(await writeAuditPosts({ driver: boom, apiKey: "k", model: "m", page: PAGE }), null);
});

test("the prompts are built from the site's own words and carry the no-invented-facts rule", async () => {
  const seen: { system: string; user: string }[] = [];
  const spy = (async (req: { system?: string; messages: { content: string }[] }) => {
    seen.push({ system: req.system ?? "", user: req.messages[0].content });
    return { text: "no" };
  }) as unknown as LlmDriver;
  await writeAuditPosts({ driver: spy, apiKey: "k", model: "m", page: { ...PAGE, bodyText: "x".repeat(9000) } });
  assert.ok(seen.length >= 2);
  for (const s of seen) {
    assert.ok(s.user.includes("Acme Plumbing"), "the brand name from the title is used");
    assert.ok(s.user.includes("Text from the website itself"));
    assert.ok(s.user.length < 5000, "the site text is capped");
    assert.ok(/invent/i.test(s.system), "the prompt forbids invented facts");
  }
});
