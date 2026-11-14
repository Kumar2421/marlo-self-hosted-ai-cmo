import { expect, test, type Page } from "@playwright/test";
import { buildStoredReport } from "../lib/domain/seo/publicReport.ts";

// "What Marlo would post for this site": an X post and a LinkedIn post, written when the owner asks. The endpoint is
// mocked (no model is called); saved reports go through the real routes against the local fake Supabase.

test.describe.configure({ timeout: 60_000 });
test.use({ viewport: { width: 1280, height: 900 } });

const SUPABASE = process.env.E2E_SUPABASE_URL || "http://localhost:54329";
const finding = (n: number) => ({ issueId: `i${n}`, category: "meta-description", severity: "Warning", label: `Finding ${n}`, evidence: {}, whyItMatters: "Why.", recommendation: "Fix." });
const SUMMARY = { totalFindings: 3, critical: 0, warnings: 3 };
const X_TEXT = "A burst pipe at 2am is not a Monday problem.\nWe pick up the phone.";
const LI_HOOK = "A slow drip is a bill that has not arrived yet";
const LI_BODY = `${"Most plumbing emergencies are not emergencies at first. A slow drip becomes a flooded floor when nobody checks it. ".repeat(3)}THE-LAST-WORDS`;
const POSTS = { x: { text: X_TEXT }, linkedin: { hookLine: LI_HOOK, body: LI_BODY } };

async function seed(posts: unknown = null) {
  const { report, ownerToken } = buildStoredReport({ url: "https://www.acme-plumbing.test/", score: 71, findings: [finding(1), finding(2), finding(3)] as never, summary: SUMMARY });
  const res = await fetch(`${SUPABASE}/rest/v1/public_audit_reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: report.id, url: report.url, host: report.host, score: report.score, summary: report.summary, findings: report.findings, posts,
      owner_token_hash: report.ownerTokenHash, created_at: report.createdAt, expires_at: report.expiresAt,
    }),
  });
  if (!res.ok) throw new Error(`seed failed: ${res.status}`);
  return { id: report.id, ownerToken };
}

async function mockAudit(page: Page, postsAvailable: boolean) {
  await page.route("**/api/public/audit/events", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.route("**/api/public/audit", (r) =>
    r.request().method() === "POST"
      ? r.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({
            url: "https://www.acme-plumbing.test/", findings: [finding(1), finding(2), finding(3)], summary: SUMMARY, technical: { onPageScore: 71, status: 200, redirectCount: 0 },
            report: { id: "k7m2q9x4t8wn", path: "/audit/r/k7m2q9x4t8wn", ownerToken: "owner-token-owner-token-1234" }, leadsAvailable: false, postsAvailable,
          }),
        })
      : r.fallback(),
  );
}

async function runAudit(page: Page) {
  await page.goto("/audit");
  await page.getByPlaceholder("yourwebsite.com").fill("acme-plumbing.test");
  await page.getByRole("button", { name: "Run free audit" }).click();
  await expect(page.getByTestId("audit-result")).toBeVisible();
}

test("the owner asks for sample posts and gets an X card and a LinkedIn card, with the not-posted note", async ({ page }) => {
  await mockAudit(page, true);
  let asked: { method: string; token: string | undefined } | null = null;
  await page.route("**/api/public/audit/report/*/posts", (r) => {
    asked = { method: r.request().method(), token: r.request().headers()["x-report-token"] };
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ posts: POSTS }) });
  });
  await runAudit(page);
  await page.getByRole("button", { name: "Write sample posts" }).click();

  await expect(page.getByTestId("sample-x")).toContainText("A burst pipe at 2am");
  await expect(page.getByTestId("sample-x")).toContainText(/\d+\/280/);
  await expect(page.getByTestId("sample-linkedin")).toContainText(LI_HOOK);
  await expect(page.getByTestId("sample-linkedin")).not.toContainText("THE-LAST-WORDS"); // a long post folds like the feed
  await page.getByTestId("sample-see-more").click();
  await expect(page.getByTestId("sample-linkedin")).toContainText("THE-LAST-WORDS");
  await expect(page.getByTestId("posts-note")).toContainText("Marlo never posts anything for you");
  await expect(page.getByRole("link", { name: "Get my drafts" })).toHaveAttribute("href", /\/login\?mode=signup&url=/);
  expect(asked).toEqual({ method: "POST", token: "owner-token-owner-token-1234" });
});

test("the Copy buttons copy the post text", async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL! });
  await mockAudit(page, true);
  await page.route("**/api/public/audit/report/*/posts", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ posts: POSTS }) }));
  await runAudit(page);
  await page.getByRole("button", { name: "Write sample posts" }).click();
  await page.getByRole("button", { name: "Copy X post" }).click();
  const clip = async () => (await page.evaluate(() => navigator.clipboard.readText())).split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
  expect(await clip()).toBe(X_TEXT);
  await page.getByRole("button", { name: "Copy LinkedIn post" }).click();
  expect(await clip()).toBe(`${LI_HOOK}\n\n${LI_BODY}`);
});

test("a failure is shown with the real reason and the button comes back", async ({ page }) => {
  await mockAudit(page, true);
  let calls = 0;
  await page.route("**/api/public/audit/report/*/posts", (r) => {
    calls += 1;
    return calls === 1
      ? r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "That is enough sample posts for now. Try again later, or create a free account." }) })
      : r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ posts: { x: { text: X_TEXT }, linkedin: null } }) });
  });
  await runAudit(page);
  await page.getByRole("button", { name: "Write sample posts" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "enough sample posts for now" })).toBeVisible();
  await page.getByRole("button", { name: "Write sample posts" }).click();
  await expect(page.getByTestId("sample-x")).toBeVisible();
  await expect(page.getByTestId("sample-linkedin")).toHaveCount(0); // only the part that was written is shown
});

test("with the feature off there is no block", async ({ page }) => {
  await mockAudit(page, false);
  await runAudit(page);
  await expect(page.getByTestId("audit-posts")).toHaveCount(0);
});

test("a stranger sees saved sample posts, and cannot start the writing", async ({ page }) => {
  const { id } = await seed(POSTS);
  await page.goto(`/audit/r/${id}`);
  await expect(page.getByTestId("sample-x")).toBeVisible();
  await expect(page.getByTestId("sample-linkedin")).toBeVisible();
  await expect(page.getByRole("button", { name: "Write sample posts" })).toHaveCount(0);
});

test("a stranger sees no block when nothing was written, and malformed saved data renders nothing", async ({ page }) => {
  const none = await seed(null);
  await page.goto(`/audit/r/${none.id}`);
  await expect(page.getByTestId("audit-result")).toBeVisible();
  await expect(page.getByTestId("audit-posts")).toHaveCount(0);

  const bad = await seed({ x: { text: 5 }, linkedin: "<script>alert(1)</script>" });
  await page.goto(`/audit/r/${bad.id}`);
  await expect(page.getByTestId("audit-result")).toBeVisible();
  await expect(page.getByTestId("audit-posts")).toHaveCount(0);
});

test("the owner's browser sees the Write button on its own shared report", async ({ page }) => {
  const { id, ownerToken } = await seed(null);
  await page.addInitScript(([key, token]) => window.localStorage.setItem(key, token), [`marlo:audit-owner:${id}`, ownerToken]);
  await page.goto(`/audit/r/${id}`);
  await expect(page.getByRole("button", { name: "Write sample posts" })).toBeVisible();
});

test("the endpoint refuses a missing, malformed or wrong token", async ({ request }) => {
  const { id } = await seed(null);
  expect((await request.post(`/api/public/audit/report/${id}/posts`)).status()).toBe(404);
  expect((await request.post(`/api/public/audit/report/${id}/posts`, { headers: { "x-report-token": "short" } })).status()).toBe(404);
  expect((await request.post(`/api/public/audit/report/${id}/posts`, { headers: { "x-report-token": "wrong-token-wrong-token-12" } })).status()).toBe(404);
  expect((await request.post(`/api/public/audit/report/zzzzzzzzzzzz/posts`, { headers: { "x-report-token": "wrong-token-wrong-token-12" } })).status()).toBe(404);
});
