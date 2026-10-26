import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import Fastify from "fastify";
import { registerCodexRoutes } from "./routes.js";
import { CodexService } from "./client.js";
import { EventHub } from "../core/events.js";
import type { Json } from "../core/json.js";
import { RpcError } from "../transport/rpc.js";

function requirementsFixture(t: TestContext, initial: Json) {
  const app = Fastify();
  const service = new CodexService({hub: new EventHub(), instance: "r28-route-fixture", sweepIntervalMs: 0});
  const calls: Array<{method: string; params: Json}> = [];
  let rawResult = initial, failure: Error | null = null, writerCalls = 0;
  Object.assign(service, {
    raw: async (method: string, params: Json): Promise<Json> => {
      calls.push({method, params});
      assert.equal(method, "configRequirements/read"); assert.equal(params, null);
      if (failure) throw failure;
      return rawResult;
    },
    call: async () => {writerCalls++; throw Error("WRITER_MUST_NOT_RUN");},
  });
  registerCodexRoutes(app, service);
  t.after(async () => {
    try {
      assert.equal(writerCalls, 0);
      assert.deepEqual(service.ownership.ids(), []);
    } finally {
      try { await app.close(); } finally { await service.close(); }
    }
  });
  return {
    calls,
    send: (payload: object = {}) => app.inject({method: "POST", url: "/api/codex/config/requirements/read", payload}),
    setRaw: (value: Json) => {rawResult = value;},
    setFailure: (value: Error) => {failure = value;},
  };
}
const expectedCall = {method: "configRequirements/read", params: null};
const emptyPermissions = {allowedApprovalPolicies: null, allowedApprovalsReviewers: null,
  allowedSandboxModes: null, allowedPermissionProfiles: null, defaultPermissions: null};

test("R28 requirements HTTP returns a server-bound projection and exact models in one readonly call", async t => {
  const raw = {requirements: {autoReview: {requiredOnModels: ["gpt-5.6-terra", "gpt-5.6-sol"], secret: "PRIVATE_AUTO"},
    network: {proxyUrl: "PRIVATE_PROXY"}}};
  const before = structuredClone(raw), f = requirementsFixture(t, raw);
  const response = await f.send();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(f.calls, [expectedCall]); assert.deepEqual(raw, before);
  assert.doesNotMatch(response.body, /PRIVATE_|proxyUrl/);
  assert.deepEqual(response.json().projection, {version: 1, source: "configRequirements/read", scope: "runtime-global",
    runtimeInstance: "r28-route-fixture", status: "known", autoReviewSource: "required-models-list"});
  assert.deepEqual(response.json().requirements, {...emptyPermissions,
    autoReview: {requiredOnModels: ["gpt-5.6-terra", "gpt-5.6-sol"]}});
});

test("R28 requirements HTTP identifies explicit native null with the server instance", async t => {
  const f = requirementsFixture(t, {requirements: null}), response = await f.send();
  assert.equal(response.statusCode, 200); assert.deepEqual(f.calls, [expectedCall]);
  assert.equal(response.json().requirements, null);
  assert.deepEqual(response.json().projection, {version: 1, source: "configRequirements/read", scope: "runtime-global",
    runtimeInstance: "r28-route-fixture", status: "known", autoReviewSource: "native-null"});
});

test("R28 requirements HTTP keeps permissions but marks a mixed model list unavailable in full", async t => {
  const f = requirementsFixture(t, {requirements: {allowedApprovalPolicies: ["never"],
    autoReview: {requiredOnModels: ["gpt-5.6-terra", 42]}}}), response = await f.send();
  assert.equal(response.statusCode, 200); assert.deepEqual(f.calls, [expectedCall]);
  const result = response.json();
  assert.equal(result.requirements.allowedApprovalPolicies[0], "never");
  assert.deepEqual(result.projection, {version: 1, source: "configRequirements/read", scope: "runtime-global",
    runtimeInstance: "r28-route-fixture", status: "unavailable", autoReviewSource: "invalid"});
  assert.deepEqual(result.requirements, {...emptyPermissions, allowedApprovalPolicies: ["never"], autoReview: null});
});

test("R28 requirements HTTP rejects caller-supplied scope or projection without any native dispatch", async t => {
  const f = requirementsFixture(t, {requirements: null});
  for (const payload of [{cwd: "/fixture/project"}, {threadId: "fixture-A"}, {runtimeInstance: "spoof"}, {projection: {version: 1}}]) {
    const response = await f.send(payload);
    assert.equal(response.statusCode, 400); assert.deepEqual(f.calls, []);
    assert.equal(response.json().projection, undefined);
  }
});

for (const c of [
  {label: "method not found", error: new RpcError("Method not found", -32601), status: 501},
  {label: "exact legacy unsupported", error: new RpcError("unknown method configRequirements/read", -32600), status: 501},
  {label: "unrelated unsupported variant", error: new RpcError("unknown method account/read", -32600), status: 500},
  {label: "read failure", error: new Error("fixture unavailable"), status: 500},
]) test("R28 requirements HTTP retains error certainty without retry: " + c.label, async t => {
  const f = requirementsFixture(t, {requirements: null}); f.setFailure(c.error);
  const response = await f.send();
  assert.equal(response.statusCode, c.status); assert.deepEqual(f.calls, [expectedCall]);
  assert.equal(response.json().projection, undefined);
  assert.equal(response.json().requirements, undefined);
});

test("R28 requirements HTTP rejects malformed whole native payloads instead of returning no constraints", async t => {
  const f = requirementsFixture(t, null);
  for (const raw of [null, {}, {requirements: []}, {requirements: true}] as Json[]) {
    f.setRaw(raw); const count = f.calls.length, response = await f.send();
    assert.equal(response.statusCode, 500); assert.equal(f.calls.length, count + 1);
    assert.equal(response.json().projection, undefined); assert.equal(response.json().requirements, undefined);
  }
});
