import type { SetupState, SetupStatus, SetupStepKey } from "@/lib/domain/project/setupState";

export type SetupView = { state: SetupState; summary: { done: number; total: number; failed: number; running: boolean; text: string }; serverTime: string };

/** Reads persisted setup progress for the active project. Null on any failure (the caller just does not resume). */
export async function fetchSetupView(projectId?: string): Promise<SetupView | null> {
  try {
    const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    const res = await fetch(`/api/project/setup${q}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as SetupView;
  } catch {
    return null;
  }
}

/** Records one step transition. Never throws: "conflict" means another tab owns the step, "error" means
 * it could not be recorded (setup must carry on regardless). */
export async function recordSetupStep(
  projectId: string,
  step: SetupStepKey,
  status: SetupStatus,
  error?: string,
): Promise<"ok" | "conflict" | "error"> {
  try {
    const res = await fetch("/api/project/setup", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, step, status, error }),
    });
    if (res.ok) return "ok";
    return res.status === 409 ? "conflict" : "error";
  } catch {
    return "error";
  }
}
