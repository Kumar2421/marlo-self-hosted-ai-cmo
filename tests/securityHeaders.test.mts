import test from "node:test";
import assert from "node:assert/strict";
import { buildSecurityHeaders, CSP_REPORT_ONLY_DIRECTIVES } from "../lib/security/securityHeaders.ts";
import nextConfig from "../next.config.ts";

const byKey = (key: string) => {
  const found = buildSecurityHeaders().find((h) => h.key === key);
  assert.ok(found, `missing header ${key}`);
  return found.value;
};

test("baseline headers are present with the expected values", () => {
  assert.equal(byKey("X-Content-Type-Options"), "nosniff");
  assert.equal(byKey("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(byKey("X-Frame-Options"), "DENY");
  assert.equal(byKey("Permissions-Policy"), "camera=(), microphone=(), geolocation=(), payment=()");
  assert.equal(byKey("Strict-Transport-Security"), "max-age=31536000");
});

test("CSP is report-only and never the enforcing header", () => {
  const keys = buildSecurityHeaders().map((h) => h.key);
  assert.ok(keys.includes("Content-Security-Policy-Report-Only"));
  assert.ok(!keys.includes("Content-Security-Policy"));
});

test("CSP keeps frame, base and form restrictions and lets Supabase and the Lottie wasm through", () => {
  const csp = byKey("Content-Security-Policy-Report-Only");
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);
  assert.match(csp, /connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co/);
  assert.match(csp, /https:\/\/cdn\.jsdelivr\.net/);
  assert.match(csp, /'wasm-unsafe-eval'/);
  const names = CSP_REPORT_ONLY_DIRECTIVES.map((d) => d.split(" ")[0]);
  assert.equal(names.length, new Set(names).size, "each directive appears once");
});

test("next.config applies the headers to every route and disables x-powered-by", async () => {
  assert.equal(nextConfig.poweredByHeader, false);
  const rules = await nextConfig.headers!();
  assert.equal(rules.length, 1);
  assert.equal(rules[0].source, "/:path*");
  assert.deepEqual(rules[0].headers, buildSecurityHeaders());
});
