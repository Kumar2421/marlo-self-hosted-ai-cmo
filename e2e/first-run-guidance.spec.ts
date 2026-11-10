import { expect, test } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// A first-time user sees one clear next step in the Leads panel, and it changes as they move through the flow.
// Every API is mocked.

test.describe.configure({ timeout: 60_000 });
test.use({ viewport: { width: 1536, height: 900 } });

const PROFILE = (roles: string[]) => ({
  version: 1, roles, industries: ["dental clinics"], sizes: [], locations: ["Chennai"], problem: "Missed calls", exclude: [], webRelated: false, confirmedAt: "2026-11-05T00:00:00Z",
});

const good = { project_id: "p1", title: "", location: "", email_verified: 0, query: "q", created_at: "2026-11-06T00:00:00Z", company: "", lead_type: "company", website: "https://alpha.test/", source_url: "https://alpha.test/contact", fit_reason: "Company site mentions dental." };

test.beforeEach(async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!);
  await mockDashboardApi(page);
  await serveLottieWasmLocally(page);
});

async function mock(page: import("@playwright/test").Page, opts: { roles: string[]; leads: unknown[] }) {
  await page.route("**/api/agents/leads/profile", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: PROFILE(opts.roles), suggestion: null, offer: null }) }),
  );
  await page.route("**/api/agents/leads/search", (route) =>
    route.request().method() === "GET" ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: opts.leads }) }) : route.fallback(),
  );
}

test("a confirmed no-job-title profile with no leads is told to press Find companies, and why it is safe", async ({ page }) => {
  await mock(page, { roles: [], leads: [] });
  await page.goto("/dashboard");
  const hint = page.getByTestId("next-step");
  await expect(hint).toContainText("Press Find companies");
  await expect(hint).toContainText("email or WhatsApp number on their own site");
});

test("a profile that names a role is pointed at Find leads instead", async ({ page }) => {
  await mock(page, { roles: ["Founder"], leads: [] });
  await page.goto("/dashboard");
  await expect(page.getByTestId("next-step")).toContainText("Press Find leads");
  await expect(page.getByTestId("next-step")).not.toContainText("Find companies");
});

test("qualified leads with nothing reached show the Reach hint, which goes away once one is reached", async ({ page }) => {
  await mock(page, { roles: [], leads: [{ ...good, id: "a", name: "Alpha Dental", email: "hi@alpha.test" }] });
  await page.goto("/dashboard");
  await expect(page.getByTestId("next-step")).toContainText("press Reach on a lead");
  await expect(page.getByTestId("next-step")).toContainText("nothing goes out without you");

  // Once a lead was reached the top bar carries the progress and the hint is gone.
  await page.unroute("**/api/agents/leads/search");
  await page.route("**/api/agents/leads/search", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: [{ ...good, id: "a", name: "Alpha Dental", email: "hi@alpha.test", email_status: "sent", emailed_at: new Date().toISOString() }] }) })
      : route.fallback(),
  );
  await page.reload();
  await expect(page.getByTestId("header-stats")).toContainText("1 reached");
  await expect(page.getByTestId("next-step")).toHaveCount(0);
});
