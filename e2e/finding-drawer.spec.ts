import { expect, test } from "@playwright/test";
import { SEO_AUDIT, mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// Finding drawer: the Mode / Score / Device / Audit Id debug rows sit behind a collapsed "Details"
// disclosure, and the SEO tab's "Audit overview" shows one tile when the three counts agree.

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const lighthouseFinding = {
  id: "finding_lh",
  projectId: "11111111-1111-4111-8111-111111111111",
  source: "seo-audit",
  category: "accessibility",
  entityType: "page",
  entityId: "lighthouse-button-name",
  url: "https://acme.example.test/",
  severity: "warning",
  evidence: { label: "Buttons do not have an accessible name", auditId: "button-name", device: "mobile", mode: "diagnostic", score: null, displayValue: "3 elements" },
  recommendation: "Give every button a text label or an aria-label.",
  status: "new",
  firstSeen: "2026-01-01T00:00:00Z",
  lastSeen: "2026-01-01T00:00:00Z",
  resolvedAt: null,
};

test.describe("finding drawer and audit overview", () => {
  test.use({ viewport: { width: 1536, height: 730 } });
  test.setTimeout(120_000);

  test.beforeEach(async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!);
    await serveLottieWasmLocally(page);
    await mockDashboardApi(page);
  });

  test("the drawer shows the evidence, with run details collapsed under Details", async ({ page }) => {
    await page.route("**/api/agents/analytics/findings", (r) => r.fulfill(json({ findings: [lighthouseFinding] })));
    await page.goto("/dashboard");
    await page.getByTestId("fix-first").getByRole("button").first().click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toContainText("Why this was flagged");
    await expect(drawer).toContainText("3 elements");

    const details = drawer.getByTestId("finding-details");
    await expect(details).toBeVisible();
    // Collapsed by default: the debug values are not visible, and not shown as top-level rows.
    await expect(drawer.getByText("Audit Id", { exact: true })).toBeHidden();
    await expect(drawer.getByText("button-name", { exact: true })).toBeHidden();
    await expect(drawer.getByText("Mode", { exact: true })).toBeHidden();

    await details.getByText("Details", { exact: true }).click();
    await expect(drawer.getByText("Audit Id", { exact: true })).toBeVisible();
    await expect(drawer.getByText("button-name", { exact: true })).toBeVisible();
    await expect(drawer.getByText("Not measured")).toBeVisible();
  });

  test("a finding without run details has no Details disclosure", async ({ page }) => {
    const plain = { ...lighthouseFinding, id: "finding_plain", entityId: "meta-description-missing", category: "meta-description", evidence: { label: "No meta description", length: 0 } };
    await page.route("**/api/agents/analytics/findings", (r) => r.fulfill(json({ findings: [plain] })));
    await page.goto("/dashboard");
    await page.getByTestId("fix-first").getByRole("button").first().click();
    await expect(page.getByRole("dialog")).toContainText("Why this was flagged");
    await expect(page.getByTestId("finding-details")).toHaveCount(0);
  });

  test("equal counts collapse into one overview tile; different counts keep three", async ({ page }) => {
    await page.route("**/api/agents/analytics/findings", (r) => r.fulfill(json({ findings: [] })));
    await page.route("**/api/agents/seo/audit?*", (r) => r.fulfill(json({ payload: { ...SEO_AUDIT, issues: [] } })));
    await page.goto("/dashboard");
    const panel = page.locator("div[style*='grid-template-columns'] > *").nth(1);
    await expect(panel.getByTestId("overview-tile-merged")).toBeVisible();
    await expect(panel.getByTestId("overview-tile-lighthouse")).toHaveCount(0);

    await page.route("**/api/agents/seo/audit?*", (r) => r.fulfill(json({ payload: SEO_AUDIT })));
    await page.reload();
    await expect(panel.getByTestId("overview-tile-lighthouse")).toBeVisible();
    await expect(panel.getByTestId("overview-tile-merged")).toHaveCount(0);
  });
});
