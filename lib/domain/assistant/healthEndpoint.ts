import { isAuthorizedCron } from "../../jobs/jobRunner.ts";
import type { Metrics, MetricsSnapshot } from "./turnLog.ts";

/**
 * Pure core of GET /api/admin/assistant-health. Same bearer-secret check as the cron routes
 * (Authorization: Bearer $CRON_SECRET). Counters are per serverless instance, not global.
 */
export function assistantHealthResponse(
  authorization: string | null, secret: string | undefined, metrics: Metrics,
): { status: 200; body: MetricsSnapshot & { note: string } } | { status: 401; body: { error: string } } {
  if (!isAuthorizedCron(authorization, secret)) return { status: 401, body: { error: "Unauthorized" } };
  return {
    status: 200,
    body: { ...metrics.snapshot(), note: "Counters are per server instance (in memory, last 200 turns for latency); other instances and restarts have their own." },
  };
}
