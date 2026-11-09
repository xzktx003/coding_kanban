import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const { createNativeSharedThreadCreationRouter } = createRequire(import.meta.url)("../src/native-shared-thread-creation-routing.cjs");
const denied = { code: "SHARED_CREATE_INTENT_DENIED" };
function fixture() {
  const profileId = randomUUID(), generation = randomUUID(), sender = { isDestroyed: () => false }, viewId = randomUUID();
  let record = { senderId: 1, viewId, window: { webContents: sender, isDestroyed: () => false } }, runtime = true;
  const messages = [], dispatch = [], projections = [], bound = [], expected = { hostId: "kanban-shared-cli", runtimeGeneration: generation, daemonGeneration: randomUUID(), accountRevision: 1, projectId: "owned-project", cwd: "/private/owned-project", viewId, creationNonce: randomUUID() };
  const threadId = randomUUID(), binding = { hostId: expected.hostId, runtimeGeneration: generation, daemonGeneration: expected.daemonGeneration, accountRevision: 1, projectId: expected.projectId, threadId, viewId, clientId: randomUUID() };
  const router = createNativeSharedThreadCreationRouter({ profileId, generation, getOwnedRecord: s => s === sender ? record : null, getRecord: () => record, verifyRuntimeSync: () => runtime,
    sendToView: (_r, m) => messages.push(m), resolveCreateScope: async (_r, target) => { assert.equal(target.cwd, expected.cwd); return expected; },
    authorizeCreate: async (s, f) => { dispatch.push({ scope: s, frame: f }); return true; }, resolveCreatedBinding: async (_s, id) => { assert.equal(id, threadId); return binding; }, onBound: async b => { bound.push(b); return true; }, onProjection: p => projections.push(p) });
  const life = { type: "kanban-shared-connect-lifecycle", sequence: 1, epoch: randomUUID() };
  const message = { type: "kanban-shared-create-intent", v: 1, action: "create", profileId, generation, viewId, hostId: expected.hostId, projectId: expected.projectId, cwd: expected.cwd, clientThreadId: randomUUID(), attemptId: randomUUID(), sequence: life.sequence, epoch: life.epoch };
  const params = { input: [{ type: "text", text: "Keep original input" }], cwd: expected.cwd, workspaceRoots: [expected.cwd], __kanbanSharedCreateAttempt: message.attemptId, __kanbanSharedCreateClient: message.clientThreadId };
  return { router, sender, life, message, params, messages, dispatch, projections, bound, expected, threadId,
    replace: () => { record = { ...record }; }, revokeRuntime: () => { runtime = false; } };
}

test("actual explicit creation scope preserves native permissions and binds actual UUID before original first turn", async () => {
  const f = fixture(); f.router.lifecycle(f.sender, f.life); assert.equal(await f.router.intent(f.sender, f.message), true);
  assert.equal(f.messages[0].accepted, true); assert.equal(f.dispatch.length, 0);
  const result = await f.router.withStart(f.sender, "kanban-shared-cli", f.params, async (clean, created) => {
    assert.equal(clean.__kanbanSharedCreateAttempt, undefined); assert.deepEqual(clean.input, f.params.input);
    assert.equal(clean.useAppServerPermissionDefault, undefined);
    const prepared = await f.router.prepareRequest("kanban-shared-cli", { id: "thread/start:actual", method: "thread/start", params: { cwd: f.expected.cwd, config: { features: true }, personality: "native-default", approvalPolicy: "never", mockExperimentalField: null } });
    assert.deepEqual(prepared.frame.params, { cwd: f.expected.cwd, approvalPolicy: "never" }); assert.equal(prepared.shared, false);
    assert.equal(f.bound.length, 0); await created(f.threadId); assert.equal(f.bound.length, 1);
    return { status: "created", conversationId: f.threadId };
  });
  assert.equal(result.conversationId, f.threadId); assert.equal(f.dispatch.length, 1);
  assert.deepEqual(f.projections[0].droppedKeys, ["config.features", "mockExperimentalField", "personality"]);
  await assert.rejects(() => f.router.withStart(f.sender, "kanban-shared-cli", f.params, () => {}), denied);
  f.router.dispose();
});

test("background/prewarm/start without explicit cause cannot dispatch to shared daemon", async () => {
  const f = fixture();
  await assert.rejects(() => f.router.prepareRequest("kanban-shared-cli", { id: "bg", method: "thread/start", params: { cwd: f.expected.cwd } }), denied);
  await assert.rejects(() => f.router.withStart(f.sender, "kanban-shared-cli", f.params, () => {}), denied);
  assert.equal(f.dispatch.length, 0); f.router.dispose();
});

test("AppHost project id stays local while canonical server project scope is mapped by the exact cwd", async () => {
  const f = fixture(), uiProjectId = randomUUID(); f.message.projectId = uiProjectId;
  f.router.lifecycle(f.sender, f.life); assert.equal(await f.router.intent(f.sender, f.message), true);
  await f.router.withStart(f.sender, "kanban-shared-cli", { ...f.params, projectAssignment: { projectKind: "local", projectId: uiProjectId } }, async (clean, created) => {
    assert.equal(clean.projectAssignment.projectId, uiProjectId);
    const prepared = await f.router.prepareRequest("kanban-shared-cli", { id: "mapped-project", method: "thread/start", params: { cwd: f.expected.cwd, projectId: uiProjectId } });
    assert.deepEqual(prepared.frame.params, { cwd: f.expected.cwd });
    assert.equal(f.dispatch[0].scope.projectId, f.expected.projectId); await created(f.threadId);
  });
  assert.equal(f.bound[0].projectId, f.expected.projectId); f.router.dispose();
});

test("a mismatched original AppHost assignment or outgoing project id cannot borrow a mapped scope", async () => {
  for (const mismatch of ["caller", "wire"]) {
    const f = fixture(); f.message.projectId = randomUUID(); f.router.lifecycle(f.sender, f.life); await f.router.intent(f.sender, f.message);
    if (mismatch === "caller") await assert.rejects(() => f.router.withStart(f.sender, "kanban-shared-cli", { ...f.params, projectAssignment: { projectKind: "local", projectId: randomUUID() } }, () => {}), denied);
    else await f.router.withStart(f.sender, "kanban-shared-cli", { ...f.params, projectAssignment: { projectKind: "local", projectId: f.message.projectId } }, async () => {
      await assert.rejects(() => f.router.prepareRequest("kanban-shared-cli", { id: "wrong-local-project", method: "thread/start", params: { cwd: f.expected.cwd, projectId: randomUUID() } }), e => ["SHARED_CREATE_INTENT_DENIED", "SHARED_CREATE_EXPLICIT_OPTIONS_UNSUPPORTED"].includes(e.code));
    });
    assert.equal(f.dispatch.length, 0); f.router.dispose();
  }
});

test("mode switch, same-value new epoch, and replaced owned record invalidate acknowledged creation", async () => {
  for (const revoke of [f => f.router.lifecycle(f.sender, { ...f.life, sequence: 2, epoch: null }), f => f.router.lifecycle(f.sender, { ...f.life, sequence: 2, epoch: randomUUID() }), f => f.replace(), f => f.revokeRuntime()]) {
    const f = fixture(); f.router.lifecycle(f.sender, f.life); await f.router.intent(f.sender, f.message); revoke(f);
    await assert.rejects(() => f.router.withStart(f.sender, "kanban-shared-cli", f.params, () => {}), denied);
    assert.equal(f.dispatch.length, 0); f.router.dispose();
  }
});

test("wrong original client, cwd, roots, durable/cloud modes cannot claim creation", async () => {
  for (const patch of [{ __kanbanSharedCreateClient: randomUUID() }, { cwd: "/wrong" }, { workspaceRoots: ["/other"] }, { mode: "durable" }, { threadStartKind: "aeon" }, { cloudThreadPrototype: {} }]) {
    const f = fixture(); f.router.lifecycle(f.sender, f.life); await f.router.intent(f.sender, f.message);
    await assert.rejects(() => f.router.withStart(f.sender, "kanban-shared-cli", { ...f.params, ...patch }, () => {}), denied);
    assert.equal(f.dispatch.length, 0); f.router.dispose();
  }
});

test("one explicit start cannot be duplicated or bind a UUID supplied before actual creation", async () => {
  const f = fixture(); f.router.lifecycle(f.sender, f.life); await f.router.intent(f.sender, f.message);
  await f.router.withStart(f.sender, "kanban-shared-cli", f.params, async (_clean, created) => {
    await assert.rejects(() => created(f.threadId), denied);
    const frame = { id: "new", method: "thread/start", params: { cwd: f.expected.cwd } };
    await f.router.prepareRequest("kanban-shared-cli", frame);
    await assert.rejects(() => f.router.prepareRequest("kanban-shared-cli", { ...frame, id: "retry" }), denied);
  });
  assert.equal(f.dispatch.length, 1); assert.equal(f.bound.length, 0); f.router.dispose();
});

test("unknown RPC fields and ephemeral creation cannot be silently projected into ordinary persistent creation", async () => {
  for (const extra of [{ inventedFeature: true }, { ephemeral: true }, { mockExperimentalField: "test-only" }, {mockExperimentalField:false}, {mockExperimentalField:{}}, {mockExperimentalField:[]}]) {
    const f = fixture(); f.router.lifecycle(f.sender, f.life); await f.router.intent(f.sender, f.message);
    await f.router.withStart(f.sender, "kanban-shared-cli", f.params, async () => {
      await assert.rejects(() => f.router.prepareRequest("kanban-shared-cli", { id: "unknown", method: "thread/start", params: { cwd: f.expected.cwd, ...extra } }),
        e => ["SHARED_CREATE_INTENT_DENIED", "SHARED_CREATE_EXPLICIT_OPTIONS_UNSUPPORTED"].includes(e.code));
    });
    assert.equal(f.dispatch.length, 0); f.router.dispose();
  }
});

test("unsupported user permissions, instructions and provider/config overrides are rejected visibly before invoking the original manager", async () => {
  for (const patch of [{ modelProvider: "selected-provider" }, { collaborationMode: { mode: "plan", settings: { model: "selected-model" } } },
    { permissionsConfig: { sandboxPolicy: { type: "dangerFullAccess" } } }, { permissionSelection: { type: "profile", id: "full" } },
    { config: { "features.any": true } }, { baseInstructions: "user instructions" }, { additionalDeveloperInstructions: "user developer instructions" }, { usePermissionSelection: true }, { useAppServerPermissionDefault: "invented" }, { serviceTier: "priority" }]) {
    const f = fixture(); f.router.lifecycle(f.sender, f.life); await f.router.intent(f.sender, f.message);
    let invoked = 0;
    await assert.rejects(() => f.router.withStart(f.sender, "kanban-shared-cli", { ...f.params, ...patch }, () => { invoked++; }),
      e => e.code === "SHARED_CREATE_EXPLICIT_OPTIONS_UNSUPPORTED" && e.message.includes(Object.keys(patch)[0]));
    assert.equal(invoked, 0); assert.equal(f.dispatch.length, 0); f.router.dispose();
  }
});

function originalWorkspacePermissions(cwd){return{activePermissionProfile:{id:':workspace',extends:null},runtimeWorkspaceRoots:[cwd],sandboxPolicy:{type:'workspaceWrite',writableRoots:[cwd],excludeSlashTmp:false,excludeTmpdirEnvVar:false,networkAccess:false},approvalPolicy:'on-request',approvalsReviewer:'user'}}
test('original desktop permission profiles survive native creation and are not converted to daemon inheritance',async()=>{
  const f=fixture(),permissions=originalWorkspacePermissions(f.expected.cwd);f.router.lifecycle(f.sender,f.life);await f.router.intent(f.sender,f.message);
  await f.router.withStart(f.sender,'kanban-shared-cli',{...f.params,permissionsConfig:permissions,approvalsReviewer:'user',multiAgentMode:'explicitRequestOnly',useAppServerPermissionDefault:false},async(clean,created)=>{
    assert.equal(clean.permissionsConfig,permissions);assert.equal(clean.useAppServerPermissionDefault,false);assert.equal(clean.multiAgentMode,'explicitRequestOnly');
    const prepared=await f.router.prepareRequest('kanban-shared-cli',{id:'permission-start',method:'thread/start',params:{cwd:f.expected.cwd,approvalPolicy:'on-request',approvalsReviewer:'user',permissions:':workspace',runtimeWorkspaceRoots:[f.expected.cwd],config:{'features.original_default':true}}});
    assert.deepEqual(prepared.frame.params,{cwd:f.expected.cwd,approvalPolicy:'on-request',approvalsReviewer:'user',permissions:':workspace',runtimeWorkspaceRoots:[f.expected.cwd]});
    await created(f.threadId);
  });
  assert.equal(f.dispatch.length,1);f.router.dispose();
});
test('changed native permission projection and inconsistent caller reviewer cannot borrow the create intent',async()=>{
  for(const stage of ['reviewer','native']){
    const f=fixture(),permissions=originalWorkspacePermissions(f.expected.cwd);f.router.lifecycle(f.sender,f.life);await f.router.intent(f.sender,f.message);
    const params={...f.params,permissionsConfig:permissions,approvalsReviewer:stage==='reviewer'?'auto_review':'user',multiAgentMode:'explicitRequestOnly'};
    if(stage==='reviewer')await assert.rejects(()=>f.router.withStart(f.sender,'kanban-shared-cli',params,()=>assert.fail('must reject before invoking')),e=>e.code==='SHARED_CREATE_EXPLICIT_OPTIONS_UNSUPPORTED');
    else await f.router.withStart(f.sender,'kanban-shared-cli',params,async()=>{
      await assert.rejects(()=>f.router.prepareRequest('kanban-shared-cli',{id:'wrong-permission',method:'thread/start',params:{cwd:f.expected.cwd,approvalPolicy:'on-request',approvalsReviewer:'user',permissions:':read-only',runtimeWorkspaceRoots:[f.expected.cwd]}}),e=>e.code==='SHARED_CREATE_EXPLICIT_OPTIONS_UNSUPPORTED');
    });
    assert.equal(f.dispatch.length,0);f.router.dispose();
  }
});

test("original default collaboration model and effort stay in the bounded start request and original first-turn settings", async () => {
  const f = fixture(); f.router.lifecycle(f.sender, f.life); await f.router.intent(f.sender, f.message);
  const selection = { mode: "default", settings: { model: "selected-model", reasoning_effort: "high", developer_instructions: null } };
  await f.router.withStart(f.sender, "kanban-shared-cli", { ...f.params, collaborationMode: selection }, async (clean, created) => {
    assert.equal(clean.collaborationMode, selection); assert.deepEqual(clean.input, f.params.input);
    const prepared = await f.router.prepareRequest("kanban-shared-cli", { id: "selected-start", method: "thread/start", params: { cwd: f.expected.cwd, model: "selected-model", config: { model_reasoning_effort: "high", "features.request_permissions_tool": true } } });
    assert.deepEqual(prepared.frame.params, { cwd: f.expected.cwd, model: "selected-model", config: { model_reasoning_effort: "high" } });
    assert.deepEqual(f.projections[0].droppedKeys, ["config.features.request_permissions_tool"]); await created(f.threadId);
  });
  assert.equal(f.dispatch.length, 1); f.router.dispose();
});
