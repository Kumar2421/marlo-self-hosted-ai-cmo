// Plain-language auth messages for /login. Pure on purpose: no Next or
// Supabase imports, so the node tests can load it directly.

export const REPEATED_SIGNUP_MESSAGE =
  "An account with this email already exists. Sign in instead, or use Forgot password if you don't remember it.";
export const EMAIL_RATE_LIMIT_MESSAGE = "Too many emails sent. Wait a few minutes and try again.";
export const GOOGLE_SIGNIN_FAILED_MESSAGE =
  "Google sign-in didn't finish. Try again, or sign in with your email and password.";
export const GOOGLE_SIGNIN_CANCELLED_MESSAGE = "Google sign-in was cancelled.";
export const LINK_EXPIRED_MESSAGE = "That link has expired. Request a new code and try again.";

// resetPasswordForEmail succeeds for unknown emails by design, so the notice
// must not claim that a code was sent to this specific address.
export function resetCodeNotice(email: string): string {
  return `If an account exists for ${email}, we sent a code.`;
}

// Supabase's email OTP length is a project setting (6 by default, up to 10). Accept any length in that
// range instead of hard-coding one, so a dashboard change can't silently lock users out.
export const OTP_MIN_LENGTH = 6;
export const OTP_MAX_LENGTH = 10;

export function cleanOtp(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, OTP_MAX_LENGTH);
}

export function isOtpComplete(code: string): boolean {
  return /^\d+$/.test(code) && code.length >= OTP_MIN_LENGTH && code.length <= OTP_MAX_LENGTH;
}

export type AuthUserLike = { identities?: unknown[] | null } | null | undefined;

// Supabase signUp() for an email that is already registered returns HTTP 200
// with a user whose identities array is empty, and sends no email.
export function isRepeatedSignup(user: AuthUserLike): boolean {
  const identities = user?.identities;
  return Array.isArray(identities) && identities.length === 0;
}

export type HashParamsLike = { get(name: string): string | null };

export type FriendlyAuthError = {
  message: string;
  // Raw Supabase error_description. Never shown to the user; the page logs it.
  raw: string | null;
};

// Reads the error the server sends back to /login after a failed OAuth round
// trip: ?error=auth from /api/auth/callback, or #error=...&error_code=... from
// Supabase itself. Returns null when there is no auth error to show.
export function friendlyAuthError(
  queryError: string | null | undefined,
  hashParams: HashParamsLike | null | undefined,
): FriendlyAuthError | null {
  const hashError = hashParams?.get("error") ?? null;
  const errorCode = hashParams?.get("error_code") ?? null;
  const raw = hashParams?.get("error_description") ?? null;
  if (!queryError && !hashError && !errorCode) return null;

  if (errorCode === "otp_expired") return { message: LINK_EXPIRED_MESSAGE, raw };
  if (hashError === "access_denied" || errorCode === "access_denied") {
    return { message: GOOGLE_SIGNIN_CANCELLED_MESSAGE, raw };
  }
  // server_error / unexpected_failure, the callback's ?error=auth, and anything
  // else that arrives here all mean the Google sign-in did not complete.
  return { message: GOOGLE_SIGNIN_FAILED_MESSAGE, raw };
}

// Email send failures from signUp, resend and resetPasswordForEmail. Other
// errors pass through unchanged so the user still sees the real reason.
export function friendlyEmailSendError(error: { code?: string | null; message?: string | null }): string {
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (code === "over_email_send_rate_limit" || /rate limit/i.test(message)) {
    return EMAIL_RATE_LIMIT_MESSAGE;
  }
  return message || "Something went wrong. Try again.";
}
