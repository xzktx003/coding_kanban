import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSharedThreadCreationAuthority, consumeSharedThreadCreationReceipt } from "../src/shared-thread-creation.mjs";

function fixture(options = {}) {
  let record = { viewId: randomUUID() }, projectCurrent = true, intentCurrent = true, time = 100;
  const scope = { hostId: "kanban-shared-cli", runtimeGeneration: randomUUID(), daemonGeneration: randomUUID(), accountRevision: 1, projectId: "owned-project", cwd: "/private/owned-project", viewId: record.viewId, creationNonce: randomUUID() };
  const frame = { id: `thread/start:${randomUUID()}`, method: "thread/start", params: { cwd: scope.cwd } };
  const controller = new AbortController(), control = { signal: controller.signal, deadline: time + 5000 }, receipts = [];
  const authority = createSharedThreadCreationAuthority({ verifyProjectSync: value => projectCurrent && value.projectId === scope.projectId && value.cwd === scope.cwd && value.runtimeGeneration === scope.runtimeGeneration && value.daemonGeneration === scope.daemonGeneration && value.accountRevision === scope.accountRevision,
    getOwnedView: () => record, verifyOwnedViewSync: () => true, verifyExplicitIntentSync: value => intentCurrent && value.creationNonce === scope.creationNonce, onCreated: receipt => { receipts.push(receipt); }, now: () => time, ...options });
  const reply = { id: frame.id, result: { approvalPolicy: "on-request", approvalsReviewer: "user", cwd: scope.cwd, model: "real-default", modelProvider: "openai", sandbox: { type: "readOnly" }, thread: { id: randomUUID(), cwd: scope.cwd, turns: [] } } };
  return { authority, scope, frame, control, controller, receipts, reply,
    replaceRecord: () => { record = { ...record }; }, revokeProject: () => { projectCurrent = false; }, revokeIntent: () => { intentCurrent = false; }, expire: () => { time += 5001; } };
}
const denied = { code: "SHARED_CREATE_DENIED" }, unknown = { code: "SHARED_DAEMON_OUTCOME_UNKNOWN" };

test("explicit fixed project create writes once; binding receives only the daemon's actual UUID", () => {
  const f = fixture();
  assert.equal(f.authority.registerCreate(f.scope, f.frame, f.control), true);
  assert.deepEqual(f.receipts, []);
  assert.equal(f.authority.beforeWriteSync(f.frame), true);
  assert.deepEqual(f.receipts, []);
  const result = f.authority.observeReplySync(f.frame, f.reply);
  assert.equal(result.status, "created"); assert.equal(result.threadId, f.reply.result.thread.id);
  assert.equal(f.receipts[0], result);
  assert.throws(() => f.authority.beforeWriteSync(f.frame), denied);
  assert.throws(() => f.authority.registerCreate(f.scope, { ...f.frame, id: randomUUID() }, f.control), denied);
});

test("background/unregistered thread/start and unacknowledged creation intent are denied", () => {
  const f = fixture(); assert.throws(() => f.authority.beforeWriteSync(f.frame), denied);
  f.revokeIntent(); assert.throws(() => f.authority.registerCreate(f.scope, f.frame, f.control), denied);
});

test("arbitrary config, permission, paths and host IDs cannot enter fixed native CLI creation", () => {
  for (const extra of [{ config: { model: "injected" } }, { approvalPolicy: "never" }, { sandbox: "danger-full-access" }, { cwd: "/different" }, { dynamicTools: [] }, { projectId: "another" }]) {
    const f = fixture(); assert.throws(() => f.authority.registerCreate(f.scope, { ...f.frame, params: { ...f.frame.params, ...extra } }, f.control), denied);
  }
  const f = fixture(); assert.throws(() => f.authority.registerCreate({ ...f.scope, hostId: "local" }, f.frame, f.control), denied);
});

test("replacement owned record, account/config revocation, cancellation and expiry prevent actual dispatch", () => {
  for (const revoke of [f => f.replaceRecord(), f => f.revokeProject(), f => f.controller.abort(), f => f.expire()]) {
    const f = fixture(); f.authority.registerCreate(f.scope, f.frame, f.control); revoke(f);
    assert.throws(() => f.authority.beforeWriteSync(f.frame), denied); assert.deepEqual(f.receipts, []);
  }
});

test("dispatch burns nonce even with missing outcome; another request cannot reuse it", () => {
  const f = fixture(); f.authority.registerCreate(f.scope, f.frame, f.control); f.authority.beforeWriteSync(f.frame);
  assert.throws(() => f.authority.beforeWriteSync(f.frame), denied);
  assert.throws(() => f.authority.registerCreate(f.scope, { ...f.frame, id: randomUUID() }, f.control), denied);
  assert.deepEqual(f.receipts, []);
});

test("invalid/late thread reply cannot establish binding or be retried", () => {
  for (const edit of [f => { f.reply.result.thread.id = "invented"; }, f => { f.reply.result.cwd = "/other"; }, f => { f.reply.result.thread.turns = [{}]; }, f => f.replaceRecord(), f => f.revokeProject(), f => f.expire()]) {
    const f = fixture(); f.authority.registerCreate(f.scope, f.frame, f.control); f.authority.beforeWriteSync(f.frame); edit(f);
    assert.throws(() => f.authority.observeReplySync(f.frame, f.reply), unknown); assert.deepEqual(f.receipts, []);
    assert.throws(() => f.authority.registerCreate(f.scope, { ...f.frame, id: randomUUID() }, f.control), denied);
  }
});

test("actual native error is a rejection and does not invent a UUID", () => {
  const f = fixture(); f.authority.registerCreate(f.scope, f.frame, f.control); f.authority.beforeWriteSync(f.frame);
  assert.deepEqual(f.authority.observeReplySync(f.frame, { id: f.frame.id, error: { code: -32602, message: "invalid" } }), { status: "rejected" });
  assert.deepEqual(f.receipts, []);
});

test("retiring the exact view makes a late creation reply unusable", () => {
  const f = fixture(); f.authority.registerCreate(f.scope, f.frame, f.control); f.authority.beforeWriteSync(f.frame);
  f.authority.retireView(f.scope.viewId); assert.throws(() => f.authority.observeReplySync(f.frame, f.reply), denied);
  assert.deepEqual(f.receipts, []);
});

test("only actual observed reply can mint a one-use execution receipt for the exact metadata binding", () => {
  const f = fixture();
  f.authority.registerCreate(f.scope, f.frame, f.control); f.authority.beforeWriteSync(f.frame);
  const receipt = f.authority.observeReplySync(f.frame, f.reply);
  const binding = { hostId: f.scope.hostId, runtimeGeneration: f.scope.runtimeGeneration, daemonGeneration: f.scope.daemonGeneration, accountRevision: f.scope.accountRevision, projectId: f.scope.projectId, threadId: f.reply.result.thread.id, viewId: f.scope.viewId, clientId: randomUUID() };
  assert.equal(consumeSharedThreadCreationReceipt({ ...receipt }, binding), null);
  assert.equal(consumeSharedThreadCreationReceipt(receipt, { ...binding, accountRevision: 2 }), null);
  const proof = consumeSharedThreadCreationReceipt(receipt, binding);
  assert.equal(proof.origin, "native-start-response"); assert.equal(proof.execution.cwd, f.scope.cwd);
  assert.equal(proof.execution.approvalPolicy, "on-request"); assert.equal(Object.isFrozen(proof.execution.sandbox), true);
  assert.equal(consumeSharedThreadCreationReceipt(receipt, binding), null);
});

test("receipt source rechecks actual owned record and project before consumption", () => {
  const f = fixture(); f.authority.registerCreate(f.scope, f.frame, f.control); f.authority.beforeWriteSync(f.frame);
  const receipt = f.authority.observeReplySync(f.frame, f.reply); f.revokeProject();
  const binding = Object.fromEntries(["hostId", "runtimeGeneration", "daemonGeneration", "accountRevision", "projectId", "viewId"].map(k => [k, f.scope[k]]));
  Object.assign(binding, { threadId: receipt.threadId, clientId: randomUUID() });
  assert.equal(consumeSharedThreadCreationReceipt(receipt, binding), null);
});

test("same-source permission proof authorizes an exact original profile and only its actual reply mints a receipt",()=>{
 let selectionCurrent=true;const f=fixture({verifyPermissionSelectionSync:()=>selectionCurrent});
 Object.assign(f.frame.params,{permissions:':workspace',approvalPolicy:'on-request',approvalsReviewer:'user',runtimeWorkspaceRoots:[f.scope.cwd]});
 Object.assign(f.reply.result,{activePermissionProfile:{id:':workspace',extends:null},sandbox:{type:'workspaceWrite',writableRoots:[f.scope.cwd],networkAccess:false},runtimeWorkspaceRoots:[f.scope.cwd]});
 assert.equal(f.authority.registerCreate(f.scope,f.frame,f.control),true);assert.equal(f.authority.beforeWriteSync(f.frame),true);
 const receipt=f.authority.observeReplySync(f.frame,f.reply),binding={hostId:f.scope.hostId,runtimeGeneration:f.scope.runtimeGeneration,daemonGeneration:f.scope.daemonGeneration,accountRevision:1,projectId:f.scope.projectId,threadId:receipt.threadId,viewId:f.scope.viewId,clientId:randomUUID()};
 const data=consumeSharedThreadCreationReceipt(receipt,binding);assert.equal(data.permissionRequest.permissions,':workspace');assert.equal(Object.isFrozen(data.permissionRequest.runtimeWorkspaceRoots),true);assert.match(data.permissionRequestSha256,/^[a-f0-9]{64}$/);
 const revoked=fixture({verifyPermissionSelectionSync:()=>selectionCurrent});Object.assign(revoked.frame.params,{permissions:':read-only'});revoked.authority.registerCreate(revoked.scope,revoked.frame,revoked.control);selectionCurrent=false;assert.throws(()=>revoked.authority.beforeWriteSync(revoked.frame),denied);
});
test("unknown or mismatched effective permission reply cannot be bound or retried",()=>{
 for(const mismatch of [{activePermissionProfile:{id:':danger-full-access'}},{approvalsReviewer:'auto_review'},{approvalPolicy:'never'}]){
  const f=fixture({verifyPermissionSelectionSync:()=>true});Object.assign(f.frame.params,{permissions:':read-only',approvalPolicy:'on-request',approvalsReviewer:'user'});f.reply.result.activePermissionProfile={id:':read-only'};Object.assign(f.reply.result,mismatch);
  f.authority.registerCreate(f.scope,f.frame,f.control);f.authority.beforeWriteSync(f.frame);assert.throws(()=>f.authority.observeReplySync(f.frame,f.reply),unknown);assert.equal(f.receipts.length,0);assert.throws(()=>f.authority.beforeWriteSync(f.frame),denied);
 }
});
