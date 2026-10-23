import { expect, test, type Page } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// Lead outreach drawer: recipients summary with blocked reasons, the guessed-address checkbox, template preview,
// a test send, and review -> confirm -> results. Every endpoint is mocked; no email can leave the machine.

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const lead = (i: number) => `Very Long Lead Name Number ${i} With Extra Words To Overflow The Column`;

type Sent = { leadIds: string[]; subject: string; body: string; templateId: string; acceptGuessed?: boolean; test?: boolean };

async function mockOutreach(page: Page, opts: { sendStatus?: number; failLead?: string } = {}) {
  let failed = false; // the failing lead fails once, then succeeds on retry
  const sends: Sent[] = [];
  const plans: Array<{ leadIds: string[]; acceptGuessed?: boolean }> = [];
  let sentToday = 7;
  await page.route("**/api/auth/gmail/status", (r) => r.fulfill(json({ connected: true, email: "me@acme.test", canSend: true, canRead: true })));
  await page.route("**/api/agents/leads/outreach/status", (r) => r.fulfill(json({ dailyCap: 25, sentToday, remainingToday: 25 - sentToday })));
  await page.route("**/api/agents/leads/outreach/plan", async (r) => {
    const req = r.request().postDataJSON() as { leadIds: string[]; acceptGuessed?: boolean };
    plans.push(req);
    const sendable = req.leadIds.filter((id) => id === "lead_1" || id === "lead_4" || (id === "lead_2" && req.acceptGuessed));
    const blocked = [
      ...(req.leadIds.includes("lead_5") ? [{ leadId: "lead_5", reason: "recent" }] : []),
      ...(!req.acceptGuessed && req.leadIds.includes("lead_2") ? [{ leadId: "lead_2", reason: "guessed" }] : []),
    ];
    await r.fulfill(
      json({
        sendable,
        blocked,
        guessedIds: req.leadIds.includes("lead_2") ? ["lead_2"] : [],
        status: { dailyCap: 25, sentToday, remainingToday: 25 - sentToday },
        creditCost: Math.ceil(sendable.length / 5),
      }),
    );
  });
  await page.route("**/api/agents/leads/send-email", async (r) => {
    if (opts.sendStatus) return r.fulfill(json({ error: "Outreach safeguards are not set up yet" }, opts.sendStatus));
    const req = r.request().postDataJSON() as Sent;
    sends.push(req);
    if (!req.test) sentToday += req.leadIds.length;
    await r.fulfill(
      json({
        results: req.leadIds.map((id) => (id === opts.failLead && !failed && (failed = true) ? { id, status: "failed", error: "Mailbox unavailable" } : { id, status: "sent" })),
        status: { dailyCap: 25, sentToday, remainingToday: 25 - sentToday },
        creditsRecorded: 0,
      }),
    );
  });
  return { sends, plans };
}

async function openPanel(page: Page) {
  await page.goto("/dashboard");
  for (const i of [1, 2, 4, 5]) await page.getByLabel(`Select ${lead(i)}`, { exact: true }).check();
  await page.getByRole("button", { name: /Email Selected/ }).click();
  return page.getByRole("dialog", { name: /Email 4 leads/ });
}

test.describe("lead outreach drawer", () => {
  test.use({ viewport: { width: 1536, height: 900 } });
  test.setTimeout(120_000);

  test.beforeEach(async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!);
    await serveLottieWasmLocally(page);
    await mockDashboardApi(page);
  });

  test("recipients: summary, blocked reasons, guessed checkbox re-plans", async ({ page }) => {
    const { plans } = await mockOutreach(page);
    const panel = await openPanel(page);
    await expect(panel.getByTestId("plan-headline")).toHaveText("4 selected: 2 will be sent, 2 blocked");
    const blocked = panel.getByTestId("blocked-list");
    await expect(blocked).toContainText("Emailed in the last 30 days");
    await expect(blocked).toContainText("Guessed address");
    await expect(panel.getByTestId("daily-meter")).toContainText("7 of 25 sent today, 18 left");
    await expect(panel).toContainText("Costs about 1 credit (beta: not charged)");

    await panel.getByRole("checkbox", { name: /Include 1 guessed address \(they may bounce\)/ }).check();
    await expect(panel.getByTestId("plan-headline")).toHaveText("4 selected: 3 will be sent, 1 blocked");
    expect(plans.at(-1)?.acceptGuessed).toBe(true);
  });

  test("write: template switch changes the sandboxed preview, test send reports the result", async ({ page }) => {
    const { sends } = await mockOutreach(page);
    const panel = await openPanel(page);
    await panel.getByTestId("to-compose").click();

    await panel.getByRole("textbox", { name: "Subject" }).fill("Quick question about {{company}}");
    await panel.getByRole("textbox", { name: "Message" }).fill("Hi {{name}},\n\nLoved your work.");
    // Merge-tag chip inserts at the cursor.
    await panel.getByRole("textbox", { name: "Message" }).click();
    await panel.getByRole("button", { name: "Insert title merge tag" }).click();
    await expect(panel.getByRole("textbox", { name: "Message" })).toHaveValue(/\{\{title\}\}$/);

    const frame = panel.getByTestId("preview-frame");
    await expect(frame).toHaveAttribute("sandbox", "");
    await expect(panel.getByTestId("preview-subject")).toContainText("Quick question about Company 1");
    const before = await frame.getAttribute("srcdoc");
    await panel.getByTestId("template-card").click();
    await expect.poll(() => frame.getAttribute("srcdoc")).not.toBe(before);

    await panel.getByRole("tab", { name: "Plain text" }).click();
    await expect(panel.getByTestId("preview-text")).toContainText("Unsubscribe:");

    await panel.getByTestId("send-test").click();
    await expect(panel.getByTestId("test-result")).toContainText("Test sent to me@acme.test");
    expect(sends.at(-1)?.test).toBe(true);
    expect(sends.filter((s) => !s.test)).toHaveLength(0);
  });

  test("subject guidance warns about length and shouting", async ({ page }) => {
    await mockOutreach(page);
    const panel = await openPanel(page);
    await panel.getByTestId("to-compose").click();
    await panel.getByRole("textbox", { name: "Subject" }).fill("BUY THIS INCREDIBLE THING RIGHT NOW!!!");
    await expect(panel.getByTestId("subject-warnings")).toContainText("capital letters");
    await expect(panel.getByTestId("subject-warnings")).toContainText("exclamation");
  });

  test("review -> confirm -> results, with retry for failed only", async ({ page }) => {
    const { sends } = await mockOutreach(page, { failLead: "lead_4" });
    const panel = await openPanel(page);
    await panel.getByTestId("to-compose").click();
    await panel.getByRole("textbox", { name: "Subject" }).fill("Hello");
    await panel.getByRole("textbox", { name: "Message" }).fill("Hi {{name}}");
    await panel.getByTestId("to-review").click();
    await expect(panel.getByTestId("review-summary")).toContainText("2 people");
    await expect(panel).toContainText("Each email includes an unsubscribe link.");
    expect(sends).toHaveLength(0); // nothing is sent before the confirm click

    await panel.getByTestId("confirm-send").dblclick();
    await expect(panel.getByTestId("results-headline")).toHaveText("1 of 2 sent");
    expect(sends).toHaveLength(1); // double click sent once
    await expect(panel.getByTestId("results-problems")).toContainText("Mailbox unavailable");
    await expect(panel.getByTestId("daily-meter")).toContainText("9 of 25 sent today, 16 left");

    await panel.getByTestId("retry-failed").click();
    await expect(panel.getByTestId("results-headline")).toHaveText("2 of 2 sent");
    expect(sends.at(-1)?.leadIds).toEqual(["lead_4"]);
    await expect(panel.getByTestId("retry-failed")).toHaveCount(0);
  });

  test("503 from send shows a calm message and keeps the form", async ({ page }) => {
    await mockOutreach(page, { sendStatus: 503 });
    const panel = await openPanel(page);
    await panel.getByTestId("to-compose").click();
    await panel.getByRole("textbox", { name: "Subject" }).fill("Hello");
    await panel.getByRole("textbox", { name: "Message" }).fill("Body text");
    await panel.getByTestId("to-review").click();
    await panel.getByTestId("confirm-send").click();
    await expect(panel.getByRole("alert")).toContainText("safeguards are not set up yet");
    await expect(panel.getByRole("alert")).not.toContainText("{");
    await panel.getByRole("button", { name: "Back" }).click();
    await expect(panel.getByRole("textbox", { name: "Subject" })).toHaveValue("Hello");
  });

  test("narrow screens turn the preview into a tab", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockOutreach(page);
    await page.goto("/dashboard");
    // Phones show one dashboard section at a time.
    await page.getByRole("tablist", { name: "Dashboard sections" }).getByRole("tab", { name: "Leads" }).click();
    for (const i of [1, 2, 4, 5]) await page.getByLabel(`Select ${lead(i)}`, { exact: true }).check();
    await page.getByRole("button", { name: /Email Selected/ }).click();
    const panel = page.getByRole("dialog", { name: /Email 4 leads/ });
    await panel.getByTestId("to-compose").click();
    await expect(panel.getByTestId("preview-frame")).toBeHidden();
    await panel.getByRole("tab", { name: "Preview" }).click();
    await expect(panel.getByTestId("preview-frame")).toBeVisible();
  });
});
