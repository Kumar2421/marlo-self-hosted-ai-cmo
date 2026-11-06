import test from "node:test";
import assert from "node:assert/strict";
import { guessingEnabled } from "../lib/domain/leads/guessPolicy.ts";

test("email guessing is off unless explicitly switched on", () => {
  assert.equal(guessingEnabled({}), false);
  assert.equal(guessingEnabled({ MARLO_GUESS_EMAILS: "0" }), false);
  assert.equal(guessingEnabled({ MARLO_GUESS_EMAILS: "true" }), false);
  assert.equal(guessingEnabled({ MARLO_GUESS_EMAILS: "1" }), true);
});
