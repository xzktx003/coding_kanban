import test from "node:test";
import assert from "node:assert/strict";
import { createSharedNativeModelSelection, observeSharedNativeModelList } from "../src/shared-native-model-selection.mjs";
import { createSharedThreadCreationAuthority } from "../src/shared-thread-creation.mjs";
import { randomUUID } from "node:crypto";

function catalogFixture() {
  let revision = 1;
  const catalog = createSharedNativeModelSelection({ getAccountRevision: () => revision, verifyCurrentSync: () => true });
  const request = { id: "actual-models", method: "model/list", params: { limit: 100, includeHidden: false } };
  const reply = { id: request.id, result: { data: [{ id: "selected-model", model: "selected-model", supportedReasoningEfforts: [{ reasoningEffort: "high", description: "High" }] }], nextCursor: null } };
  return { catalog, request, reply, revoke: () => { revision++; } };
}
test("model/effort choice requires actual recorded same-account model/list response", () => {
  const f = catalogFixture(), scope = { accountRevision: 1 };
  assert.equal(f.catalog.verifySelectionSync(scope, { model: "selected-model", reasoningEffort: "high" }), false);
  assert.equal(observeSharedNativeModelList(f.catalog, f.request, f.reply), true);
  assert.equal(f.catalog.verifySelectionSync(scope, { model: "selected-model", reasoningEffort: "high" }), true);
  assert.equal(f.catalog.verifySelectionSync(scope, { model: "invented" }), false);
  assert.equal(f.catalog.verifySelectionSync(scope, { model: "selected-model", reasoningEffort: "invented" }), false);
  assert.equal(f.catalog.verifySelectionSync(scope, { model: "selected-model", providerEndpoint: "https://bad" }), false);
  f.revoke(); assert.equal(f.catalog.verifySelectionSync(scope, { model: "selected-model" }), false);
});

test("real start receipt preserves and checks selected model/effort while rejecting arbitrary config", () => {
  const f = catalogFixture(); observeSharedNativeModelList(f.catalog, f.request, f.reply);
  const view = { viewId: randomUUID() }, controller = new AbortController(), receipts = [];
  const scope = { hostId: "kanban-shared-cli", runtimeGeneration: randomUUID(), daemonGeneration: randomUUID(), accountRevision: 1, projectId: "owned", cwd: "/private/owned", viewId: view.viewId, creationNonce: randomUUID() };
  const authority = createSharedThreadCreationAuthority({ modelSelection: f.catalog, verifyProjectSync: () => true, getOwnedView: () => view, verifyOwnedViewSync: () => true, verifyExplicitIntentSync: () => true, onCreated: r => { receipts.push(r); } });
  const frame = { id: "create-selected", method: "thread/start", params: { cwd: scope.cwd, model: "selected-model", config: { model_reasoning_effort: "high" } } };
  const control = { signal: controller.signal, deadline: performance.now() + 5000 };
  assert.throws(() => authority.registerCreate(scope, { ...frame, params: { ...frame.params, config: { mcp_servers: {} } } }, control));
  authority.registerCreate(scope, frame, control); authority.beforeWriteSync(frame);
  const reply = { id: frame.id, result: { thread: { id: randomUUID(), cwd: scope.cwd, turns: [] }, cwd: scope.cwd, model: "selected-model", modelProvider: "openai", reasoningEffort: "high", approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "workspaceWrite" } } };
  assert.equal(authority.observeReplySync(frame, reply).threadId, reply.result.thread.id);
  assert.equal(receipts.length, 1); authority.close();
});


test("explicit creation reads the registered daemon catalog when the original UI did not issue model/list", async () => {
  const {ensureSharedNativeModelSelection} = await import("../src/shared-native-model-selection.mjs");
  const f = catalogFixture(), scope = { accountRevision: 1 }, selection = { model: "selected-model", reasoningEffort: "high" };
  const seen = [], source = {assertCurrent() {}, async readModelPage(cursor) {seen.push(cursor); return f.reply.result;}};
  assert.equal(f.catalog.verifySelectionSync(scope, selection), false);
  assert.equal(await ensureSharedNativeModelSelection(f.catalog, scope, selection, {source,signal:new AbortController().signal,deadline:performance.now()+1000,verifyCurrentSync:()=>true}), true);
  assert.deepEqual(seen,[null]);
  assert.equal(f.catalog.verifySelectionSync(scope,selection),true);
  assert.equal(f.catalog.verifySelectionSync(scope,{model:"invented"}),false);
});

test("registered daemon model read preserves opaque pagination and cannot commit after cancellation or account change", async () => {
  const {ensureSharedNativeModelSelection} = await import("../src/shared-native-model-selection.mjs");
  for (const revoke of ["cancel","account","view","deadline"]) {
    const f=catalogFixture(),controller=new AbortController(),scope={accountRevision:1};let release,current=true;
    const held=new Promise(resolve=>{release=resolve}),source={assertCurrent(){},async readModelPage(cursor){assert.equal(cursor,null);await held;return f.reply.result;}};
    const pending=ensureSharedNativeModelSelection(f.catalog,scope,{model:"selected-model"},{source,signal:controller.signal,deadline:performance.now()+(revoke==="deadline"?20:1000),verifyCurrentSync:()=>current});
    if(revoke==="cancel")controller.abort();if(revoke==="account")f.revoke();if(revoke==="view")current=false;
    if(revoke!=="deadline")release();await assert.rejects(pending,{code:"SHARED_MODEL_SELECTION_UNVERIFIED"});release();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.catalog.verifySelectionSync(scope,{model:"selected-model"}),false);
  }
  const f=catalogFixture(),seen=[],source={assertCurrent(){},async readModelPage(cursor){seen.push(cursor);return cursor===null?{data:[],nextCursor:"opaque page 2"}:f.reply.result;}};
  assert.equal(await ensureSharedNativeModelSelection(f.catalog,{accountRevision:1},{model:"selected-model"},{source,signal:new AbortController().signal,deadline:performance.now()+1000,verifyCurrentSync:()=>true}),true);
  assert.deepEqual(seen,[null,"opaque page 2"]);
});

test("model discovery is bounded, rejects repeated cursors and never treats a missing choice as an accepted default", async () => {
  const {ensureSharedNativeModelSelection} = await import("../src/shared-native-model-selection.mjs");
  for (const mode of ["repeated","unknown","oversized","too-many-pages"]) {
    const f=catalogFixture();let calls=0;const source={assertCurrent(){},async readModelPage(){calls++;return mode==="unknown"?{data:[],nextCursor:null}:mode==="oversized"?{data:[],nextCursor:null,unused:"x".repeat(2*1024*1024)}:{data:[],nextCursor:mode==="repeated"?"same":String(calls)};}};
    await assert.rejects(ensureSharedNativeModelSelection(f.catalog,{accountRevision:1},{model:"selected-model"},{source,signal:new AbortController().signal,deadline:performance.now()+1000,verifyCurrentSync:()=>true}),{code:"SHARED_MODEL_SELECTION_UNVERIFIED"});
    assert.ok(calls<=5);assert.equal(f.catalog.verifySelectionSync({accountRevision:1},{model:"selected-model"}),false);
  }
});
