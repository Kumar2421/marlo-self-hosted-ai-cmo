import { expect, test } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// A buying signal the company's own site states shows as a chip and becomes the opener in the draft. Every API is mocked.

test.describe.configure({ timeout: 60_000 });
test.use({ viewport: { width: 1536, height: 900 } });

const base = { project_id: "p1", title: "", location: "", email_verified: 0, query: "q", created_at: "2026-11-11T00:00:00Z", lead_type: "company", email: null, whatsapp: "+91 98765 43210" };
const LEADS = [
  { ...base, id: "h", name: "Hiring Dental", company: "Hiring Dental", website: "https://hiring.test/", source_url: "https://hiring.test/contact", fit_reason: 'Company site mentions "dental clinics". Signals: hiring now; new location.' },
  { ...base, id: "q", name: "Quiet Dental", company: "Quiet Dental", website: "https://quiet.test/", source_url: "https://quiet.test/contact", fit_reason: 'Company site mentions "dental clinics".' },
];

test.beforeEach(async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!);
  await mockDashboardApi(page);
  await serveLottieWasmLocally(page);
  await page.route("**/api/agents/leads/search", (route) =>
    route.request().method() === "GET" ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: LEADS }) }) : route.fallback(),
  );
});

test("the chips show only the signals a site stated, and the draft opens with the real signal", async ({ page }) => {
  await page.goto("/dashboard");
  const hiring = page.locator('[data-testid="lead-chips"]').filter({ hasText: "Hiring" });
  await expect(hiring).toContainText("Hiring");
  await expect(hiring).toContainText("New location");
  await expect(page.locator('[data-testid="lead-chips"]').filter({ hasText: "Quiet" })).toHaveCount(0); // chips carry no name; Quiet has none

  await page.getByRole("button", { name: "Reach Hiring Dental" }).click();
  await expect(page.getByTestId("reach-message")).toHaveValue(/I noticed you're hiring on hiring\.test\./);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Reach Quiet Dental" }).click();
  await expect(page.getByTestId("reach-message")).toHaveValue(/I came across quiet\.test\./);
});
