/** Thrown when a call is still running when the time budget it was given runs out. */
export class DeadlineExceededError extends Error {
  constructor() {
    super("Ran out of time before GitHub or the database answered.");
    this.name = "DeadlineExceededError";
  }
}

/**
 * Run `start` and wait for it, but no longer than `remainingMs`. A call still running at the deadline is
 * abandoned (it cannot be cancelled here) and the caller gets DeadlineExceededError, so one hung call cannot
 * overrun a cron run's budget. With no time left, `start` is never called. An infinite budget means no limit.
 */
export function withDeadline<T>(start: () => Promise<T>, remainingMs: number): Promise<T> {
  if (remainingMs <= 0) return Promise.reject(new DeadlineExceededError());
  if (!Number.isFinite(remainingMs)) return start();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceededError()), remainingMs);
  });
  return Promise.race([start(), limit]).finally(() => clearTimeout(timer));
}
