/** View model for the quiet "N of 10 chats left this month" line under the composer. Pure. */
export type MeterInput = { allowed?: boolean; remaining: number; limit: number; plan: string; enforced: boolean };

export const METER_AMBER_AT = 3;

/** Null (hidden) unless enforcement is on, the plan is free, and the plan has a cap. */
export function chatMeterView(a: MeterInput | null | undefined): { text: string; amber: boolean } | null {
  if (!a || !a.enforced || a.plan !== "free" || a.limit <= 0) return null;
  const left = Math.max(0, a.remaining);
  return { text: `${left} of ${a.limit} chats left this month`, amber: left <= METER_AMBER_AT };
}
