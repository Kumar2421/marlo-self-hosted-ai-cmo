import { expect, test, type Page, type Response } from "@playwright/test";
import {
  TEST_EMAIL,
  TEST_PASSWORD,
  VALID_CODE,
  WRONG_CODE,
  mockSupabaseAuth,
  type AuthCall,
} from "./support/supabaseMock";

// Every test mocks Supabase Auth at the browser network layer (see support/supabaseMock.ts),
// so no user is created, no email is sent, and prod is never contacted from the browser.
//
// After a successful login the page calls router.push("/dashboard"). The server-side session
// check (proxy.ts) calls Supabase directly, which page.route() cannot intercept, so the
// dashboard itself is not expected to render. The tests assert that the client navigation
// was requested. When E2E_BASE_URL points at a deployed app, that server-side check would
// reach real Supabase with the fake session cookie, so those tests are skipped there.
const isDeployed = Boolean(process.env.E2E_BASE_URL);
const dashboardNavSkip = {
  skip: isDeployed,
  reason: "post-login redirect would make the deployed server call real Supabase; run locally",
};

// The root layout's ProjectProvider calls /api/project on mount. Signed-out visitors get a 401
// there, which is expected and not a page error.
const EXPECTED_BOOT_401 = /\/api\/project$/;

function hasCall(calls: AuthCall[], method: string, pathPrefix: string): boolean {
  return calls.some((c) => c.method === method && c.path.startsWith(pathPrefix));
}

/** Start waiting for the client-side navigation to /dashboard. Call before the click that triggers it. */
function waitForDashboardNavigation(page: Page) {
  return page.waitForRequest((req) => new URL(req.url()).pathname === "/dashboard");
}

async function signInWith(page: Page, email: string, password: string) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
}

async function startSignUp(page: Page) {
  await page.goto("/login?mode=signup");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(TEST_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Create Account" }).click();
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
}

test.describe("sign in", () => {
  test("(a) sign-in page renders", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
  });

  test("(a) invalid credentials show the error banner", async ({ page }) => {
    await mockSupabaseAuth(page, { signIn: "invalid" });
    await page.goto("/login");
    await signInWith(page, TEST_EMAIL, "wrong-password");
    await expect(page.getByText("Invalid login credentials")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("(b) successful password sign-in requests a token and navigates to dashboard", async ({ page }) => {
    test.skip(dashboardNavSkip.skip, dashboardNavSkip.reason);
    const calls = await mockSupabaseAuth(page, { signIn: "ok" });
    await page.goto("/login");
    const navigated = waitForDashboardNavigation(page);
    await signInWith(page, TEST_EMAIL, TEST_PASSWORD);
    await navigated;
    expect(hasCall(calls, "POST", "/token")).toBe(true);
  });
});

test.describe("sign up", () => {
  test("(c) new email moves to the verification code step", async ({ page }) => {
    const calls = await mockSupabaseAuth(page, { signUp: "new" });
    await startSignUp(page);
    await expect(page.getByLabel("Verification code", { exact: true })).toBeVisible();
    await expect(page.getByText(`Enter the code we sent to ${TEST_EMAIL}.`)).toBeVisible();
    expect(hasCall(calls, "POST", "/signup")).toBe(true);
  });

  test("(c) resend code calls /resend", async ({ page }) => {
    const calls = await mockSupabaseAuth(page, { signUp: "new" });
    await startSignUp(page);
    await page.getByRole("button", { name: "Resend code" }).click();
    await expect.poll(() => hasCall(calls, "POST", "/resend")).toBe(true);
    const resend = calls.find((c) => c.path.startsWith("/resend"));
    expect((resend?.body as { type?: string } | undefined)?.type).toBe("signup");
  });

  // The resend handler sets a "Code resent" notice, but the verify-code step only renders
  // `error`, not `notice`, so the confirmation never appears. Remove test.fixme when fixed.
  test("(c) resend shows a confirmation on the code step", async ({ page }) => {
    await mockSupabaseAuth(page, { signUp: "new" });
    await startSignUp(page);
    await page.getByRole("button", { name: "Resend code" }).click();
    await expect(page.getByText("Code resent — check your inbox.")).toBeVisible();
  });

  test("(c) wrong code shows the error and stays on the code step", async ({ page }) => {
    await mockSupabaseAuth(page, { signUp: "new", validCode: VALID_CODE });
    await startSignUp(page);
    await page.getByLabel("Verification code", { exact: true }).fill(WRONG_CODE);
    await page.getByRole("button", { name: "Verify & continue" }).click();
    await expect(page.getByText("Token has expired or is invalid")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  });

  // Supabase's email OTP length is a project setting; an 8-digit code used to be cut to 6 characters.
  test("(c) an 8-digit code can be typed in full and submitted", async ({ page }) => {
    const EIGHT = "12345678";
    await mockSupabaseAuth(page, { signUp: "new", validCode: EIGHT });
    await startSignUp(page);
    const input = page.getByLabel("Verification code", { exact: true });
    await input.fill(EIGHT);
    await expect(input).toHaveValue(EIGHT);
    await expect(page.getByRole("button", { name: "Verify & continue" })).toBeEnabled();
    await input.fill("12345");
    await expect(page.getByRole("button", { name: "Verify & continue" })).toBeDisabled();
  });

  test("(c) correct code proceeds to dashboard", async ({ page }) => {
    test.skip(dashboardNavSkip.skip, dashboardNavSkip.reason);
    await mockSupabaseAuth(page, { signUp: "new", validCode: VALID_CODE });
    await startSignUp(page);
    await page.getByLabel("Verification code", { exact: true }).fill(VALID_CODE);
    const navigated = waitForDashboardNavigation(page);
    await page.getByRole("button", { name: "Verify & continue" }).click();
    await navigated;
  });

  // Known bug on current main, being fixed in another branch. Supabase returns an empty
  // identities array for an already-registered address, but login/page.tsx only checks for
  // a missing session, so it still switches to the code step and says a code was sent.
  // Remove test.fixme when the fix lands.
  test("(d) already registered email does not claim a code was sent", async ({ page }) => {
    await mockSupabaseAuth(page, { signUp: "existing" });
    await page.goto("/login?mode=signup");
    await page.getByLabel("Email", { exact: true }).fill(TEST_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page.getByText(/we sent to|code we sent/i)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Verify your email" })).toHaveCount(0);
  });
});

test.describe("forgot password", () => {
  test("(e) request code, verify, and set a new password", async ({ page }) => {
    test.skip(dashboardNavSkip.skip, dashboardNavSkip.reason);
    const calls = await mockSupabaseAuth(page, { validCode: VALID_CODE });
    await page.goto("/login");
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();

    await page.getByLabel("Email", { exact: true }).fill(TEST_EMAIL);
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByText(`If an account exists for ${TEST_EMAIL}, we sent a code.`)).toBeVisible();
    expect(hasCall(calls, "POST", "/recover")).toBe(true);

    await page.getByLabel("Verification code", { exact: true }).fill(VALID_CODE);
    await page.getByLabel("New password", { exact: true }).fill("new-e2e-password-456");
    const navigated = waitForDashboardNavigation(page);
    await page.getByRole("button", { name: "Reset password" }).click();
    await navigated;

    const verify = calls.find((c) => c.method === "POST" && c.path.startsWith("/verify"));
    expect((verify?.body as { type?: string } | undefined)?.type).toBe("recovery");
    expect(hasCall(calls, "PUT", "/user")).toBe(true);
  });
});

test.describe("google sign-in", () => {
  const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";

  test("(f) Google button starts the authorize flow when enabled", async ({ page }) => {
    test.skip(!googleEnabled, "NEXT_PUBLIC_GOOGLE_AUTH_ENABLED is not true; the Google button is disabled in this build");
    await mockSupabaseAuth(page);
    await page.goto("/login");
    const googleButton = page.getByRole("button", { name: "Google", exact: true });
    await expect(googleButton).toBeEnabled();

    const authorizeRequest = page.waitForRequest((req) => req.url().includes("/auth/v1/authorize"));
    await googleButton.click();
    const url = new URL((await authorizeRequest).url());
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("redirect_to")).toContain("/api/auth/callback");
  });

  // The login page does not read window.location.hash, so the provider error is never shown.
  // Remove test.fixme when the other branch that surfaces OAuth errors on /login lands.
  test("(f) provider error in the URL hash is shown", async ({ page }) => {
    await page.goto("/login#error=server_error&error_code=unexpected_failure&error_description=x");
    await expect(page.getByText(/Google sign-in didn.t finish/i)).toBeVisible();
  });
});

test.describe("accessibility and basics", () => {
  test("(g) form fields are labelled and Enter submits", async ({ page }) => {
    const calls = await mockSupabaseAuth(page, { signIn: "invalid" });
    await page.goto("/login");
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();

    await page.getByLabel("Email", { exact: true }).fill(TEST_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill("wrong-password");
    await page.getByLabel("Password", { exact: true }).press("Enter");
    await expect(page.getByText("Invalid login credentials")).toBeVisible();
    expect(hasCall(calls, "POST", "/token")).toBe(true);
  });

  test("(g) no console errors or unexpected HTTP errors on load", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (msg) => {
      // Failed resource loads are checked below from the response itself, with the URL.
      if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource")) problems.push(msg.text());
    });
    page.on("pageerror", (err) => problems.push(err.message));
    page.on("response", (res: Response) => {
      const path = new URL(res.url()).pathname;
      if (res.status() < 400) return;
      if (res.status() === 401 && EXPECTED_BOOT_401.test(path)) return;
      problems.push(`HTTP ${res.status()} ${res.url()}`);
    });

    await mockSupabaseAuth(page);
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(problems).toEqual([]);
  });
});
