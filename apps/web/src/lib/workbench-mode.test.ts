import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWorkbenchMode,
  resolveWorkbenchMode,
  workbenchModeUrl,
} from "./workbench-mode";

test("explicit mode takes precedence over the saved mode", () => {
  assert.equal(resolveWorkbenchMode("?mode=terminal", "session"), "terminal");
  assert.equal(resolveWorkbenchMode("?mode=session", "terminal"), "session");
  assert.equal(resolveWorkbenchMode("?other=1", "session"), "session");
});

test("invalid persisted or URL values fall back safely", () => {
  assert.equal(parseWorkbenchMode("unknown"), "terminal");
  assert.equal(resolveWorkbenchMode("?mode=unknown", "session"), "session");
  assert.equal(resolveWorkbenchMode("", null), "terminal");
});

test("switching mode preserves the mobile route, other parameters and hash", () => {
  assert.equal(
    workbenchModeUrl("/mobile?session=abc#details", "session"),
    "/mobile?session=abc&mode=session#details",
  );
  assert.equal(
    workbenchModeUrl("/?mode=session", "terminal"),
    "/?mode=terminal",
  );
});
