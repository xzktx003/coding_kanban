import assert from "node:assert/strict";
import test from "node:test";
import { sessionRuntimeStatus } from "./session-runtime-status.mjs";
const binary = "/fixture/bin/runtime";
function fake({ instance = "owned", changed = false } = {}) {
  return {
    root: "/fixture",
    env: { SESSION_RUNTIME_BIN: binary, SERVER_PORT: "45678" },
    fetcher: async (url) => {
      assert.equal(url, "http://127.0.0.1:45678/api/session/health");
      return { ok: true, json: async () => ({ status: "ok", instance }) };
    },
    readFile: (path) =>
      path.endsWith("runtime.json")
        ? JSON.stringify({ pid: 123, port: 45679, instance: "owned", binary })
        : `${binary}\0--port\0${45679}`,
    stat: (path) => ({
      dev: 1,
      ino: path.startsWith("/proc/") && changed ? 2 : 1,
    }),
  };
}
test("disabled mode needs neither a health request nor a runtime record", async () => {
  const result = await sessionRuntimeStatus({
    root: "/fixture",
    env: { SESSION_MODE_ENABLED: "0" },
    fetcher: () => {
      throw new Error("should not fetch");
    },
  });
  assert.equal(result.state, "disabled");
});
test("healthy runtime reports matching or older executable without stopping it", async () => {
  assert.equal((await sessionRuntimeStatus(fake())).binaryState, "current");
  const result = await sessionRuntimeStatus(fake({ changed: true }));
  assert.equal(result.state, "ready");
  assert.equal(result.binaryState, "older");
  assert.equal(result.pid, 123);
});
test("mismatched ownership never claims which local PID is serving requests", async () => {
  const result = await sessionRuntimeStatus(fake({ instance: "foreign" }));
  assert.equal(result.binaryState, "unknown");
  assert.equal(result.pid, undefined);
});
test("runtime failures remain distinct from gateway availability", async () => {
  const result = await sessionRuntimeStatus({
    ...fake(),
    fetcher: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(result.state, "unavailable");
  assert.match(result.error, /503/);
});
