import assert from "node:assert/strict";
import test from "node:test";
import { scopeSessionSelector } from "./session-css-scope.mjs";

test("session style roots and dark theme remain inside the mode", () => {
  assert.equal(scopeSessionSelector(":root"), ".session-mode");
  assert.equal(scopeSessionSelector("body"), ".session-mode");
  assert.equal(
    scopeSessionSelector(".dark .text-white"),
    ".session-mode.dark .text-white",
  );
  assert.equal(
    scopeSessionSelector("button:hover"),
    ".session-mode button:hover",
  );
  assert.equal(
    scopeSessionSelector(".session-mode .session-ready"),
    ".session-mode .session-ready",
  );
});
