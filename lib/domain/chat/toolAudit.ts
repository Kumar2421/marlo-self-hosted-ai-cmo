import { createHash } from "node:crypto";
import type { ToolAuditEntry } from "./tools.ts";

/** Stable JSON: keys sorted, so the same arguments always hash the same. */
function canonical(value: unknown, depth = 0): string {
  if (value === null || typeof value !== "object" || depth > 4) return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v, depth + 1)).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k], depth + 1)}`).join(",")}}`;
}

/** Short SHA-256 of the arguments. The audit trail stores this, never the arguments themselves. */
export function hashArgs(args: unknown): string {
  return createHash("sha256").update(canonical(args)).digest("hex").slice(0, 16);
}

/** The full record written for one call: who, where, which tool, outcome. No content, emails or secrets. */
export type ToolAuditRecord = ToolAuditEntry & { userId: string | null; projectId: string };

export type ToolAuditSink = (record: ToolAuditRecord) => void;

/**
 * Structured log line sink. The platform_audit_log table does not exist in supabase/migrations, so
 * audit records go to the server log as one JSON line each (event "assistant.tool_call").
 * Failure to log must never break a chat turn.
 */
export function logLineAuditSink(write: (line: string) => void = (l) => console.info(l)): ToolAuditSink {
  return (record) => {
    try {
      write(JSON.stringify({
        event: "assistant.tool_call",
        userId: record.userId, projectId: record.projectId, tool: record.tool,
        argsHash: record.argsHash, ok: record.ok, durationMs: record.durationMs,
      }));
    } catch { /* never break a turn */ }
  };
}
