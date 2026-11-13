import { expect, test } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// "Find requests": public Reddit posts where someone asks for what the user sells, with the reply drafted for the user
// to post from their own account. Every API is mocked; no search, model or Reddit page is ever contacted.

test.describe.configure({ timeout: 60_000 });
test.use({ viewport: { width: 1536, height: 900 } });

const PROFILE = { version: 1, roles: [], industries: ["small clinics"], sizes: [], locations: [], problem: "", exclude: [], webRelated: false, confirmedAt: "2026-11-05T00:00:00Z" };
const OFFER = {
  version: 1, archetype: "service", sells: "custom software and CRM", whoPays: "small clinics", clientKind: "companies", roles: [], industries: ["small clinics"], locations: [], problem: "", webRelated: false,
  evidence: { sells: { quote: "builds custom software and CRM", url: "https://acme.example.test/" } }, sources: ["https://acme.example.test/"], derivedAt: "2026-11-05T00:00:00Z",
};
const POST_URL = "https://www.reddit.com/r/smallbusiness/comments/1xr59oi/";
const REQUEST = {
  id: "r1", project_id: "p1", name: "Recommend a CRM system for a small clinic", title: "", company: "r/smallbusiness", location: "", lead_type: "intent", email: null, email_verified: 0,
  website: null, source_url: POST_URL, fit_reason: 'Asked on r/smallbusiness: "Recommend a CRM system for a small clinic".', query: "requests for custom software and CRM", created_at: "2026-11-11T00:00:00Z",
};

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL! });
  await signIn(context, baseURL!);
  await mockDashboardApi(page);
  await serveLottieWasmLocally(page);
  await page.route("**/api/agents/leads/search", (route) =>
    route.request().method() === "GET" ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: [] }) }) : route.fallback(),
  );
  await page.route(/reddit\.com/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" }));
});

async function mockProfile(page: import("@playwright/test").Page, offer: unknown) {
  await page.route("**/api/agents/leads/profile", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: PROFILE, suggestion: null, offer }) }),
  );
}

test("the button appears only once Marlo has read what the user sells", async ({ page }) => {
  await mockProfile(page, null);
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Find companies" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Find requests" })).toHaveCount(0);
});

test("Find requests saves the posts the model kept, with the post, the subreddit and the quote", async ({ page }) => {
  await mockProfile(page, OFFER);
  let calls = 0;
  await page.route("**/api/agents/leads/intent-search", (route) => {
    calls += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: [REQUEST], considered: 14, droppedSellers: 5, duplicates: 0, message: null }) });
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Find requests" }).click();
  await expect.poll(() => calls).toBe(1);

  await expect(page.getByRole("tab", { name: "Qualified (1)" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Recommend a CRM system for a small clinic").first()).toBeVisible();
  await expect(page.getByTestId("lead-why")).toContainText("Asked on r/smallbusiness");
  await expect(page.locator('[data-testid="lead-chips"]').getByText("Reddit", { exact: true })).toBeVisible();
});

test("the reply draft is useful first, discloses who is writing, and opens the post after copying", async ({ page }) => {
  await mockProfile(page, OFFER);
  await page.route("**/api/agents/leads/search", (route) =>
    route.request().method() === "GET" ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: [REQUEST] }) }) : route.fallback(),
  );
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /^Reach Recommend a CRM/ }).click();
  const dialog = page.getByRole("dialog", { name: /^Reach Recommend a CRM/ });

  const message = dialog.getByTestId("reach-message");
  await expect(message).toHaveValue(/^Happy to help with this\./);
  await expect(message).toHaveValue(/Full disclosure: I work on .*, so I'm biased\./);
  await expect(message).toHaveValue(/Happy to answer questions here/);
  await expect(dialog.getByTestId("reddit-tip")).toContainText("Read the subreddit's rules first");

  const popup = page.waitForEvent("popup");
  await dialog.getByRole("button", { name: /Copy reply and open the post/ }).click();
  expect((await popup).url()).toBe(POST_URL);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^Happy to help with this\./);
});

test("when no post is a request it says so plainly and saves nothing, and an error is shown", async ({ page }) => {
  await mockProfile(page, OFFER);
  await page.route("**/api/agents/leads/intent-search", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: [], considered: 12, droppedSellers: 6, duplicates: 0, message: "Looked at 12 public posts and none was someone asking for what you sell. That is normal: most posts are not requests." }) }),
  );
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Find requests" }).click();
  await expect(page.getByText("none was someone asking for what you sell").first()).toBeVisible();

  await page.unroute("**/api/agents/leads/intent-search");
  await page.route("**/api/agents/leads/intent-search", (route) => route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "Marlo hasn't read what you sell yet. Finish setup so it can, then try again." }) }));
  await page.getByRole("button", { name: "Find requests" }).click();
  await expect(page.getByText("hasn't read what you sell yet").first()).toBeVisible();
});
