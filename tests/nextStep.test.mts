import test from "node:test";
import assert from "node:assert/strict";
import { nextStep } from "../lib/domain/leads/nextStep.ts";

const base = { profileConfirmed: true, companiesFirst: true, leadCount: 0, qualified: 0, reached: 0 };

test("without a confirmed profile the first step is to say who you sell to", () => {
  assert.equal(nextStep({ ...base, profileConfirmed: false })?.id, "profile");
});

test("a confirmed profile with no leads points at the right search for the profile", () => {
  const companies = nextStep(base);
  assert.equal(companies?.id, "find");
  assert.match(companies!.text, /Find companies/);
  assert.match(companies!.text, /email or WhatsApp number on their own site/);
  const people = nextStep({ ...base, companiesFirst: false });
  assert.match(people!.text, /Find leads/);
  assert.doesNotMatch(people!.text, /Find companies/);
});

test("leads that do not qualify are explained instead of looking like a result", () => {
  const s = nextStep({ ...base, leadCount: 4 });
  assert.equal(s?.id, "none-qualified");
  assert.match(s!.text, /reach them.*why they fit.*source page/);
});

test("qualified leads with nothing reached yet point at Reach, and say Marlo does not send", () => {
  const s = nextStep({ ...base, leadCount: 4, qualified: 2 });
  assert.equal(s?.id, "reach");
  assert.match(s!.text, /press Reach/);
  assert.match(s!.text, /nothing goes out without you/);
});

test("once something was reached the top bar carries the progress and no hint shows", () => {
  assert.equal(nextStep({ ...base, leadCount: 4, qualified: 2, reached: 1 }), null);
});
