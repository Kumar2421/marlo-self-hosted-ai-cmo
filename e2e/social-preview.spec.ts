import { expect, test, type Page } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// The draft previews in the Social panel: X counts links as 23 and emoji as 2, and LinkedIn and Reddit fold long
// posts behind "see more" even when the post is one paragraph. Every API is mocked.

test.describe.configure({ timeout: 60_000 });
test.use({ viewport: { width: 1536, height: 900 } });

const base = { status: "draft", edited: false, whyThisWorks: "Because.", createdAt: new Date().toISOString() };
const LONG_URL = `https://example.com/${"a-very-long-path/".repeat(12)}`; // well over 100 characters
const X_TEXT = `${"We audited 100 sites. ".repeat(5)}Read it: ${LONG_URL}`;
const LI_HOOK = "Most sites skip the one tag that decides how they look when shared";
const LI_BODY = `${"Here is what we found when we checked a hundred homepages and looked at how each one appears in a feed. ".repeat(4)}THE-LAST-WORDS`;
const RD_BODY = `${"I have been comparing a few approaches to getting a first hundred users without a budget. ".repeat(6)}THE-END-OF-THE-POST`;

async function open(page: Page, network: "x" | "linkedin" | "reddit", drafts: unknown[], menuName: RegExp, angle: string) {
  await mockDashboardApi(page);
  await serveLottieWasmLocally(page);
  await page.route(`**/api/agents/${network}/drafts*`, (r) =>
    r.request().method() === "GET" ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ drafts }) }) : r.fallback(),
  );
  await page.route("**/api/agents/reddit/settings", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ settings: { subreddits: ["startups"], keywords: [] } }) }));
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Social drafts" }).click();
  await page.getByRole("menuitem", { name: menuName }).click();
  await page.getByRole("button", { name: new RegExp(angle) }).first().click();
}

test.beforeEach(async ({ context, baseURL }) => {
  await signIn(context, baseURL!);
});

test("X: a long link counts as 23 characters, not its real length, and the note says so", async ({ page }) => {
  expect(X_TEXT.length).toBeGreaterThan(280); // the old counter would have shown this as over the limit
  await open(page, "x", [{ ...base, id: "x1", angle: "Audit data", text: X_TEXT }], /^X|Twitter/, "Audit data");
  const weighted = 22 * 5 + "Read it: ".length + 23;
  await expect(page.getByText(`${weighted}/280`)).toBeVisible();
  await expect(page.getByTestId("preview-note")).toContainText("Links count as 23 characters");
});

test("X: an emoji counts as 2", async ({ page }) => {
  await open(page, "x", [{ ...base, id: "x2", angle: "Emoji post", text: "Shipped 🚀" }], /^X|Twitter/, "Emoji post");
  await expect(page.getByText("10/280")).toBeVisible(); // "Shipped " is 8, the rocket is 2
});

test("LinkedIn: one long paragraph is folded at about 210 characters, then expands", async ({ page }) => {
  expect(LI_BODY).not.toContain("\n");
  await open(page, "linkedin", [{ ...base, id: "l1", angle: "Data post", hookLine: LI_HOOK, body: LI_BODY }], /LinkedIn/, "Data post");
  const card = page.getByTestId("linkedin-preview");
  await expect(card).toContainText(LI_HOOK);
  await expect(card).not.toContainText("THE-LAST-WORDS");
  const folded = (await card.innerText()).length;
  expect(folded).toBeLessThan(330); // 210 characters of post plus the name and the "see more" link
  await page.getByTestId("linkedin-see-more").click();
  await expect(card).toContainText("THE-LAST-WORDS");
  await expect(page.getByTestId("linkedin-see-more")).toHaveCount(0);
  await expect(page.getByTestId("preview-note")).toContainText("Approximate preview");
});

test("LinkedIn: a short post is not folded", async ({ page }) => {
  await open(page, "linkedin", [{ ...base, id: "l2", angle: "Short post", hookLine: "One line hook", body: "A short body." }], /LinkedIn/, "Short post");
  await expect(page.getByTestId("linkedin-preview")).toContainText("A short body.");
  await expect(page.getByTestId("linkedin-see-more")).toHaveCount(0);
});

test("Reddit: a long single-paragraph body is folded at about 300 characters, then expands", async ({ page }) => {
  expect(RD_BODY).not.toContain("\n");
  await open(page, "reddit", [{ ...base, id: "r1", angle: "Question", subreddit: "startups", title: "How do you get the first 100 users?", body: RD_BODY }], /Reddit/, "Question");
  const card = page.getByTestId("reddit-preview");
  await expect(card).toContainText("r/startups");
  await expect(card).not.toContainText("THE-END-OF-THE-POST");
  await page.getByTestId("reddit-see-more").click();
  await expect(card).toContainText("THE-END-OF-THE-POST");
});
