import test from "node:test";
import assert from "node:assert/strict";
import { recordOpenedPr } from "../lib/domain/codefix/recordOpenedPr.ts";

const OPENED = { prUrl: "https://github.com/o/r/pull/7", branch: "marlo/fix-1", files: ["app/page.tsx"] };

test("a recorded PR returns the PR without a warning", async () => {
  const seen: string[] = [];
  const out = await recordOpenedPr(OPENED, async (url) => { seen.push(url); });
  assert.deepEqual(seen, [OPENED.prUrl]);
  assert.deepEqual(out, OPENED);
});

test("a bookkeeping failure after a PR exists still returns the PR URL, with a warning", async () => {
  let logged: unknown = null;
  const out = await recordOpenedPr(
    OPENED,
    async () => { throw new Error("db down"); },
    (err) => { logged = err; },
  );
  assert.equal(out.prUrl, OPENED.prUrl);
  assert.equal(out.branch, OPENED.branch);
  assert.deepEqual(out.files, OPENED.files);
  assert.match(out.warning ?? "", /opened/);
  assert.equal((logged as Error).message, "db down");
});

test("when the finding stays linked to a different open PR, that URL is returned with a warning naming the duplicate", async () => {
  const kept = "https://github.com/o/r/pull/3";
  const out = await recordOpenedPr(OPENED, async () => kept);
  assert.equal(out.prUrl, kept);
  assert.equal(out.branch, OPENED.branch);
  assert.ok(out.warning?.includes(kept), "warning names the PR that was kept");
  assert.ok(out.warning?.includes(OPENED.prUrl), "warning names the duplicate");
  assert.match(out.warning ?? "", /duplicate/);
});

test("a record that returns the same URL, or nothing, has no warning", async () => {
  assert.deepEqual(await recordOpenedPr(OPENED, async () => OPENED.prUrl), OPENED);
  assert.equal("warning" in (await recordOpenedPr(OPENED, async () => undefined)), false);
});
