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
