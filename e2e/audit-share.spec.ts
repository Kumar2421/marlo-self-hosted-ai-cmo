import { expect, test, type Page } from "@playwright/test";
import { buildStoredReport } from "../lib/domain/seo/publicReport.ts";

// Shareable audit reports: run an audit, get a link, open it as a stranger, remove it. The audit crawl itself is
// mocked (no outside site is contacted); saved reports are read and written through the real routes, against the local fake Supabase.

test.describe.configure({ timeout: 60_000 });
test.use({ viewport: { width: 1280, height: 900 } });

const finding = (n: number, over: Record<string, unknown> = {}) => ({
  issueId: `issue-${n}`, category: "meta-description", severity: n === 1 ? "Error" : "Warning", label: `Finding number ${n}`,
  evidence: { length: 12 * n }, whyItMatters: `Why finding ${n} matters.`, recommendation: `Fix finding ${n}.`, ...over,
});
const FINDINGS = [finding(1), finding(2), finding(3)];
const SUMMARY = { totalFindings: 7, critical: 2, warnings: 5 };

const SUPABASE = process.env.E2E_SUPABASE_URL || "http://localhost:54329";

/** Saves a report in the fake Supabase the dev server talks to (the same table the real store writes). */
async function seed(over: { score?: number; now?: Date } = {}) {
  const { report, ownerToken } = buildStoredReport(
    { url: "https://www.acme-plumbing.test/", score: over.score ?? 62, findings: FINDINGS as never, summary: SUMMARY },
    over.now,
  );
  const res = await fetch(`${SUPABASE}/rest/v1/public_audit_reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: report.id, url: report.url, host: report.host, score: report.score, summary: report.summary, findings: report.findings,
      owner_token_hash: report.ownerTokenHash, created_at: report.createdAt, expires_at: report.expiresAt,
    }),
  });
  if (!res.ok) throw new Error(`seed failed: ${res.status}`);
  return { id: report.id, ownerToken };
}

async function mockAudit(page: Page, report: { id: string; path: string; ownerToken: string } | null) {
  await page.route("**/api/public/audit/events", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.route("**/api/public/audit", (r) =>
    r.request().method() === "POST"
      ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "https://www.acme-plumbing.test/", findings: FINDINGS, summary: SUMMARY, technical: { onPageScore: 62, status: 200, redirectCount: 0 }, report }) })
      : r.fallback(),
  );
}

test("running an audit shows the score, the findings and a link to share", async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL! });
  await mockAudit(page, { id: "k7m2q9x4t8wn", path: "/audit/r/k7m2q9x4t8wn", ownerToken: "owner-token-owner-token-1234" });
  await page.goto("/audit");
  await page.getByPlaceholder("yourwebsite.com").fill("https://www.acme-plumbing.test");
  await page.getByRole("button", { name: "Run free audit" }).click();

  await expect(page.getByTestId("audit-host")).toHaveText("acme-plumbing.test");
  await expect(page.getByTestId("audit-score")).toContainText("62");
  await expect(page.getByTestId("audit-score")).toContainText("Needs work");
  await expect(page.getByText("Top 3 of 7 issues")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finding number 2" })).toBeVisible();

  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseURL}/audit/r/k7m2q9x4t8wn`);
});

test("when the report could not be saved the audit still shows, just without a link", async ({ page }) => {
  await mockAudit(page, null);
  await page.goto("/audit?url=https%3A%2F%2Fwww.acme-plumbing.test%2F");
  await expect(page.getByTestId("audit-score")).toContainText("62");
  await expect(page.getByTestId("share-bar")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Create free account" })).toBeVisible();
});

test("a stranger can open the shared report and check their own site", async ({ page }) => {
  const { id } = await seed();
  await mockAudit(page, null);
  await page.goto(`/audit/r/${id}`);

  await expect(page.getByTestId("audit-host")).toHaveText("acme-plumbing.test");
  await expect(page.getByTestId("audit-score")).toContainText("62");
  await expect(page.getByRole("heading", { name: "Finding number 3" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove this report" })).toHaveCount(0); // only the owner's browser has the token
  await expect(page.getByTestId("check-yours")).toBeVisible();

  await page.getByLabel("Your website address").fill("https://their-site.test");
  await page.getByRole("button", { name: "Run free audit" }).last().click();
  await expect(page).toHaveURL(/\/audit\?url=https%3A%2F%2Ftheir-site\.test/);
});

test("the shared page has link-preview tags, is not indexed, and has a preview image", async ({ page, request }) => {
  const { id } = await seed({ score: 88 });
  await page.goto(`/audit/r/${id}`);
  await expect(page).toHaveTitle(/acme-plumbing\.test scores 88\/100/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /88\/100/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", new RegExp(`/audit/r/${id}/opengraph-image`));
  const image = await request.get(`/audit/r/${id}/opengraph-image`);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toContain("image/png");
});

test("an unknown, malformed or expired report is a plain not-found", async ({ page }) => {
  // The page streams, so the status line is not a reliable signal here; what a visitor sees is.
  const notFound = async (id: string) => {
    await page.goto(`/audit/r/${id}`);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page.getByTestId("audit-result")).toHaveCount(0);
  };
  for (const id of ["zzzzzzzzzzzz", "not-an-id", "..%2F..%2Fetc"]) await notFound(id);
  const { id } = await seed({ now: new Date("2026-01-01T00:00:00Z") });
  await notFound(id);
});

test("the owner can remove a report: the right token works once, a wrong one never does", async ({ page, request }) => {
  const { id, ownerToken } = await seed();
  const wrong = await request.delete(`/api/public/audit/report/${id}`, { headers: { "x-report-token": "wrong-token-wrong-token-12" } });
  expect(wrong.status()).toBe(404);
  expect((await request.delete(`/api/public/audit/report/${id}`)).status()).toBe(404); // no token at all
  await page.goto(`/audit/r/${id}`);
  await expect(page.getByTestId("audit-result")).toBeVisible();

  const ok = await request.delete(`/api/public/audit/report/${id}`, { headers: { "x-report-token": ownerToken } });
  expect(ok.status()).toBe(200);
  await page.goto(`/audit/r/${id}`);
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  expect((await request.delete(`/api/public/audit/report/${id}`, { headers: { "x-report-token": ownerToken } })).status()).toBe(404);
});

test("the browser that ran the audit sees Remove, and removing ends the link", async ({ page }) => {
  const { id, ownerToken } = await seed();
  await page.addInitScript(([key, token]) => window.localStorage.setItem(key, token), [`marlo:audit-owner:${id}`, ownerToken]);
  await page.goto(`/audit/r/${id}`);
  await page.getByRole("button", { name: "Remove this report" }).click();
  await expect(page.getByRole("status")).toContainText("This report was removed");
  await page.goto(`/audit/r/${id}`);
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
});
