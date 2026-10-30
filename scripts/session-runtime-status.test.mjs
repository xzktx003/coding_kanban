import assert from "node:assert/strict";
import test from "node:test";
import { sessionRuntimeStatus, readOwnedAgentActivity } from "./session-runtime-status.mjs";
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

test("legacy default remains visible as legacy during TypeScript migration", async () => {
  const options = fake();
  options.env = { SERVER_PORT: "45678" };
  const result = await sessionRuntimeStatus(options);
  assert.equal(result.pid, 123);
  assert.equal(result.runtime, "legacy");
  assert.equal(result.binaryState, "current");
});

test("TS status verifies executable plus entrypoint and compares the complete JS build", async () => {
  const entrypoint = "/fixture/packages/session-runtime/dist/main.js";
  const options = fake();
  options.env = { SERVER_PORT: "45678" };
  options.readFile = (path) =>
    path.endsWith("runtime.json")
      ? JSON.stringify({
          pid: 123,
          port: 45679,
          instance: "owned",
          binary: process.execPath,
          entrypoint,
          buildFingerprint: "same",
        })
      : `${process.execPath}\0${entrypoint}\0--port\0${45679}`;
  options.fingerprint = () => "same";
  assert.equal((await sessionRuntimeStatus(options)).binaryState, "current");
  options.fingerprint = () => "changed";
  const result = await sessionRuntimeStatus(options);
  assert.equal(result.runtime, "typescript");
  assert.equal(result.binaryState, "older");
  options.readFile = (path) =>
    path.endsWith("runtime.json")
      ? JSON.stringify({
          pid: 123,
          instance: "owned",
          binary: process.execPath,
          entrypoint,
          buildFingerprint: "same",
        })
      : `${process.execPath}\0/other/main.js\0`;
  assert.equal((await sessionRuntimeStatus(options)).binaryState, "unknown");
});
test("owned Agent health preserves validated counts only; missing or malformed providers remain unknown", async () => {
  const counts={cc:{connections:1,activeTurns:1,pendingRequests:0},acp:{connections:2,activePrompts:0,pendingRequests:1,uncertainSessions:1}};
  const projected=readOwnedAgentActivity({...counts,transcript:"private",cc:{...counts.cc,text:"private"}});
  assert.deepEqual(projected,counts);
  for(const value of [undefined,{}, {...counts,acp:null},{...counts,cc:{...counts.cc,connections:-1}},{...counts,acp:{...counts.acp,uncertainSessions:"0"}}])
    assert.equal(readOwnedAgentActivity(value),undefined);
  const options=fake();options.fetcher=async()=>({ok:true,json:async()=>({status:"ok",instance:"owned",codexBackend:"shared-daemon",ownedAgents:counts})});
  const result=await sessionRuntimeStatus(options);
  assert.deepEqual(result.ownedAgents,counts);assert.equal(result.codexBackend,"shared-daemon");
});
