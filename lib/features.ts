/**
 * Feature flags for SaaS vs Self-Host builds
 * Controls which settings sections and features are visible
 */

export type PlatformModeEnv = {
  NEXT_PUBLIC_PLATFORM_MODE?: string;
  NEXT_PUBLIC_SELF_HOST?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  VERCEL?: string;
  /** Not read by resolvePlatformMode; accepted so callers can pass a full env object. */
  NODE_ENV?: string;
};

/**
 * Pure platform-mode decision (see FEATURES.PLATFORM_MODE for the rules).
 * Takes an explicit env object so it can be tested without touching process.env.
 *
 * Default-deny for Vercel: Vercel sets VERCEL at build and at runtime, so a
 * deployment that sets neither NEXT_PUBLIC_PLATFORM_MODE nor
 * NEXT_PUBLIC_SELF_HOST is treated as platform mode. Missing Supabase config
 * then fails closed (proxy.ts answers 503) instead of silently running the
 * unauthenticated self-host app. NODE_ENV is deliberately not used: Next sets
 * it to "production" on every build and start, self-host builds included.
 */
export function resolvePlatformMode(env: PlatformModeEnv): boolean {
  if (env.NEXT_PUBLIC_PLATFORM_MODE === "true") return true;
  if (env.NEXT_PUBLIC_SELF_HOST === "true") return false;
  const onVercel = Boolean(env.VERCEL);
  if (onVercel && env.NEXT_PUBLIC_PLATFORM_MODE === undefined) return true;
  const hasSupabasePlatformConfig = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return hasSupabasePlatformConfig;
}

// Literal process.env reads: Next inlines NEXT_PUBLIC_* at build time only for
// these exact expressions, so they must not be passed as a whole process.env object.
const platformModeEnv: PlatformModeEnv = {
  NEXT_PUBLIC_PLATFORM_MODE: process.env.NEXT_PUBLIC_PLATFORM_MODE,
  NEXT_PUBLIC_SELF_HOST: process.env.NEXT_PUBLIC_SELF_HOST,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  VERCEL: process.env.VERCEL,
};

export const FEATURES = {
  /** Self-host mode: users configure everything */
  SELF_HOST: process.env.NEXT_PUBLIC_SELF_HOST === "true",

  /** Show LLM provider settings (self-host only) */
  SHOW_LLM_SETTINGS: process.env.NEXT_PUBLIC_SHOW_LLM_SETTINGS === "true",

  /** Show API credentials section (self-host only) */
  SHOW_API_CREDENTIALS: process.env.NEXT_PUBLIC_SHOW_API_CREDENTIALS === "true",

  /**
   * Platform mode: use Supabase-backed persistence and hide self-host configs.
   *
   * An explicit NEXT_PUBLIC_PLATFORM_MODE=true still enables platform mode,
   * while configured public Supabase credentials enable it automatically
   * unless NEXT_PUBLIC_SELF_HOST=true is set. On Vercel with neither flag set,
   * platform mode is the default (fail closed). Server
   * routes still require SUPABASE_SECRET_KEY when they create the service-role
   * client.
   */
  PLATFORM_MODE: resolvePlatformMode(platformModeEnv),
};

/** Log active features at startup */
export function logFeatures() {
  if (typeof window === "undefined") return; // Server-side only
  console.log("[Features]", {
    selfHost: FEATURES.SELF_HOST,
    showLLMSettings: FEATURES.SHOW_LLM_SETTINGS,
    showApiCredentials: FEATURES.SHOW_API_CREDENTIALS,
    platformMode: FEATURES.PLATFORM_MODE,
  });
}
