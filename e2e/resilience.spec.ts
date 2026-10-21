import { expect, test, type Page } from "@playwright/test";
import { mockDashboardApi, signIn } from "./support/dashboardMock.ts";

// One bad section must never take the dashboard down: partial/error API shapes show an
// empty or error state, and a real render crash is contained by an error boundary.

test.use({ viewport: { width: 1536, height: 800 } });

const pageErrors = new WeakMap<Page, string[]>();
const consoleErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page, context, baseURL }) => {
  const errors: string[] = [];
  const logged: string[] = [];
  pageErrors.set(page, errors);
  consoleErrors.set(page, logged);
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") logged.push(m.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const st = document.createElement("style");
      st.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(st);
    });
  });
  await signIn(context, baseURL!);
  await mockDashboardApi(page);
});

async function open(page: Page) {
  await page.goto("/dashboard");
  await expect(page.getByRole("tablist", { name: "Analytics sections" })).toBeVisible();
  await page.waitForLoadState("networkidle");
}

const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });

/** The header and the other three panels are still there and usable. */
async function expectDashboardIntact(page: Page) {
  await expect(page.getByTestId("terminal-bar")).toBeVisible();
  await expect(page.getByText("Context", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("mlforge studio")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Select Very Long Lead Name Number 1 With/ })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Analytics sections" })).toBeVisible();
}

/** The other Analytics tabs still switch and render. */
async function expectOtherTabsWork(page: Page) {
  await tab(page, "Technical").click();
  await expect(tab(page, "Technical")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("error-boundary-card")).toHaveCount(0);
  await tab(page, "SEO").click();
  await expect(tab(page, "SEO")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("error-boundary-card")).toHaveCount(0);
  await tab(page, "Links").click();
  await expect(tab(page, "Links")).toHaveAttribute("aria-selected", "true");
}

test("GEO endpoints answering {} show an empty state, not a blank page", async ({ page }) => {
  await open(page);
  await tab(page, "GEO").click();
  await expect(page.getByText("No GEO checks yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run now" })).toBeVisible();
  await expectDashboardIntact(page);
  await expectOtherTabsWork(page);
  expect(pageErrors.get(page)).toHaveLength(0);
});

test("GEO endpoints answering 500 show an error with Retry, then recover", async ({ page }) => {
  await open(page);
  let failing = true;
  await page.route("**/api/geo/**", (route) =>
    failing
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "GEO is down" }) })
      : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) }),
  );
  await tab(page, "GEO").click();
  const alerts = page.getByRole("alert").filter({ hasText: "GEO is down" });
  await expect(alerts.first()).toBeVisible();
  await expect(alerts.first().getByRole("button", { name: "Retry" })).toBeVisible();
  await expectDashboardIntact(page);

  failing = false;
  await alerts.first().getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("No GEO checks yet")).toBeVisible();
  await expectOtherTabsWork(page);
  expect(pageErrors.get(page)).toHaveLength(0);
});

test("GEO with partial data (checks missing, null bodies) does not crash", async ({ page }) => {
  await page.route("**/api/geo/readiness", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ score: 40, domain: "acme.example.test" }) }));
  await page.route("**/api/geo/referral", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "null" }));
  await page.route("**/api/geo/overview", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ prompts: [{ prompt: "best invoicing tool" }] }) }));
  await open(page);
  await tab(page, "GEO").click();
  await expect(page.getByText("best invoicing tool")).toBeVisible();
  await expect(page.getByText("We could not read Google Analytics right now.")).toBeVisible();
  await expectDashboardIntact(page);
  expect(pageErrors.get(page)).toHaveLength(0);
});

test("a render crash in one Analytics tab is contained to that tab", async ({ page }) => {
  // A null entry in the findings list is a shape the Findings tab does not guard against.
  await page.route("**/api/agents/analytics/findings", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ findings: [null] }) }));
  await open(page);
  await tab(page, "Findings").click();
  const card = page.getByTestId("error-boundary-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("This section hit a problem");
  await expect(card.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(card.locator("details")).toHaveCount(1);
  // The tab bar, the header and the other three panels stay.
  await expectDashboardIntact(page);
  // Other tabs work, and returning to Findings re-renders the boundary.
  await expectOtherTabsWork(page);
  await tab(page, "Findings").click();
  await expect(page.getByTestId("error-boundary-card")).toBeVisible();
  // Logged once, never swallowed.
  const logs = consoleErrors.get(page)!.filter((t) => t.includes("[ErrorBoundary]"));
  expect(logs.length).toBeGreaterThanOrEqual(1);
  expect(pageErrors.get(page)).toHaveLength(0);
});

test("no 'Query data cannot be undefined' console errors on load", async ({ page }) => {
  await open(page);
  await tab(page, "GEO").click();
  await tab(page, "Links").click();
  await tab(page, "Findings").click();
  await page.waitForLoadState("networkidle");
  const bad = consoleErrors.get(page)!.filter((t) => /cannot be undefined/i.test(t));
  expect(bad).toEqual([]);
  expect(pageErrors.get(page)).toHaveLength(0);
});

test("drafts endpoints answering {} do not log undefined query data", async ({ page }) => {
  await page.route(/\/api\/agents\/(x|linkedin|reddit)\/drafts/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route("**/api/agents/social/daily-settings", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await open(page);
  const bad = consoleErrors.get(page)!.filter((t) => /cannot be undefined/i.test(t));
  expect(bad).toEqual([]);
  expect(pageErrors.get(page)).toHaveLength(0);
});
