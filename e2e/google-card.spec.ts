import { expect, test, type Page } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// SEO tab "Google data" card: one compact row above the fold instead of a 420px card.
// Connected and healthy -> one-line summary with an expander; needs reconnect -> the shared amber state;
// not connected -> a single Connect Google row. Expanded, the card is unchanged.

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const connectedResources = {
  account: { connectedHere: true, canReuse: false, email: "owner@acme.example.test" },
  integrations: [
    {
      integrationType: "google-search-console",
      integrationId: "i1",
      resources: [{ resourceId: "sc-domain:acme.example.test", resourceName: "sc-domain:acme.example.test", selected: true }],
    },
    {
      integrationType: "google-analytics",
      integrationId: "i2",
      resources: [{ resourceId: "p1", resourceName: "Acme GA4", selected: true }],
    },
  ],
};

async function setup(page: Page, opts: { resources: unknown; google: unknown }) {
  await mockDashboardApi(page);
  await page.route("**/api/project/integrations/google/resources", (r) => r.fulfill(json(opts.resources)));
  await page.route("**/api/project/integrations", (r) => r.fulfill(json({ projectId: "p", integrations: [], google: opts.google })));
  await page.goto("/dashboard");
  const panel = page.locator("div[style*='grid-template-columns'] > *").nth(1);
  await panel.getByRole("tab", { name: "SEO", exact: true }).click();
  return panel;
}

test.describe("Google data card", () => {
  test.use({ viewport: { width: 1536, height: 730 } });
  test.setTimeout(120_000);

  test.beforeEach(async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!);
    await serveLottieWasmLocally(page);
  });

  test("connected and healthy: a one-line summary that expands to the unchanged card", async ({ page }) => {
    const lastSyncAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const panel = await setup(page, { resources: connectedResources, google: { connected: true, needsReconnect: false, reason: null, lastSyncAt } });
    const row = panel.getByTestId("google-summary-row");
    await expect(row).toBeVisible();
    await expect(row).toContainText("sc-domain:acme.example.test");
    await expect(row).toContainText("Acme GA4");
    await expect(row).toContainText("Synced 3 days ago");
    expect((await row.boundingBox())!.height).toBeLessThan(60);
    await expect(panel.getByText("Search Console site", { exact: true })).toHaveCount(0);

    await row.getByRole("button", { name: /Google data/ }).click();
    await expect(panel.getByRole("heading", { name: /Google data for/ })).toBeVisible();
    await expect(panel.getByText("Search Console site", { exact: true })).toBeVisible();
    await expect(panel.getByText("Analytics property", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Hide" }).click();
    await expect(row).toBeVisible();
  });

  test("needs reconnect: the shared amber state with a Reconnect link, still one row", async ({ page }) => {
    const panel = await setup(page, {
      resources: connectedResources,
      google: { connected: true, needsReconnect: true, reason: "Google access was revoked or expired. Reconnect Google.", lastSyncAt: null },
    });
    const row = panel.getByTestId("google-summary-row");
    await expect(row).toContainText("Google access was revoked or expired. Reconnect Google.");
    await expect(row).toContainText("Not synced yet");
    await expect(row.getByRole("link", { name: "Reconnect Google" })).toHaveAttribute("href", "/api/auth/google-analytics/connect?return=dashboard");
    expect((await row.boundingBox())!.height).toBeLessThan(100);
  });

  test("not connected: a single compact Connect Google row, no setup card", async ({ page }) => {
    const panel = await setup(page, {
      resources: { account: { connectedHere: false, canReuse: false, email: null }, integrations: [] },
      google: { connected: false, needsReconnect: false, reason: null, lastSyncAt: null },
    });
    const row = panel.getByTestId("google-connect-row");
    await expect(row.getByRole("link", { name: "Connect Google" })).toHaveAttribute("href", "/api/auth/google-analytics/connect?return=dashboard");
    expect((await row.boundingBox())!.height).toBeLessThan(100);
    await expect(panel.getByText("Add your Google data")).toHaveCount(0);
  });

  test("connected but no site chosen yet keeps the full setup card", async ({ page }) => {
    const unchosen = {
      account: connectedResources.account,
      integrations: [
        {
          integrationType: "google-search-console",
          integrationId: "i1",
          resources: [
            { resourceId: "a", resourceName: "a.example.test", selected: false },
            { resourceId: "b", resourceName: "b.example.test", selected: false },
          ],
        },
      ],
    };
    const panel = await setup(page, { resources: unchosen, google: { connected: true, needsReconnect: false, reason: null, lastSyncAt: null } });
    await expect(panel.getByRole("heading", { name: /Google data for/ })).toBeVisible();
    await expect(panel.getByTestId("google-summary-row")).toHaveCount(0);
  });
});
