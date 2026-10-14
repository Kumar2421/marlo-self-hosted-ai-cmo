import test from "node:test";
import assert from "node:assert/strict";
import { returnUrl, safeReturnPath } from "../lib/domain/github/returnPath.ts";
import { safeReturnPath as fromGithubApp } from "../lib/domain/github/githubApp.ts";

test("same-site paths are accepted, including their query strings", () => {
  assert.equal(safeReturnPath("/dashboard?finding=abc"), "/dashboard?finding=abc");
  assert.equal(safeReturnPath("/settings/integrations"), "/settings/integrations");
});

test("anything that could leave the site is refused", () => {
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "dashboard", "", null, 42, "/" + "a".repeat(300)]) {
    assert.equal(safeReturnPath(bad), null, JSON.stringify(bad));
  }
});

test("githubApp re-exports the same validator", () => {
  assert.equal(fromGithubApp, safeReturnPath);
});

test("returnUrl builds same-origin redirects and replaces existing parameters", () => {
  const url = returnUrl("https://app.marlo.test", "/dashboard?finding=abc", { github_error: "Nope" });
  assert.equal(url.origin, "https://app.marlo.test");
  assert.equal(url.pathname, "/dashboard");
  assert.equal(url.searchParams.get("finding"), "abc");
  assert.equal(url.searchParams.get("github_error"), "Nope");
  const again = returnUrl("https://app.marlo.test", "/dashboard?github_error=old", { github_error: "new" });
  assert.deepEqual(again.searchParams.getAll("github_error"), ["new"]);
});

test("returnUrl falls back to settings when the path would leave the origin", () => {
  const url = returnUrl("https://app.marlo.test", "//evil.example/x", { github: "connected" });
  assert.equal(url.origin, "https://app.marlo.test");
  assert.equal(url.pathname, "/settings/integrations");
  assert.equal(url.searchParams.get("github"), "connected");
  assert.equal(returnUrl("https://app.marlo.test", null, {}).pathname, "/settings/integrations");
});
