import { expect, test } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// The top bar shows one outreach progress line (reached / replied / day of 7) and it moves as the user marks leads.
// Every API is mocked; nothing is sent.

test.describe.configure({ timeout: 60_000 });
test.use({ viewport: { width: 1536, height: 900 } });

const base = { project_id: "p1", title: "", location: "", email_verified: 0, query: "q", created_at: "2026-11-06T00:00:00Z", company: "", fit_reason: "Company site mentions dental.", lead_type: "company" };
const LEADS = [
  { ...base, id: "a", name: "Alpha Dental", email: null, whatsapp: "+91 98765 43210", website: "https://alpha.test/", source_url: "https://alpha.test/contact", tags: null },
  { ...base, id: "b", name: "Beta Dental", email: "hi@beta.test", website: "https://beta.test/", source_url: "https://beta.test/contact", tags: null },
];

test.beforeEach(async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!);
  await mockDashboardApi(page);
  await serveLottieWasmLocally(page);
  await page.route("**/api/agents/leads/search", (route) =>
    route.request().method() === "GET" ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: LEADS }) }) : route.fallback(),
  );
  await page.route(/linkedin\.com|wa\.me/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" }));
});

test("the top bar starts with qualified-and-none-reached, then follows contacted and replied", async ({ page }) => {
  const puts: { id: string; status: string }[] = [];
  await page.route("**/api/agents/leads/status", (route) => {
    const body = route.request().postDataJSON() as { id: string; status: string };
    puts.push(body);
    const tags = [`status:${body.status}`, "reached:" + new Date().toISOString().slice(0, 10)];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: body.id, status: body.status, tags }) });
  });

  await page.goto("/dashboard");
  const bar = page.getByTestId("header-stats");
  await expect(bar).toContainText("Outreach");
  await expect(bar).toContainText("2 qualified · none reached yet");

  // Open WhatsApp for Alpha, mark contacted: one reached on day 1.
  await page.getByRole("button", { name: "Reach Alpha Dental" }).click();
  const dialog = page.getByRole("dialog", { name: "Reach Alpha Dental" });
  const popup = page.waitForEvent("popup");
  await dialog.getByRole("link", { name: "Open WhatsApp" }).click();
  await popup;
  await dialog.getByRole("button", { name: "Mark as contacted" }).click();
  await expect(bar).toContainText("Day 1 of 7 · 1 reached · 0 replied");

  // The user records a reply by hand.
  await dialog.getByRole("button", { name: "They replied" }).click();
  await expect(dialog.getByTestId("reach-replied")).toBeVisible();
  await expect(bar).toContainText("Day 1 of 7 · 1 reached · 1 replied");
  expect(puts).toEqual([{ id: "a", status: "contacted" }, { id: "a", status: "replied" }]);

  // The tooltip carries the full sentence and the goal.
  const item = bar.locator("li", { hasText: "Outreach" });
  await expect(item).toHaveAttribute("title", /2 qualified, 1 reached, 1 replied/);
  await expect(item).toHaveAttribute("title", /one real reply within 7 days/);
});
