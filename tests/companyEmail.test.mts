import test from "node:test";
import assert from "node:assert/strict";
import { isOutreachInbox, pickOutreachEmail } from "../lib/domain/leads/company/companyEmail.ts";

test("press, careers, investor, legal and similar inboxes are not for a first message", () => {
  for (const e of ["investor_relations@gap.com", "corrections@businessinsider.com", "careers@acme.com", "jobs@acme.com", "press@acme.com", "privacy@acme.com", "legal@acme.com", "hr@acme.com", "ir@acme.com", "billing@acme.com", "noreply@acme.com", "media-enquiries@acme.com", "gap_press@gap.com", "acme.careers@acme.com", "no-reply@acme.com", "do.not.reply@acme.com"]) {
    assert.equal(isOutreachInbox(e), false, e);
  }
});

test("general and personal inboxes are fine", () => {
  for (const e of ["info@acme.com", "hello@acme.com", "contact@acme.com", "sales@acme.com", "steve@gtaaccounting.ca", "acharya@acharyadental.com", "srivaridentalclinic@gmail.com", "support@acme.com"]) {
    assert.equal(isOutreachInbox(e), true, e);
  }
});

test("a name that merely starts like a blocked word is not blocked", () => {
  assert.equal(isOutreachInbox("prakash@acme.com"), true);
  assert.equal(isOutreachInbox("irene@acme.com"), true);
  assert.equal(isOutreachInbox("hrithik@acme.com"), true);
  assert.equal(isOutreachInbox("newsome@acme.com"), true);
});

test("the best general address is chosen, and a lone blocked inbox yields nothing", () => {
  assert.equal(pickOutreachEmail(["support@acme.com", "info@acme.com", "careers@acme.com"]), "info@acme.com");
  assert.equal(pickOutreachEmail(["jane@acme.com", "hello@acme.com"]), "hello@acme.com");
  assert.equal(pickOutreachEmail(["careers@acme.com", "press@acme.com"]), null);
  assert.equal(pickOutreachEmail([]), null);
});

test("ties keep the reader's order, which puts the company's own domain first", () => {
  assert.equal(pickOutreachEmail(["owner@acme.com", "boss@gmail.com"]), "owner@acme.com");
});
