"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, Lock, KeyRound, ArrowLeft } from "lucide-react";
import GhostLoader from "@/components/shared/GhostLoader";
import { createClient } from "@/utils/supabase/client";
import { sessionMarkerCookie } from "@/utils/supabase/sessionPersistence";
import { FEATURES } from "@/lib/features";
import { scopesFor } from "@/lib/googleOAuthScopes";
import type { AuditFunnelPayload } from "@/lib/analytics/auditFunnel";
import {
  friendlyAuthError,
  friendlyEmailSendError,
  isRepeatedSignup,
  resetCodeNotice,
  cleanOtp,
  OTP_MAX_LENGTH,
  isOtpComplete,
  REPEATED_SIGNUP_MESSAGE,
  EMAIL_NOT_CONFIRMED_MESSAGE,
  RESEND_COOLDOWN_SECONDS,
  isEmailNotConfirmed,
} from "@/lib/domain/auth/authMessages";
import {
  GoogleSearchConsoleIcon,
  GoogleAnalyticsIcon,
  GmailIcon,
  GitHubIcon,
  PageSpeedIcon,
  TavilyIcon,
  GooglePlacesIcon,
  WordPressIcon,
  WebflowIcon,
  FramerIcon,
  WixIcon,
  SanityIcon,
  LinkedInIcon,
  XIcon,
  WhatsAppIcon,
  TelegramIcon,
  TikTokIcon,
  InstagramIcon,
  SlackIcon,
} from "@/components/login/IntegrationIcons";

// Same "live today" set as the marketing site's integrations section
// (marlo/src/components/sites/marlo/root/IntegrationsSection.tsx) -- keep
// these two in sync if either changes.
const INTEGRATIONS: { label: string; icon: typeof GmailIcon; soon?: boolean }[] = [
  { label: "Google Search\nConsole", icon: GoogleSearchConsoleIcon },
  { label: "Google Analytics", icon: GoogleAnalyticsIcon },
  { label: "Gmail", icon: GmailIcon },
  { label: "GitHub", icon: GitHubIcon },
  { label: "PageSpeed\nInsights", icon: PageSpeedIcon },
  { label: "Tavily", icon: TavilyIcon },
  { label: "Google Places", icon: GooglePlacesIcon },
  { label: "WordPress", icon: WordPressIcon, soon: true },
  { label: "Webflow", icon: WebflowIcon, soon: true },
  { label: "Framer", icon: FramerIcon, soon: true },
  { label: "Wix", icon: WixIcon, soon: true },
  { label: "Sanity", icon: SanityIcon, soon: true },
  { label: "LinkedIn", icon: LinkedInIcon, soon: true },
  { label: "X (Twitter)", icon: XIcon, soon: true },
  { label: "WhatsApp", icon: WhatsAppIcon, soon: true },
  { label: "Telegram", icon: TelegramIcon, soon: true },
  { label: "TikTok", icon: TikTokIcon, soon: true },
  { label: "Instagram", icon: InstagramIcon, soon: true },
  { label: "Slack", icon: SlackIcon, soon: true },
];

type Mode = "signin" | "signup" | "verify-signup" | "forgot" | "verify-reset";

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z" fill="#34A853" />
      <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84Z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" fill="#EB4335" />
    </svg>
  );
}

function trackSignupCompleted() {
  if (typeof window === "undefined") return;
  const sessionId = window.localStorage.getItem("marlo:audit-session-id");
  if (!sessionId) return;
  const payload: AuditFunnelPayload & { sessionId: string } = {
    event: "signup_completed",
    sessionId,
  };
  const body = JSON.stringify(payload);
  if ("sendBeacon" in navigator) {
    navigator.sendBeacon("/api/public/audit/events", new Blob([body], { type: "application/json" }));
    return;
  }
  void fetch("/api/public/audit/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>(() => (searchParams.get("mode") === "signup" ? "signup" : "signin"));

  // A `useState` lazy initializer only runs on first mount. When this page
  // is reached via a client-side <Link> transition (e.g. from /audit's
  // "Create free account" CTA), Next's router can reuse an already-mounted
  // /login instance from an earlier prefetch of the plain, param-less
  // "/login" link in the page header -- the initializer never re-runs, so
  // the page silently stays in sign-in mode despite ?mode=signup in the
  // URL. useSearchParams() is reactive to client-side navigation, so
  // resyncing from it here self-corrects regardless of how the page was
  // reached. Confirmed live: reproduced this exact stuck-in-signin state
  // against production going through the real CTA link.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(searchParams.get("mode") === "signup" ? "signup" : "signin");
  }, [searchParams]);

  // Default on: persistent session. Off: session cookies only (see sessionPersistence.ts).
  const [rememberMe, setRememberMe] = useState(true);
  const applyRememberChoice = () => {
    document.cookie = sessionMarkerCookie(rememberMe);
  };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Counts the resend cooldown down one second at a time. The timeout is
  // scheduled from an effect, so state is only updated from the timer.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = window.setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [resendCooldown]);

  // Google/OAuth failures come back as ?error=... from our callback (with
  // optional error_code / error_description) or as a #error=... hash from
  // Supabase. Read both, show a plain message, keep the raw Supabase text out
  // of the page, and drop the params so a refresh does not show it again.
  useEffect(() => {
    const url = new URL(window.location.href);
    const params = new URLSearchParams(url.search);
    new URLSearchParams(window.location.hash.replace(/^#/, "")).forEach((value, key) => params.set(key, value));
    const friendly = friendlyAuthError(params.get("error"), params);
    if (!friendly) return;
    if (friendly.raw) console.warn("[login] auth error:", friendly.raw);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(friendly.message);
    url.searchParams.delete("error");
    url.searchParams.delete("error_code");
    url.searchParams.delete("error_description");
    url.hash = "";
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  }, []);

  const getPendingAuditUrl = () => {
    if (typeof window === "undefined") return null;
    const url = new URLSearchParams(window.location.search).get("url");
    return url;
  };

  const isSignUp = mode === "signup";

  const persistPendingAuditUrl = () => {
    const pendingAuditUrl = getPendingAuditUrl();
    if (pendingAuditUrl) localStorage.setItem("marlo:pending-audit-url", pendingAuditUrl);
  };

  const toggleMode = () => {
    setMode(isSignUp ? "signin" : "signup");
    setError(null);
    setNotice(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setNotice(null);
    applyRememberChoice();

    if (isSignUp) {
      const pendingAuditUrl = getPendingAuditUrl();
      if (pendingAuditUrl) localStorage.setItem("marlo:pending-audit-url", pendingAuditUrl);
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signUp({ email, password });
      if (authError) {
        setError(friendlyEmailSendError(authError));
      } else if (!data.session && isRepeatedSignup(data.user)) {
        // Supabase sends no email for an existing address, so do not show the
        // code screen. Send the user to sign-in with the email kept.
        setMode("signin");
        setError(REPEATED_SIGNUP_MESSAGE);
      } else if (!data.session) {
        setOtpCode("");
        // Supabase just sent the confirmation email, so hold off on a resend.
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
        setMode("verify-signup");
      } else {
        trackSignupCompleted();
        router.push("/dashboard");
        router.refresh();
      }
    } else {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError && isEmailNotConfirmed(authError)) {
        // Account exists but was never confirmed: send the user to the code screen, where Resend lives.
        setOtpCode("");
        setError(EMAIL_NOT_CONFIRMED_MESSAGE);
        setMode("verify-signup");
      } else if (authError) {
        setError(authError.message);
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    }

    setIsLoading(false);
  };

  // Email OTP verification — the same confirmation token Supabase always
  // generates on signUp(), just entered as a numeric code instead of
  // followed as a link. Requires the "Confirm signup" email template in
  // Supabase Dashboard -> Authentication -> Email Templates to include
  // {{ .Token }} -- otherwise the email still only shows the old link and
  // there's no code for the user to type here.
  const handleVerifySignupOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    applyRememberChoice();
    const supabase = createClient();
    const { error: otpError } = await supabase.auth.verifyOtp({ email, token: otpCode, type: "signup" });
    if (otpError) {
      setError(otpError.message);
      setIsLoading(false);
      return;
    }
    trackSignupCompleted();
    router.push("/dashboard");
    router.refresh();
  };

  const handleResendSignupOtp = async () => {
    if (resendCooldown > 0) return;
    setError(null);
    setNotice(null);
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    const supabase = createClient();
    const { error: resendError } = await supabase.auth.resend({ type: "signup", email });
    if (resendError) setError(friendlyEmailSendError(resendError));
    else setNotice("Code resent — check your inbox.");
  };

  // Password reset, same OTP pattern: resetPasswordForEmail() sends the
  // recovery email (needs {{ .Token }} in the "Reset Password" template too),
  // verifyOtp(type: "recovery") exchanges the code for a real session, then
  // updateUser() sets the new password on that session.
  const handleRequestPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);
    if (resetError) {
      setError(friendlyEmailSendError(resetError));
      setIsLoading(false);
      return;
    }
    setOtpCode("");
    setNewPassword("");
    setMode("verify-reset");
    setIsLoading(false);
  };

  const handleVerifyResetOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: otpError } = await supabase.auth.verifyOtp({ email, token: otpCode, type: "recovery" });
    if (otpError) {
      setError(otpError.message);
      setIsLoading(false);
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) {
      setError(updateError.message);
      setIsLoading(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  };

  const backToSignIn = () => {
    setMode("signin");
    setOtpCode("");
    setNewPassword("");
    setError(null);
    setNotice(null);
  };

  // Enable once Google is turned on in the Supabase project's Auth
  // provider settings — this route alone doesn't grant that. Google is
  // wired for production (FEATURES.PLATFORM_MODE); flip
  // NEXT_PUBLIC_GOOGLE_AUTH_ENABLED once the Supabase provider is live.
  const oauthAvailable = {
    google: FEATURES.PLATFORM_MODE && process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true",
  };

  const handleOAuth = async (provider: "google") => {
    setError(null);
    applyRememberChoice();
    persistPendingAuditUrl();
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
        ...(provider === "google" && FEATURES.PLATFORM_MODE
          ? { scopes: scopesFor("login") }
          : {}),
      },
    });
  };

  return (
    <section className="h-dvh overflow-hidden bg-white p-3 text-black antialiased">
      <div className="grid h-[calc(100dvh-1.5rem)] gap-6 lg:grid-cols-[0.94fr_1.06fr]">
        {/* Left: sign-in / sign-up form */}
        <div className="flex items-center justify-center overflow-y-auto rounded-md border border-black/10 bg-white px-6 py-6 sm:px-10 lg:px-14 xl:px-16">
          <div className="w-full max-w-[420px]">
            <div className="mb-2 flex items-center gap-2">
              <GhostLoader className="h-6 w-6" />
              <span className="text-sm font-bold tracking-tight">Marlo</span>
            </div>

            {mode === "verify-signup" || mode === "verify-reset" ? (
              <>
                <h1 className="text-2xl font-medium tracking-[-0.04em] sm:text-3xl">
                  {mode === "verify-signup" ? "Verify your email" : "Reset your password"}
                </h1>
                <p className="mt-1.5 text-sm leading-snug text-black/60">
                  {mode === "verify-signup" ? `Enter the code we sent to ${email}.` : resetCodeNotice(email)}
                </p>

                <form
                  className="mt-5 flex flex-col gap-3.5"
                  onSubmit={mode === "verify-signup" ? handleVerifySignupOtp : handleVerifyResetOtp}
                >
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="otp" className="text-[13px] font-medium text-gray-700">
                      Verification code
                    </label>
                    <div className="flex h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 focus-within:border-gray-900">
                      <KeyRound className="h-4 w-4 shrink-0 text-gray-400" />
                      <input
                        id="otp"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={OTP_MAX_LENGTH}
                        value={otpCode}
                        onChange={(e) => setOtpCode(cleanOtp(e.target.value))}
                        placeholder="Enter code"
                        required
                        className="h-full w-full text-sm tracking-[0.3em] outline-none"
                      />
                    </div>
                  </div>

                  {mode === "verify-reset" && (
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="newPassword" className="text-[13px] font-medium text-gray-700">
                        New password
                      </label>
                      <div className="flex h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 focus-within:border-gray-900">
                        <Lock className="h-4 w-4 shrink-0 text-gray-400" />
                        <input
                          id="newPassword"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Create a new password"
                          required
                          minLength={6}
                          className="h-full w-full text-sm outline-none"
                        />
                      </div>
                    </div>
                  )}

                  {error && <div className="text-sm text-red-600">{error}</div>}
                  {notice && <div className="text-sm text-green-600">{notice}</div>}

                  <button
                    type="submit"
                    disabled={isLoading || !isOtpComplete(otpCode)}
                    className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#111111] text-sm font-medium text-white hover:bg-black disabled:opacity-50"
                  >
                    {isLoading ? <GhostLoader className="h-4 w-4" tone="light" /> : null}
                    {isLoading ? "Verifying..." : mode === "verify-signup" ? "Verify & continue" : "Reset password"}
                  </button>
                </form>

                <div className="mt-4 flex items-center justify-between text-sm">
                  {mode === "verify-signup" ? (
                    <button
                      type="button"
                      onClick={handleResendSignupOtp}
                      disabled={resendCooldown > 0}
                      className="font-medium text-gray-900 hover:underline disabled:opacity-50 disabled:no-underline"
                    >
                      {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
                    </button>
                  ) : (
                    <span />
                  )}
                  <button type="button" onClick={backToSignIn} className="flex items-center gap-1 font-medium text-gray-600 hover:underline">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
                  </button>
                </div>
              </>
            ) : mode === "forgot" ? (
              <>
                <h1 className="text-2xl font-medium tracking-[-0.04em] sm:text-3xl">Reset your password</h1>
                <p className="mt-1.5 text-sm leading-snug text-black/60">
                  Enter your email and we&apos;ll send you a code.
                </p>

                <form className="mt-5 flex flex-col gap-3.5" onSubmit={handleRequestPasswordReset}>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="email" className="text-[13px] font-medium text-gray-700">
                      Email
                    </label>
                    <div className="flex h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 focus-within:border-gray-900">
                      <Mail className="h-4 w-4 shrink-0 text-gray-400" />
                      <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                        className="h-full w-full text-sm outline-none"
                      />
                    </div>
                  </div>

                  {error && <div className="text-sm text-red-600">{error}</div>}

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#111111] text-sm font-medium text-white hover:bg-black disabled:opacity-50"
                  >
                    {isLoading ? <GhostLoader className="h-4 w-4" tone="light" /> : null}
                    {isLoading ? "Sending..." : "Send code"}
                  </button>
                </form>

                <button type="button" onClick={backToSignIn} className="mt-4 flex items-center gap-1 text-sm font-medium text-gray-600 hover:underline">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
                </button>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-medium tracking-[-0.04em] sm:text-3xl">
                  {isSignUp ? "Create your account" : "Welcome back"}
                </h1>
                <p className="mt-1.5 text-sm leading-snug text-black/60">
                  Your AI CMO — SEO, leads, and outreach on autopilot.
                </p>

                <div className="mt-5 grid gap-2.5">
                  <button
                    type="button"
                    onClick={() => handleOAuth("google")}
                    disabled={!oauthAvailable.google}
                    title={oauthAvailable.google ? undefined : "Enable Google in Supabase Auth settings"}
                    className="flex h-9 items-center justify-center gap-2 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50 disabled:opacity-40"
                  >
                    <GoogleIcon />
                    Google
                  </button>
                </div>

                <div className="my-4 flex items-center gap-3 text-xs text-black/40">
                  <div className="h-px flex-1 bg-black/10" />
                  or
                  <div className="h-px flex-1 bg-black/10" />
                </div>

                <form className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="email" className="text-[13px] font-medium text-gray-700">
                      Email
                    </label>
                    <div className="flex h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 focus-within:border-gray-900">
                      <Mail className="h-4 w-4 shrink-0 text-gray-400" />
                      <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                        className="h-full w-full text-sm outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="password" className="text-[13px] font-medium text-gray-700">
                      Password
                    </label>
                    <div className="flex h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 focus-within:border-gray-900">
                      <Lock className="h-4 w-4 shrink-0 text-gray-400" />
                      <input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={isSignUp ? "Create a password" : "Enter your password"}
                        required
                        className="h-full w-full text-sm outline-none"
                      />
                    </div>
                  </div>

                  {error && <div className="text-sm text-red-600">{error}</div>}
                  {notice && <div className="text-sm text-green-600">{notice}</div>}

                  {isSignUp ? (
                    <p className="text-xs leading-5 text-black/40">
                      By creating an account, you agree to our{" "}
                      <a href="/terms" className="font-medium underline underline-offset-2">
                        Terms of Service
                      </a>{" "}
                      and{" "}
                      <a href="/privacy" className="font-medium underline underline-offset-2">
                        Privacy Policy
                      </a>
                    </p>
                  ) : (
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-sm font-normal text-black/60">
                        <input
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => setRememberMe(e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        Remember me
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setMode("forgot");
                          setError(null);
                          setNotice(null);
                        }}
                        className="text-sm font-medium text-gray-900 hover:underline"
                      >
                        Forgot password?
                      </button>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#111111] text-sm font-medium text-white hover:bg-black disabled:opacity-50"
                  >
                    {isLoading ? <GhostLoader className="h-4 w-4" tone="light" /> : null}
                    {isLoading ? "Loading..." : isSignUp ? "Create Account" : "Sign In"}
                  </button>
                </form>

                <p className="mt-4 text-center text-sm text-black/50">
                  {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
                  <button type="button" onClick={toggleMode} className="font-medium text-gray-900 hover:underline">
                    {isSignUp ? "Sign In" : "Sign Up"}
                  </button>
                </p>
                <p className="mt-2 text-center text-sm text-black/50">
                  <Link href="/pricing" className="font-medium text-gray-900 hover:underline">
                    Pricing
                  </Link>
                </p>
              </>
            )}
          </div>
        </div>

        {/* Right: brand panel */}
        <div className="relative hidden items-center justify-center overflow-hidden rounded-md bg-[#0b0b0d] lg:flex">
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 120% at 15% 10%, #1f2937 0%, #0b0b0d 55%, #000000 100%)",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-black/20" />

          <div className="relative z-10 flex h-full w-full flex-col justify-between overflow-y-auto p-8 sm:p-10">
            <div className="flex items-center gap-2.5">
              <GhostLoader className="h-9 w-9" tone="light" />
              <span className="text-sm font-semibold tracking-tight text-white/90">Marlo</span>
            </div>

            <div>
              <h2 className="max-w-[520px] text-2xl font-medium tracking-[-0.03em] text-white sm:text-3xl lg:text-[36px] lg:leading-[1.1]">
                Connect your stack.
                <br />
                Grow automatically.
              </h2>
              <p className="mt-2.5 max-w-[440px] text-sm text-white/75">
                Real integrations, wired to your own accounts — not mock data. Seven live today,
                more publishing targets on the way.
              </p>

              <div className="mt-6 rounded-2xl bg-white p-5 shadow-xl">
                <div className="flex flex-wrap gap-x-3 gap-y-4">
                  {INTEGRATIONS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.label} className="group relative flex w-[68px] flex-col items-center gap-1.5">
                        <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-black/10 bg-black/[0.03]">
                          <Icon className="h-5 w-5" />
                        </div>
                        <span className="whitespace-pre-line text-center text-[9.5px] leading-tight text-black/55">
                          {item.label}
                        </span>
                        {item.soon && (
                          <span className="absolute -right-1 -top-1 rounded-full border border-black/10 bg-black/[0.04] px-1 py-0.5 text-[7px] font-medium text-black/50">
                            SOON
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
