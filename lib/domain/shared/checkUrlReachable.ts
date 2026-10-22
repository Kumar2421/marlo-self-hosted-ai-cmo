import { SafeFetchError, safeFetch } from "../net/safeFetch.ts";
import type { ProbeOutcome } from "./urlReachability.ts";

/** Real bounded reachability check — HEAD first, falls back to GET only if
 * the server doesn't implement HEAD (405/501), since reporting that as
 * unreachable would be a false negative. Shared by the Links tab's
 * reachability check and new-project creation (reject an unreachable URL
 * before it's saved, rather than silently creating a broken project with no
 * way to delete it later). */
export async function checkUrlReachable(url: string, timeoutMs = 8000): Promise<{ reachable: boolean; status?: number }> {
  // Links and project URLs are user-influenced: every hop goes through the guarded fetcher.
  try {
    const headers = { "User-Agent": "OkaraAlternative/1.0" };
    let res = await safeFetch(url, { method: "HEAD", timeoutMs, headers });
    if (res.status === 405 || res.status === 501) {
      res = await safeFetch(url, { method: "GET", timeoutMs, headers });
    }
    return { reachable: res.status >= 200 && res.status < 300, status: res.status };
  } catch {
    return { reachable: false };
  }
}

/** Raw probe for onboarding: returns what the server said (or how the connection failed) and leaves the
 * verdict to classifyReachability() in urlReachability.ts. HEAD first; any non-2xx HEAD answer is retried
 * once with a small GET, since some servers answer HEAD differently from GET. A failed GET keeps the HEAD
 * status. Connection-level failures from HEAD are returned as-is (no second attempt, to bound latency). */
export async function probeUrl(url: string, timeoutMs = 8000): Promise<ProbeOutcome> {
  const headers = { "User-Agent": "OkaraAlternative/1.0" };
  let head: { status: number };
  try {
    head = await safeFetch(url, { method: "HEAD", timeoutMs, headers });
  } catch (err) {
    return { errorCode: err instanceof SafeFetchError ? err.code : "unknown" };
  }
  if (head.status >= 200 && head.status < 300) return { status: head.status };
  try {
    const get = await safeFetch(url, { method: "GET", timeoutMs: Math.min(timeoutMs, 5000), headers, maxBytes: 4096 });
    return { status: get.status };
  } catch {
    return { status: head.status };
  }
}
