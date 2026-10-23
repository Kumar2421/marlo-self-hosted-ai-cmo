import { expect, test, type Page } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// "Fix first" strip at the top of the Analytics panel: top actions from the existing ranking, honest
// empty/error states, Findings as the default tab when something is open, and a remembered tab choice.
// Server auth is satisfied by the fake Supabase server (see support/fakeSupabaseServer.ts).

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const finding = (i: number, over: Record<string, unknown> = {}) => ({
  id: `finding_${i}`,
  projectId: "11111111-1111-4111-8111-111111111111",
  source: "seo-audit",
  category: "meta-description",
  entityType: "page",
  entityId: "meta-description-missing",
  url: `https://acme.example.test/page-${i}`,
  severity: i === 0 ? "critical" : "warning",
  evidence: { label: "Meta description is missing" },
  recommendation: "Add a meta description between 120 and 160 characters.",
  status: "new",
  firstSeen: "2026-01-01T00:00:00Z",
  lastSeen: "2026-01-01T00:00:00Z",
  resolvedAt: null,
  ...over,
});

const analytics = (page: Page) => page.locator("div[style*='grid-template-columns'] > *").nth(1);

test.describe("Fix first strip", () => {
  test.use({ viewport: { width: 1536, height: 730 } });
  test.setTimeout(120_000); // first request compiles the dashboard in the dev server

  test.beforeEach(async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!);
    await serveLottieWasmLocally(page);
    await mockDashboardApi(page);
  });

  test("groups the same issue into one row with a count, defaults to Findings, and the button opens the drawer", async ({ page }) => {
    await page.route("**/api/agents/analytics/findings", (r) => r.fulfill(json({ findings: [0, 1, 2, 3, 4].map((i) => finding(i)) })));
    await page.goto("/dashboard");
    const panel = analytics(page);
    const strip = panel.getByTestId("fix-first");
    await expect(strip).toHaveAttribute("data-state", "actions");
    await expect(strip.getByRole("listitem")).toHaveCount(1);
    await expect(strip).toContainText("(5 pages)");
    await expect(strip).not.toContainText("Fix:");
    await expect(strip.getByRole("button", { name: /^(Open|Fix this)$/ })).toBeVisible();
    await expect(panel.getByRole("tab", { name: "Findings", exact: true })).toHaveAttribute("aria-selected", "true");

    // The strip sits between the header and the tab strip, and the page still does not scroll.
    const order = await page.evaluate(() => {
      const strip = document.querySelector('[data-testid="fix-first"]')!.getBoundingClientRect();
      const tabs = document.querySelector('[role="tablist"][aria-label="Analytics sections"]')!.getBoundingClientRect();
      return { stripAboveTabs: strip.bottom <= tabs.top + 1, noPageScroll: document.documentElement.scrollHeight <= window.innerHeight };
    });
    expect(order).toEqual({ stripAboveTabs: true, noPageScroll: true });

    await strip.getByRole("button", { name: /^(Open|Fix this)$/ }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Meta description is missing");
  });

  test("shows at most two rows and a quiet link for the rest", async ({ page }) => {
    const kinds = ["meta-description-missing", "meta-title-missing", "canonical-missing"];
    await page.route("**/api/agents/analytics/findings", (r) =>
      r.fulfill(json({ findings: kinds.map((k, i) => finding(i, { entityId: k, recommendation: `Do thing ${i}. More.`, evidence: { label: `Thing ${i}` } })) })),
    );
    await page.goto("/dashboard");
    const strip = analytics(page).getByTestId("fix-first");
    await expect(strip.getByRole("listitem")).toHaveCount(2);
    await strip.getByRole("button", { name: "1 more in Findings" }).click();
    await expect(analytics(page).getByRole("tab", { name: "Findings", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  test("with nothing open it says so and keeps SEO as the default tab", async ({ page }) => {
    await page.route("**/api/agents/analytics/findings", (r) => r.fulfill(json({ findings: [] })));
    await page.goto("/dashboard");
    const panel = analytics(page);
    await expect(panel.getByTestId("fix-first")).toContainText("Nothing needs attention.");
    await expect(panel.getByRole("tab", { name: "SEO", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  test("with no audit it says so and offers to run one", async ({ page }) => {
    await page.route("**/api/agents/analytics/findings", (r) => r.fulfill(json({ findings: [] })));
    await page.route("**/api/agents/seo/audit?*", (r) => r.fulfill(json({ payload: null })));
    await page.goto("/dashboard");
    const strip = analytics(page).getByTestId("fix-first");
    await expect(strip).toContainText("No audit yet.");
    await expect(strip.getByRole("button", { name: "Run audit" })).toBeVisible();
  });

  test("a failed load says so, and Retry recovers", async ({ page }) => {
    let fail = true;
    await page.route("**/api/agents/analytics/findings", (r) =>
      fail ? r.fulfill(json({ error: "boom" }, 422)) : r.fulfill(json({ findings: [finding(0)] })),
    );
    await page.goto("/dashboard");
    const strip = analytics(page).getByTestId("fix-first");
    await expect(strip).toContainText("Couldn't load your findings.");
    await expect(strip).not.toContainText("Nothing needs attention");
    fail = false;
    await strip.getByRole("button", { name: "Retry" }).click();
    await expect(strip).toHaveAttribute("data-state", "actions");
  });

  test("shows a skeleton line while loading, without shifting the tab strip when it resolves", async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/agents/analytics/findings", async (r) => {
      await gate;
      await r.fulfill(json({ findings: [finding(0)] }));
    });
    await page.goto("/dashboard");
    const panel = analytics(page);
    const strip = panel.getByTestId("fix-first");
    await expect(strip).toHaveAttribute("data-state", "loading");
    const tabs = panel.getByRole("tablist", { name: "Analytics sections" });
    const before = (await tabs.boundingBox())!.y;
    release();
    await expect(strip).toHaveAttribute("data-state", "actions");
    const after = (await tabs.boundingBox())!.y;
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  });

  test("a tab the user chose is remembered over the Findings default", async ({ page }) => {
    await page.route("**/api/agents/analytics/findings", (r) => r.fulfill(json({ findings: [finding(0)] })));
    await page.goto("/dashboard");
    const panel = analytics(page);
    await expect(panel.getByRole("tab", { name: "Findings", exact: true })).toHaveAttribute("aria-selected", "true");
    await panel.getByRole("tab", { name: "Links", exact: true }).click();
    await page.reload();
    await expect(analytics(page).getByRole("tab", { name: "Links", exact: true })).toHaveAttribute("aria-selected", "true");
  });
  test("from another tab, ONE click on the strip button opens that finding's drawer", async ({ page }) => {
    await page.route("**/api/agents/analytics/findings", (r) => r.fulfill(json({ findings: [0, 1].map((i) => finding(i, { entityId: i ? "canonical-missing" : "meta-description-missing", evidence: { label: `Thing ${i}` } })) })));
    await page.addInitScript(() => window.localStorage.setItem("marlo:analytics-tab", "Technical"));
    await page.goto("/dashboard");
    const panel = analytics(page);
    await expect(panel.getByRole("tab", { name: "Technical", exact: true })).toHaveAttribute("aria-selected", "true");
    await panel.getByTestId("fix-first").getByRole("button", { name: /^(Open|Fix this)$/ }).first().click();
    await expect(panel.getByRole("tab", { name: "Findings", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("dialog")).toContainText("Thing 0");
  });
});
