import { expect, test } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// The Leads panel's Qualified tab: a lead needs a reachable channel, a stored reason and a source page.
// A guessed email never counts. Every API is mocked.

test.describe.configure({ timeout: 60_000 });
test.use({ viewport: { width: 1536, height: 900 } });

const row = (id: string, over: Record<string, unknown>) => ({
  id, project_id: "p1", name: `Lead ${id}`, title: "Head of Sales", company: "Acme", location: "Chennai",
  email: null, email_verified: 0, source_url: "https://www.linkedin.com/in/lead-" + id, query: "q", created_at: "2026-11-05T00:00:00Z", lead_type: "person", ...over,
});

const LEADS = [
  row("good", { fit_reason: "Head of Sales at Acme. Role matches sales." }),
  row("guessed", { email: "lead.guessed@acme.test", email_verified: 1, source_url: "https://acme.test/team", fit_reason: "Fits the profile." }),
  row("noreason", { email: "hello@acme.test", source_url: "https://acme.test/contact" }),
];

test.beforeEach(async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!);
  await mockDashboardApi(page);
  await serveLottieWasmLocally(page);
  await page.route("**/api/agents/leads/search", (route) =>
    route.request().method() === "GET" ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: LEADS }) }) : route.fallback(),
  );
});

test("opens on Qualified, shows why and the channel, and keeps guessed or reasonless leads out", async ({ page }) => {
  await page.goto("/dashboard");
  const tabs = page.getByRole("tablist", { name: "Filter leads" });
  await expect(tabs.getByRole("tab", { name: "Qualified (1)" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Lead good")).toBeVisible();
  await expect(page.getByTestId("lead-why")).toContainText("Role matches sales");
  await expect(page.getByText("LinkedIn", { exact: true })).toBeVisible();
  await expect(page.getByText("Lead guessed")).toHaveCount(0);
  await expect(page.getByText("Lead noreason")).toHaveCount(0);

  await tabs.getByRole("tab", { name: "All (3)" }).click();
  await expect(page.getByText("Lead guessed")).toBeVisible();
  await expect(page.getByText("Lead noreason")).toBeVisible();
});
