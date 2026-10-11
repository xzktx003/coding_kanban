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

test("Codex deep links and device preferences select the third workbench", () => {
  assert.equal(resolveWorkbenchMode("?mode=codex", "session"), "codex");
  assert.equal(resolveWorkbenchMode("?mode=terminal", "codex"), "terminal");
  assert.equal(resolveWorkbenchMode("?mode=unknown", "codex"), "codex");
  assert.equal(parseWorkbenchMode("codex"), "codex");
  assert.equal(
    workbenchModeUrl("/mobile?session=abc&mode=session#details", "codex"),
    "/mobile?session=abc&mode=codex#details",
  );
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
