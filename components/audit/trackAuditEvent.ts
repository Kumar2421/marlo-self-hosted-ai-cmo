import type { AuditFunnelPayload } from "@/lib/analytics/auditFunnel";

function getAuditSessionId() {
  if (typeof window === "undefined") return undefined;
  try {
    const key = "marlo:audit-session-id";
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const sessionId = crypto.randomUUID();
    window.localStorage.setItem(key, sessionId);
    return sessionId;
  } catch {
    return undefined;
  }
}

/** Fire-and-forget funnel event. Never throws and never blocks the page. */
export function trackAuditEvent(payload: AuditFunnelPayload) {
  const sessionId = getAuditSessionId();
  if (!sessionId) return;
  const body = JSON.stringify({ ...payload, sessionId });
  if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
    const queued = navigator.sendBeacon("/api/public/audit/events", new Blob([body], { type: "application/json" }));
    if (queued) return;
  }
  void fetch("/api/public/audit/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}
