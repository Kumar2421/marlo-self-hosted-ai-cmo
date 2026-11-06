import { expect, test } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// "Find companies": web search for companies matching the profile, kept only when a contact is shown on their
// own site. Every API is mocked; nothing here calls a search engine or reads a real website.

test.describe.configure({ timeout: 60_000 });
test.use({ viewport: { width: 1536, height: 900 } });

const PROFILE = (roles: string[]) => ({
  version: 1, roles, industries: ["dental clinics"], sizes: [], locations: ["Chennai"], problem: "Missed calls", exclude: [], webRelated: false, confirmedAt: "2026-11-05T00:00:00Z",
});

const COMPANY = {
  id: "c1", project_id: "p1", name: "Smile Dental", title: "", company: "Smile Dental", location: "", lead_type: "company", email: "hi@smile.test", email_verified: 0,
  email_quality: "source_found", website: "https://smile.test/", source_url: "https://smile.test/contact", fit_reason: 'Company site mentions "dental clinics"; mentions chennai.',
  query: "dental clinics Chennai", created_at: "2026-11-06T00:00:00Z",
};

test.beforeEach(async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!);
  await mockDashboardApi(page);
  await serveLottieWasmLocally(page);
  await page.route("**/api/agents/leads/search", (route) =>
    route.request().method() === "GET" ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: [] }) }) : route.fallback(),
  );
});

async function mockProfile(page: import("@playwright/test").Page, roles: string[]) {
  await page.route("**/api/agents/leads/profile", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: PROFILE(roles), suggestion: null, offer: null }) }),
  );
}

test("Find companies saves reachable companies and shows them under Qualified with why and where", async ({ page }) => {
  await mockProfile(page, ["Founder"]);
  let calls = 0;
  await page.route("**/api/agents/leads/company-search", (route) => {
    calls += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: [COMPANY], dropped: { noContact: 2, noFit: 1 }, duplicates: 0, message: null }) });
  });
  await page.goto("/dashboard");

  await expect(page.getByRole("button", { name: "Find leads" })).toBeVisible(); // a role exists, so people search stays
  await page.getByRole("button", { name: "Find companies" }).click();

  await expect.poll(() => calls).toBe(1);
  await expect(page.getByRole("tab", { name: "Qualified (1)" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Smile Dental")).toBeVisible();
  await expect(page.getByText("smile.test", { exact: true })).toBeVisible();
  await expect(page.getByTestId("lead-why")).toContainText("dental clinics");
});

test("with no job title in the profile, Find companies is the only search", async ({ page }) => {
  await mockProfile(page, []);
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Find companies" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Find leads" })).toHaveCount(0);
});

test("a search that finds companies but no contacts says so honestly and saves nothing", async ({ page }) => {
  await mockProfile(page, []);
  await page.route("**/api/agents/leads/company-search", (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ leads: [], dropped: { noContact: 3, noFit: 0 }, duplicates: 0, message: "Found 3 matching companies, but none showed an email or WhatsApp number on their site, so none were saved." }),
    }),
  );
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Find companies" }).click();
  await expect(page.getByText("none showed an email or WhatsApp number").first()).toBeVisible();
  await expect(page.getByText("Smile Dental")).toHaveCount(0);
});

test("a server error is shown, not swallowed", async ({ page }) => {
  await mockProfile(page, []);
  await page.route("**/api/agents/leads/company-search", (route) => route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "Web search isn't configured on this deployment." }) }));
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Find companies" }).click();
  await expect(page.getByText("Web search isn't configured on this deployment.").first()).toBeVisible();
});
