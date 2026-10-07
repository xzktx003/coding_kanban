import assert from "node:assert/strict";
import test from "node:test";
import { resolveSessionDataHome } from "./session-data-home.js";
test("gateway and runtime data paths are independent of launch directory", () => {
  assert.equal(
    resolveSessionDataHome("/repo"),
    "/repo/.dev-runtime/session-mode",
  );
  assert.equal(resolveSessionDataHome("/repo", "records"), "/repo/records");
  assert.equal(
    resolveSessionDataHome("/repo", "/persistent/app"),
    "/persistent/app",
  );
  assert.throws(() => resolveSessionDataHome("/repo", "bad\npath"));
});
