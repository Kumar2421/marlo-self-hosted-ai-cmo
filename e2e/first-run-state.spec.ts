import { expect, test, type Page } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";
import { PROJECT_ID, mockSetupApi } from "./support/setupResumeMock.ts";

// First run, live-testing bugs: (1) the findings list was cached empty before the creation-time audit saved
// them and never refetched, so Fix first said "Nothing needs attention" next to an audit reporting issues;
// (2) the "Set up your lead profile" drawer opened by itself over the half-built dashboard.

test.describe.configure({ timeout: 90_000 });
test.use({ viewport: { width: 1536, height: 730 } });

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const AUDIT_DELAY_MS = 1_500;
const finding = (i: number) => ({
  id: `finding_${i}`,
  projectId: PROJECT_ID,
  source: "seo-audit",
  category: i === 0 ? "title" : "meta-description",
  entityType: "page",
  entityId: i === 0 ? "title-missing" : "meta-description-missing",
  url: `https://acme.example.test/page-${i}`,
  severity: i === 0 ? "critical" : "warning",
  evidence: { label: i === 0 ? "Title is missing" : "Meta description is missing" },
  recommendation: "Fix it.",
  status: "new",
  firstSeen: "2026-01-01T00:00:00Z",
  lastSeen: "2026-01-01T00:00:00Z",
  resolvedAt: null,
});

test.beforeEach(async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!);
  await mockDashboardApi(page);
  await serveLottieWasmLocally(page);
});

const analytics = (page: Page) => page.locator("div[style*='grid-template-columns'] > *").nth(1);

test("findings and Fix first update right after the creation audit, and the lead-profile drawer never opens", async ({ page }) => {
  const mock = await mockSetupApi(page, { project: false });
  let auditSavedAt = 0;
  let findingsRequests = 0;
  // Registered after the mocks above, so these win. An unconfirmed profile is the state that used to auto-open the drawer.
  await page.route("**/api/agents/leads/profile", (r) => r.fulfill(json({ profile: null, suggestion: null })));
  await page.route("**/api/agents/seo/audit", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await new Promise((res) => setTimeout(res, AUDIT_DELAY_MS));
    auditSavedAt = Date.now();
    return route.fulfill(json({ meta: { title: "Acme Invoice" } }));
  });
  await page.route("**/api/agents/analytics/findings", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    findingsRequests++;
    return route.fulfill(json({ findings: auditSavedAt ? [0, 1, 2, 3].map(finding) : [] }));
  });

  // The drawer must not be visible at any point, so watch for it from the first frame.
  await page.addInitScript(() => {
    const w = window as unknown as { __drawerSeen: boolean };
    w.__drawerSeen = false;
    new MutationObserver(() => {
      if ((document.body?.innerText ?? "").includes("Set up your lead profile")) w.__drawerSeen = true;
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });

  await page.goto("/dashboard");
  await page.getByPlaceholder("yourproduct.com").fill("acme.example.test");
  await page.getByRole("button", { name: "Get started" }).click();

  const strip = analytics(page).getByTestId("fix-first");
  await expect.poll(() => auditSavedAt, { timeout: 30_000 }).toBeGreaterThan(0);
  // No tab switch, no reload: the strip must reach the 4 findings by itself.
  await expect(strip).toHaveAttribute("data-state", "actions", { timeout: 10_000 });
  const lag = Date.now() - auditSavedAt;
  console.log(`Fix first showed the saved findings ${lag}ms after the audit step finished; findings requests: ${findingsRequests}`);
  expect(lag).toBeLessThan(5_000);
  await expect(strip).not.toContainText("Nothing needs attention");
  // The SEO overview's "Needs attention" tile reads the same list.
  await expect(analytics(page).getByText("Needs attention", { exact: true }).locator("..")).toContainText("4");

  // Let setup finish, then the Leads panel offers the profile inline, with no drawer.
  await expect.poll(() => mock.state()?.finishedAt ?? null, { timeout: 30_000 }).not.toBeNull();
  await expect(page.getByRole("button", { name: "Set up lead profile" })).toBeVisible();
  await expect(page.getByText("Set up your lead profile")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __drawerSeen: boolean }).__drawerSeen)).toBe(false);

  // The button is still the way in.
  await page.getByRole("button", { name: "Set up lead profile" }).click();
  await expect(page.getByText("Set up your lead profile")).toBeVisible();
});
