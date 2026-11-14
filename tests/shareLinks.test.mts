import assert from "node:assert/strict";
import test from "node:test";
import { emailShareLink, shareText, whatsappShareLink } from "../lib/domain/audit/shareLinks.ts";

const msg = { host: "acme-plumbing.test", score: 62, url: "https://app.marlo.mlforge.in/audit/r/k7m2q9x4t8wn" };

test("the share line names the site, the score and the link, and promises nothing about rankings", () => {
  const t = shareText(msg);
  assert.ok(t.includes("acme-plumbing.test"));
  assert.ok(t.includes("62/100"));
  assert.ok(t.endsWith(msg.url));
  assert.ok(!/rank|traffic|guarantee/i.test(t));
});

test("the WhatsApp link opens a chat with the text encoded", () => {
  const link = whatsappShareLink(msg);
  assert.ok(link.startsWith("https://wa.me/?text="));
  assert.equal(decodeURIComponent(link.slice("https://wa.me/?text=".length)), shareText(msg));
});

test("the email link has a subject and a body and no recipient", () => {
  const link = emailShareLink(msg);
  assert.ok(link.startsWith("mailto:?subject="));
  const params = new URLSearchParams(link.slice("mailto:?".length));
  assert.equal(params.get("subject"), "Website audit for acme-plumbing.test");
  assert.ok(params.get("body")!.includes(msg.url));
  assert.ok(params.get("body")!.includes("62/100"));
});

test("a host with odd characters cannot break out of the link", () => {
  const link = whatsappShareLink({ ...msg, host: "a&b=c d.test" });
  assert.ok(!link.slice("https://wa.me/?text=".length).includes("&"));
});
