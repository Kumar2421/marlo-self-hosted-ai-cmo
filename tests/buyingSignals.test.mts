import test from "node:test";
import assert from "node:assert/strict";
import { detectSignals, mergeSignals, reasonWithoutSignals, signalsFromReason, signalsSentence } from "../lib/domain/leads/company/buyingSignals.ts";

test("wording that announces openings is a hiring signal; a plain Careers link is not", () => {
  assert.deepEqual(detectSignals("Welcome", [{ href: "/about", text: "Join our team" }]), ["hiring"]);
  assert.deepEqual(detectSignals("Welcome", [{ href: "/x", text: "We're hiring" }]), ["hiring"]);
  assert.deepEqual(detectSignals("We are hiring a receptionist.", []), ["hiring"]);
  assert.deepEqual(detectSignals("Now hiring!", []), ["hiring"]);
  // The menu item every company has all year says nothing about hiring now.
  assert.deepEqual(detectSignals("Welcome", [{ href: "/careers", text: "Careers" }]), []);
  assert.deepEqual(detectSignals("Welcome", [{ href: "/jobs", text: "Jobs" }, { href: "/work-with-us", text: "Work with us" }]), []);
});

test("a new place stated on the page is a signal; opening hours are not", () => {
  assert.deepEqual(detectSignals("Visit our new branch in Anna Nagar.", []), ["new_location"]);
  assert.deepEqual(detectSignals("Grand opening this Saturday", []), ["new_location"]);
  assert.deepEqual(detectSignals("Open hours: Mon-Sat 9am to 6pm. We are open now. Now open hours are shown below.", []), []);
});

test("nothing is invented from a plain page, and unrelated words do not match", () => {
  assert.deepEqual(detectSignals("We repair bicycles. Jobsite safety and carrier services.", [{ href: "/carriers", text: "Carriers" }]), []);
  assert.deepEqual(detectSignals("", []), []);
});

test("both signals can appear and merge across pages without duplicates, in a stable order", () => {
  assert.deepEqual(detectSignals("We are hiring. Our new clinic is open.", []), ["hiring", "new_location"]);
  assert.deepEqual(mergeSignals(["new_location"], ["hiring"], undefined, ["hiring"]), ["hiring", "new_location"]);
});

test("the sentence is stored in the fit reason and read back from it", () => {
  const s = signalsSentence(["hiring", "new_location"]);
  assert.equal(s, "Signals: hiring now; new location.");
  const reason = `Company site mentions "dental clinics". ${s}`;
  assert.deepEqual(signalsFromReason(reason), ["hiring", "new_location"]);
  assert.equal(signalsSentence([]), "");
  assert.deepEqual(signalsFromReason('Company site mentions "dental clinics".'), []);
  assert.deepEqual(signalsFromReason(null), []);
});

test("the list shows the reason without the signals sentence, which the chips already carry", () => {
  assert.equal(reasonWithoutSignals('Company site mentions "dental clinics". Signals: hiring now; new location.'), 'Company site mentions "dental clinics".');
  assert.equal(reasonWithoutSignals('Company site mentions "dental clinics".'), 'Company site mentions "dental clinics".');
  assert.equal(reasonWithoutSignals(null), "");
});
