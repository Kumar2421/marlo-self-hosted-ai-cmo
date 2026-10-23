import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blankTagCount,
  canReview,
  flowReducer,
  guessedCheckboxLabel,
  initialFlow,
  insertAtCursor,
  mergeResults,
  meterLabel,
  outreachErrorMessage,
  parseSenderProfile,
  reasonLabel,
  retryIds,
  stepperIndex,
  subjectWarnings,
  summarisePlan,
  summariseResults,
  unknownMergeTags,
  type FlowAction,
  type FlowState,
} from "../lib/domain/leads/outreachCompose.ts";
import type { OutreachPlanResponse } from "../lib/domain/leads/outreachContract.ts";

const plan: OutreachPlanResponse = {
  sendable: ["a", "b", "c"],
  blocked: [
    { leadId: "d", reason: "no_email" },
    { leadId: "e", reason: "guessed" },
    { leadId: "f", reason: "no_email" },
  ],
  guessedIds: ["e"],
  status: { dailyCap: 25, sentToday: 7, remainingToday: 18 },
  creditCost: 1,
};

describe("reasons and plan summary", () => {
  it("labels every reason in plain language", () => {
    assert.equal(reasonLabel("no_email"), "No email address");
    assert.equal(reasonLabel("guessed"), "Guessed address");
    assert.equal(reasonLabel("unsubscribed"), "Unsubscribed");
    assert.equal(reasonLabel("recent"), "Emailed in the last 30 days");
    assert.equal(reasonLabel("over_cap"), "Over today's limit");
    assert.equal(reasonLabel(undefined), "Not sent");
  });
  it("summarises a plan", () => {
    const s = summarisePlan(6, plan);
    assert.equal(s.headline, "6 selected: 3 will be sent, 3 blocked");
    assert.equal(s.creditLine, "Costs about 1 credit (beta: not charged)");
    assert.equal(s.meterLabel, "7 of 25 sent today, 18 left");
    assert.equal(s.meterPercent, 28);
    assert.deepEqual(s.reasonCounts[0], { reason: "no_email", count: 2 });
    assert.equal(s.canContinue, true);
  });
  it("cannot continue with nobody sendable", () => {
    assert.equal(summarisePlan(2, { ...plan, sendable: [] }).canContinue, false);
  });
  it("meter handles a full day and a zero cap", () => {
    assert.equal(meterLabel({ dailyCap: 25, sentToday: 25, remainingToday: 0 }), "25 of 25 sent today, 0 left");
    assert.equal(summarisePlan(1, { ...plan, status: { dailyCap: 0, sentToday: 0, remainingToday: 0 } }).meterPercent, 100);
  });
  it("words the guessed checkbox", () => {
    assert.equal(guessedCheckboxLabel(1), "Include 1 guessed address (they may bounce)");
    assert.equal(guessedCheckboxLabel(4), "Include 4 guessed addresses (they may bounce)");
  });
});

describe("subject and body advice", () => {
  it("is quiet for a good subject, with or without merge tags", () => {
    assert.deepEqual(subjectWarnings("Quick question about {{company}}"), []);
    assert.deepEqual(subjectWarnings(""), []);
  });
  it("warns on long subjects, measured after merging", () => {
    assert.equal(subjectWarnings("x".repeat(61))[0].id, "long");
    assert.deepEqual(subjectWarnings("Hello {{company}}", { company: "Acme" }), []);
    assert.equal(subjectWarnings("Hello {{company}}", { company: "A".repeat(80) }).some((w) => w.id === "long"), true);
  });
  it("warns on ALL CAPS but not on short acronyms", () => {
    assert.equal(subjectWarnings("GREAT OFFER FOR YOU TODAY").some((w) => w.id === "caps"), true);
    assert.equal(subjectWarnings("Our SEO plan").some((w) => w.id === "caps"), false);
  });
  it("warns on repeated exclamation marks and spammy phrases", () => {
    assert.equal(subjectWarnings("Hi!!!").some((w) => w.id === "exclaim"), true);
    assert.equal(subjectWarnings("Hi there!").some((w) => w.id === "exclaim"), false);
    assert.equal(subjectWarnings("Act now").some((w) => w.id === "spammy"), true);
  });
  it("finds unknown merge tags only", () => {
    assert.deepEqual(unknownMergeTags("Hi {{name}} at {{company}}, {{ title }} {{nmae}}"), ["{{ title }}", "{{nmae}}"]);
  });
  it("counts leads that would render a tag blank", () => {
    const leads = [{ name: "A", company: "X" }, { name: "B", company: "" }, { name: "C" }];
    assert.equal(blankTagCount("Hi {{name}}", leads), 0);
    assert.equal(blankTagCount("At {{company}}", leads), 2);
    assert.equal(blankTagCount("plain", leads), 0);
  });
});

describe("insertAtCursor", () => {
  it("inserts at the cursor", () => {
    assert.deepEqual(insertAtCursor("Hi ,", "{{name}}", 3, 3), { text: "Hi {{name}},", cursor: 11 });
  });
  it("replaces a selection", () => {
    assert.deepEqual(insertAtCursor("Hi NAME,", "{{name}}", 3, 7), { text: "Hi {{name}},", cursor: 11 });
  });
  it("appends when there is no usable cursor", () => {
    assert.equal(insertAtCursor("Hi", "{{name}}", null, null).text, "Hi{{name}}");
    assert.equal(insertAtCursor("Hi", "{{name}}", 99, 99).text, "Hi{{name}}");
    assert.equal(insertAtCursor("", "{{name}}", 0, 0).text, "{{name}}");
  });
});

function run(actions: FlowAction[], from: FlowState = initialFlow): FlowState {
  return actions.reduce((s, a) => flowReducer(s, a), from);
}

describe("step machine", () => {
  it("walks recipients -> compose -> review -> sending -> results", () => {
    assert.equal(run([{ type: "next" }]).step, "compose");
    assert.equal(run([{ type: "next" }, { type: "next" }]).step, "review");
    assert.equal(run([{ type: "next" }, { type: "next" }, { type: "submit" }]).step, "sending");
    assert.equal(run([{ type: "next" }, { type: "next" }, { type: "submit" }, { type: "done" }]).step, "results");
  });
  it("goes back one step at a time and not from recipients", () => {
    assert.equal(run([{ type: "next" }, { type: "next" }, { type: "back" }]).step, "compose");
    assert.equal(run([{ type: "back" }]).step, "recipients");
  });
  it("cannot submit before review, nor skip ahead", () => {
    assert.equal(run([{ type: "submit" }]).step, "recipients");
    assert.equal(run([{ type: "next" }, { type: "submit" }]).step, "compose");
    assert.equal(run([{ type: "done" }]).step, "recipients");
  });
  it("guards a double submit and blocks back while sending", () => {
    const sending = run([{ type: "next" }, { type: "next" }, { type: "submit" }]);
    assert.equal(flowReducer(sending, { type: "submit" }), sending);
    assert.equal(flowReducer(sending, { type: "retry" }), sending);
    assert.equal(flowReducer(sending, { type: "back" }), sending);
    assert.equal(flowReducer(sending, { type: "next" }), sending);
  });
  it("returns to review when a normal send fails, to results when a retry fails", () => {
    const sent = run([{ type: "next" }, { type: "next" }, { type: "submit" }]);
    assert.equal(flowReducer(sent, { type: "fail" }).step, "review");
    const results = flowReducer(sent, { type: "done" });
    const retrying = flowReducer(results, { type: "retry" });
    assert.equal(retrying.step, "sending");
    assert.equal(flowReducer(retrying, { type: "fail" }).step, "results");
  });
  it("retry works only from results", () => {
    assert.equal(run([{ type: "retry" }]).step, "recipients");
  });
  it("maps steps to the three-stop stepper", () => {
    assert.deepEqual(
      (["recipients", "compose", "review", "sending", "results"] as const).map((s) => stepperIndex(s)),
      [0, 1, 2, 2, 2],
    );
  });
  it("needs a subject and a body to review", () => {
    assert.equal(canReview("Hi", "Body"), true);
    assert.equal(canReview(" ", "Body"), false);
    assert.equal(canReview("Hi", ""), false);
  });
});

describe("results", () => {
  const rows = [
    { id: "a", status: "sent" as const },
    { id: "b", status: "failed" as const, error: "Mailbox full" },
    { id: "c", status: "skipped" as const, reason: "recent" as const },
    { id: "d", status: "failed" as const },
  ];
  it("counts by status", () => {
    assert.deepEqual(summariseResults(rows), { sent: 1, failed: 2, skipped: 1, total: 4 });
  });
  it("retries only failed, never skipped", () => {
    assert.deepEqual(retryIds(rows), ["b", "d"]);
    assert.deepEqual(retryIds([{ id: "x", status: "skipped", reason: "over_cap" }]), []);
  });
  it("merges a retry over the earlier rows", () => {
    const merged = mergeResults(rows, [{ id: "b", status: "sent" }, { id: "d", status: "failed", error: "again" }]);
    assert.deepEqual(summariseResults(merged), { sent: 2, failed: 1, skipped: 1, total: 4 });
    assert.deepEqual(retryIds(merged), ["d"]);
  });
});

describe("errors and stored sender", () => {
  it("shows calm messages, never raw JSON", () => {
    assert.match(outreachErrorMessage(503), /safeguards are not set up yet/);
    assert.match(outreachErrorMessage(422, "Gmail is not connected"), /Gmail is not connected/);
    assert.doesNotMatch(outreachErrorMessage(422, '{"error":"x"}'), /\{/);
    assert.match(outreachErrorMessage(500), /Nothing was sent/);
    assert.match(outreachErrorMessage(0), /connection/);
  });
  it("parses a stored sender defensively", () => {
    assert.deepEqual(parseSenderProfile('{"name":"Ada","company":"Acme","address":"1 Main St"}'), { name: "Ada", company: "Acme", address: "1 Main St" });
    assert.deepEqual(parseSenderProfile("not json"), { name: "", company: "", address: "" });
    assert.deepEqual(parseSenderProfile('{"name":5}'), { name: "", company: "", address: "" });
    assert.deepEqual(parseSenderProfile(null), { name: "", company: "", address: "" });
  });
});
