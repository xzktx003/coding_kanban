import assert from "node:assert/strict";
import { test } from "node:test";
import { readRequirements } from "./protocol.js";
import { object, type Json } from "../core/json.js";
import { RpcError } from "../transport/rpc.js";

const r28Permissions = {
  allowedApprovalPolicies: null, allowedApprovalsReviewers: null,
  allowedSandboxModes: null, allowedPermissionProfiles: null, defaultPermissions: null,
};
const r28Projection = (autoReviewSource: string, status = "known", runtimeInstance: string | null = null) => ({
  version: 1, source: "configRequirements/read", scope: "runtime-global",
  runtimeInstance, status, autoReviewSource,
});

const r28Known: Array<{label: string; native: Json; source: string; auto: Json}> = [
  {label: "native null", native: null, source: "native-null", auto: null},
  {label: "autoReview absent", native: {}, source: "auto-review-absent", auto: null},
  {label: "autoReview null", native: {autoReview: null}, source: "auto-review-null", auto: null},
  {label: "required list absent", native: {autoReview: {}}, source: "required-models-absent", auto: {requiredOnModels: null}},
  {label: "required list null", native: {autoReview: {requiredOnModels: null}}, source: "required-models-null", auto: {requiredOnModels: null}},
  {label: "explicit empty list", native: {autoReview: {requiredOnModels: []}}, source: "required-models-list", auto: {requiredOnModels: []}},
  {label: "exact strings/order/duplicates", native: {autoReview: {requiredOnModels: ["gpt-5.6-terra", "gpt-5.6-sol", "Sol", "provider/sol", "gpt-5.6-terra", " Sol "]}},
    source: "required-models-list", auto: {requiredOnModels: ["gpt-5.6-terra", "gpt-5.6-sol", "Sol", "provider/sol", "gpt-5.6-terra", " Sol "]}},
];
for (const c of r28Known) test("R28 requirements preserves " + c.label + " in one native read", async () => {
  const calls: Array<{method: string; params: Json}> = [];
  const response = {requirements: c.native};
  const before = structuredClone(response);
  const result = await readRequirements({}, async (method, params) => {
    calls.push({method, params}); return response;
  });
  assert.deepEqual(calls, [{method: "configRequirements/read", params: null}]);
  assert.deepEqual(response, before);
  const inputModels = object(object(c.native).autoReview).requiredOnModels;
  const outputModels = object(object(result.requirements).autoReview).requiredOnModels;
  if (Array.isArray(inputModels)) assert.notStrictEqual(outputModels, inputModels);
  assert.deepEqual(result.projection, r28Projection(c.source));
  assert.deepEqual(result.requirements, c.native === null ? null : {...r28Permissions, autoReview: c.auto});
});

const r28Malformed: Array<{label: string; value: Json}> = [
  {label: "empty member", value: {requiredOnModels: ["terra", ""]}},
  {label: "scalar autoReview", value: "wrong"}, {label: "array autoReview", value: []},
  {label: "string list", value: {requiredOnModels: "terra"}},
  {label: "object list", value: {requiredOnModels: {model: "terra"}}},
  {label: "mixed numeric member", value: {requiredOnModels: ["terra", 7]}},
  {label: "mixed null member", value: {requiredOnModels: ["terra", null]}},
  {label: "boolean member", value: {requiredOnModels: [false]}},
  {label: "C0 member", value: {requiredOnModels: ["terra", "sol\u001f"]}},
  {label: "DEL member", value: {requiredOnModels: ["sol\u007f"]}},
];
for (const c of r28Malformed) test("R28 invalid auto-review is unavailable: " + c.label, async () => {
  let calls = 0;
  const result = await readRequirements({}, async (method, params) => {
    calls++; assert.equal(method, "configRequirements/read"); assert.equal(params, null);
    return {requirements: {allowedApprovalPolicies: ["never"], autoReview: c.value}};
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.projection, r28Projection("invalid", "unavailable"));
  assert.deepEqual(result.requirements, {...r28Permissions, allowedApprovalPolicies: ["never"], autoReview: null});
});

const r28Limits: Array<{label: string; names: string[]; valid: boolean}> = [
  {label: "exact 256 entries", names: Array(256).fill("terra"), valid: true},
  {label: "257 entries", names: Array(257).fill("terra"), valid: false},
  {label: "exact ASCII 512 bytes", names: ["t".repeat(512)], valid: true},
  {label: "ASCII 513 bytes", names: ["t".repeat(513)], valid: false},
  {label: "exact mixed UTF8 512 bytes", names: ["界".repeat(170) + "ab"], valid: true},
  {label: "mixed UTF8 513 bytes", names: ["界".repeat(170) + "abc"], valid: false},
  {label: "exact raw total 65536 bytes", names: Array(128).fill("界".repeat(170) + "ab"), valid: true},
  {label: "raw total 65537 bytes", names: [...Array(128).fill("界".repeat(170) + "ab"), "x"], valid: false},
];
for (const c of r28Limits) test("R28 local validation bound: " + c.label, async () => {
  let calls = 0;
  const result = await readRequirements({}, async (method, params) => {
    calls++; assert.equal(method, "configRequirements/read"); assert.equal(params, null);
    return {requirements: {autoReview: {requiredOnModels: c.names}}};
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.projection, r28Projection(c.valid ? "required-models-list" : "invalid", c.valid ? "known" : "unavailable"));
  assert.deepEqual(object(result.requirements).autoReview, c.valid ? {requiredOnModels: c.names} : null);
});

test("R28 projection keeps old permission allowlists, strips unrelated data and never mutates raw", async () => {
  const raw = {requirements: {
    allowedApprovalPolicies: ["never", "invented"], allowedApprovalsReviewers: ["user", "invented"],
    allowedSandboxModes: ["read-only", "invented"], allowedPermissionProfiles: {team: true, bad: "PRIVATE_PERMISSION"},
    defaultPermissions: "team", autoReview: {requiredOnModels: ["terra", "sol"], secret: "PRIVATE_AUTO_SIBLING", cwd: "/fixture/private"},
    network: {proxyUrl: "PRIVATE_PROXY"}, logDir: "/fixture/private-log",
  }, layers: [{token: "PRIVATE_LAYER"}], account: {email: "private@example.invalid"}};
  const before = structuredClone(raw); let calls = 0;
  const result = await readRequirements({}, async () => {calls++; return raw;});
  assert.equal(calls, 1); assert.deepEqual(raw, before);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|private-log|private@example|proxyUrl|layers|cwd/);
  assert.deepEqual(result.requirements, {allowedApprovalPolicies: ["never"], allowedApprovalsReviewers: ["user"],
    allowedSandboxModes: ["read-only"], allowedPermissionProfiles: {team: true}, defaultPermissions: "team",
    autoReview: {requiredOnModels: ["terra", "sol"]}});
  assert.deepEqual(result.projection, r28Projection("required-models-list"));
});

test("R28 malformed whole native DTO still rejects; read errors propagate once without fallback", async () => {
  for (const response of [null, {}, {requirements: []}, {requirements: true}] as Json[]) {
    let calls = 0;
    await assert.rejects(readRequirements({}, async () => {calls++; return response;}), /Invalid native requirements/);
    assert.equal(calls, 1);
  }
  for (const error of [new RpcError("Method not found", -32601), new Error("fixture unavailable")]) {
    let calls = 0;
    await assert.rejects(readRequirements({}, async () => {calls++; throw error;}), e => e === error);
    assert.equal(calls, 1);
  }
});

test("R28 readonly request rejects caller scope/projection before native dispatch", async () => {
  for (const input of [null, {cwd: "/fixture/project"}, {threadId: "fixture-A"}, {includeLayers: true},
    {projection: {version: 1}}, {runtimeInstance: "caller-chosen"}] as Json[]) {
    let calls = 0;
    await assert.rejects(readRequirements(input, async () => {calls++; throw Error("UNEXPECTED_NATIVE");}), /empty object/);
    assert.equal(calls, 0);
  }
});
