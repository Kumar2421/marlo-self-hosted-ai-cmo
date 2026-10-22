// Classifies the outcome of probing a project URL during onboarding. Pure on
// purpose: no network or Next imports, so the node tests can load it directly.
//
// Principle: a site that answers at all is "reachable". Bot protection (401,
// 403, 429), temporary outages (5xx) and slow responses (timeouts) say nothing
// about whether the site is real, so the project is still created and the
// audit reports what it can. We reject only what is clearly wrong: an address
// that cannot be used, a domain that does not resolve, a host that refuses
// every connection, or a page that answers "not found".

export type ProbeOutcome = {
  /** Final HTTP status, when the server answered. */
  status?: number;
  /** SafeFetch error code (e.g. "dns:failed", "network:timeout") when no answer came back. */
  errorCode?: string;
};

export type ReachabilityVerdict = "reachable" | "unverified" | "unreachable";

export type ReachabilityResult = {
  verdict: ReachabilityVerdict;
  /** Plain-language reason, only set when verdict is "unreachable". */
  message?: string;
};

// Statuses that mean "the site exists but would not let our checker in right
// now" rather than "this address is wrong".
const UNVERIFIED_STATUSES = new Set([401, 403, 407, 408, 425, 429, 451]);

const BLOCKED_ADDRESS_MESSAGE =
  "This address can't be used. Enter a public website address, like yourproduct.com.";
const DNS_MESSAGE =
  "We couldn't find a website at this address. Check the spelling and try again.";
const CONNECT_MESSAGE =
  "We couldn't connect to this site. Check that the address is correct and publicly accessible.";

export function classifyReachability(outcome: ProbeOutcome): ReachabilityResult {
  if (typeof outcome.status === "number") {
    const { status } = outcome;
    if (status >= 200 && status < 300) return { verdict: "reachable" };
    if (UNVERIFIED_STATUSES.has(status) || status >= 500) return { verdict: "unverified" };
    return {
      verdict: "unreachable",
      message: `This address returned HTTP ${status}. Check that it's correct and publicly accessible.`,
    };
  }

  const code = outcome.errorCode ?? "";
  if (code.startsWith("policy:")) return { verdict: "unreachable", message: BLOCKED_ADDRESS_MESSAGE };
  if (code === "dns:failed") return { verdict: "unreachable", message: DNS_MESSAGE };
  if (code === "network:error") return { verdict: "unreachable", message: CONNECT_MESSAGE };

  // Timeouts, odd redirect chains and anything unexpected: not clearly wrong, so
  // do not block onboarding on them.
  return { verdict: "unverified" };
}
