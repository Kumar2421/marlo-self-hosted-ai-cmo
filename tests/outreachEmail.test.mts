import test from "node:test";
import assert from "node:assert/strict";
import { OUTREACH_TEMPLATES } from "../lib/domain/leads/outreachContract.ts";
import { bodyToParagraphs, escapeHtml, renderOutreachEmail, safeHref } from "../lib/domain/leads/outreachEmail.ts";

const sender = { name: "Ana Sender", email: "ana@acme.test", company: "Acme", address: "1 Main St, Springfield" };
const lead = { name: "Bo <b>", company: "Zed & Co", title: "CEO" };
const base = { subject: "Hi {{name}}", body: "Hello {{name}} at {{company}}.\n\nSecond line\nwraps.", lead, sender, unsubscribeUrl: "https://app.test/unsub?t=abc" };

test("every template carries the unsubscribe link, headers, address and a text part", () => {
  for (const t of OUTREACH_TEMPLATES) {
    const r = renderOutreachEmail({ ...base, templateId: t.id });
    assert.match(r.html, /href="https:\/\/app\.test\/unsub\?t=abc"/);
    assert.match(r.html, /1 Main St, Springfield/);
    assert.match(r.text, /Unsubscribe: https:\/\/app\.test\/unsub\?t=abc/);
    assert.equal(r.headers["List-Unsubscribe"], "<https://app.test/unsub?t=abc>");
    assert.equal(r.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  }
});

test("user and lead text is HTML-escaped; no markup or script gets through", () => {
  const r = renderOutreachEmail({ ...base, templateId: "card", body: "<script>alert(1)</script> {{name}} {{company}}", subject: "x\r\nBcc: evil@x.test" });
  assert.ok(!r.html.includes("<script>"));
  assert.match(r.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; Bo &lt;b&gt; Zed &amp; Co/);
  assert.equal(r.subject, "x Bcc: evil@x.test", "line breaks in the subject cannot inject headers");
});

test("preview with no real unsubscribe address uses a placeholder and sends no list headers", () => {
  const r = renderOutreachEmail({ ...base, templateId: "plain", unsubscribeUrl: null });
  assert.match(r.html, /href="#"/);
  assert.deepEqual(r.headers, {});
});

test("only http(s) hrefs are allowed", () => {
  assert.equal(safeHref("javascript:alert(1)"), "#");
  assert.equal(safeHref("https://a.test/x"), "https://a.test/x");
  assert.equal(safeHref(null), "#");
});

test("paragraph and escape helpers", () => {
  assert.deepEqual(bodyToParagraphs("a\n\n\nb\nc"), ["a", "b\nc"]);
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});

const messageOnly = (text: string) => text.split("\n--\n")[0];

test("plain template has no signature block; clean and card add one", () => {
  assert.ok(!messageOnly(renderOutreachEmail({ ...base, templateId: "plain" }).text).includes("Ana Sender"));
  assert.match(messageOnly(renderOutreachEmail({ ...base, templateId: "clean" }).text), /Ana Sender\nAcme/);
  assert.match(renderOutreachEmail({ ...base, templateId: "card" }).html, /Ana Sender/);
});
