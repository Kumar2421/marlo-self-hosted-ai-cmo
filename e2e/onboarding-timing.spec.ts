import { expect, test, type Page } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// First-run timing: a brand-new account must see the onboarding dialog as soon as the project list
// (GET /api/project) says there is no project, not after the slower GET /api/project/data fails, and
// the empty "No project yet" panels must never show before it.

test.use({ viewport: { width: 1536, height: 730 } });

const TITLE = "Let's grow your business";
const DATA_DELAY_MS = 3_000;
const LIST_DELAY_MS = 800;

test.beforeEach(async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!);
  await serveLottieWasmLocally(page);
});

/** Records (Date.now()) when the dialog title and the empty-state text first appear in the DOM. */
async function watchFirstAppearance(page: Page) {
  await page.addInitScript((title) => {
    const w = window as unknown as { __seen: { dialog?: number; empty?: number } };
    w.__seen = {};
    const check = () => {
      const t = document.body?.innerText ?? "";
      if (w.__seen.dialog === undefined && t.includes(title)) w.__seen.dialog = Date.now();
      if (w.__seen.empty === undefined && t.includes("No project yet")) w.__seen.empty = Date.now();
    };
    new MutationObserver(check).observe(document, { childList: true, subtree: true, characterData: true });
  }, TITLE);
  return () => page.evaluate(() => (window as unknown as { __seen: { dialog?: number; empty?: number } }).__seen);
}

test("new user: dialog shows right after the project list resolves, never behind 'No project yet'", async ({ page }) => {
  await mockDashboardApi(page); // populated fallbacks for everything else
  let listResolvedAt = 0;
  let dataRequests = 0;
  // Registered after mockDashboardApi, so these win.
  await page.route("**/api/project", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await new Promise((r) => setTimeout(r, LIST_DELAY_MS));
    listResolvedAt = Date.now();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ project: null, projects: [] }) });
  });
  await page.route("**/api/project/data*", async (route) => {
    dataRequests++;
    await new Promise((r) => setTimeout(r, DATA_DELAY_MS));
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "No active project" }) });
  });
  const seen = await watchFirstAppearance(page);

  await page.goto("/dashboard");
  await expect(page.getByText(TITLE)).toBeVisible({ timeout: 10_000 });
  const s = await seen();

  const afterList = s.dialog! - listResolvedAt;
  console.log(`dialog appeared ${afterList}ms after /api/project resolved (data request delay ${DATA_DELAY_MS}ms)`);
  expect(afterList).toBeLessThan(300);
  expect(afterList).toBeLessThan(DATA_DELAY_MS / 2);
  if (s.empty !== undefined) expect(s.empty).toBeGreaterThanOrEqual(s.dialog!);
  expect(dataRequests, "no project-scoped data request for a user with no project").toBe(0);
});

test("a user with a project never sees the onboarding dialog", async ({ page }) => {
  await mockDashboardApi(page);
  const seen = await watchFirstAppearance(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByText("Acme Invoice").first()).toBeVisible();
  await page.waitForTimeout(1_000);
  expect((await seen()).dialog).toBeUndefined();
});

test("a failing project list (500) never shows the onboarding dialog", async ({ page }) => {
  await mockDashboardApi(page);
  await page.route("**/api/project", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) })
      : route.fallback(),
  );
  const seen = await watchFirstAppearance(page);
  await page.goto("/dashboard");
  await page.waitForTimeout(2_000);
  expect((await seen()).dialog).toBeUndefined();
});
