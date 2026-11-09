import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSharedThreadCreationAuthority, consumeSharedThreadCreationReceipt } from "../src/shared-thread-creation.mjs";
import { createSourceBoundSharedAuthority } from "../src/container-shared-source-authority.mjs";
import { createSharedCreatedThreadAdoption, createSharedCreatedReplyHold } from "../src/shared-created-thread-adoption.mjs";
import { createContainerSharedAuthority } from "../src/container-shared-authority.mjs";
import { createRequire } from "node:module";
const { createSharedThreadAuthorityWire } = createRequire(import.meta.url)("../src/shared-thread-authority-wire.cjs");
const { createSharedThreadAuthorityClient } = createRequire(import.meta.url)("../src/shared-thread-authority-channel.cjs");

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ delayed = false, fakeAdoption = false } = {}) {
  let view = { viewId: randomUUID() }, live = true, writeCurrent = true, bound = false, attestation = null, catalogReads = 0;
  const gate = deferred(), controller = new AbortController();
  const scope = { hostId: "kanban-shared-cli", runtimeGeneration: randomUUID(), daemonGeneration: randomUUID(), accountRevision: 1, projectId: "owned", cwd: "/private/owned", viewId: view.viewId, creationNonce: randomUUID() };
  const frame = { id: randomUUID(), method: "thread/start", params: { cwd: scope.cwd } };
  const reply = { id: frame.id, result: { thread: { id: randomUUID(), cwd: scope.cwd, turns: [] }, cwd: scope.cwd, model: "fixture-default", modelProvider: "openai", approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "workspaceWrite" } } };
  const creation = createSharedThreadCreationAuthority({ verifyProjectSync: () => live, getOwnedView: () => view, verifyOwnedViewSync: () => live, verifyExplicitIntentSync: () => true });
  creation.registerCreate(scope, frame, { signal: controller.signal, deadline: performance.now() + 5000 }); creation.beforeWriteSync(frame);
  const receipt = creation.observeReplySync(frame, reply), binding = { hostId: scope.hostId, runtimeGeneration: scope.runtimeGeneration, daemonGeneration: scope.daemonGeneration, accountRevision: 1, projectId: scope.projectId, threadId: receipt.threadId, viewId: scope.viewId, clientId: randomUUID() };
  const sharedThread = { resolveBinding: async () => { throw Error("existing catalog path must not run"); }, verifyViewSync: () => live,
    verifyBindingSync: value => live && writeCurrent && bound && value.clientId === binding.clientId, verifyHistorySync: value => live && bound && value.clientId === binding.clientId,
    verifyReadSync: () => live, write: () => { throw Error("adoption must not write resume/turn"); } };
  const provider = { sharedThread, executionProof: { getAttestationSync: () => attestation }, async resolveCreatedBinding(request, actualReceipt) {
    assert.equal(request.threadId, receipt.threadId); if (delayed) await gate.promise;
    const proof = consumeSharedThreadCreationReceipt(actualReceipt, binding); if (!proof) throw Error("receipt revoked");
    bound = true; attestation = { policyOrigin: "native-start-response", nativeReplyDigest: proof.replySha256 }; return binding;
  } };
  const source = createSourceBoundSharedAuthority({ registry: { resolveFromPage: () => { catalogReads++; throw Error("no fake page"); }, verifyResolvedSync: () => false }, getOwnedView: () => view, sharedThread });
  const adoption = createSharedCreatedThreadAdoption({ creationAuthority: creation, provider, getOwnedView: () => view, verifyOwnedViewSync: () => live, verifyCurrentSync: () => live,
    adoptSourceBinding: fakeAdoption ? () => true : (value, token) => source.adoptCreatedBinding(value, token) });
  return { creation, receipt, binding, reply, source, adoption, gate, controller, catalogReads: () => catalogReads,
    replaceView: () => { view = { ...view }; }, revokeWrite: () => { writeCurrent = false; }, revoke: () => { live = false; }, close: () => { adoption.close(); source.close(); creation.close(); } };
}

test("created binding gains separate real-receipt provenance without catalog token or empty-thread resume", async () => {
  const f = fixture();
  assert.equal(f.source.sharedThread.verifyBindingSync(f.binding), false);
  assert.deepEqual(await f.adoption.adopt(f.receipt), f.binding);
  assert.equal(f.source.sharedThread.verifyBindingSync(f.binding), true); assert.equal(f.catalogReads(), 0);
  await assert.rejects(() => f.adoption.adopt(f.receipt), { code: "SHARED_DAEMON_OUTCOME_UNKNOWN" });
  f.revoke(); assert.equal(f.source.sharedThread.verifyBindingSync(f.binding), false); f.close();
});

test("JSON receipt and a constant-true source callback cannot establish created provenance", async () => {
  const f = fixture(); await assert.rejects(() => f.adoption.adopt({ ...f.receipt }), { code: "SHARED_DAEMON_OUTCOME_UNKNOWN" }); f.close();
  const other = fixture({ fakeAdoption: true }); await assert.rejects(() => other.adoption.adopt(other.receipt), { code: "SHARED_DAEMON_OUTCOME_UNKNOWN" });
  assert.equal(other.source.sharedThread.verifyBindingSync(other.binding), false); other.close();
});

test("real created provenance prepares the existing follower without a resume attempt and carries exact later events", async () => {
  const f = fixture(), profileId = randomUUID(), generation = f.binding.runtimeGeneration, events = [], controller = new AbortController();
  let authority, client, wire;
  const later = fn => queueMicrotask(fn);
  wire = createSharedThreadAuthorityWire({ side: "native", sendFrame: frame => later(() => authority.receive(frame)) });
  client = createSharedThreadAuthorityClient({ socket: wire.stream, profileId, generation, onEvent: (binding, attemptId, event) => { events.push({ binding, attemptId, event }); } });
  authority = createContainerSharedAuthority({ profileId, generation, verifyContainerSync: () => true,
    verifyOwnedViewSync: id => id === f.binding.viewId, sharedThread: f.source.sharedThread,
    verifyCreatedBindingSync: binding => f.source.verifyCreatedBindingSync(binding),
    sendFrame: frame => later(() => { wire.receive(frame); if (frame.type === "shared-reply") authority.receive({ v: 1, type: "shared-reply-ack", profileId, generation, requestId: frame.requestId }); }) });
  try {
    const control = { attemptId: randomUUID(), signal: controller.signal, deadline: performance.now() + 5000 };
    assert.equal(authority.registerCreatedFollow(f.binding, control), false);
    await f.adoption.adopt(f.receipt);
    assert.equal(authority.registerCreatedFollow(f.binding, control), true);
    assert.equal(await client.follow(f.binding, control), true);
    assert.equal(authority.verifyConnectedThreadSync(f.binding.threadId), true);
    const event = { method: "item/agentMessage/delta", params: { threadId: f.binding.threadId, turnId: "turn", itemId: "item", delta: "exact owned reply" } };
    assert.equal(authority.receiveDaemon(JSON.stringify(event)), true); await tick(); await tick();
    assert.deepEqual(events.map(value => value.event), [event]);
    assert.equal(events[0].attemptId, control.attemptId);
    assert.equal(authority.registerCreatedFollow(f.binding, control), false);
    controller.abort(); assert.equal(authority.verifyConnectedThreadSync(f.binding.threadId), true);
    f.revokeWrite();
    assert.equal(f.source.sharedThread.verifyBindingSync(f.binding), false);
    assert.equal(f.source.sharedThread.verifyHistorySync(f.binding), true);
    assert.equal(authority.verifyConnectedThreadSync(f.binding.threadId), false); // read follow never authorizes tools
    const completion = { method: "turn/completed", params: { threadId: f.binding.threadId, turn: { id: "turn", status: "completed", items: [] } } };
    assert.equal(authority.receiveDaemon(JSON.stringify(completion)), true); await tick(); await tick();
    assert.deepEqual(events.at(-1).event, completion); assert.deepEqual(events.at(-1).binding, f.binding);
    f.replaceView(); assert.equal(f.source.sharedThread.verifyHistorySync(f.binding), false);
    client.unfollow(control.attemptId); await tick(); assert.equal(authority.verifyConnectedThreadSync(f.binding.threadId), false);
  } finally { client.close(); wire.close(); authority.close(); f.close(); }
});

test("cancelled created follow preparation never becomes a follower", async () => {
  const f = fixture(); await f.adoption.adopt(f.receipt);
  const controller = new AbortController(), profileId = randomUUID(), generation = f.binding.runtimeGeneration;
  let authority, client, wire;
  wire = createSharedThreadAuthorityWire({ side: "native", sendFrame: frame => queueMicrotask(() => authority.receive(frame)) });
  client = createSharedThreadAuthorityClient({ socket: wire.stream, profileId, generation });
  authority = createContainerSharedAuthority({ profileId, generation, verifyContainerSync: () => true, verifyOwnedViewSync: id => id === f.binding.viewId,
    sharedThread: f.source.sharedThread, verifyCreatedBindingSync: b => f.source.verifyCreatedBindingSync(b),
    sendFrame: frame => queueMicrotask(() => { wire.receive(frame); if(frame.type === "shared-reply")authority.receive({v:1,type:"shared-reply-ack",profileId,generation,requestId:frame.requestId}); }) });
  try {
    const control = { attemptId: randomUUID(), signal: controller.signal, deadline: performance.now() + 5000 };
    assert.equal(authority.registerCreatedFollow(f.binding, control), true); controller.abort();
    assert.equal(await client.follow(f.binding, { ...control, signal: new AbortController().signal }), false);
    assert.equal(authority.verifyConnectedThreadSync(f.binding.threadId), false);
  } finally { client.close(); wire.close(); authority.close(); f.close(); }
});

test("original reply and following frames remain bounded and ordered until real adoption completes", async () => {
  const f = fixture({ delayed: true }), released = [], failures = []; let bytes = 0, paused = 0, resumed = 0;
  const hold = createSharedCreatedReplyHold({ creationAuthority: f.creation, adoption: f.adoption, verifyCurrentSync: () => true,
    memoryBudget: { reserveBytes(n) { bytes += n; return true; }, releaseBytes(n) { bytes -= n; } }, getQueuedBytes: () => 0, getQueuedWrites: () => 0,
    pauseInput: () => { paused++; }, resumeInput: () => { resumed++; }, releaseReply: text => { assert.equal(f.source.sharedThread.verifyBindingSync(f.binding), true); released.push(text); },
    releaseFollowing: data => { released.push(String(data)); }, onFailure: e => failures.push(e) });
  const encoded = JSON.stringify(f.reply), next = Buffer.from(JSON.stringify({ method: "thread/started", params: { thread: { id: f.receipt.threadId, turns: [] } } }));
  assert.equal(hold.begin(f.receipt, encoded), true); assert.equal(hold.bufferFollowing(next), true); assert.deepEqual(released, []); assert.equal(paused, 1); assert.ok(bytes > 0);
  f.gate.resolve(); await tick(); await tick();
  assert.deepEqual(released, [encoded, String(next)]); assert.equal(bytes, 0); assert.equal(resumed, 1); assert.deepEqual(failures, []); hold.close(); f.close();
});

test("held reply never reaches SDK after owned-view replacement; known created UUID remains in failure", async () => {
  const f = fixture({ delayed: true }), released = [], failures = []; let bytes = 0;
  const hold = createSharedCreatedReplyHold({ creationAuthority: f.creation, adoption: f.adoption, verifyCurrentSync: () => true,
    memoryBudget: { reserveBytes(n) { bytes += n; return true; }, releaseBytes(n) { bytes -= n; } }, getQueuedBytes: () => 0, getQueuedWrites: () => 0,
    pauseInput: () => {}, resumeInput: () => {}, releaseReply: text => released.push(text), releaseFollowing: () => {}, onFailure: e => failures.push(e) });
  hold.begin(f.receipt, JSON.stringify(f.reply)); f.replaceView(); f.gate.resolve(); await tick(); await tick();
  assert.deepEqual(released, []); assert.equal(bytes, 0); assert.equal(failures[0].threadId, f.receipt.threadId); assert.equal(failures[0].code, "SHARED_DAEMON_OUTCOME_UNKNOWN"); f.close();
});

test("hold includes the existing queue in the original 8 MiB/2 MiB budgets", async () => {
  const f = fixture({ delayed: true }), failures = []; let bytes = 0;
  const hold = createSharedCreatedReplyHold({ creationAuthority: f.creation, adoption: f.adoption, verifyCurrentSync: () => true,
    memoryBudget: { reserveBytes(n) { bytes += n; return true; }, releaseBytes(n) { bytes -= n; } }, getQueuedBytes: () => 7 * 1024 * 1024, getQueuedWrites: () => 0,
    pauseInput: () => {}, resumeInput: () => {}, releaseReply: () => { throw Error("not adopted"); }, releaseFollowing: () => {}, onFailure: e => failures.push(e) });
  hold.begin(f.receipt, JSON.stringify(f.reply)); hold.bufferFollowing(Buffer.alloc(2 * 1024 * 1024));
  assert.equal(failures[0].phase, "created-hold-budget"); assert.equal(bytes, 0); f.gate.resolve(); await tick(); f.close();
});

test("following notifications wait for the original created reply's real asynchronous delivery receipt", async () => {
 const f=fixture(),written=deferred(),released=[],failures=[];let bytes=0,resumed=0;
 const hold=createSharedCreatedReplyHold({creationAuthority:f.creation,adoption:f.adoption,verifyCurrentSync:()=>true,memoryBudget:{reserveBytes(n){bytes+=n;return true;},releaseBytes(n){bytes-=n;}},getQueuedBytes:()=>0,getQueuedWrites:()=>0,pauseInput(){},resumeInput(){resumed++;},releaseReply(){released.push('reply-queued');return written.promise.then(()=>released.push('reply-consumed'));},releaseFollowing(data){released.push(String(data));},onFailure:error=>failures.push(error)});
 try{hold.begin(f.receipt,JSON.stringify(f.reply));hold.bufferFollowing(Buffer.from('original MCP startup status'));await tick();await tick();assert.deepEqual(released,['reply-queued']);assert.equal(hold.active,true);assert.equal(resumed,0);assert.deepEqual(failures,[]);written.resolve();await tick();await tick();assert.deepEqual(released,['reply-queued','reply-consumed','original MCP startup status']);assert.equal(hold.active,false);assert.equal(bytes,0);assert.equal(resumed,1);assert.deepEqual(failures,[]);}finally{hold.close();f.close();}
});
test("revocation while the created reply is queued never drains its retained following events", async () => {
 const f=fixture(),written=deferred(),following=[],failures=[];let live=true,bytes=0;
 const hold=createSharedCreatedReplyHold({creationAuthority:f.creation,adoption:f.adoption,verifyCurrentSync:()=>live,memoryBudget:{reserveBytes(n){bytes+=n;return true;},releaseBytes(n){bytes-=n;}},getQueuedBytes:()=>0,getQueuedWrites:()=>0,pauseInput(){},resumeInput(){throw Error('revoked source must not resume');},releaseReply:()=>written.promise,releaseFollowing:data=>following.push(data),onFailure:error=>failures.push(error)});
 try{hold.begin(f.receipt,JSON.stringify(f.reply));hold.bufferFollowing(Buffer.from('retained status'));await tick();live=false;written.resolve();await tick();await tick();assert.deepEqual(following,[]);assert.equal(bytes,0);assert.equal(failures[0].threadId,f.receipt.threadId);}finally{hold.close();f.close();}
});

for(const action of ['close','revoke'])test(`${action} between created-following batches releases retained bytes without dispatching later frames`,async()=>{
 const f=fixture({delayed:true}),following=[],failures=[];let live=true,bytes=0,resumed=0,hold;
 hold=createSharedCreatedReplyHold({creationAuthority:f.creation,adoption:f.adoption,verifyCurrentSync:()=>live,
  memoryBudget:{reserveBytes(n){bytes+=n;return true;},releaseBytes(n){bytes-=n;}},getQueuedBytes:()=>0,getQueuedWrites:()=>0,
  pauseInput(){},resumeInput(){resumed++;},releaseReply(){},releaseFollowing(data){following.push(String(data));if(following.length===1)queueMicrotask(()=>{if(action==='close')hold.close();else live=false;});},onFailure:e=>failures.push(e)});
 try{
  hold.begin(f.receipt,JSON.stringify(f.reply));
  for(const text of ['first','second','third'])hold.bufferFollowing(Buffer.from(text));
  f.gate.resolve();for(let n=0;n<6;n++)await tick();
  assert.deepEqual(following,['first']);assert.equal(bytes,0);assert.equal(resumed,0);
  if(action==='close')assert.deepEqual(failures,[]);
  else{assert.equal(failures[0]?.code,'SHARED_DAEMON_OUTCOME_UNKNOWN');assert.equal(failures[0]?.threadId,f.receipt.threadId);}
 }finally{hold.close();f.close();}
});
