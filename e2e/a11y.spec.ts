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

const TRAFFIC = {
  range: { startDate: "2026-01-01", endDate: "2026-01-28" },
  site: "sc-domain:acme.example.test",
  propertyName: null,
  byDate: [
    { date: "2026-01-01", clicks: 12, impressions: 340, ctr: 0.035, position: 8.2 },
    { date: "2026-01-02", clicks: 15, impressions: 360, ctr: 0.041, position: 7.9 },
  ],
  topQueries: [{ query: "invoice software", clicks: 20, impressions: 500, ctr: 0.04, position: 6.1 }],
  opportunities: [],
  search: null,
  totals: { clicks: 27, impressions: 700, ctr: 0.038, position: 8 },
  status: "ok",
  reason: null,
  needs_reconnect: false,
  gscError: null,
  ga4: null,
  ga4Error: null,
};

const WIDTHS = [
  { name: "1280", width: 1280, height: 800 },
  { name: "390", width: 390, height: 844 },
];

async function openDashboard(page: Page) {
  await page.goto("/dashboard");
  // Phone shows a bottom tab bar, wider screens show the panels side by side; both have this nav or tablist.
  await page.locator('[role="tablist"][aria-label="Analytics sections"], nav[aria-label="Dashboard sections"]').first().waitFor();
  await page.waitForLoadState("networkidle");
}

test.describe("signed in", () => {
  test.beforeEach(async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!);
    await mockDashboardApi(page);
    await serveLottieWasmLocally(page);
    // The Next dev-only indicator badge sits over the bottom-left tab and eats clicks.
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const st = document.createElement("style");
        st.textContent = "nextjs-portal{display:none!important}";
        document.head.appendChild(st);
      });
    });
  });

  for (const w of WIDTHS) {
    const phone = w.width < 768;
    test.describe(`dashboard ${w.name}`, () => {
      test.use({ viewport: { width: w.width, height: w.height } });

      if (!phone) {
        test("default view", async ({ page }, testInfo) => {
          await openDashboard(page);
          await expectNoNewViolations(page, `desktop-${w.name}`, testInfo);
        });

        for (const tab of ANALYTICS_TABS) {
          test(`analytics tab ${tab}`, async ({ page }, testInfo) => {
            if (tab === "Traffic") {
              // dashboardMock has no traffic endpoint, and the panel crashes on the empty fallback body.
              await page.route("**/api/agents/analytics/traffic", (r) =>
                r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TRAFFIC) }),
              );
            }
            await openDashboard(page);
            await page.locator(`#analytics-tab-${tab}`).click();
            await page.waitForLoadState("networkidle");
            await expectNoNewViolations(page, `desktop-${w.name}-analytics-${tab}`, testInfo);
          });
        }

        test("header log overlay open", async ({ page }, testInfo) => {
          await openDashboard(page);
          await makeActivity(page);
          await statusToggle(page).click();
          await page.getByRole("log").waitFor();
          await expectNoNewViolations(page, `desktop-${w.name}-log-open`, testInfo);
        });
      } else {
        for (const t of MOBILE_TABS) {
          test(`tab ${t.key}`, async ({ page }, testInfo) => {
            await openDashboard(page);
            await page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("tab", { name: t.button, exact: true }).click();
            await page.waitForLoadState("networkidle");
            await expectNoNewViolations(page, `mobile-${t.key}`, testInfo);
          });
        }
      }
    });
  }

  for (const w of WIDTHS) {
    test.describe(`settings ${w.name}`, () => {
      test.use({ viewport: { width: w.width, height: w.height } });

      for (const slug of SETTINGS_PAGES) {
        test(`/settings/${slug}`, async ({ page }, testInfo) => {
          await page.goto(`/settings/${slug}`);
          await page.waitForLoadState("networkidle");
          await expectNoNewViolations(page, `settings-${w.name}-${slug}`, testInfo);
        });
      }
    });
  }
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
