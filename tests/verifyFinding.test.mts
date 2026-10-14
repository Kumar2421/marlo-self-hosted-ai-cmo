import test from "node:test";
import assert from "node:assert/strict";
import { isAutoVerifiable, needsPageSpeed, verifyFinding, type FreshAuditFinding, type VerifyCheckPorts } from "../lib/domain/findings/verifyFinding.ts";
import { autoVerificationLine } from "../lib/domain/findings/evidenceDisplay.ts";
import type { ReadinessCheck } from "../lib/domain/geo/readiness.ts";

const NOW = new Date("2026-10-14T12:00:00.000Z");

function ports(overrides: Partial<{ audit: FreshAuditFinding[] | Error; geo: ReadinessCheck[] | Error }> = {}): VerifyCheckPorts {
  return {
    runSeoAudit: async () => {
      if (overrides.audit instanceof Error) throw overrides.audit;
      return overrides.audit ?? [];
    },
    runGeoReadiness: async () => {
      if (overrides.geo instanceof Error) throw overrides.geo;
      return overrides.geo ?? [];
    },
  };
}

const seoFinding = {
  source: "seo-audit",
  category: "meta-title",
  entityId: "meta-title-too-long",
  url: "https://example.com/",
  severity: "warning" as const,
};

const stillThere: FreshAuditFinding = {
  issueId: "meta-title-too-long",
  category: "meta-title",
  severity: "Warning",
  label: "Meta title too long",
  evidence: { length: 80 },
  autoFixable: true,
};

function geoCheck(id: string, status: ReadinessCheck["status"]): ReadinessCheck {
  return { id, label: `Check ${id}`, status, detail: "detail", fix: "fix", weight: 10 };
}

test("seo-audit: the issue is gone from a fresh audit, so it is verified", async () => {
  const result = await verifyFinding(ports({ audit: [] }), seoFinding, NOW);
  assert.equal(result.outcome, "verified");
  assert.equal(result.checkedAt, NOW.toISOString());
});

test("seo-audit: the same issue still present, so it fails", async () => {
  const result = await verifyFinding(ports({ audit: [stillThere] }), seoFinding, NOW);
  assert.equal(result.outcome, "failed");
});

test("seo-audit: a different issue on the page does not count against this finding", async () => {
  const other: FreshAuditFinding = { ...stillThere, issueId: "canonical-missing", category: "canonical" };
  assert.equal((await verifyFinding(ports({ audit: [other] }), seoFinding, NOW)).outcome, "verified");
});

test("seo-audit: a failed audit run is skipped, never failed", async () => {
  const result = await verifyFinding(ports({ audit: new Error("crawl timed out at https://secret.example") }), seoFinding, NOW);
  assert.equal(result.outcome, "skipped");
  assert.doesNotMatch(result.reason, /secret|timed out|https/);
});

test("geo: each readiness check is decided by its own check id", async () => {
  const geoFinding = { source: "geo", category: "geo_readiness", entityId: "llms-txt", url: "https://example.com/", severity: "warning" as const };
  const passing = ports({ geo: [geoCheck("llms-txt", "pass"), geoCheck("schema", "fail")] });
  assert.equal((await verifyFinding(passing, geoFinding, NOW)).outcome, "verified");
  const failing = ports({ geo: [geoCheck("llms-txt", "fail")] });
  assert.equal((await verifyFinding(failing, geoFinding, NOW)).outcome, "failed");
});

test("geo: an unknown check (fetch problem) is skipped, never failed", async () => {
  const geoFinding = { source: "geo", category: "geo_readiness", entityId: "crawler-gptbot", url: "https://example.com/", severity: "warning" as const };
  const result = await verifyFinding(ports({ geo: [geoCheck("crawler-gptbot", "unknown")] }), geoFinding, NOW);
  assert.equal(result.outcome, "skipped");
});

test("geo: a check that is no longer reported is skipped", async () => {
  const geoFinding = { source: "geo", category: "geo_readiness", entityId: "sitemap", url: "https://example.com/", severity: "warning" as const };
  assert.equal((await verifyFinding(ports({ geo: [] }), geoFinding, NOW)).outcome, "skipped");
});

test("a finding without a url is skipped", async () => {
  assert.equal((await verifyFinding(ports({ audit: [] }), { ...seoFinding, url: null }, NOW)).outcome, "skipped");
});

test("search-console findings are skipped (measured from search data)", async () => {
  const sc = { source: "search-console", category: "search-visibility", entityId: "q", url: "https://example.com/p", severity: "warning" as const };
  assert.equal((await verifyFinding(ports({ audit: [] }), sc, NOW)).outcome, "skipped");
});

test("an unknown source is skipped, and a geo finding in another category is too", async () => {
  const other = { source: "something-new", category: "x", entityId: "y", url: "https://example.com/", severity: "warning" as const };
  assert.equal((await verifyFinding(ports(), other, NOW)).outcome, "skipped");
  const geoOther = { source: "geo", category: "other", entityId: "llms-txt", url: "https://example.com/", severity: "warning" as const };
  assert.equal((await verifyFinding(ports({ geo: [geoCheck("llms-txt", "pass")] }), geoOther, NOW)).outcome, "skipped");
});

test("a readiness run that throws is skipped, never failed", async () => {
  const geoFinding = { source: "geo", category: "geo_readiness", entityId: "llms-txt", url: "https://example.com/", severity: "warning" as const };
  const result = await verifyFinding(ports({ geo: new Error("boom") }), geoFinding, NOW);
  assert.equal(result.outcome, "skipped");
});

test("autoVerificationLine: verified, failed, reappeared, and nothing when never auto-checked", () => {
  assert.deepEqual(autoVerificationLine({ autoVerify: { outcome: "verified", checkedAt: "2026-10-15T08:00:00.000Z", reason: "ok" } }), {
    tone: "verified",
    text: "Verified automatically on 2026-10-15",
  });
  assert.equal(
    autoVerificationLine({ autoVerify: { outcome: "failed", checkedAt: "2026-10-15T08:00:00.000Z", reason: "Still flagged." } })?.text,
    "Still detected on 2026-10-15: Still flagged.",
  );
  assert.deepEqual(autoVerificationLine({ regression: "Reappeared on 2026-10-21" }), { tone: "reappeared", text: "Reappeared on 2026-10-21" });
  assert.equal(autoVerificationLine({ label: "x" }), null);
});

test("PageSpeed-only findings are skipped without running any audit, never verified or failed", async () => {
  let audits = 0;
  const counting: VerifyCheckPorts = {
    runSeoAudit: async () => {
      audits += 1;
      return [];
    },
    runGeoReadiness: async () => [],
  };
  const lighthouse = { source: "seo-audit", category: "lighthouse", entityId: "lighthouse-mobile-image-alt", url: "https://example.com/", severity: "warning" as const };
  const result = await verifyFinding(counting, lighthouse, NOW);
  assert.equal(result.outcome, "skipped");
  assert.equal(result.reason, "Needs a PageSpeed run: use Re-check");
  assert.equal(audits, 0);
  // Same for an id that starts with lighthouse- even under another category.
  assert.equal((await verifyFinding(counting, { ...lighthouse, category: "meta-title" }, NOW)).outcome, "skipped");
  assert.equal(audits, 0);
});

test("needsPageSpeed: only Lighthouse issues qualify", () => {
  assert.equal(needsPageSpeed({ category: "lighthouse", entityId: "x" }), true);
  assert.equal(needsPageSpeed({ category: "meta-title", entityId: "lighthouse-desktop-foo" }), true);
  assert.equal(needsPageSpeed({ category: "meta-title", entityId: "meta-title-too-long" }), false);
});

test("crawl-derived SEO checks still verify normally", async () => {
  assert.equal((await verifyFinding(ports({ audit: [] }), seoFinding, NOW)).outcome, "verified");
});

test("isAutoVerifiable agrees with verifyFinding: every finding it rejects is skipped without a fresh check", async () => {
  const samples: Array<{ source: string; category: string; entityId: string; url: string | null }> = [
    { source: "seo-audit", category: "meta-title", entityId: "meta-title-too-long", url: "https://example.com/" },
    { source: "seo-audit", category: "lighthouse", entityId: "lighthouse-mobile-image-alt", url: "https://example.com/" },
    { source: "seo-audit", category: "meta-title", entityId: "lighthouse-x", url: "https://example.com/" },
    { source: "seo-audit", category: "meta-title", entityId: "meta-title-too-long", url: null },
    { source: "search-console", category: "queries", entityId: "q1", url: "https://example.com/" },
    { source: "geo", category: "geo_readiness", entityId: "llms-txt", url: "https://example.com/" },
    { source: "geo", category: "other", entityId: "x", url: "https://example.com/" },
    { source: "manual", category: "other", entityId: "x", url: "https://example.com/" },
  ];
  for (const sample of samples) {
    let fresh = 0;
    const ports = {
      runSeoAudit: async () => { fresh += 1; return []; },
      runGeoReadiness: async () => { fresh += 1; return []; },
    };
    const result = await verifyFinding(ports, { ...sample, severity: "warning" }, new Date("2026-10-14T12:00:00.000Z"));
    if (!isAutoVerifiable(sample)) {
      assert.equal(result.outcome, "skipped", JSON.stringify(sample));
      assert.equal(fresh, 0, JSON.stringify(sample));
    }
  }
  assert.equal(isAutoVerifiable(samples[0]), true);
  assert.equal(isAutoVerifiable(samples[5]), true);
});
