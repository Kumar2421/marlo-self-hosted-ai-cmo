import test from "node:test";
import assert from "node:assert/strict";
import { friendlyGithubError, friendlyGithubUrlError } from "../lib/domain/github/friendlyGithubError.ts";

test("an owner who has not approved the app is told who has to act", () => {
  const out = friendlyGithubError("The GitHub organization owner still has to approve the installation.");
  assert.match(out.message, /organization owner has to approve/);
  assert.equal(out.action, null);
});

test("lost repository access offers Reconnect", () => {
  for (const raw of ["GitHub access was removed. Connect GitHub again.", "That repository isn't shared with Marlo. Add it in the GitHub App settings first.", "You don't have access to that repository on GitHub."]) {
    const out = friendlyGithubError(raw);
    assert.equal(out.action, "reconnect", raw);
    assert.match(out.message, /Reconnect GitHub/, raw);
  }
});

test("rate limits say to wait and can be retried", () => {
  const out = friendlyGithubError("GitHub could not issue an installation token: HTTP 429");
  assert.equal(out.action, "retry");
  assert.match(out.message, /limiting requests/);
  assert.equal(friendlyGithubError("You have exceeded a secondary rate limit").action, "retry");
});

test("an expired preview tells the user to Cancel and prepare again", () => {
  for (const raw of ["This preview expired. Prepare the fix again.", "This preview was already used. Prepare the fix again."]) {
    assert.equal(friendlyGithubError(raw).message, "This preview has expired. Click Cancel, then Prepare fix again.", raw);
  }
});

test("switching project mid-fix is explained", () => {
  assert.match(friendlyGithubError("Finding not found.").message, /switched to another project/);
  assert.match(friendlyGithubError("No active project.").message, /switched to another project/);
});

test("unknown messages pass through, and empty ones get a generic line", () => {
  assert.deepEqual(friendlyGithubError("Something odd happened"), { message: "Something odd happened", action: null });
  assert.deepEqual(friendlyGithubError(""), { message: "Something went wrong with GitHub. Try again.", action: "retry" });
  assert.equal(friendlyGithubError(undefined).action, "retry");
});

test("a bare mention of reconnect no longer triggers the lost-access rule", () => {
  assert.equal(friendlyGithubError("Please reconnect your printer").action, null);
  assert.equal(friendlyGithubError("GitHub access was removed. Connect GitHub again.").action, "reconnect");
});

test("URL errors: only our own messages are shown, anything else is generic", () => {
  assert.equal(friendlyGithubUrlError("Not authenticated").message, "Not authenticated");
  assert.equal(friendlyGithubUrlError("The GitHub organization owner still has to approve the installation.").action, null);
  assert.match(friendlyGithubUrlError("The GitHub organization owner still has to approve the installation.").message, /organization owner has to approve/);
  for (const hostile of ["Your account is locked, call 555-0100", "<img src=x onerror=alert(1)>", "", "not authenticated ", "Reconnect", null, undefined]) {
    const out = friendlyGithubUrlError(hostile);
    assert.equal(out.message, "GitHub connection didn't finish. Try again.", String(hostile));
  }
});
