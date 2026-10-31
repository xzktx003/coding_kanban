import test from "node:test";
import assert from "node:assert/strict";
import { createSessionRuntimeProtocol } from "./session-runtime-protocol.js";
test("only explicit legacy ownership health permits compatibility and instance changes fail closed", async () => {
  let instance = "legacy-one";
  const protocol = createSessionRuntimeProtocol(async () => ({
    status: "ok",
    instance,
    capabilities: { codexOwnership: true },
  }));
  const first = await protocol.read();
  assert.equal(first.backend, "legacy-stdio");
  assert.match(first.scopeToken, /^legacy:/);
  assert.equal((await protocol.read()).scopeToken, first.scopeToken);
  instance = "legacy-two";
  await assert.rejects(protocol.read(), /变化/);
});
test("modern and unrecognized health can never authorize a legacy fallback", async () => {
  const modern = createSessionRuntimeProtocol(async () => ({
    status: "ok",
    instance: "modern",
    runtime: "typescript",
    codexBackend: "shared-daemon",
    capabilities: { codexOwnership: true },
  }));
  assert.equal((await modern.read()).backend, "shared-daemon");
  const unknown = createSessionRuntimeProtocol(async () => ({
    status: "ok",
    instance: "unknown",
  }));
  await assert.rejects(unknown.read(), /无法核实/);
});

test("a selected modern runtime cannot downgrade after a timeout or a legacy-looking replacement", async () => {
  let mode = "modern";
  const protocol = createSessionRuntimeProtocol(async () => {
    if (mode === "timeout") throw new Error("health timeout");
    return mode === "modern"
      ? {
          status: "ok",
          instance: "same",
          runtime: "typescript",
          codexBackend: "shared-daemon",
        }
      : {
          status: "ok",
          instance: "same",
          capabilities: { codexOwnership: true },
        };
  });
  assert.equal((await protocol.read()).backend, "shared-daemon");
  mode = "timeout";
  await assert.rejects(protocol.read(), /timeout/);
  mode = "legacy";
  await assert.rejects(protocol.read(), /变化/);
});
