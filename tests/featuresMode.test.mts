import test from "node:test";
import assert from "node:assert/strict";
import { resolvePlatformMode } from "../lib/features.ts";

const SUPABASE = { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" };

test("local development without flags stays out of platform mode", () => {
  assert.equal(resolvePlatformMode({ NODE_ENV: "development" }), false);
});

test("NODE_ENV=production alone (every next build and next start) keeps the old self-host behaviour", () => {
  assert.equal(resolvePlatformMode({ NODE_ENV: "production" }), false);
  assert.equal(resolvePlatformMode({ NODE_ENV: "production", ...SUPABASE }), true);
});

test("Vercel without any mode flag defaults to platform mode, even when Supabase config is missing", () => {
  assert.equal(resolvePlatformMode({ VERCEL: "1" }), true);
  assert.equal(resolvePlatformMode({ VERCEL: "1", NODE_ENV: "production" }), true);
});

test("Vercel with NEXT_PUBLIC_SELF_HOST=true runs as self-host", () => {
  assert.equal(resolvePlatformMode({ VERCEL: "1", NEXT_PUBLIC_SELF_HOST: "true" }), false);
  assert.equal(resolvePlatformMode({ VERCEL: "1", NEXT_PUBLIC_SELF_HOST: "true", NODE_ENV: "production" }), false);
});

test("explicit NEXT_PUBLIC_PLATFORM_MODE=true wins", () => {
  assert.equal(resolvePlatformMode({ NEXT_PUBLIC_PLATFORM_MODE: "true", NODE_ENV: "development" }), true);
  assert.equal(resolvePlatformMode({ NEXT_PUBLIC_PLATFORM_MODE: "true", NEXT_PUBLIC_SELF_HOST: "true" }), true);
  assert.equal(resolvePlatformMode({ NEXT_PUBLIC_PLATFORM_MODE: "true", VERCEL: "1", NEXT_PUBLIC_SELF_HOST: "true" }), true);
});

test("explicit NEXT_PUBLIC_PLATFORM_MODE=false on Vercel defers to the Supabase check", () => {
  assert.equal(resolvePlatformMode({ NEXT_PUBLIC_PLATFORM_MODE: "false", VERCEL: "1" }), false);
  assert.equal(resolvePlatformMode({ NEXT_PUBLIC_PLATFORM_MODE: "false", VERCEL: "1", ...SUPABASE }), true);
});

test("local development with Supabase config keeps the existing auto-detect behaviour", () => {
  assert.equal(resolvePlatformMode({ NODE_ENV: "development", ...SUPABASE }), true);
  assert.equal(resolvePlatformMode({ NODE_ENV: "development", NEXT_PUBLIC_SELF_HOST: "true", ...SUPABASE }), false);
});
