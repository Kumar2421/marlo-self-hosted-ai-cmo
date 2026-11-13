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

test("a Reddit reply starts by being useful, discloses who is writing, and invites questions instead of pushing", () => {
  const r = buildReachMessage("reddit", { lead: { name: "Looking for a designer", lead_type: "intent" }, sender, projectName: "P", offer });
  assert.match(r, /^Happy to help with this\./);
  assert.match(r, /Full disclosure: I'm Senthil from MLForge, so I'm biased\./);
  assert.match(r, /We do custom software and CRM for small clinics\./);
  assert.match(r, /Happy to answer questions here/);
  assert.ok(r.length <= REACH_LIMITS.reddit);
});

test("a Reddit reply with no sender name uses the project name, and with no offer has no offer line", () => {
  const r = buildReachMessage("reddit", { lead: { name: "x", lead_type: "intent" }, sender: {}, projectName: "Acme Invoice" });
  assert.match(r, /Full disclosure: I work on Acme Invoice, so I'm biased\./);
  assert.doesNotMatch(r, /We do/);
});

test("a hiring or new-location signal in the saved reason becomes the opener, named for what the site says", () => {
  const hiring = { ...company, fit_reason: 'Company site mentions "dental clinics". Signals: hiring now.' };
  const m = buildReachMessage("whatsapp", { lead: hiring, sender, projectName: "P", offer: null });
  assert.match(m, /I noticed you're hiring on smile\.test\./);
  assert.doesNotMatch(m, /I came across/);
  const opened = { ...company, fit_reason: "Signals: new location." };
  assert.match(buildReachMessage("whatsapp", { lead: opened, sender, projectName: "P" }), /I noticed your new location on smile\.test\./);
});

test("without a signal the opener is unchanged", () => {
  const m = buildReachMessage("whatsapp", { lead: { ...company, fit_reason: 'Company site mentions "dental clinics".' }, sender, projectName: "P" });
  assert.match(m, /I came across smile\.test\./);
});
