/** Guessed addresses (pattern + mail-server check) are off unless MARLO_GUESS_EMAILS=1. See qualify.ts for why. */
export function guessingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.MARLO_GUESS_EMAILS === "1";
}
