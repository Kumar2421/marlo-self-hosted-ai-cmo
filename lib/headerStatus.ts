// What the header status slot shows. Pure (no React) so it can be unit-tested.
import type { LogLine } from "./mock-terminal.ts";

export type HeaderStatus =
  | { kind: "idle" }
  | { kind: "running"; text: string }
  | { kind: "done" | "error" | "info"; text: string };

/** How long a finished or failed line stays in the bar before it goes quiet. */
export const STATUS_TTL_MS = 15_000;

/** When the bar's current done/error line should expire (epoch ms), or null if nothing is pending. */
export function statusExpiresAt(lines: readonly LogLine[], ttlMs: number = STATUS_TTL_MS): number | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.type === "divider") continue;
    if ((l.type === "done" || l.type === "error") && l.at !== undefined) return l.at + ttlMs;
    return null;
  }
  return null;
}

/**
 * Idle (nothing logged, nothing running) renders no status text at all, so
 * there is no permanent "No activity yet." A line whose work has not finished
 * (type "cmd") shows as running.
 */
export function headerStatus(lines: readonly LogLine[], now?: number, ttlMs: number = STATUS_TTL_MS): HeaderStatus {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.type === "divider") continue;
    if (l.type === "cmd") return { kind: "running", text: l.text };
    if (l.type === "done" || l.type === "error") {
      // A finished/failed line goes quiet after the TTL; the overlay history keeps it.
      if (now !== undefined && l.at !== undefined && now - l.at >= ttlMs) return { kind: "idle" };
      return { kind: l.type, text: l.text };
    }
    return { kind: "info", text: l.text };
  }
  return { kind: "idle" };
}
