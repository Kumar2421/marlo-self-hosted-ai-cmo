/** What a Re-check told us, normalised from the API response (verified/failed carry `verification`, skipped/pending carry `reason`). */
export type RecheckOutcome = {
  status: "verified" | "failed" | "skipped" | "pending";
  reason?: string | null;
};

export type RecheckNote = { tone: "verified" | "failed" | "waiting"; text: string };

const MAX_REASON = 280;

function cleanReason(reason: string | null | undefined): string | null {
  const text = (reason ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 1).trimEnd()}…` : text;
}

/** Short honest line shown beside the Re-check button. Says "verified" only when the API did. */
export function recheckNote(outcome: RecheckOutcome | null | undefined): RecheckNote | null {
  if (!outcome) return null;
  const reason = cleanReason(outcome.reason);
  switch (outcome.status) {
    case "verified":
      return { tone: "verified", text: reason ?? "Verified: the issue is no longer detected." };
    case "failed":
      return { tone: "failed", text: reason ?? "Not fixed yet: the issue is still detected. Keep fixing it and re-check again." };
    case "skipped":
    case "pending":
      return { tone: "waiting", text: `Not verified yet: ${reason ?? "we couldn't check this one right now. Try again later."}` };
    default:
      return null;
  }
}
