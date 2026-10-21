import test from "node:test";
import assert from "node:assert/strict";
import {
  breakpointForWidth,
  nextTabForKey,
  parseDashboardTab,
  searchWithTab,
  tabFromSearch,
  visibleTabs,
} from "../lib/dashboardShell.ts";

test("parseDashboardTab accepts the four tabs and falls back to context", () => {
  for (const t of ["context", "analytics", "agents", "chat"]) assert.equal(parseDashboardTab(t), t);
  for (const bad of ["", "Chat", "leads", null, undefined, 3, "context,chat"]) assert.equal(parseDashboardTab(bad), "context");
});

test("breakpointForWidth: phone <768, tablet 768-1099, desktop >=1100", () => {
  assert.equal(breakpointForWidth(390), "mobile");
  assert.equal(breakpointForWidth(767), "mobile");
  assert.equal(breakpointForWidth(768), "tablet");
  assert.equal(breakpointForWidth(820), "tablet");
  assert.equal(breakpointForWidth(1099), "tablet");
  assert.equal(breakpointForWidth(1100), "desktop");
  assert.equal(breakpointForWidth(1536), "desktop");
});

test("tabFromSearch and searchWithTab round-trip and keep other params", () => {
  assert.equal(tabFromSearch("?tab=chat"), "chat");
  assert.equal(tabFromSearch("tab=analytics&x=1"), "analytics");
  assert.equal(tabFromSearch("?tab=nope"), "context");
  assert.equal(tabFromSearch(""), "context");
  assert.equal(searchWithTab("?x=1&tab=chat", "agents"), "?x=1&tab=agents");
  assert.equal(searchWithTab("", "chat"), "?tab=chat");
});

test("visibleTabs: one panel on mobile, a left+right pair on tablet", () => {
  assert.deepEqual(visibleTabs("mobile", "chat", "analytics", "agents"), ["chat"]);
  assert.deepEqual(visibleTabs("tablet", "chat", "analytics", "agents"), ["analytics", "chat"]);
  assert.deepEqual(visibleTabs("tablet", "context", "analytics", "chat"), ["context", "chat"]);
  assert.deepEqual(visibleTabs("tablet", "agents", "context", "chat"), ["context", "agents"]);
});

test("nextTabForKey wraps and supports Home/End", () => {
  assert.equal(nextTabForKey("context", "ArrowRight"), "analytics");
  assert.equal(nextTabForKey("chat", "ArrowRight"), "context");
  assert.equal(nextTabForKey("context", "ArrowLeft"), "chat");
  assert.equal(nextTabForKey("agents", "Home"), "context");
  assert.equal(nextTabForKey("agents", "End"), "chat");
  assert.equal(nextTabForKey("agents", "Enter"), null);
});
