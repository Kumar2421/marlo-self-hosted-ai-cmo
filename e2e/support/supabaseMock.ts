import type { Page, Route } from "@playwright/test";

/**
 * Mocks every Supabase Auth request the browser makes (<host>/auth/v1/**).
 *
 * Nothing reaches Supabase: no users are created, no emails are sent, and
 * prod is never contacted. Any auth endpoint not handled here is answered
 * with a 404 so an unexpected call fails visibly in the test.
 */

export type AuthCall = { method: string; path: string; body: unknown };

export type AuthMockOptions = {
  /** Result of POST /token?grant_type=password. */
  signIn?: "ok" | "invalid";
  /** Result of POST /signup: a new user (needs a code) or an already registered address. */
  signUp?: "new" | "existing";
  /** Code accepted by POST /verify (both signup and recovery). */
  validCode?: string;
};

export const VALID_CODE = "123456";
export const WRONG_CODE = "000000";
export const TEST_EMAIL = "e2e-user@example.test";
export const TEST_PASSWORD = "e2e-password-123";

const USER_ID = "00000000-0000-4000-8000-0000000000e2";

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeAccessToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({
    sub: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: TEST_EMAIL,
    exp,
  })}.e2e-signature`;
}

function userPayload(identities: unknown[]) {
  const now = new Date().toISOString();
  return {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: TEST_EMAIL,
    email_confirmed_at: now,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities,
    created_at: now,
    updated_at: now,
  };
}

function sessionPayload() {
  return {
    access_token: fakeAccessToken(),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "e2e-refresh-token",
    user: userPayload([{ provider: "email" }]),
  };
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
};

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readBody(route: Route): Promise<unknown> {
  const raw = route.request().postData();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Installs the mock. Returns the list of Supabase auth calls the page made, in order,
 * so tests can assert on what was requested without any real backend.
 */
export async function mockSupabaseAuth(page: Page, options: AuthMockOptions = {}): Promise<AuthCall[]> {
  const calls: AuthCall[] = [];
  const validCode = options.validCode ?? VALID_CODE;
  const signIn = options.signIn ?? "ok";
  const signUp = options.signUp ?? "new";

  await page.route("**/auth/v1/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/auth\/v1/, "");

    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }

    const body = await readBody(route);
    calls.push({ method, path: `${path}${url.search}`, body });

    if (method === "POST" && path === "/token") {
      if (signIn === "invalid") {
        await fulfillJson(route, 400, {
          code: 400,
          error_code: "invalid_credentials",
          msg: "Invalid login credentials",
        });
        return;
      }
      await fulfillJson(route, 200, sessionPayload());
      return;
    }

    if (method === "POST" && path === "/signup") {
      // Supabase returns the user object directly when confirmation is required (no session).
      // An already-registered address comes back with an empty identities array.
      const identities = signUp === "existing" ? [] : [{ provider: "email" }];
      await fulfillJson(route, 200, userPayload(identities));
      return;
    }

    if (method === "POST" && path === "/resend") {
      await fulfillJson(route, 200, { message_id: "e2e-message" });
      return;
    }

    if (method === "POST" && path === "/recover") {
      await fulfillJson(route, 200, {});
      return;
    }

    if (method === "POST" && path === "/verify") {
      const token = (body as { token?: string } | undefined)?.token;
      if (token !== validCode) {
        await fulfillJson(route, 403, {
          code: 403,
          error_code: "otp_expired",
          msg: "Token has expired or is invalid",
        });
        return;
      }
      await fulfillJson(route, 200, sessionPayload());
      return;
    }

    if (method === "PUT" && path === "/user") {
      await fulfillJson(route, 200, userPayload([{ provider: "email" }]));
      return;
    }

    await fulfillJson(route, 404, {
      code: 404,
      error_code: "e2e_unmocked_endpoint",
      msg: `Unmocked Supabase auth call: ${method} ${path}`,
    });
  });

  return calls;
}
