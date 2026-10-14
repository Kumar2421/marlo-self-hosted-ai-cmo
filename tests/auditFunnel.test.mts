import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeAuditFunnelPayload } from "../lib/analytics/auditFunnel.ts";

test("client-generated session ids (crypto.randomUUID) are kept", () => {
  const uuid = "3f2a9c1e-7b4d-4e8a-9c1f-0a1b2c3d4e5f";
  assert.equal(sanitizeAuditFunnelPayload({ event: "audit_started", sessionId: uuid }).sessionId, uuid);
  assert.equal(sanitizeAuditFunnelPayload({ event: "audit_started", sessionId: "ABCDEF0123456789" }).sessionId, "ABCDEF0123456789");
  assert.equal(sanitizeAuditFunnelPayload({ event: "audit_started", sessionId: "a_b-c_d-e_f-0123456" }).sessionId, "a_b-c_d-e_f-0123456");
});

test("session ids outside the allowed alphabet or length are dropped", () => {
  const rejected = [
    "short",
    "3f2a9c1e 7b4d 4e8a 9c1f 0a1b2c3d4e5f",
    "<script>alert(1)</script>xx",
    "abc.def.ghi.jkl.mno.pqr",
    "a/b/c/d/e/f/g/h/i/j/k/l/m",
    "a'); drop table x;--aaaa",
    "a".repeat(129),
    "",
  ];
  for (const sessionId of rejected) {
    assert.equal(
      sanitizeAuditFunnelPayload({ event: "audit_completed", sessionId }).sessionId,
      undefined,
      `rejected: ${JSON.stringify(sessionId).slice(0, 40)}`,
    );
  }
  assert.equal(sanitizeAuditFunnelPayload({ event: "audit_completed", sessionId: "a".repeat(128) }).sessionId, "a".repeat(128));
  assert.equal(sanitizeAuditFunnelPayload({ event: "audit_completed", sessionId: "a".repeat(16) }).sessionId, "a".repeat(16));
});
