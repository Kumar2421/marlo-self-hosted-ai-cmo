import { expect, test, type Page } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// The Social page's Reddit "Replies" tab: real threads where someone asks for what the user sells, each with a reply to
// edit and post by hand. Every API is mocked; no search, model or Reddit page is ever contacted.

test.describe.configure({ timeout: 60_000 });
test.use({ viewport: { width: 1536, height: 900 } });

const REPLY = "Spreadsheets break down once more than one person edits them. Start by listing what you actually track, then pick a tool that does those well before adding anything else.";
const thread = (id: string, sub: string, title: string, over: Record<string, unknown> = {}) => ({
  id, project_id: "p1", name: title, title: "", company: `r/${sub}`, location: "", lead_type: "intent", email: null, email_verified: 0, website: null,
  source_url: `https://www.reddit.com/r/${sub}/comments/1xr59o${id}/some_slug/`, fit_reason: `Asked on r/${sub}: "${title}".`, description: REPLY, tags: null,
  query: "requests", created_at: new Date().toISOString(), ...over,
});

const LEADS = [
  thread("a", "smallbusiness", "Recommend a CRM for a small clinic", { created_at: new Date(Date.now() - 60_000).toISOString() }),
  thread("b", "CRM", "CRM recommendations for a small travel agency", { created_at: new Date(Date.now() - 3_600_000).toISOString() }),
  thread("c", "web_design", "Need a website designer", { tags: ["status:contacted", "reached:2026-11-12"] }),
  thread("d", "startups", "Dismissed already", { tags: ["status:not_interested"] }),
  { id: "x", project_id: "p1", name: "Acharya Dental", lead_type: "company", company: "Acharya Dental", email: "info@a.test", source_url: "https://a.test/contact", fit_reason: "Company site mentions dental.", created_at: new Date().toISOString() },
];

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL! });
  await signIn(context, baseURL!);
  await mockDashboardApi(page);
  await serveLottieWasmLocally(page);
  await page.route(/reddit\.com/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" }));
});

async function serveLeads(page: Page, leads: unknown[] | (() => unknown[])) {
  await page.route("**/api/agents/leads/search", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: typeof leads === "function" ? leads() : leads }) })
      : route.fallback(),
  );
}

async function openReplies(page: Page) {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Social drafts" }).click();
  await page.getByRole("menuitem", { name: /Reddit/ }).click();
  await page.getByRole("tab", { name: /^Replies/ }).click();
}

test("the Social menu counts replies to answer on the Reddit line", async ({ page }) => {
  await serveLeads(page, LEADS);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Social drafts" }).click();
  await expect(page.getByRole("menuitem", { name: /Reddit/ })).toContainText("2 replies to answer");
});

test("the Replies tab lists threads to answer with the quote and a reply preview, and keeps posted ones apart", async ({ page }) => {
  await serveLeads(page, LEADS);
  await openReplies(page);

  await expect(page.getByRole("tab", { name: /To answer \(2\)/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("reply-card")).toHaveCount(2);
  await expect(page.getByTestId("reply-card").first()).toContainText("r/smallbusiness");
  await expect(page.getByTestId("reply-card").first()).toContainText("Recommend a CRM for a small clinic");
  await expect(page.getByTestId("reply-card").filter({ hasText: "Dismissed already" })).toHaveCount(0);

  await page.getByRole("tab", { name: /Posted \(1\)/ }).click();
  await expect(page.getByTestId("reply-card")).toHaveCount(1);
  await expect(page.getByTestId("reply-card")).toContainText("Need a website designer");
  await expect(page.getByTestId("reply-card")).toContainText("Posted");
});

test("opening a thread shows the reply to edit, the rules link and tip; copy and open copies it and opens the thread", async ({ page }) => {
  await serveLeads(page, LEADS);
  const saves: { id: string; reply: string }[] = [];
  await page.route("**/api/agents/leads/reply", (route) => {
    const body = route.request().postDataJSON() as { id: string; reply: string };
    saves.push(body);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await openReplies(page);
  await page.getByTestId("reply-card").first().click();

  await expect(page.getByTestId("reply-thread-title")).toHaveText("Recommend a CRM for a small clinic");
  const box = page.getByTestId("reply-text");
  await expect(box).toHaveValue(REPLY);
  await expect(page.getByTestId("reply-rules-tip")).toContainText("Many subreddits ban promotion");
  await expect(page.getByRole("link", { name: /Read r\/smallbusiness rules/ })).toHaveAttribute("href", "https://www.reddit.com/r/smallbusiness/about/rules");

  await box.fill(`${REPLY} Happy to answer questions here.`);
  await expect(page.getByTestId("reply-count")).toContainText("/ 1500");
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: /Copy reply and open thread/ }).click();
  expect((await popup).url()).toBe("https://www.reddit.com/r/smallbusiness/comments/1xr59oa/");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${REPLY} Happy to answer questions here.`);
  await expect.poll(() => saves.length).toBe(1); // an edited reply is saved when it is copied
  expect(saves[0]).toEqual({ id: "a", reply: `${REPLY} Happy to answer questions here.` });
});

test("I posted it marks the thread posted, and Dismiss hides it", async ({ page }) => {
  const leads = LEADS.map((l) => ({ ...l }));
  await serveLeads(page, () => leads);
  const statuses: { id: string; status: string }[] = [];
  await page.route("**/api/agents/leads/status", (route) => {
    const body = route.request().postDataJSON() as { id: string; status: string };
    statuses.push(body);
    const target = leads.find((l) => l.id === body.id) as { tags?: string[] } | undefined;
    if (target) target.tags = [`status:${body.status}`];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: body.id, status: body.status, tags: [`status:${body.status}`] }) });
  });
  await openReplies(page);
  await expect(page.getByTestId("reply-card")).toHaveCount(2);

  await page.getByTestId("reply-card").first().click(); // a
  await page.getByRole("button", { name: "I posted it" }).click();
  await expect(page.getByRole("tab", { name: /To answer \(1\)/ })).toBeVisible(); // back on the list, one left

  await page.getByTestId("reply-card").first().click(); // b
  await page.getByRole("button", { name: /Dismiss this thread/ }).click();
  await expect(page.getByRole("tab", { name: /To answer \(0\)/ })).toBeVisible();
  await page.getByRole("tab", { name: /Posted \(2\)/ }).click();
  await expect(page.getByTestId("reply-card")).toHaveCount(2);
  expect(statuses).toEqual([{ id: "a", status: "contacted" }, { id: "b", status: "not_interested" }]);
});

test("Find requests now searches, shows the new ones, and says so plainly when there are none", async ({ page }) => {
  let current: unknown[] = [];
  await page.route("**/api/agents/leads/search", (route) =>
    route.request().method() === "GET" ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: current }) }) : route.fallback(),
  );
  let calls = 0;
  await page.route("**/api/agents/leads/intent-search", (route) => {
    calls += 1;
    if (calls === 1) {
      current = [thread("n", "smallbusiness", "Need a CRM for my dental practice")];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: current, considered: 14, droppedSellers: 5, duplicates: 0, message: null }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: [], considered: 9, droppedSellers: 3, duplicates: 1, message: "Looked at 9 public posts and none was someone asking for what you sell. That is normal: most posts are not requests." }) });
  });
  await openReplies(page);

  await expect(page.getByTestId("reply-empty")).toContainText("No threads to answer yet");
  await page.getByRole("button", { name: "Find requests now" }).click();
  await expect(page.getByTestId("reply-card")).toHaveCount(1);
  await expect(page.getByTestId("reply-card")).toContainText("Need a CRM for my dental practice");

  await page.getByRole("button", { name: "Find requests now" }).click();
  await expect(page.getByText("none was someone asking for what you sell").first()).toBeVisible();
});

test("a search error is shown with Retry, not swallowed", async ({ page }) => {
  await serveLeads(page, []);
  await page.route("**/api/agents/leads/intent-search", (route) => route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "Marlo hasn't read what you sell yet. Finish setup so it can, then try again." }) }));
  await openReplies(page);
  await page.getByRole("button", { name: "Find requests now" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "hasn't read what you sell yet" });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("Posts is still there: switching back shows the post drafts list", async ({ page }) => {
  await serveLeads(page, LEADS);
  await openReplies(page);
  await page.getByRole("tab", { name: "Posts" }).click();
  await expect(page.getByRole("button", { name: /Generate new drafts/ })).toBeVisible();
});

test("a request with no saved reply starts from a template that discloses who is writing", async ({ page }) => {
  await serveLeads(page, [thread("t", "smallbusiness", "Looking for a CRM", { description: null })]);
  await openReplies(page);
  await page.getByTestId("reply-card").first().click();
  await expect(page.getByTestId("reply-text")).toHaveValue(/Full disclosure: I work on /);
});
