import test from "node:test";
import assert from "node:assert/strict";
import { REACH_LIMITS, buildReachMessage, linkedInProfileUrl, waLink } from "../lib/domain/leads/reach.ts";

const sender = { name: "Senthil", company: "MLForge" };
const offer = { sells: "custom software and CRM", whoPays: "small clinics" };
const person = { name: "Ann Lee", title: "Head of Sales", company: "Acme", lead_type: "person" };
const company = { name: "Smile Dental", lead_type: "company", website: "https://www.smile.test/" };

test("waLink builds a wa.me link with the message encoded, and rejects unusable numbers", () => {
  assert.equal(waLink("+91 98765 43210", "Hi there & welcome"), "https://wa.me/919876543210?text=Hi%20there%20%26%20welcome");
  assert.equal(waLink("12345", "x"), null);
  assert.equal(waLink(null, "x"), null);
});

test("linkedInProfileUrl normalises real profile URLs and rejects everything else", () => {
  assert.equal(linkedInProfileUrl("https://in.linkedin.com/in/ann-lee/?trk=x"), "https://www.linkedin.com/in/ann-lee");
  assert.equal(linkedInProfileUrl("https://www.linkedin.com/company/acme/"), "https://www.linkedin.com/company/acme");
  assert.equal(linkedInProfileUrl("javascript:alert(1)"), null);
  assert.equal(linkedInProfileUrl("https://evil.test/in/ann"), null);
  assert.equal(linkedInProfileUrl("https://www.linkedin.com/jobs/view/1"), null);
});

test("a person message greets by first name and uses only their real title and company", () => {
  const m = buildReachMessage("whatsapp", { lead: person, sender, projectName: "Acme Invoice", offer });
  assert.match(m, /^Hi Ann,/);
  assert.match(m, /I'm Senthil from MLForge\./);
  assert.match(m, /I saw you're Head of Sales at Acme\./);
  assert.match(m, /We offer custom software and CRM for small clinics\./);
  assert.match(m, /Would a quick chat be useful\?$/);
});

test("a company message greets the team and names their site, not a person", () => {
  const m = buildReachMessage("whatsapp", { lead: company, sender, projectName: "P", offer: null });
  assert.match(m, /^Hi Smile Dental team,/);
  assert.match(m, /I came across smile\.test\./);
  assert.doesNotMatch(m, /We offer/);
});

test("with no sender name or business it falls back to the project name and invents nothing", () => {
  const m = buildReachMessage("whatsapp", { lead: { name: "Ravi" }, sender: {}, projectName: "Acme Invoice" });
  assert.equal(m, "Hi Ravi,\n\nThis is Acme Invoice. Would a quick chat be useful?");
  assert.equal(buildReachMessage("whatsapp", { lead: { name: "" }, sender: {}, projectName: "" }), "Hi,\n\nWould a quick chat be useful?");
});

test("LinkedIn notes stay within 300 characters by dropping the offer line, then the hook", () => {
  const long = { sells: "x".repeat(150), whoPays: "y".repeat(150) };
  const m = buildReachMessage("linkedin", { lead: person, sender, projectName: "P", offer: long });
  assert.ok(m.length <= REACH_LIMITS.linkedin, `length ${m.length}`);
  assert.doesNotMatch(m, /We offer/);
  assert.match(m, /I saw you're Head of Sales at Acme\./);
  const tiny = buildReachMessage("linkedin", { lead: { ...person, title: "t".repeat(300) }, sender, projectName: "P", offer });
  assert.ok(tiny.length <= 300);
  assert.doesNotMatch(tiny, /I saw you're/);
});

test("the same lead gets the offer line on WhatsApp where there is room for it", () => {
  const m = buildReachMessage("whatsapp", { lead: person, sender, projectName: "P", offer });
  assert.match(m, /We offer/);
});
