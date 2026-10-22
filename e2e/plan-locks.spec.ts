import { expect, test, type Page } from "@playwright/test";
import { mockDashboardApi, signIn } from "./support/dashboardMock.ts";

// Plan locks are dark: with enforcement off nothing locked renders; with it on and a
// free plan the Leads finder is replaced by exactly one compact line.

const PLAN_FREE_ENFORCED = {
  plan: "free",
  enforced: true,
  limits: { credits_per_month: 20, daily_leads: 0 },
  features: { leads_finder: false, x_drafts: false, linkedin_drafts: false, reddit_drafts: false, article_writer: false },
};
const PLAN_OFF = { plan: "free", enforced: false, limits: { credits_per_month: 20 }, features: { leads_finder: true } };

async function open(page: Page, plan: unknown) {
  await mockDashboardApi(page);
  await page.route("**/api/plan", (route) => route.fulfill({ json: plan }));
  await page.goto("/dashboard");
  await expect(page.getByTestId("terminal-bar")).toBeVisible();
}

test.beforeEach(async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await signIn(context, baseURL!);
});

test("enforced free plan: Leads shows one locked line and no finder, page does not scroll", async ({ page }) => {
  await open(page, PLAN_FREE_ENFORCED);
  const line = page.getByTestId("locked-line");
  await expect(line).toHaveCount(1);
  await expect(line).toContainText("Leads finder is on the Pro plan");
  await expect(line.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/pricing");
  await expect(page.getByRole("tab", { name: /^With email/ })).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  const noScroll = await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(noScroll).toBe(true);
});

test("enforcement off: dashboard is unchanged and nothing is locked", async ({ page }) => {
  await open(page, PLAN_OFF);
  await expect(page.getByRole("tab", { name: /^With email/ })).toBeVisible();
  await expect(page.getByTestId("locked-line")).toHaveCount(0);
});
