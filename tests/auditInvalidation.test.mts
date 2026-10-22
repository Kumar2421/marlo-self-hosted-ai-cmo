import test from "node:test";
import assert from "node:assert/strict";
import { queryKeysAfterAudit } from "../lib/query/auditInvalidation.ts";
import { qk } from "../lib/query/keys.ts";

test("a finished audit invalidates that project's findings list", () => {
  assert.deepEqual(queryKeysAfterAudit("p1"), [qk.findings("p1")]);
});

test("the findings key is a prefix of the per-finding keys, so recommendations and actions refresh too", () => {
  const [key] = queryKeysAfterAudit("p1");
  const child = qk.findingActions("p1", "f1");
  assert.deepEqual(child.slice(0, key.length), key);
});

test("another project's findings are not touched", () => {
  const [key] = queryKeysAfterAudit("p1");
  assert.notDeepEqual(qk.findings("p2"), key);
});
