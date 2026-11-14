import { expect, test, type Page } from "@playwright/test";
import { buildStoredReport } from "../lib/domain/seo/publicReport.ts";

// "Businesses that may need what this site sells", under an audit. The lookup endpoint is mocked (no search, model or
// company site is contacted); saved reports go through the real routes against the local fake Supabase.

test.describe.configure({ timeout: 60_000 });
test.use({ viewport: { width: 1280, height: 900 } });

const SUPABASE = process.env.E2E_SUPABASE_URL || "http://localhost:54329";
const finding = (n: number) => ({
  issueId: `issue-${n}`, category: "meta-description", severity: n === 1 ? "Error" : "Warning", label: `Finding number ${n}`,
  evidence: { length: 12 * n }, whyItMatters: `Why ${n} matters.`, recommendation: `Fix ${n}.`,
});
const FINDINGS = [finding(1), finding(2), finding(3)];
const SUMMARY = { totalFindings: 4, critical: 1, warnings: 3 };
const LEADS = [
  { name: "Acharya Dental", host: "acharya-dental.test", fitReason: 'Company site mentions "dental"; mentions chennai.', channels: ["email"] },
  { name: "Smile Studio", host: "smile-studio.test", fitReason: 'Company site mentions "dental".', channels: ["whatsapp", "email"] },
  { name: "Bright Teeth", host: "bright-teeth.test", fitReason: 'Company site mentions "orthodontist".', channels: ["form"] },
];
const SECRETS = ["info@acharya-dental.test", "+914412345678", "acharya-dental.test/contact"];

async function seed(leads: unknown[] | null = null) {
  const { report, ownerToken } = buildStoredReport({ url: "https://www.acme-booking.test/", score: 71, findings: FINDINGS as never, summary: SUMMARY });
  const res = await fetch(`${SUPABASE}/rest/v1/public_audit_reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: report.id, url: report.url, host: report.host, score: report.score, summary: report.summary, findings: report.findings, leads,
      owner_token_hash: report.ownerTokenHash, created_at: report.createdAt, expires_at: report.expiresAt,
    }),
  });
  if (!res.ok) throw new Error(`seed failed: ${res.status}`);
  return { id: report.id, ownerToken };
}

async function mockAudit(page: Page, leadsAvailable: boolean) {
  await page.route("**/api/public/audit/events", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.route("**/api/public/audit", (r) =>
    r.request().method() === "POST"
      ? r.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({
            url: "https://www.acme-booking.test/", findings: FINDINGS, summary: SUMMARY, technical: { onPageScore: 71, status: 200, redirectCount: 0 },
            report: { id: "k7m2q9x4t8wn", path: "/audit/r/k7m2q9x4t8wn", ownerToken: "owner-token-owner-token-1234" }, leadsAvailable,
          }),
        })
      : r.fallback(),
  );
}

async function runAudit(page: Page) {
  await page.goto("/audit");
  await page.getByPlaceholder("yourwebsite.com").fill("https://www.acme-booking.test");
  await page.getByRole("button", { name: "Run free audit" }).click();
  await expect(page.getByTestId("audit-result")).toBeVisible();
}

test("the owner asks for businesses and gets a teaser with no contact details", async ({ page }) => {
  await mockAudit(page, true);
  let asked: { method: string; token: string | undefined } | null = null;
  await page.route("**/api/public/audit/report/*/leads", (r) => {
    asked = { method: r.request().method(), token: r.request().headers()["x-report-token"] };
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: LEADS, reason: null }) });
  });
  await runAudit(page);

  await expect(page.getByTestId("audit-leads")).toContainText("Businesses that may need what this site sells");
  await page.getByRole("button", { name: "Find businesses" }).click();
  await expect(page.getByTestId("audit-lead")).toHaveCount(3);
  await expect(page.getByTestId("audit-lead").first()).toContainText("Acharya Dental");
  await expect(page.getByTestId("audit-lead").first()).toContainText("Email found");
  await expect(page.getByTestId("audit-lead").nth(1)).toContainText("WhatsApp found");
  await expect(page.getByTestId("audit-lead").nth(2)).toContainText("Contact form");
  expect(asked).toEqual({ method: "POST", token: "owner-token-owner-token-1234" });

  const text = await page.locator("body").innerText();
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  const link = page.getByRole("link", { name: "See their contact details" });
  await expect(link).toHaveAttribute("href", /\/login\?mode=signup&url=https%3A%2F%2Fwww\.acme-booking\.test%2F/);
});

test("a site that sells to consumers gets an honest message, not an empty box", async ({ page }) => {
  await mockAudit(page, true);
  await page.route("**/api/public/audit/report/*/leads", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: [], reason: "no_business_buyers" }) }));
  await runAudit(page);
  await page.getByRole("button", { name: "Find businesses" }).click();
  await expect(page.getByTestId("audit-leads-none")).toContainText("sells to consumers");
  await expect(page.getByTestId("audit-lead")).toHaveCount(0);
});

test("nothing reachable found says so plainly", async ({ page }) => {
  await mockAudit(page, true);
  await page.route("**/api/public/audit/report/*/leads", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: [], reason: "no_reachable_match" }) }));
  await runAudit(page);
  await page.getByRole("button", { name: "Find businesses" }).click();
  await expect(page.getByTestId("audit-leads-none")).toContainText("No business that shows a way to contact it");
});

test("a limit or a failure is shown with the real reason, and the button comes back", async ({ page }) => {
  await mockAudit(page, true);
  let calls = 0;
  await page.route("**/api/public/audit/report/*/leads", (r) => {
    calls += 1;
    return calls === 1
      ? r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "That is enough lookups for now. Try again later, or create a free account." }) })
      : r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: LEADS.slice(0, 1), reason: null }) });
  });
  await runAudit(page);
  await page.getByRole("button", { name: "Find businesses" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "enough lookups for now" })).toBeVisible();
  await page.getByRole("button", { name: "Find businesses" }).click();
  await expect(page.getByTestId("audit-lead")).toHaveCount(1);
});

test("with the feature off there is no leads block at all", async ({ page }) => {
  await mockAudit(page, false);
  await runAudit(page);
  await expect(page.getByTestId("audit-leads")).toHaveCount(0);
  await expect(page.getByTestId("share-bar")).toBeVisible();
});

test("a stranger opening a report with saved businesses sees them, and cannot start a lookup", async ({ page }) => {
  const { id } = await seed(LEADS);
  await page.goto(`/audit/r/${id}`);
  await expect(page.getByTestId("audit-lead")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Find businesses" })).toHaveCount(0);
  const text = await page.locator("body").innerText();
  for (const secret of SECRETS) expect(text).not.toContain(secret);
});

test("a stranger opening a report with no lookup yet sees no leads block", async ({ page }) => {
  const { id } = await seed(null);
  await page.goto(`/audit/r/${id}`);
  await expect(page.getByTestId("audit-result")).toBeVisible();
  await expect(page.getByTestId("audit-leads")).toHaveCount(0);
});

test("the owner's browser sees the Find button on its own shared report", async ({ page }) => {
  const { id, ownerToken } = await seed(null);
  await page.addInitScript(([key, token]) => window.localStorage.setItem(key, token), [`marlo:audit-owner:${id}`, ownerToken]);
  await page.goto(`/audit/r/${id}`);
  await expect(page.getByRole("button", { name: "Find businesses" })).toBeVisible();
});

test("the lookup endpoint refuses a missing, malformed or wrong token", async ({ request }) => {
  const { id } = await seed(null);
  expect((await request.post(`/api/public/audit/report/${id}/leads`)).status()).toBe(404);
  expect((await request.post(`/api/public/audit/report/${id}/leads`, { headers: { "x-report-token": "short" } })).status()).toBe(404);
  expect((await request.post(`/api/public/audit/report/${id}/leads`, { headers: { "x-report-token": "wrong-token-wrong-token-12" } })).status()).toBe(404);
  expect((await request.post(`/api/public/audit/report/zzzzzzzzzzzz/leads`, { headers: { "x-report-token": "wrong-token-wrong-token-12" } })).status()).toBe(404);
});
