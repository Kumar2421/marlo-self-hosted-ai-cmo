// What the header status slot shows. Pure (no React) so it can be unit-tested.
import type { LogLine } from "./mock-terminal.ts";

export type HeaderStatus =
  | { kind: "idle" }
  | { kind: "running"; text: string }
  | { kind: "done" | "error" | "info"; text: string };

/**
 * Idle (nothing logged, nothing running) renders no status text at all, so
 * there is no permanent "No activity yet." A line whose work has not finished
 * (type "cmd") shows as running.
 */
export function headerStatus(lines: readonly LogLine[]): HeaderStatus {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.type === "divider") continue;
    if (l.type === "cmd") return { kind: "running", text: l.text };
    if (l.type === "done" || l.type === "error") return { kind: l.type, text: l.text };
    return { kind: "info", text: l.text };
  }
  return { kind: "idle" };
}
