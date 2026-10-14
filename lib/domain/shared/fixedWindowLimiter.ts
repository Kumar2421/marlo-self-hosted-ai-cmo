/**
 * In-memory fixed-window limiter with a bounded key set. Expired windows are dropped on every call,
 * and when the set is still full the oldest key is evicted, so memory stays bounded under any
 * number of distinct clients. Process-local: fine as a soft limit, not as a security boundary.
 */

export type FixedWindowLimiterOptions = { limit: number; windowMs: number; maxKeys: number; now?: () => number };

export function createFixedWindowLimiter(opts: FixedWindowLimiterOptions): (key: string) => boolean {
  const now = opts.now ?? Date.now;
  const windows = new Map<string, { count: number; resetAt: number }>();
  return (key: string) => {
    const t = now();
    for (const [k, w] of windows) {
      if (w.resetAt <= t) windows.delete(k);
    }
    const current = windows.get(key);
    if (!current) {
      if (windows.size >= opts.maxKeys) {
        const oldest = windows.keys().next().value;
        if (oldest !== undefined) windows.delete(oldest);
      }
      windows.set(key, { count: 1, resetAt: t + opts.windowMs });
      return true;
    }
    if (current.count >= opts.limit) return false;
    current.count += 1;
    return true;
  };
}
