import { safeFetch } from "../net/safeFetch.ts";

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
