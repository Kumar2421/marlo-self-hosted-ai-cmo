import test from "node:test";
import assert from "node:assert/strict";
import { checkedDecision, decideRecheck } from "../lib/domain/findings/recheckDecision.ts";
import { PAGESPEED_MISSING_REASON, PAGESPEED_SKIP_REASON, type FreshAudit, type FreshAuditFinding, type VerifyCheckPorts } from "../lib/domain/findings/verifyFinding.ts";
import { reconcileSeoAuditRecheck } from "../lib/domain/seo/reconcileRecheck.ts";
import { findingErrorResponse } from "../lib/domain/findings/findingHttp.ts";
import { FindingLifecycleError, staleFindingError } from "../lib/domain/findings/findingTypes.ts";
import type { ReadinessCheck } from "../lib/domain/geo/readiness.ts";

const NOW = new Date("2026-10-21T12:00:00.000Z");

function ports(over: { audit?: FreshAudit | FreshAuditFinding[] | Error; geo?: ReadinessCheck[] | Error } = {}): VerifyCheckPorts {
  return {
    runSeoAudit: async () => {
      if (over.audit instanceof Error) throw over.audit;
      return over.audit ?? [];
    },
    runGeoReadiness: async () => {
      if (over.geo instanceof Error) throw over.geo;
      return over.geo ?? [];
    },
  };
}

const lighthouse = {
  source: "seo-audit", category: "lighthouse", entityId: "lighthouse-mobile-render-blocking-resources",
  url: "https://example.com/", severity: "critical" as const,
};
const metaTitle = {
  source: "seo-audit", category: "meta-title", entityId: "meta-title-too-long",
  url: "https://example.com/", severity: "warning" as const,
};
const stillThere: FreshAuditFinding = {
  issueId: "meta-title-too-long", category: "meta-title", severity: "Warning",
  label: "Meta title too long", evidence: { length: 80 }, autoFixable: true,
};
const geoFinding = {
  source: "geo", category: "geo_readiness", entityId: "llms-txt", url: "https://example.com/", severity: "warning" as const,
};
const check = (status: ReadinessCheck["status"]): ReadinessCheck => ({ id: "llms-txt", label: "llms.txt", status, detail: "d", fix: "Add an llms.txt file.", weight: 10 });

test("audit probe: the old manual rule called a missing Lighthouse finding verified (D2)", () => {
  const old = reconcileSeoAuditRecheck("lighthouse-mobile-render-blocking-resources", [], "critical");
  assert.equal(old.issueDetected, false); // the false "verified" this fix stops reaching the user
});

test("a Lighthouse finding without PageSpeed data is skipped, never verified", async () => {
  // Crawl-only audit with no PageSpeed flag: the finding is simply absent.
  const noKey = await decideRecheck(ports({ audit: { findings: [] } }), lighthouse, NOW, { allowPageSpeed: false });
  assert.deepEqual(noKey, { kind: "skipped", reason: PAGESPEED_SKIP_REASON });
  // A key was set but the PageSpeed call failed: the audit carries no PageSpeed data.
  const failed = await decideRecheck(ports({ audit: { findings: [], hasPageSpeed: false } }), lighthouse, NOW, { allowPageSpeed: true });
  assert.deepEqual(failed, { kind: "skipped", reason: PAGESPEED_MISSING_REASON });
  // An audit returned as a bare list cannot prove PageSpeed ran.
  const bare = await decideRecheck(ports({ audit: [] }), lighthouse, NOW, { allowPageSpeed: true });
  assert.equal(bare.kind, "skipped");
});

test("a Lighthouse finding is decided when the fresh audit carried PageSpeed data", async () => {
  const gone = await decideRecheck(ports({ audit: { findings: [], hasPageSpeed: true } }), lighthouse, NOW, { allowPageSpeed: true });
  assert.equal(gone.kind === "checked" && gone.outcome, "verified");
  const present: FreshAuditFinding = { ...stillThere, issueId: lighthouse.entityId, category: "lighthouse", label: "Render-blocking" };
  const still = await decideRecheck(ports({ audit: { findings: [present], hasPageSpeed: true } }), lighthouse, NOW, { allowPageSpeed: true });
  assert.equal(still.kind === "checked" && still.outcome, "failed");
});

test("redirected-away audit is skipped, not decided", async () => {
  const d = await decideRecheck(ports({ audit: { findings: [], finalUrl: "https://example.com/login" } }), metaTitle, NOW);
  assert.equal(d.kind, "skipped");
});

test("a crawl that throws is skipped with a generic reason, no raw error text", async () => {
  const d = await decideRecheck(ports({ audit: new Error("ECONNRESET 10.0.0.5:443") }), metaTitle, NOW);
  assert.equal(d.kind, "skipped");
  assert.ok(d.kind === "skipped" && !d.reason.includes("ECONNRESET"));
});

test("a seo-audit finding still flagged is failed with the fresh evidence; one gone is verified", async () => {
  const failed = await decideRecheck(ports({ audit: { findings: [stillThere] } }), metaTitle, NOW);
  assert.ok(failed.kind === "checked" && failed.outcome === "failed" && failed.result.issueDetected);
  assert.equal(failed.kind === "checked" && failed.result.evidence.label, "Meta title too long");
  const verified = await decideRecheck(ports({ audit: { findings: [] } }), metaTitle, NOW);
  assert.ok(verified.kind === "checked" && verified.outcome === "verified" && !verified.result.issueDetected);
});

test("geo findings use the readiness check, not the SEO audit rules", async () => {
  const pass = await decideRecheck(ports({ geo: [check("pass")] }), geoFinding, NOW);
  assert.ok(pass.kind === "checked" && pass.outcome === "verified");
  const fail = await decideRecheck(ports({ geo: [check("fail")] }), geoFinding, NOW);
  assert.ok(fail.kind === "checked" && fail.outcome === "failed" && fail.result.recommendation === "Add an llms.txt file.");
  assert.equal(fail.kind === "checked" && (fail.result.evidence.check as { id: string }).id, "llms-txt");
});

test("geo: an unknown or missing readiness check is skipped (never failed or verified)", async () => {
  assert.equal((await decideRecheck(ports({ geo: [check("unknown")] }), geoFinding, NOW)).kind, "skipped");
  assert.equal((await decideRecheck(ports({ geo: [] }), geoFinding, NOW)).kind, "skipped");
  assert.equal((await decideRecheck(ports({ geo: new Error("dns") }), geoFinding, NOW)).kind, "skipped");
});

test("search-console and url-less findings are skipped by the verify rules", async () => {
  assert.equal((await decideRecheck(ports(), { ...metaTitle, source: "search-console" }, NOW)).kind, "skipped");
  assert.equal((await decideRecheck(ports(), { ...metaTitle, url: null }, NOW)).kind, "skipped");
});

test("checkedDecision maps an already-evaluated result", () => {
  const r = { severity: "warning" as const, evidence: {}, recommendation: "r" };
  assert.equal(checkedDecision({ ...r, issueDetected: true }).kind === "checked" && (checkedDecision({ ...r, issueDetected: true }) as { outcome: string }).outcome, "failed");
  assert.equal((checkedDecision({ ...r, issueDetected: false }) as { outcome: string }).outcome, "verified");
});

test("route error mapping: validation 400, conflicts 409, everything else a generic 502", () => {
  assert.deepEqual(findingErrorResponse(new FindingLifecycleError("rejected", "x")), { status: 400, error: "x" });
  assert.equal(findingErrorResponse(new FindingLifecycleError("invalid", "x")).status, 409);
  assert.equal(findingErrorResponse(staleFindingError()).status, 409);
  const raw = findingErrorResponse(new Error("connect ECONNREFUSED 10.1.2.3:5432"), "Try again.");
  assert.deepEqual(raw, { status: 502, error: "Try again." });
});
