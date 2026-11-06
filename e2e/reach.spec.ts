import { expect, test } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// Reaching a lead: an editable draft for WhatsApp and LinkedIn that the user sends from their own account, and a
// hand-off to the email composer. Every API is mocked; nothing is sent and no real site is opened.

test.describe.configure({ timeout: 60_000 });
test.use({ viewport: { width: 1536, height: 900 } });

const base = { project_id: "p1", title: "", location: "", email_verified: 0, query: "q", created_at: "2026-11-06T00:00:00Z" };
const LEADS = [
  { ...base, id: "wa", name: "Bright Teeth Clinic", company: "Bright Teeth Clinic", lead_type: "company", email: null, whatsapp: "+91 98765 43210", website: "https://brightteeth.test/", source_url: "https://brightteeth.test/contact", fit_reason: "Company site mentions dental." },
  { ...base, id: "li", name: "Ann Lee", title: "Head of Sales", company: "Acme", lead_type: "person", email: null, source_url: "https://www.linkedin.com/in/ann-lee", fit_reason: "Head of Sales at Acme. Role matches sales." },
  { ...base, id: "em", name: "Ravi K", lead_type: "person", company: "Clinic Hub", email: "ravi@clinichub.test", source_url: "https://clinichub.test/contact", fit_reason: "Founder at Clinic Hub." },
  { ...base, id: "nope", name: "Guessed Gary", lead_type: "person", company: "Acme", email: "g.g@acme.test", email_verified: 1, source_url: "https://acme.test/team", fit_reason: "Fits." },
];

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL! });
  await signIn(context, baseURL!);
  await mockDashboardApi(page);
  await serveLottieWasmLocally(page);
  await page.route("**/api/agents/leads/search", (route) =>
    route.request().method() === "GET" ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: LEADS }) }) : route.fallback(),
  );
  // No real site is ever opened by these tests.
  await page.route(/linkedin\.com|wa\.me/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" }));
});

test("WhatsApp: the draft names the company, and the link carries the edited text", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Reach Bright Teeth Clinic" }).click();

  const dialog = page.getByRole("dialog", { name: "Reach Bright Teeth Clinic" });
  const message = dialog.getByTestId("reach-message");
  await expect(message).toHaveValue(/^Hi Bright Teeth Clinic team,\n\n/);
  await expect(message).toHaveValue(/I came across brightteeth\.test\./);

  await message.fill("Hello from a test");
  const open = dialog.getByRole("link", { name: "Open WhatsApp" });
  await expect(open).toHaveAttribute("href", "https://wa.me/919876543210?text=Hello%20from%20a%20test");
  await expect(open).toHaveAttribute("rel", /noopener/);
});

test("LinkedIn: the note stays within 300 characters, is copied, and the profile opens", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Reach Ann Lee" }).click();
  const dialog = page.getByRole("dialog", { name: "Reach Ann Lee" });

  await expect(dialog.getByTestId("reach-message")).toHaveValue(/^Hi Ann,/);
  const count = await dialog.getByTestId("reach-count").innerText();
  expect(Number(count.split("/")[0])).toBeLessThanOrEqual(300);

  const popup = page.waitForEvent("popup");
  await dialog.getByRole("button", { name: /Copy message and open LinkedIn/ }).click();
  expect((await popup).url()).toBe("https://www.linkedin.com/in/ann-lee");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^Hi Ann,/);
});

test("a lead reachable only by email hands over to the email composer", async ({ page }) => {
  await page.route("**/api/auth/gmail/status", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ connected: true, email: "me@acme.test", canSend: true, canRead: true }) }));
  const status = { dailyCap: 25, sentToday: 0, remainingToday: 25 };
  await page.route("**/api/agents/leads/outreach/status", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(status) }));
  await page.route("**/api/agents/leads/outreach/plan", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sendable: ["em"], blocked: [], guessedIds: [], status, creditCost: 1 }) }),
  );
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Reach Ravi K" }).click();
  await page.getByRole("dialog", { name: "Reach Ravi K" }).getByRole("button", { name: "Write an email" }).click();
  await expect(page.getByRole("dialog", { name: "Reach Ravi K" })).toHaveCount(0);
  await expect(page.getByTestId("outreach-panel")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Email 1 lead" })).toBeVisible();
});

test("a lead with only a guessed email has no Reach button", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("tab", { name: /^All/ }).click();
  await expect(page.getByText("Guessed Gary")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reach Guessed Gary" })).toHaveCount(0);
});

test("after opening WhatsApp the user can mark the lead contacted, and the list remembers it", async ({ page }) => {
  let put: { id: string; status: string } | null = null;
  await page.route("**/api/agents/leads/status", (route) => {
    put = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: put!.id, status: put!.status, tags: ["status:contacted"] }) });
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Reach Bright Teeth Clinic" }).click();
  const dialog = page.getByRole("dialog", { name: "Reach Bright Teeth Clinic" });
  await expect(dialog.getByRole("button", { name: "Mark as contacted" })).toHaveCount(0); // not before it was opened

  const popup = page.waitForEvent("popup");
  await dialog.getByRole("link", { name: "Open WhatsApp" }).click();
  await popup;
  await dialog.getByRole("button", { name: "Mark as contacted" }).click();
  await expect(dialog.getByTestId("reach-contacted")).toBeVisible();
  expect(put).toEqual({ id: "wa", status: "contacted" });

  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Contacted", { exact: true }).first()).toBeVisible();
});
