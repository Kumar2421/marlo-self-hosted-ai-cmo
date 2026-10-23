/**
 * Deterministic assistant evaluation (CI).
 *
 * IMPORTANT: this validates the PIPELINE, not the real model's judgement. The "model" here is a script
 * (tests/fixtures/assistantEval.ts) that says which tools it calls and what it replies. What is proven:
 * the tool loop's budgets and size caps hold, tool results reach the model as capped strings, unknown
 * tools never execute, tool errors do not crash a turn, the never-audited vs audited-clean distinction
 * is in what the model is shown, plan locks are relayed, and the reply-grounding check flags invented
 * figures while passing grounded replies. Whether a real model PICKS the right tools or phrases things
 * honestly is measured only by the manual script (scripts/assistant-eval.mts).
 */
import { test } from "node:test";
import * as assert from "node:assert";
import { CHAT_TOOLS, MAX_RESULT_CHARS } from "../lib/domain/chat/tools.ts";
import { buildAutoSummary, buildToolDefs, MAX_TOOL_CALLS, MAX_TOTAL_RESULT_CHARS } from "../lib/domain/chat/toolLoop.ts";
import { EVAL_CASES } from "./fixtures/assistantEval.ts";
import { LOCKED_MESSAGE, runCase, scoreCase, scriptedDriver, type CaseRun } from "./fixtures/assistantEvalHarness.ts";
import { STATES } from "./fixtures/assistantEvalStates.ts";

const TOOL_NAMES = new Set(CHAT_TOOLS.map((t) => t.name));
const BUDGET_PREFIX = "Tool budget used up";

const runs = new Map<string, CaseRun>();
async function run(id: string): Promise<CaseRun> {
  let r = runs.get(id);
  if (!r) {
    const c = EVAL_CASES.find((x) => x.id === id)!;
    r = await runCase(c, scriptedDriver(c.script));
    runs.set(id, r);
  }
  return r;
}

test("eval data: about 50 unique cases covering every category and every tool", () => {
  assert.ok(EVAL_CASES.length >= 50, `have ${EVAL_CASES.length}`);
  assert.equal(new Set(EVAL_CASES.map((c) => c.id)).size, EVAL_CASES.length, "unique ids");
  const cats = new Set(EVAL_CASES.map((c) => c.category));
  for (const need of ["fix-first", "traffic", "did-it-work", "site-health", "never-audited", "competitors", "leads", "geo", "out-of-scope", "injection", "pipeline", "gating"]) {
    assert.ok(cats.has(need), `category ${need}`);
  }
  const expected = new Set(EVAL_CASES.flatMap((c) => c.expectedTools));
  for (const t of TOOL_NAMES) assert.ok(expected.has(t) || EVAL_CASES.some((c) => c.script.calls.some((x) => x.tool === t)), `tool ${t} appears in some case`);
  for (const c of EVAL_CASES) {
    assert.ok(c.state in STATES, `${c.id} state`);
    for (const t of [...c.expectedTools, ...(c.allowedTools ?? [])]) assert.ok(TOOL_NAMES.has(t), `${c.id} names real tool ${t}`);
    for (const t of c.gating?.lockedOnFree ?? []) assert.ok(TOOL_NAMES.has(t), `${c.id} locks real tool ${t}`);
  }
});

for (const c of EVAL_CASES) {
  test(`eval ${c.id} [${c.category}]: ${c.question.slice(0, 60)}`, async () => {
    const r = await run(c.id);
    assert.equal(r.error, null, "turn must not fail");
    const s = scoreCase(c, r);

    // The script behaves as the case expects (keeps the data honest).
    assert.deepEqual(s.missingTools, [], "expected tools were called");
    assert.deepEqual(s.extraTools, [], "no unexpected tools");
    assert.deepEqual(s.forbiddenCalled, [], "forbidden tool never called");
    assert.deepEqual(s.claimedForbidden, [], "reply makes no forbidden claim");
    assert.deepEqual(s.missedMentions, [], "reply says what it must");
    assert.notEqual(s.neverAuditedSeen, false, "neverAudited flag reached the model");

    // Grounding: invented figures are flagged, grounded replies are clean.
    if (c.scriptedReplyInvents) assert.ok(s.groundingFlags > 0, `invented reply must be flagged: ${r.reply}`);
    else assert.equal(s.groundingFlags, 0, `grounded reply flagged: ${JSON.stringify(r.grounding.unverified)}`);

    // Pipeline guarantees that hold for every case.
    const real = r.results.filter((x) => !x.startsWith(BUDGET_PREFIX) && x !== LOCKED_MESSAGE);
    assert.ok(real.length <= MAX_TOOL_CALLS, "call budget");
    assert.ok(real.every((x) => x.length <= MAX_RESULT_CHARS), "per-result cap");
    assert.ok(real.reduce((n, x) => n + x.length, 0) <= MAX_TOTAL_RESULT_CHARS, "total char cap");
    for (const used of r.serviceToolsUsed) assert.ok(TOOL_NAMES.has(used), "only real tools are reported as used");
    for (const bad of r.rejected) assert.ok(!r.serviceToolsUsed.includes(bad) && !TOOL_NAMES.has(bad), "unknown tool never executes");
  });
}

test("pipeline: call budget stops at MAX_TOOL_CALLS and the rest get the budget message", async () => {
  const r = await run("er-2");
  assert.equal(r.results.length, 14);
  assert.equal(r.results.filter((x) => !x.startsWith(BUDGET_PREFIX)).length, MAX_TOOL_CALLS);
  assert.ok(r.results.slice(MAX_TOOL_CALLS).every((x) => x.startsWith(BUDGET_PREFIX)));
  assert.ok(r.serviceToolsUsed.length <= TOOL_NAMES.size);
});

test("pipeline: parallel calls cannot overshoot the budget", async () => {
  const used: string[] = [];
  const defs = buildToolDefs(STATES.healthy, used);
  const out = await Promise.all(Array.from({ length: 20 }, () => defs[0].execute({})));
  const real = out.filter((x) => !x.startsWith(BUDGET_PREFIX));
  assert.ok(real.length >= 1 && real.length <= MAX_TOOL_CALLS);
  assert.ok(real.reduce((n, x) => n + x.length, 0) <= MAX_TOTAL_RESULT_CHARS);
});

test("pipeline: oversized evidence is capped and secrets/emails are stripped", async () => {
  const r = await run("er-3");
  const [res] = r.results;
  assert.ok(res.length <= MAX_RESULT_CHARS);
  assert.ok(!/SHOULD-NOT-APPEAR|leak@example/.test(res));
});

test("pipeline: failing data ports become tool-error text, the turn still completes", async () => {
  const r = await run("er-1");
  assert.equal(r.error, null);
  assert.equal(r.results.length, 3);
  assert.ok(r.results.every((x) => x.startsWith("Tool error:")), r.results.join("|"));
});

test("pipeline: unknown tools are rejected before execution and never reported as used", async () => {
  const r = await run("pi-2");
  assert.deepEqual(r.rejected, ["delete_project"]);
  assert.deepEqual(r.serviceToolsUsed, []);
  assert.deepEqual(r.called, []);
});

test("pipeline: injected text in stored data arrives as JSON data inside a capped result", async () => {
  const r = await run("pi-4");
  const parsed = JSON.parse(r.results[0]);
  assert.match(JSON.stringify(parsed), /IGNORE ALL PREVIOUS INSTRUCTIONS/);
  assert.ok(Array.isArray(parsed.findings), "still structured data, not free text");
});

test("pipeline: a foreign finding id returns not-found, nothing from another project", async () => {
  const r = await run("pi-5");
  assert.match(r.results[0], /No finding with that id in this project/);
});

test("never-audited and audited-clean look different to the model", async () => {
  const never = (await run("na-1")).results.join("");
  const clean = (await run("na-2")).results.join("");
  assert.match(never, /"neverAudited":true/);
  assert.match(never, /does NOT mean the site is fine/);
  assert.doesNotMatch(clean, /neverAudited/);
  assert.match(clean, /"auditedAt"/);
  assert.match((await run("sw-4")).results.join(""), /"neverAudited":true/);
});

test("context fallback (no tool support) also says never-audited out loud", async () => {
  assert.match(await buildAutoSummary(STATES.neverAudited), /never run for this project \(zero findings does not mean the site is fine\)/);
  assert.match(await buildAutoSummary(STATES.auditedClean), /0 errors, 0 warnings/);
});

test("gating: a locked tool returns the lock message and the reply discloses no data", async () => {
  for (const id of ["gt-1", "gt-2"]) {
    const r = await run(id);
    assert.deepEqual(r.results, [LOCKED_MESSAGE]);
  }
  // A tool that is not locked on free still returns real data.
  const open = await run("gt-3");
  assert.match(open.results[0], /"rank":1/);
});

test("grounding: deliberately invented replies are the ones flagged, with the invented figures named", async () => {
  const flagged = EVAL_CASES.filter((c) => c.scriptedReplyInvents).map((c) => c.id);
  assert.deepEqual(flagged.sort(), ["co-3b", "sw-4b", "tr-1b"]);
  const tr = (await run("tr-1b")).grounding.unverified.map((u) => u.text);
  assert.ok(tr.includes("62%") && tr.includes("412"), tr.join(","));
  const co = (await run("co-3b")).grounding.unverified.map((u) => u.text);
  assert.ok(co.includes("18,400"), co.join(","));
});
