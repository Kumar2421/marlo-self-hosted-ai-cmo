import { expect, test, type Page } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// SEO tab order. On a phone the audit result leads and the Google connection card follows it,
// so the first screen shows what the audit found. On wider screens the Google card stays on top.
// Also: the connected Google account email is shortened, and phone tap targets are at least 44px.

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const resources = {
  account: { connectedHere: true, canReuse: false, email: "owner.person@acme.example.test" },
  integrations: [
    {
      integrationType: "google-search-console",
      integrationId: "i1",
      resources: [{ resourceId: "sc-domain:acme.example.test", resourceName: "sc-domain:acme.example.test", selected: true }],
    },
  ],
};

async function open(page: Page) {
  await mockDashboardApi(page);
  await page.route("**/api/project/integrations/google/resources", (r) => r.fulfill(json(resources)));
  await page.route("**/api/project/integrations", (r) =>
    r.fulfill(json({ projectId: "p", integrations: [], google: { connected: true, needsReconnect: false, reason: null, lastSyncAt: null } })),
  );
  await page.goto("/dashboard");
}

test.describe("SEO tab order and phone polish", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!);
    await serveLottieWasmLocally(page);
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const st = document.createElement("style");
        st.textContent = "nextjs-portal{display:none!important}";
        document.head.appendChild(st);
      });
    });
  });

  test("phone: the audit overview comes before the Google card", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("tab", { name: "Analytics", exact: true }).click();
    await page.waitForLoadState("networkidle");
    await page.locator("#analytics-tab-SEO").click();
    const overview = page.getByRole("heading", { name: "Audit overview" });
    const google = page.getByTestId("google-summary-row").or(page.locator("#google-data-card")).first();
    await expect(overview).toBeVisible();
    await expect(google).toBeVisible();
    const o = (await overview.boundingBox())!;
    const g = (await google.boundingBox())!;
    expect(o.y).toBeLessThan(g.y);
  });

  test("desktop: the Google card stays above the audit overview", async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 730 });
    await open(page);
    const panel = page.locator("div[style*='grid-template-columns'] > *").nth(1);
    await panel.getByRole("tab", { name: "SEO", exact: true }).click();
    const overview = panel.getByRole("heading", { name: "Audit overview" });
    const google = panel.getByTestId("google-summary-row").or(panel.locator("#google-data-card")).first();
    await expect(overview).toBeVisible();
    await expect(google).toBeVisible();
    const o = (await overview.boundingBox())!;
    const g = (await google.boundingBox())!;
    expect(g.y).toBeLessThan(o.y);
  });

  test("the connected Google email is shortened, never shown in full", async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 730 });
    await open(page);
    const panel = page.locator("div[style*='grid-template-columns'] > *").nth(1);
    await panel.getByRole("tab", { name: "SEO", exact: true }).click();
    const row = panel.getByTestId("google-summary-row").or(panel.locator("#google-data-card")).first();
    await row.getByRole("button", { name: /Google data/ }).click().catch(() => {});
    await expect(panel.getByText("owner.person@acme.example.test")).toHaveCount(0);
    await expect(panel.getByText("ow…@acme.example.test")).toBeVisible();
  });

  test("phone: header buttons and key actions are at least 44px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("tab", { name: "Analytics", exact: true }).click();
    const targets = [
      page.getByRole("button", { name: "Social drafts" }),
      page.getByRole("button", { name: /^Notifications/ }),
      page.getByRole("button", { name: "Status Log" }),
    ];
    for (const t of targets) {
      const box = (await t.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(43.5);
      expect(box.width).toBeGreaterThanOrEqual(43.5);
    }
    const wide = await page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1 && getComputedStyle(e).position !== "fixed"; })
        .slice(0, 5)
        .map((e) => `${e.tagName}.${String((e as HTMLElement).className).slice(0, 60)} right=${Math.round(e.getBoundingClientRect().right)}`),
    );
    expect(wide).toEqual([]);
  });
});
