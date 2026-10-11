import assert from "node:assert/strict";
import { test } from "node:test";
import { readConfig, readRequirements, searchOccurrences, cancelLogin, logout, rollback } from "./protocol.js";
import { RpcError } from "../transport/rpc.js";
import { object, type Json } from "../core/json.js";
import type { Rpc } from "./ownership.js";
test("public MCP startup configuration retains only its explicit boolean", async () => {
  const projected = await readConfig({}, async () => ({config:{desktop:{mcp_startup_authentication:true,secret:"PRIVATE",path:"/private"}}}));
  assert.deepEqual(object(object(projected.config).desktop),{mcp_startup_authentication:true});
  assert.doesNotMatch(JSON.stringify(projected),/PRIVATE|private/);
  const absent = await readConfig({}, async () => ({config:{desktop:{mcp_startup_authentication:"true"}}}));
  assert.equal(object(absent.config).desktop,undefined);
});

test("public config and requirements project only permission fields and never expose credentials or paths", async () => {
  const config = await readConfig({}, async (method, params) => {
    assert.equal(method, "config/read"); assert.deepEqual(params, { includeLayers: false });
    return { config: { approvals_reviewer: "guardian_subagent", approval_policy: "on-request", sandbox_mode: "workspace-write", permissions: "profile:team", private: "SECRET" }, layers: [{ secret: "SECRET" }] };
  });
  assert.deepEqual(config, { config: { approvals_reviewer: "guardian_subagent", approval_policy: "on-request", sandbox_mode: "workspace-write", permissions: "profile:team" } });
  const requirements = await readRequirements({}, async (method, params) => {
    assert.equal(method, "configRequirements/read"); assert.equal(params, null);
    return { requirements: { allowedApprovalPolicies: ["never", "invented"], allowedApprovalsReviewers: ["user"],
      allowedSandboxModes: ["read-only"], allowedPermissionProfiles: { team: true, private: "SECRET" }, defaultPermissions: "team", network: { proxyUrl: "SECRET" } } };
  });
  assert.doesNotMatch(JSON.stringify(requirements), /SECRET|network|invented/);
  assert.deepEqual(object(requirements.requirements).allowedApprovalPolicies, ["never"]);
  for (const params of [null, { cwd: "/private" }, { includeLayers: true }] as Json[]) {
    await assert.rejects(readConfig(params, async () => { throw new Error("Native must not be called"); }), /empty object/);
  }
});

test("literal history search preserves Unicode and opaque cursors without native fallback", async () => {
  const params = { threadId: "t", searchTerm: "😀 needle", cursor: "opaque:x", limit: 250 };
  const data = { data: [{ turnId: "turn", itemId: "item", snippetMatchRange: { start: 4, end: 10 } }], nextCursor: null };
  assert.deepEqual(await searchOccurrences(params, async (method, actual) => {
    assert.equal(method, "thread/searchOccurrences"); assert.deepEqual(actual, params); return data;
  }), data);
  for (const invalid of [{ ...params, limit: 251 }, { ...params, limit: 1.5 }, { ...params, cwd: "/x" }, { ...params, searchTerm: "" }])
    await assert.rejects(searchOccurrences(invalid, async () => { throw new Error("must not send"); }), /Invalid|Unknown|limit/);
  let calls = 0;
  await assert.rejects(searchOccurrences(params, async () => { calls++; throw new RpcError("Method not found", -32601); }), /Method not found/);
  assert.equal(calls, 1);
});

test("account actions reject stale runtime/account snapshots and verify native receipts without retry", async () => {
  let calls = 0;
  const never: Rpc = async () => { calls++; throw new Error("must not send"); };
  await assert.rejects(cancelLogin({ runtimeInstance: "old", loginId: "login" }, "current", never), /SESSION_AUTH_SCOPE_CHANGED/);
  assert.equal(calls, 0);
  assert.deepEqual(await cancelLogin({ runtimeInstance: "current", loginId: "login" }, "current", async (method, params) => {
    assert.equal(method, "account/login/cancel"); assert.deepEqual(params, { loginId: "login" }); return { status: "notFound" };
  }), { status: "notFound" });
  const methods: string[] = [];
  const expected = { type: "chatgpt", email: "test@example.invalid", planType: "plus" };
  await logout({ runtimeInstance: "current", expectedAccount: expected }, "current", async (method, params): Promise<Json> => {
    methods.push(method);
    if (method === "account/read") { assert.deepEqual(params, { refreshToken: false }); return { account: expected }; }
    assert.equal(params, null); return {};
  });
  assert.deepEqual(methods, ["account/read", "account/logout"]);
  await assert.rejects(logout({ runtimeInstance: "current", expectedAccount: expected }, "current", async () => ({ account: { ...expected, email: "changed@example.invalid" } })), /SESSION_AUTH_SCOPE_CHANGED/);
  await assert.rejects(logout({ runtimeInstance: "current", expectedAccount: { type: "apiKey", apiKey: "SECRET" } }, "current", never), /minimal public snapshot/);
  await assert.rejects(cancelLogin({ runtimeInstance: "current", loginId: "login" }, "current", async () => ({ status: "success" })), /DELIVERY_UNKNOWN/);
});

test("rollback falls back only on unsupported legacy method and rebuilds retained history", async () => {
  const calls: Array<{ method: string; params: Json }> = [];
  const result = await rollback({ threadId: "t", numTurns: 1, beforeTurnId: "c" }, async (method, params): Promise<Json> => {
    calls.push({ method, params });
    if (method === "thread/rollback") throw new RpcError("Method not found", -32601);
    if (method === "thread/revert") return { thread: { id: "t", turns: [] }, turnsBackwardsCursor: "tail" };
    return object(params).cursor === "tail" ? { data: [{ id: "b" }], nextCursor: "older" } : { data: [{ id: "a" }], nextCursor: null };
  });
  assert.deepEqual(object(object(result).thread).turns, [{ id: "a" }, { id: "b" }]);
  assert.deepEqual(calls[1], { method: "thread/revert", params: { threadId: "t", beforeTurnId: "c" } });
  assert.equal(object(calls[2].params).itemsView, "full");
  let attempted = 0;
  await assert.rejects(rollback({ threadId: "t", numTurns: 1 }, async () => { attempted++; throw new RpcError("Thread busy", -32000); }), /Thread busy/);
  assert.equal(attempted, 1);
  await assert.rejects(rollback({ threadId: "t", numTurns: 1, beforeTurnId: "c" }, async (method): Promise<Json> => {
    if (method === "thread/rollback") throw new RpcError("Method not found", -32601);
    if (method === "thread/revert") return { thread: { id: "t" }, turnsBackwardsCursor: "tail" };
    throw new Error("history unavailable");
  }), /已回滚.*重新加载失败/);
});
