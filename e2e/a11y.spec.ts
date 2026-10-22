import { makeActivity, statusToggle } from "./support/headerActivity.ts";
import { test, type Page } from "@playwright/test";
import { expectNoNewViolations } from "./support/a11y.ts";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// Accessibility gate: axe-core on the mocked dashboard (desktop and the mobile tab
// shell), the settings pages and the login page. Serious/critical violations fail
// the test unless they are listed (with a reason) in support/a11yAllowlist.ts.

// Dev-server compiles and axe on a dense page can take a while on a cold run.
test.describe.configure({ timeout: 60_000 });

const ANALYTICS_TABS = ["SEO", "Links", "Technical", "GEO", "Traffic", "Findings"];
const MOBILE_TABS = [
  { key: "Context", button: "Context" },
  { key: "Analytics", button: "Analytics" },
  { key: "Leads", button: "Leads" },
  { key: "Chat", button: "Chat" },
];
const SETTINGS_PAGES = [
  "websites",
  "credits",
  "llm-providers",
  "api-credentials",
  "agents",
  "integrations",
  "team",
  "personalization",
  "account",
  "notifications",
];

async function openDashboard(page: Page) {
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
}

test.describe("signed in", () => {
  test.beforeEach(async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!);
    await mockDashboardApi(page);
    await serveLottieWasmLocally(page);
  });

  test.describe("dashboard desktop 1536x730", () => {
    test.use({ viewport: { width: 1536, height: 730 } });

    test("default view", async ({ page }, testInfo) => {
      await openDashboard(page);
      await page.getByText("Very Long Lead Name Number 0").first().waitFor();
      await expectNoNewViolations(page, "desktop", testInfo);
    });

    for (const tab of ANALYTICS_TABS) {
      test(`analytics tab ${tab}`, async ({ page }, testInfo) => {
        await openDashboard(page);
        const panel = page.locator("div[style*='grid-template-columns'] > *").nth(1);
        await panel.getByRole("button", { name: tab, exact: true }).click();
        await page.waitForLoadState("networkidle");
        await expectNoNewViolations(page, `desktop-analytics-${tab}`, testInfo);
      });
    }

    test("header log overlay open", async ({ page }, testInfo) => {
      await openDashboard(page);
      await makeActivity(page);
      await statusToggle(page).click();
      await page.getByRole("log").waitFor();
      await expectNoNewViolations(page, "desktop-log-open", testInfo);
    });
  });

  test.describe("dashboard mobile 390x844", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    for (const t of MOBILE_TABS) {
      test(`tab ${t.key}`, async ({ page }, testInfo) => {
        await openDashboard(page);
        await page.getByRole("tab", { name: t.button, exact: true }).click();
        await page.waitForLoadState("networkidle");
        await expectNoNewViolations(page, `mobile-${t.key}`, testInfo);
      });
    }
  });

  test.describe("settings", () => {
    test.use({ viewport: { width: 1536, height: 730 } });

    for (const slug of SETTINGS_PAGES) {
      test(`/settings/${slug}`, async ({ page }, testInfo) => {
        await page.goto(`/settings/${slug}`);
        await page.waitForLoadState("networkidle");
        await expectNoNewViolations(page, `settings-${slug}`, testInfo);
      });
    }
  });
});

test.describe("login (signed out)", () => {
  test.use({ viewport: { width: 1536, height: 730 } });

  test.beforeEach(async ({ page }) => {
    await serveLottieWasmLocally(page);
  });

  for (const [label, path] of [
    ["login-signin", "/login"],
    ["login-signup", "/login?mode=signup"],
  ]) {
    test(label, async ({ page }, testInfo) => {
      await page.goto(path);
      await page.getByLabel("Email", { exact: true }).waitFor();
      await expectNoNewViolations(page, label, testInfo);
    });
  }
});
