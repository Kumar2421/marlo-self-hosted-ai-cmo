import test from "node:test";
import assert from "node:assert/strict";
import { extractContact } from "../lib/domain/leads/local/websiteContact.ts";

const page = (body: string) => `<html><head><title>x</title></head><body>${body}</body></html>`;

test("the site reader reports a hiring announcement and a new-branch notice from real HTML", () => {
  const html = page('<nav><a href="/about">About</a><a href="/jobs">We are hiring</a></nav><p>Visit our new branch in Anna Nagar.</p>');
  const out = extractContact(html, "https://smile.test/");
  assert.deepEqual(out.signals, ["hiring", "new_location"]);
  // A permanent menu link called Careers is not a hiring signal.
  assert.deepEqual(extractContact(page('<nav><a href="/careers">Careers</a></nav><p>We repair teeth.</p>'), "https://smile.test/").signals, []);
});

test("a plain page reports no signals, and script text is not read as page text", () => {
  const html = page('<p>We repair teeth.</p><script>var s = "we are hiring now hiring";</script>');
  assert.deepEqual(extractContact(html, "https://smile.test/").signals, []);
});

test("contact facts are unaffected by the signal reading", () => {
  const out = extractContact(page('<a href="mailto:hi@smile.test">Mail</a><a href="/contact">Contact us</a>'), "https://smile.test/");
  assert.deepEqual(out.emails, ["hi@smile.test"]);
  assert.equal(out.contactUrl, "https://smile.test/contact");
});
