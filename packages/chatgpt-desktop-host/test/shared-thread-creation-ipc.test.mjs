import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const { isSharedThreadCreationFrame, createNativeSharedThreadCreationClient, createHostSharedThreadCreationEndpoint } = createRequire(import.meta.url)("../src/shared-thread-creation-ipc.cjs");
function fixture({ onScope, onAuthorize, onBinding } = {}) {
  const profileId = randomUUID(), generation = randomUUID(), viewId = randomUUID(), messages = [];
  const target = { hostId: "kanban-shared-cli", projectId: "owned-project", cwd: "/private/owned-project", viewId };
  const scope = { ...target, runtimeGeneration: generation, daemonGeneration: randomUUID(), accountRevision: 1, creationNonce: randomUUID() };
  const threadId = randomUUID(), binding = { hostId: target.hostId, runtimeGeneration: generation, daemonGeneration: scope.daemonGeneration, accountRevision: 1, projectId: target.projectId, threadId, viewId, clientId: randomUUID() };
  let native, host;
  host = createHostSharedThreadCreationEndpoint({ profileId, generation, verifyCurrentSync: () => true, sendFrame: frame => { messages.push(frame); assert.equal(native.receive(frame), true); }, onScope: onScope ?? (async () => scope),
    onAuthorize: onAuthorize ?? (async () => true), onBinding: onBinding ?? (async () => binding) });
  native = createNativeSharedThreadCreationClient({ profileId, generation, verifyCurrentSync: () => true, sendFrame: frame => { messages.push(frame); assert.equal(host.receive(frame), true); } });
  const controller = new AbortController(), control = () => ({ attemptId: randomUUID(), signal: controller.signal, deadline: performance.now() + 10_000 });
  const frame = { id: `thread/start:${randomUUID()}`, method: "thread/start", params: { cwd: scope.cwd } };
  return { profileId, generation, native, host, target, scope, threadId, binding, controller, control, messages, frame, close: () => { native.close(); host.close(); } };
}

test("fixed scope/authorize/binding operations preserve exact project and server-minted nonce across owned channel", async () => {
  const f = fixture();
  assert.deepEqual(await f.native.resolveCreateScope(f.target, f.control()), f.scope);
  assert.equal(await f.native.authorizeCreate(f.scope, f.frame, f.control()), true);
  assert.deepEqual(await f.native.resolveCreatedBinding(f.scope, f.threadId, f.control()), f.binding);
  assert.equal(f.messages.filter(x => x.type === "shared-create-request").length, 3);
  assert.equal(f.host.receive(f.messages[0]), false); f.close();
});

test("host successful authorize ACK does not abort the capability before final native socket dispatch", async () => {
  let captured;
  const f = fixture({ onAuthorize: async (_scope, _frame, control) => { captured = control.signal; return true; } });
  await f.native.authorizeCreate(f.scope, f.frame, f.control());
  assert.equal(captured.aborted, false); f.close();
});

test("scope alone permits the owned host to map AppHost project id; binding retains the canonical project", async () => {
  const f = fixture(), target = { ...f.target, projectId: randomUUID() };
  assert.deepEqual(await f.native.resolveCreateScope(target, f.control()), f.scope);
  assert.deepEqual(await f.native.resolveCreatedBinding(f.scope, f.threadId, f.control()), f.binding); f.close();
});

test("the original submit abort after authorize ACK revokes the host capability before delayed socket write", async () => {
  let signal; const f = fixture({ onAuthorize: async (_s, _f, control) => { signal = control.signal; return true; } });
  await f.native.authorizeCreate(f.scope, f.frame, f.control()); assert.equal(signal.aborted, false);
  f.controller.abort(); assert.equal(signal.aborted, true); f.close();
});

test("no arbitrary RPC/config/URL, mismatched generation or oversized frame enters owned creation channel", () => {
  const f = fixture(), normal = { v: 1, type: "shared-create-request", profileId: f.profileId, generation: f.generation, id: randomUUID(), op: "authorize", data: { scope: f.scope, frame: f.frame } };
  for (const candidate of [{ ...normal, op: "turn/start" }, { ...normal, generation: randomUUID() }, { ...normal, data: { scope: f.scope, frame: { ...f.frame, params: { cwd: f.scope.cwd, config: {} } } } }, { ...normal, url: "http://127.0.0.1" }, { ...normal, data: { scope: { ...f.scope, cwd: "/bad/../path" }, frame: f.frame } }]) {
    assert.equal(isSharedThreadCreationFrame(candidate, { side: "host", profileId: f.profileId, generation: f.generation }), false);
    assert.equal(f.host.receive(candidate), false);
  }
  f.close();
});

test("binding failure after actual creation reports unknown and cannot manufacture successful UUID", async () => {
  const f = fixture({ onBinding: async () => { throw new Error("created metadata stale"); } });
  await assert.rejects(() => f.native.resolveCreatedBinding(f.scope, f.threadId, f.control()), { code: "SHARED_DAEMON_OUTCOME_UNKNOWN" }); f.close();
});

test("cancelled intent revokes pending host callback without a late successful response", async () => {
  let captured, release;
  const f = fixture({ onAuthorize: (_s, _f, control) => { captured = control.signal; return new Promise(resolve => { release = resolve; }); } });
  const promise = f.native.authorizeCreate(f.scope, f.frame, f.control());
  f.controller.abort(); await assert.rejects(() => promise, { code: "SHARED_CREATE_DENIED" });
  assert.equal(captured.aborted, true); release(true); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.messages.some(x => x.type === "shared-create-reply"), false); f.close();
});

test('native request/control and host scope/authorize/result failures retain distinct fixed phases',async()=>{
 const local=fixture();try{
  await assert.rejects(()=>local.native.authorizeCreate(local.scope,{...local.frame,params:{...local.frame.params,unknown:true}},local.control()),{code:'SHARED_CREATE_NATIVE_REQUEST_INVALID'});assert.equal(local.messages.length,0);
  await assert.rejects(()=>local.native.authorizeCreate(local.scope,local.frame,{...local.control(),deadline:performance.now()-1}),{code:'SHARED_CREATE_NATIVE_CONTROL_INVALID'});assert.equal(local.messages.length,0);
 }finally{local.close()}
 for(const [options,op,code]of [[{onScope:()=>{throw Error('private host detail')}},'scope','SHARED_CREATE_HOST_SCOPE_DENIED'],[{onAuthorize:()=>{throw Error('private host detail')}},'authorize','SHARED_CREATE_HOST_AUTHORIZE_DENIED'],[{onAuthorize:()=>false},'authorize','SHARED_CREATE_HOST_RESULT_INVALID']]){
  const f=fixture(options);try{await assert.rejects(()=>op==='scope'?f.native.resolveCreateScope(f.target,f.control()):f.native.authorizeCreate(f.scope,f.frame,f.control()),{code});const reply=f.messages.find(x=>x.type==='shared-create-reply');assert.equal(reply.code,code);assert.equal(JSON.stringify(reply).includes('private host detail'),false)}finally{f.close()}
 }
});

test('projected native approval/profile and legacy workspace selections pass the exact existing authorize IPC',async()=>{
 for(const profile of [true,false]){let received;const f=fixture({onAuthorize:(_scope,frame)=>{received=frame;return true}});try{
  const config={model_reasoning_effort:'high'},permissions=profile?{permissions:':workspace',runtimeWorkspaceRoots:[f.scope.cwd]}:{sandbox:'workspace-write'};
  if(!profile)config.sandbox_workspace_write={writable_roots:[f.scope.cwd],network_access:false,exclude_slash_tmp:false,exclude_tmpdir_env_var:false};
  const frame={...f.frame,params:{cwd:f.scope.cwd,approvalPolicy:'on-request',approvalsReviewer:'user',...permissions,model:'native-model',config}};
  assert.equal(await f.native.authorizeCreate(f.scope,frame,f.control()),true);assert.deepEqual(received,frame);assert.equal(f.messages.filter(x=>x.type==='shared-create-request').length,1);
 }finally{f.close()}}
});
