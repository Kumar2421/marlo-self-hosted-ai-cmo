import { FEATURES } from "@/lib/features";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import {
  memoryConcurrencyGate,
  memoryRateLimiter,
  supabaseConcurrencyGate,
  supabaseRateLimiter,
  type ConcurrencyGate,
  type FailMode,
  type RateLimiter,
  type RpcClient,
} from "./rateLimit.ts";

/**
 * Picks the limiter and gate for this deployment. Hosted (platform mode) always uses the
 * shared Supabase store. If the service client cannot be built, the adapter gets null and
 * reports an outage, so hosted never silently falls back to per-instance memory.
 * Self-host (no Supabase) uses one bounded in-process store per process.
 */

let memoryLimiter: RateLimiter | null = null;
let memoryGate: ConcurrencyGate | null = null;

function hostedClient(): RpcClient | null {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}

export function publicRateLimiter(failMode: FailMode): RateLimiter {
  if (!FEATURES.PLATFORM_MODE) {
    memoryLimiter ??= memoryRateLimiter();
    return memoryLimiter;
  }
  return supabaseRateLimiter(hostedClient(), failMode);
}

export function publicConcurrencyGate(): ConcurrencyGate {
  if (!FEATURES.PLATFORM_MODE) {
    memoryGate ??= memoryConcurrencyGate();
    return memoryGate;
  }
  return supabaseConcurrencyGate(hostedClient());
}
