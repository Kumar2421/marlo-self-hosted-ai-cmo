import test from "node:test";
import assert from "node:assert/strict";
import {
  EMAIL_NOT_CONFIRMED_MESSAGE,
  EMAIL_RATE_LIMIT_MESSAGE,
  GOOGLE_SIGNIN_CANCELLED_MESSAGE,
  GOOGLE_SIGNIN_FAILED_MESSAGE,
  REPEATED_SIGNUP_MESSAGE,
  RESEND_COOLDOWN_SECONDS,
  friendlyAuthError,
  friendlyEmailSendError,
  isEmailNotConfirmed,
  isRepeatedSignup,
  resetCodeNotice,
  cleanOtp,
  isOtpComplete,
} from "../lib/domain/auth/authMessages.ts";

// Mirrors how /login reads the callback: query params first, then the Supabase hash on top.
function paramsFrom(query: string, hash = ""): URLSearchParams {
  const params = new URLSearchParams(query);
  new URLSearchParams(hash).forEach((value, key) => params.set(key, value));
  return params;
}

test("signUp for an already-registered email has an empty identities array", () => {
  assert.equal(isRepeatedSignup({ identities: [] }), true);
});

test("a normal new signup is not treated as a repeat", () => {
  assert.equal(isRepeatedSignup({ identities: [{ provider: "email" }] }), false);
  assert.equal(isRepeatedSignup({ identities: undefined }), false);
  assert.equal(isRepeatedSignup(null), false);
  assert.equal(isRepeatedSignup(undefined), false);
});

test("repeat signup message tells the user to sign in or reset", () => {
  assert.match(REPEATED_SIGNUP_MESSAGE, /already exists/);
  assert.match(REPEATED_SIGNUP_MESSAGE, /Sign in instead/);
  assert.match(REPEATED_SIGNUP_MESSAGE, /Forgot password/);
});

test("no auth error in the query or hash returns null", () => {
  assert.equal(friendlyAuthError(null, new URLSearchParams("")), null);
  assert.equal(friendlyAuthError(undefined, null), null);
  assert.equal(friendlyAuthError(null, new URLSearchParams("foo=bar")), null);
});

test("the callback's ?error=auth maps to the Google failure message", () => {
  const out = friendlyAuthError("auth", null);
  assert.equal(out?.message, GOOGLE_SIGNIN_FAILED_MESSAGE);
  assert.equal(out?.raw, null);
});

test("Supabase server_error/unexpected_failure hash maps to the Google failure message", () => {
  const hash = new URLSearchParams(
    "error=server_error&error_code=unexpected_failure&error_description=Database+error+saving+new+user",
  );
  const out = friendlyAuthError(null, hash);
  assert.equal(out?.message, GOOGLE_SIGNIN_FAILED_MESSAGE);
  assert.equal(out?.raw, "Database error saving new user");
});

test("access_denied maps to the cancelled message", () => {
  const hash = new URLSearchParams("error=access_denied&error_code=access_denied&error_description=User+denied");
  assert.equal(friendlyAuthError(null, hash)?.message, GOOGLE_SIGNIN_CANCELLED_MESSAGE);
});

test("an expired link is not reported as a cancelled sign-in", () => {
  const hash = new URLSearchParams("error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid");
  assert.match(friendlyAuthError(null, hash)?.message ?? "", /expired/);
});

test("raw error_description text never appears in the user-facing message", () => {
  const raw = "Database error saving new user";
  const hash = new URLSearchParams(`error=server_error&error_code=unexpected_failure&error_description=${encodeURIComponent(raw)}`);
  const out = friendlyAuthError(null, hash);
  assert.ok(out);
  assert.equal(out.message.includes(raw), false);
  assert.equal(out.raw, raw);
});

test("over_email_send_rate_limit maps to the rate limit message", () => {
  assert.equal(
    friendlyEmailSendError({ code: "over_email_send_rate_limit", message: "email rate limit exceeded" }),
    EMAIL_RATE_LIMIT_MESSAGE,
  );
});

test("any 'rate limit' message maps to the rate limit message", () => {
  assert.equal(friendlyEmailSendError({ message: "Email rate limit exceeded" }), EMAIL_RATE_LIMIT_MESSAGE);
  assert.equal(friendlyEmailSendError({ code: null, message: "rate limit reached" }), EMAIL_RATE_LIMIT_MESSAGE);
});

test("other email errors pass through unchanged", () => {
  assert.equal(friendlyEmailSendError({ code: "weak_password", message: "Password is too weak" }), "Password is too weak");
  assert.equal(friendlyEmailSendError({}), "Something went wrong. Try again.");
});

test("reset notice is generic and does not confirm the account exists", () => {
  assert.equal(
    resetCodeNotice("someone@example.com"),
    "If an account exists for someone@example.com, we sent a code.",
  );
});

test("otp: any 6-10 digit numeric code is accepted, anything else is not", () => {
  for (const code of ["123456", "12345678", "1234567890"]) assert.equal(isOtpComplete(code), true, code);
  for (const code of ["", "12345", "12345678901", "12ab5678", "123 456"]) assert.equal(isOtpComplete(code), false, code);
});

test("otp: input is stripped to digits and capped at 10", () => {
  assert.equal(cleanOtp("48 29-16"), "482916");
  assert.equal(cleanOtp("12345678"), "12345678");
  assert.equal(cleanOtp("123456789012345"), "1234567890");
});

test("the callback's query error=access_denied (user cancelled Google) maps to the cancelled message", () => {
  const params = paramsFrom("error=access_denied&error_description=User+denied+consent");
  const out = friendlyAuthError(params.get("error"), params);
  assert.equal(out?.message, GOOGLE_SIGNIN_CANCELLED_MESSAGE);
  assert.equal(out?.raw, "User denied consent");
});

test("a provider error from the query keeps its error_description out of the message", () => {
  const raw = "Unable to exchange external code";
  const params = paramsFrom(`error=server_error&error_description=${encodeURIComponent(raw)}`);
  const out = friendlyAuthError(params.get("error"), params);
  assert.equal(out?.message, GOOGLE_SIGNIN_FAILED_MESSAGE);
  assert.equal(out?.raw, raw);
  assert.equal(out?.message.includes(raw), false);
});

test("a query otp_expired code maps to the expired message", () => {
  const params = paramsFrom("error=access_denied&error_code=otp_expired");
  assert.match(friendlyAuthError(params.get("error"), params)?.message ?? "", /expired/);
});

test("the hash from Supabase still wins over an older query error", () => {
  const params = paramsFrom("error=auth", "error=access_denied&error_code=access_denied");
  assert.equal(friendlyAuthError(params.get("error"), params)?.message, GOOGLE_SIGNIN_CANCELLED_MESSAGE);
});

test("'Email not confirmed' is detected by Supabase error code", () => {
  assert.equal(isEmailNotConfirmed({ code: "email_not_confirmed", message: "Email not confirmed" }), true);
});

test("'Email not confirmed' is detected by message when no code is present", () => {
  assert.equal(isEmailNotConfirmed({ message: "Email not confirmed" }), true);
  assert.equal(isEmailNotConfirmed({ code: null, message: "email not confirmed" }), true);
});

test("other sign-in errors are not treated as unconfirmed email", () => {
  assert.equal(isEmailNotConfirmed({ code: "invalid_credentials", message: "Invalid login credentials" }), false);
  assert.equal(isEmailNotConfirmed({}), false);
});

test("unconfirmed-email message is friendly and points to the code", () => {
  assert.match(EMAIL_NOT_CONFIRMED_MESSAGE, /isn't confirmed yet/);
  assert.match(EMAIL_NOT_CONFIRMED_MESSAGE, /request a new one/);
  assert.equal(EMAIL_NOT_CONFIRMED_MESSAGE.includes("Email not confirmed"), false);
});

test("resend cooldown is 30 seconds", () => {
  assert.equal(RESEND_COOLDOWN_SECONDS, 30);
});
