import { test } from "node:test";
import * as assert from "node:assert";
import { parseChatText } from "../lib/chatText.ts";
import { rankFindingsForChat } from "../lib/domain/chat/rankedFindings.ts";
import { runTool, type ChatPorts } from "../lib/domain/chat/tools.ts";
import { buildAutoSummary } from "../lib/domain/chat/toolLoop.ts";
import { buildFixFirstView } from "../lib/domain/overview/fixFirst.ts";
import type { Finding } from "../lib/domain/findings/findingTypes.ts";

test("parseChatText unifies list styles and strips markdown", () => {
  const b = parseChatText("Do these:\n1) **Fix title**\n2. Fix OG\n\nThen:\n* a\n- b\n• c\n   wrapped");
  assert.deepStrictEqual(b, [
    { kind: "p", text: "Do these:" },
    { kind: "ol", items: ["Fix title", "Fix OG"] },
    { kind: "p", text: "Then:" },
    { kind: "ul", items: ["a", "b", "c wrapped"] },
  ]);
});

test("parseChatText joins soft-wrapped lines and drops fences", () => {
  assert.deepStrictEqual(parseChatText("one\ntwo\n```\n## H"), [{ kind: "p", text: "one two" }, { kind: "p", text: "H" }]);
});

const mk = (id: string, severity: Finding["severity"], category: string, rec: string, status: Finding["status"] = "new"): Finding => ({
  id, projectId: "p", source: "seo", category, entityType: "page", entityId: id, url: "https://x.com/" + id,
  severity, evidence: {}, recommendation: rec, status, firstSeen: "2026-10-01", lastSeen: "2026-10-20", resolvedAt: null,
});
const now = new Date("2026-10-22T00:00:00Z");
const list = [
  mk("a", "info", "x", "Add alt text"),
  mk("b", "critical", "missing_og", "Add Open Graph tags"),
  mk("c", "warning", "meta_description_long", "Shorten meta description"),
  mk("d", "critical", "z", "Verified one", "verified"),
];

test("rankFindingsForChat follows the Fix-first ranking, unranked last", () => {
  const r = rankFindingsForChat(list, now);
  assert.deepStrictEqual(r.map((x) => x.finding.id), ["b", "c", "a", "d"]);
  assert.deepStrictEqual(r.map((x) => x.rank), [1, 2, 3, null]);
  const view = buildFixFirstView({ hasWebsite: true, findings: { status: "ready", data: list }, audit: "present", now });
  assert.ok(view.kind === "actions");
  assert.strictEqual(view.items[0].findingId, r[0].finding.id);
  assert.strictEqual(view.items[1].findingId, r[1].finding.id);
});

function ports(): ChatPorts {
  const stub = (async () => null) as never;
  return {
    getSearchSnapshot: stub, listFindings: async () => list, getFinding: stub, recommendationsFor: () => [],
    listActionsWithOutcomes: async () => [], getLeadSummary: stub, getGeoStatus: stub, getAuditSummary: stub,
    listCompetitors: async () => [], now: () => now,
  } as ChatPorts;
}

test("list_findings tool returns ranked order with rank numbers", async () => {
  const r = await runTool(ports(), "list_findings");
  const j = JSON.parse(r.content);
  assert.deepStrictEqual(j.findings.map((f: { id: string }) => f.id), ["b", "c", "a", "d"]);
  assert.deepStrictEqual(j.findings.map((f: { rank?: number }) => f.rank), [1, 2, 3, undefined]);
  assert.match(j.order, /Keep this order/);
});

test("context-path summary lists fix-first in ranked order", async () => {
  const s = await buildAutoSummary(ports());
  const line = s.split("\n").find((l) => l.startsWith("Fix first"))!;
  assert.ok(line.indexOf("1.") < line.indexOf("2.") && line.indexOf("2.") < line.indexOf("3."));
  assert.doesNotMatch(line, /Verified one/);
});
