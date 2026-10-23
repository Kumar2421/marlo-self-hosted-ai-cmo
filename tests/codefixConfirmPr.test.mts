import test from "node:test";
import assert from "node:assert/strict";
import { askConfirm, backToPreview, confirmSubmit, submitFailed } from "../lib/domain/codefix/confirmPr.ts";
import { OAUTH_RETURN_DELAY_MS, resetOnPageShow, resetOnReturn } from "../lib/ui/oauthReturn.ts";

test("approve only shows the confirmation and sends nothing", () => {
  assert.equal(askConfirm("preview"), "confirming");
  assert.deepEqual(confirmSubmit("preview"), { step: "preview", send: false });
});

test("back returns to the preview from confirming only", () => {
  assert.equal(backToPreview("confirming"), "preview");
  assert.equal(backToPreview("submitting"), "submitting");
  assert.equal(backToPreview("preview"), "preview");
});

test("confirming sends once; a second click while submitting is ignored", () => {
  const first = confirmSubmit("confirming");
  assert.deepEqual(first, { step: "submitting", send: true });
  assert.deepEqual(confirmSubmit(first.step), { step: "submitting", send: false });
  assert.equal(askConfirm("submitting"), "submitting");
});

test("a failed submit returns to confirming", () => {
  assert.equal(submitFailed("submitting"), "confirming");
  assert.equal(submitFailed("preview"), "preview");
});

test("oauth busy resets on bfcache restore only", () => {
  assert.equal(resetOnPageShow(true), true);
  assert.equal(resetOnPageShow(false), false);
});

test("oauth busy resets on return only when visible and after the delay", () => {
  assert.equal(resetOnReturn(1000, 1000 + OAUTH_RETURN_DELAY_MS, true), true);
  assert.equal(resetOnReturn(1000, 1000 + OAUTH_RETURN_DELAY_MS - 1, true), false);
  assert.equal(resetOnReturn(1000, 100000, false), false);
});
