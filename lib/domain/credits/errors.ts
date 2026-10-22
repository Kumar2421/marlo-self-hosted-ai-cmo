/**
 * Single shared "not enough credits" error. Routes map it to HTTP 402.
 * Lives in a dependency-free module so pure domain code (draftGeneration) and
 * lib/credits.ts throw/catch the SAME class — two classes with one name made
 * `instanceof` miss and turned a credit race into a 500.
 */
export class InsufficientCreditsError extends Error {
  constructor(message = "insufficient_credits") {
    super(message);
    this.name = "InsufficientCreditsError";
  }
}
