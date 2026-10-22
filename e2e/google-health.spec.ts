import { expect, test, type Page, type Route } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// A revoked Google token: the server answers 200 with status "error", needs_reconnect and totals: null.
// The dashboard must say so (and offer Reconnect) instead of crashing or showing a green check.

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const REVOKED_TRAFFIC = {
  range: { startDate: "2026-09-21", endDate: "2026-10-18" },
  site: "sc-domain:example.com",
  propertyName: null,
  status: "error",
  reason: "Google didn't accept the saved connection. Reconnect Google in Settings to see this data.",
  needs_reconnect: true,
  byDate: [],
  topQueries: [],
  opportunities: [],
  search: null,
  totals: null,
  gscError: "Token has been expired or revoked",
  ga4: null,
  ga4Error: null,
};

async function mockRevokedGoogle(page: Page, counter: { traffic: number }) {
  await mockDashboardApi(page);
  // Registered after the generic mock, so it wins for these paths.
  await page.route("**/api/agents/analytics/traffic", (route) => {
    counter.traffic += 1;
    return json(route, REVOKED_TRAFFIC);
  });
  await page.route("**/api/project/integrations", (route) =>
    json(route, { projectId: "p1", integrations: [], google: { connected: true, needsReconnect: true, reason: "Google access was revoked or expired. Reconnect Google.", lastSyncAt: null } }),
  );
}

test.describe("revoked Google connection", () => {
  test.use({ viewport: { width: 1536, height: 730 } });
  test.setTimeout(120_000); // first request compiles the dashboard in the dev server

  test.beforeEach(async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!);
    await serveLottieWasmLocally(page);
  });

  test("Traffic tab explains the reconnect, fetches once, and logs no green success", async ({ page }) => {
    const counter = { traffic: 0 };
    await mockRevokedGoogle(page, counter);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    const panel = page.locator("div[style*='grid-template-columns'] > *").nth(1);
    await panel.getByRole("tab", { name: "Traffic", exact: true }).click();

    await expect(panel.getByText("Google connection needs to be reconnected.")).toBeVisible();
    await expect(panel.getByRole("link", { name: "Reconnect Google" })).toHaveAttribute("href", "/api/auth/google-analytics/connect?return=dashboard");
    await expect(page.getByText(/Cannot read properties/)).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(counter.traffic).toBe(1);
  });

  test("GEO referral card says reconnect, not 'Connect Google Analytics in Settings'", async ({ page }) => {
    await mockRevokedGoogle(page, { traffic: 0 });
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    const panel = page.locator("div[style*='grid-template-columns'] > *").nth(1);
    await panel.getByRole("tab", { name: "GEO", exact: true }).click();

    await expect(panel.getByText("Google connection needs to be reconnected.")).toBeVisible();
    await expect(panel.getByText("Connect Google Analytics in Settings")).toHaveCount(0);
  });
});
