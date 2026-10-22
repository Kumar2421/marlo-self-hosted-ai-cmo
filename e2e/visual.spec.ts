import { expect, test, type Page } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// Visual regression for the mocked dashboard. Baselines live in e2e/__screenshots__ (see
// snapshotPathTemplate in playwright.config.ts) and are generated on Chromium/Windows.
// Off by default in CI until baselines are regenerated on ubuntu: E2E_VISUAL=1 turns it
// on there, E2E_VISUAL=0 turns it off anywhere. See e2e/README.md.
const visualEnabled = process.env.E2E_VISUAL ? process.env.E2E_VISUAL === "1" : !process.env.CI;

test.skip(!visualEnabled, "visual snapshots are off (E2E_VISUAL=0, or CI without E2E_VISUAL=1)");

// A fixed clock keeps relative times ("3 days ago") and dates identical between runs.
const FIXED_NOW = new Date("2026-01-02T12:00:00Z");

async function settle(page: Page) {
  // The Next dev overlay (issue badge, logo) is not part of the product.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  // next/font downloads DM Sans from Google when the dev server compiles. Offline it silently
  // falls back to a system font and every pixel moves; say so instead of reporting a 3% diff.
  const webFontLoaded = await page.evaluate(() =>
    [...document.fonts].some((f) => /DM[ _]Sans/.test(f.family) && !f.family.includes("Fallback") && f.status === "loaded"),
  );
  expect(webFontLoaded, "DM Sans did not load (Google Fonts unreachable from the dev server?). Snapshots need the real font.").toBe(true);
  await page.waitForTimeout(600);
}

/** Parts that change from run to run: live timestamps. Add data-volatile to anything else that does. */
function volatile(page: Page) {
  return [page.locator("time"), page.locator("[data-volatile]")];
}

test.beforeEach(async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!);
  await mockDashboardApi(page);
  await serveLottieWasmLocally(page);
  await page.clock.setFixedTime(FIXED_NOW);
});

test.describe("desktop 1536x730", () => {
  test.use({ viewport: { width: 1536, height: 730 } });

  test("dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("Very Long Lead Name Number 0").first()).toBeVisible({ timeout: 15_000 });
    await settle(page);
    await expect(page).toHaveScreenshot("dashboard-desktop.png", { mask: volatile(page) });
  });
});

test.describe("mobile 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("dashboard tab shell", async ({ page }) => {
    await page.goto("/dashboard?tab=context");
    await expect(page.getByRole("button", { name: "Context", exact: true }).last()).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot("dashboard-mobile-context.png", { mask: volatile(page) });

    await page.getByRole("button", { name: "Leads", exact: true }).last().click();
    await expect(page.getByText("Very Long Lead Name Number 0").first()).toBeVisible({ timeout: 15_000 });
    await settle(page);
    await expect(page).toHaveScreenshot("dashboard-mobile-leads.png", { mask: volatile(page) });
  });
});
