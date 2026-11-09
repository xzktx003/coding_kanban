import test from "node:test";
import assert from "node:assert/strict";
import { createSharedDaemonRpcGate } from "../src/shared-daemon-rpc-gate.mjs";

const encode = (value) => JSON.stringify(value);
const init = { id: 1, method: "initialize", params: { clientInfo: { name: "codex_desktop", title: "Codex Desktop", version: "1" }, capabilities: { experimentalApi: true, requestAttestation: false } } };
const initResult = { id: 1, result: { userAgent: "codex_app_server/0.166.0", codexHome: "/owned/home" } };
const ready = { method: "initialized", params: {} };
const ownedThread = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function fixture({confirmInitialAccount=false,consumeInitialize=false,rejectFileRead=false,rejectCapabilities=false}={}) {
  const writes = [], events = [], calls = [], receipts=[],policyErrors=[];
  const state = { live: true, reply: false, accountUpdates: 0, attachmentThread: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", attachmentLive:true };
  const gate = createSharedDaemonRpcGate({
    verifyReadSync: (frame) => state.live && (frame.method !== "config/read" || frame.params.cwd == null || frame.params.cwd === "/owned/project") &&
      (frame.method !== "thread/attachment/list" || (state.attachmentLive && frame.params.threadId === state.attachmentThread)),
    verifyBindingSync: () => state.live,
    verifyHistorySync: () => state.live,
    write: (frame) => { writes.push(frame); },
    desktop: {
      daemonVersion: "0.166.0",
      verifyInitializeSync: (result) => result.codexHome === "/owned/home" && state.live,
      verifyInitialAccountNotificationSync:()=>confirmInitialAccount&&state.live,
      ...(consumeInitialize?{registerInitializeConsumptionSync:receipt=>{receipts.push(receipt);}}:{}),
      ...(rejectFileRead?{deliverUnsupportedReadSync:response=>{policyErrors.push(response);}}:{}),
      ...(rejectCapabilities?{deliverUnsupportedCapabilitySync:response=>{policyErrors.push(response);}}:{}),
      verifyServerEventSync: (frame) => { events.push(frame.method); return state.live && (frame.method === "account/updated" || frame.params.threadId === ownedThread); },
      authorizeServerReplySync: (request, response) => { calls.push([request.id, response.id]); const allowed = state.live && state.reply; state.reply = false; return allowed; },
    },
  });
  return { gate, writes, events, calls, state,receipts,policyErrors };
}

function start(f) {
  f.gate.write(encode(init));
  assert.equal(f.gate.receive(encode(initResult)), encode(initResult));
  f.gate.write(encode(ready));
}

test("desktop startup uses the real initialize and initialized frames once, before metadata", () => {
  const f = fixture();
  try {
    const request = { id: 2, method: "account/read", params: { refreshToken: false } };
    assert.throws(() => f.gate.write(encode(request)), { code: "SHARED_DAEMON_DENIED" });
    f.gate.write(encode(init));
    assert.throws(() => f.gate.write(encode(ready)), { code: "SHARED_DAEMON_DENIED" });
    assert.equal(f.gate.receive(encode(initResult)), encode(initResult));
    assert.throws(() => f.gate.write(encode(request)), { code: "SHARED_DAEMON_DENIED" });
    f.gate.write(encode(ready));
    f.gate.write(encode(request));
    const response = { id: 2, result: { account: null, requiresOpenaiAuth: false } };
    assert.equal(f.gate.receive(encode(response)), encode(response));
    assert.throws(() => f.gate.write(encode(init)), { code: "SHARED_DAEMON_DENIED" });
    assert.deepEqual(f.writes.map((value) => JSON.parse(value).method), ["initialize", "initialized", "account/read"]);
  } finally { f.gate.close(); }
});

test("native initialization version and registered home must match without inventing a result", () => {
  for (const result of [
    { ...initResult, result: { ...initResult.result, userAgent: "codex_app_server/0.120.0" } },
    { ...initResult, result: { ...initResult.result, codexHome: "/different/home" } },
  ]) {
    const f = fixture();
    try {
      f.gate.write(encode(init));
      assert.throws(() => f.gate.receive(encode(result)), { code: "SHARED_DAEMON_UNSUPPORTED" });
      assert.throws(() => f.gate.write(encode(ready)), { code: "SHARED_DAEMON_DENIED" });
      assert.equal(f.writes.length, 1);
    } finally { f.gate.close(); }
  }
});

test("original metadata requests and real errors pass unchanged; unsafe variants and tasks are denied", () => {
  const f = fixture();
  try {
    start(f);
    const values = [
      { id: 2, method: "account/read", params: { refreshToken: false } },
      { id: 3, method: "getAuthStatus", params: { includeToken: false, refreshToken: false } },
      { id: 4, method: "config/read", params: { includeLayers: true, cwd: "/owned/project" } },
      { id: 5, method: "configRequirements/read" },
      { id: 6, method: "model/list", params: { includeHidden: true, cursor: null, limit: 100 } },
      { id: 7, method: "model/list", params: { includeHidden: true } },
      { id: 8, method: "collaborationMode/list", params: {} },
    ];
    for (const value of values) f.gate.write(encode(value));
    for (const value of values) {
      const response = { id: value.id, error: { code: -32601, message: "Method not found" } };
      assert.equal(f.gate.receive(encode(response)), encode(response));
    }
    for (const value of [
      { id: 9, method: "account/read", params: { refreshToken: true } },
      { id: 10, method: "getAuthStatus", params: { includeToken: true, refreshToken: false } },
      { id: 11, method: "config/read", params: { includeLayers: false, cwd: "/unowned" } },
      { id: 12, method: "model/list", params: { limit: 101 } },
      { id: 13, method: "experimentalFeature/list", params: { limit: 100 } },
      { id: 14, method: "turn/start", params: {} },
      { id: 15, method: "config/value/write", params: {} },
    ]) assert.throws(() => f.gate.write(encode(value)), { code: "SHARED_DAEMON_DENIED" });
    assert.equal(f.writes.length, 2 + values.length);
  } finally { f.gate.close(); }
});

test("original desktop pinned-section thread/list forwards all real filters and opaque cursors with bounded pages", () => {
  const f = fixture({consumeInitialize:true});
  try {
    f.gate.write(encode(init)); f.gate.receive(encode(initResult));
    assert.equal(f.receipts[0].consumeSync(),true);
    // Fixed SDK pinned-section probe: section_position is a stable 0.166.0
    // ThreadSortKey, distinct from the ordinary recent-thread sort keys.
    const params={cursor:null,limit:1,modelProviders:null,sectionId:'pinned-section',sortKey:'section_position',sourceKinds:['cli','vscode','appServer'],useStateDbOnly:true};
    const first={id:'pinned-first',method:'thread/list',params},encoded=encode(first);
    f.gate.write(encoded); assert.equal(f.writes.at(-1),encoded);
    const response=encode({id:first.id,result:{data:[],nextCursor:'opaque-native-cursor:page-2',unknownNativeMetadata:17}});
    assert.equal(f.gate.receive(response),response);
    const second={id:'pinned-second',method:'thread/list',params:{...params,cursor:'opaque-native-cursor:page-2'}};
    f.gate.write(encode(second)); assert.equal(f.writes.at(-1),encode(second));
    let n=0;
    for(const patch of [{sortKey:'unsupported_sort'},{limit:201},{limit:0},{limit:null},{useStateDbOnly:false},{modelProviders:{}},{sourceKinds:'cli'},{sectionId:'pinned\nsection'},{cursor:'x'.repeat(4097)},{config:{unsafe:true}}]){
      assert.throws(()=>f.gate.write(encode({id:'invalid-list-'+(++n),method:'thread/list',params:{...params,...patch}})),{code:'SHARED_DAEMON_DENIED'});
    }
    assert.equal(f.writes.length,3); // actual initialize and exactly two reads
  } finally {f.gate.close();}
});

test("only real scoped server events and exactly authorized responses travel, once, without fabricated replies", () => {
  const f = fixture();
  try {
    start(f);
    const notification = { method: "thread/status/changed", params: { threadId: ownedThread, status: { type: "active", activeFlags: [] } } };
    assert.equal(f.gate.receive(encode(notification)), encode(notification));
    assert.throws(() => f.gate.receive(encode({ ...notification, params: { threadId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } })), { code: "SHARED_DAEMON_DENIED" });
    const request = { id: "approval-1", method: "item/commandExecution/requestApproval", params: { threadId: ownedThread, turnId: "turn-1", itemId: "item-1" } };
    const reply = { id: request.id, result: { decision: "accept" } };
    assert.equal(f.gate.receive(encode(request)), encode(request));
    assert.equal(f.writes.length, 2);
    assert.throws(() => f.gate.write(encode(reply)), { code: "SHARED_DAEMON_DENIED" });
    f.state.reply = true;
    assert.throws(() => f.gate.write(encode(reply)), { code: "SHARED_DAEMON_DENIED" });
    const next = { ...request, id: "approval-2" };
    assert.equal(f.gate.receive(encode(next)), encode(next));
    const nextReply = { ...reply, id: next.id };
    f.state.reply = true;
    f.gate.write(encode(nextReply));
    assert.equal(f.writes.at(-1), encode(nextReply));
    assert.throws(() => f.gate.write(encode(nextReply)), { code: "SHARED_DAEMON_DENIED" });
    assert.throws(() => f.gate.receive(encode({ id: "dynamic", method: "item/tool/call", params: { threadId: ownedThread } })), { code: "SHARED_DAEMON_DENIED" });
  } finally { f.gate.close(); }
});

test("account changes retire the old channel even if the update has the same value", () => {
  const f = fixture();
  try {
    start(f);
    const event = { method: "account/updated", params: { authMode: null } };
    assert.equal(f.gate.receive(encode(event)), encode(event));
    assert.throws(() => f.gate.write(encode({ id: 2, method: "account/read", params: { refreshToken: false } })), { code: "SHARED_DAEMON_DENIED" });
  } finally { f.gate.close(); }
});

test('real native timestamp is accepted only as bounded metadata; repeat same account still revokes',()=>{
 const f=fixture({confirmInitialAccount:true});try{
  start(f);const event={method:'account/updated',params:{authMode:'chatgpt',planType:'plus'},emittedAtMs:1794043649358};
  assert.equal(f.gate.receive(encode(event)),encode(event));
  f.gate.write(encode({id:2,method:'account/read',params:{refreshToken:false}}));
  assert.equal(f.gate.receive(encode({...event,emittedAtMs:event.emittedAtMs+1})),encode({...event,emittedAtMs:event.emittedAtMs+1}));
  assert.throws(()=>f.gate.write(encode({id:3,method:'account/read',params:{refreshToken:false}})),{code:'SHARED_DAEMON_DENIED'});
 }finally{f.gate.close();}
 for(const emittedAtMs of [-1,0.25,Number.MAX_SAFE_INTEGER+1,'1',null,{}]){
  const bad=fixture({confirmInitialAccount:true});try{start(bad);assert.throws(()=>bad.gate.receive(encode({method:'account/updated',params:{authMode:'chatgpt'},emittedAtMs})),{code:'SHARED_DAEMON_DENIED'});}finally{bad.gate.close();}
 }
});
test('actual initialize-result then early account notification does not require native output ACK to arrive first',()=>{
 const f=fixture({confirmInitialAccount:true});try{
  f.gate.write(encode(init));f.gate.receive(encode(initResult));
  const notice={method:'account/updated',params:{authMode:'chatgpt',planType:'plus'},emittedAtMs:1794043649358};
  assert.equal(f.gate.receive(encode(notice)),encode(notice));
  assert.throws(()=>f.gate.write(encode({id:2,method:'account/read',params:{refreshToken:false}})),{code:'SHARED_DAEMON_DENIED'});
  assert.throws(()=>f.gate.receive(encode({method:'thread/status/changed',params:{threadId:ownedThread,status:{type:'active',activeFlags:[]}},emittedAtMs:1794043649358})),{code:'SHARED_DAEMON_DENIED'});
  f.gate.write(encode(ready));f.gate.write(encode({id:3,method:'account/read',params:{refreshToken:false}}));
  assert.equal(f.gate.receive(encode({...notice,emittedAtMs:notice.emittedAtMs+1})),encode({...notice,emittedAtMs:notice.emittedAtMs+1}));
  assert.throws(()=>f.gate.write(encode({id:4,method:'account/read',params:{refreshToken:false}})),{code:'SHARED_DAEMON_DENIED'});
 }finally{f.gate.close();}
 const denied=fixture();try{denied.gate.write(encode(init));denied.gate.receive(encode(initResult));denied.gate.receive(encode({method:'account/updated',params:{authMode:'chatgpt'},emittedAtMs:0}));assert.throws(()=>denied.gate.write(encode(ready)),{code:'SHARED_DAEMON_DENIED'});}finally{denied.gate.close();}
});
test('fixed desktop SDK becomes ready only after its exact validated initialize reply consumption receipt',()=>{
 const f=fixture({consumeInitialize:true});try{
  f.gate.write(encode(init));f.gate.receive(encode(initResult));assert.equal(f.receipts.length,1);assert.equal(f.receipts[0].responseId,init.id);
  const config={id:2,method:'config/read',params:{includeLayers:true,cwd:'/owned/project'}};
  assert.throws(()=>f.gate.write(encode(config)),{code:'SHARED_DAEMON_DENIED'});
  assert.equal(f.receipts[0].consumeSync(),true);assert.equal(f.receipts[0].consumeSync(),false);
  f.gate.write(encode(config));assert.equal(f.writes.length,2);assert.equal(f.writes.some(x=>JSON.parse(x).method==='initialized'),false);
  assert.throws(()=>f.gate.write(encode(ready)),{code:'SHARED_DAEMON_DENIED'});
 }finally{f.gate.close();}
 const revoked=fixture({consumeInitialize:true});try{revoked.gate.write(encode(init));revoked.gate.receive(encode(initResult));revoked.state.live=false;assert.equal(revoked.receipts[0].consumeSync(),false);assert.equal(revoked.receipts[0].consumeSync(),false);}finally{revoked.gate.close();}
});
test('fixed read-only filesystem methods receive explicit policy errors without native file access',()=>{
 const f=fixture({rejectFileRead:true});try{
  start(f);
  for(const method of ['fs/readFile','fs/getMetadata','fs/readDirectory']){
   const request={id:method,method,params:{path:'/owned/home/auth.json'}};
   f.gate.write(encode(request));assert.equal(f.writes.length,2);
   const response=f.policyErrors.at(-1);assert.equal(response.id,request.id);assert.equal(response.error.code,-32601);assert.equal(response.error.message,`Shared desktop policy does not support ${method}`);assert.equal(response.error.data.source,'kanban-shared-policy');assert.equal(Object.hasOwn(response,'result'),false);
   assert.throws(()=>f.gate.write(encode(request)),{code:'SHARED_DAEMON_DENIED'});
   for(const params of [undefined,{},null,{path:'relative'},{path:'/a/../b'},{path:'/valid',encoding:'utf8'},{path:'/valid',recursive:true},{path:'/invalid\u0000path'}])assert.throws(()=>f.gate.write(encode({...request,id:method+JSON.stringify(params),params})),{code:'SHARED_DAEMON_DENIED'});
  }
  assert.equal(f.policyErrors.length,3);
  for(const [method,params] of [
   ['fs/writeFile',{path:'/valid',dataBase64:''}],['fs/remove',{path:'/valid'}],
   ['fs/copy',{sourcePath:'/valid',destinationPath:'/other'}],['fs/createDirectory',{path:'/valid'}],
   ['fs/watch',{path:'/valid',watchId:'owned-watch'}],['fs/unwatch',{watchId:'owned-watch'}],
   ['fs/unknown',{path:'/valid'}],['turn/start',{}]
  ])assert.throws(()=>f.gate.write(encode({id:method,method,params})),{code:'SHARED_DAEMON_DENIED'});
  assert.equal(f.policyErrors.length,3);assert.equal(f.writes.length,2);
  f.gate.write(encode({id:'after-errors',method:'account/read',params:{refreshToken:false}}));assert.equal(f.writes.length,3);
 }finally{f.gate.close();}
 const revoked=fixture({rejectFileRead:true});try{start(revoked);revoked.state.live=false;assert.throws(()=>revoked.gate.write(encode({id:'revoked',method:'fs/getMetadata',params:{path:'/valid'}})),{code:'SHARED_DAEMON_DENIED'});assert.equal(revoked.policyErrors.length,0);}finally{revoked.gate.close();}
 const absent=fixture();try{start(absent);assert.throws(()=>absent.gate.write(encode({id:'no-policy-route',method:'fs/readDirectory',params:{path:'/valid'}})),{code:'SHARED_DAEMON_DENIED'});}finally{absent.gate.close();}
});

test('known optional host capabilities receive explicit errors without daemon operations or task authority',()=>{
 const f=fixture({rejectFileRead:true,rejectCapabilities:true});try{
  start(f);
  const methods=['process/spawn','process/writeStdin','process/kill','process/resizePty','fs/writeFile','fs/createDirectory','fs/remove','fs/copy','fs/watch','fs/unwatch','project/list','project/create','threadSection/list','skills/list','hooks/list','plugin/list','app/list','permissionProfile/list','experimentalFeature/list','environment/info','mcpServerStatus/list','feedback/upload','externalAgentConfig/detect','fuzzyFileSearch/sessionStart'];
  for(const method of methods){
   const params=method==='process/spawn'?{command:['/bin/sh','-c','mkdir -p /owned/worktrees'],cwd:'/owned/project',streamStdoutStderr:true,streamStdin:false,timeoutMs:null,processHandle:'owned-process'}:{};
   f.gate.write(encode({id:method,method,params}));const reply=f.policyErrors.at(-1);
   assert.equal(reply.id,method);assert.equal(reply.error.code,-32601);assert.equal(reply.error.data.source,'kanban-shared-policy');assert.equal(reply.error.data.code,'SHARED_CAPABILITY_NOT_SUPPORTED');assert.equal(reply.error.data.method,method);assert.equal(reply.error.message,`Shared desktop policy does not support ${method}`);assert.equal(Object.hasOwn(reply,'result'),false);assert.equal(encode(reply).includes('mkdir'),false);
   assert.throws(()=>f.gate.write(encode({id:method,method,params})),{code:'SHARED_DAEMON_DENIED'});
  }
  assert.equal(f.writes.length,2);assert.equal(f.policyErrors.length,methods.length);
  const deniedFrames=[
   ...['thread/start','thread/resume','thread/goal/set','turn/start','turn/steer','turn/interrupt','item/tool/requestUserInput','mcpServer/tool/call','account/logout','config/value/write','fs/unknown','process/unknown','unknown/capability'].map(method=>({id:method,method,params:{}})),
   {id:'token',method:'getAuthStatus',params:{includeToken:true,refreshToken:false}},
   {id:'refresh',method:'account/read',params:{refreshToken:true}},
   {id:'read-bad',method:'fs/readFile',params:{path:'relative'}},
   {id:'bad-envelope',method:'process/spawn',params:{},jsonrpc:'1.0'},
   {id:'extra-envelope',method:'process/spawn',params:{},extra:true},
   {id:'bad-params',method:'process/spawn',params:[]},
   {method:'process/spawn',params:{}},
  ];
  for(const frame of deniedFrames)assert.throws(()=>f.gate.write(encode(frame)),{code:'SHARED_DAEMON_DENIED'});
  assert.throws(()=>f.gate.write(encode({id:'oversized',method:'process/spawn',params:{command:['x'.repeat(65536)]}})),{code:'SHARED_DAEMON_DENIED'});
  assert.throws(()=>f.gate.receive(encode({id:'process/spawn',result:{}})),{code:'SHARED_DAEMON_DENIED'});
  assert.equal(f.policyErrors.length,methods.length);assert.equal(f.writes.length,2);
  f.gate.write(encode({id:'after-capability-errors',method:'account/read',params:{refreshToken:false}}));assert.equal(f.writes.length,3);
  f.state.live=false;assert.throws(()=>f.gate.write(encode({id:'revoked',method:'process/spawn',params:{}})),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.policyErrors.length,methods.length);
 }finally{f.gate.close();}
 const early=fixture({rejectCapabilities:true});try{assert.throws(()=>early.gate.write(encode({id:'not-ready',method:'process/spawn',params:{}})),{code:'SHARED_DAEMON_DENIED'});assert.equal(early.policyErrors.length,0);}finally{early.gate.close();}
});


test('startup experimental enablement receives a negative capability without changing flags or retiring reads',()=>{
 const f=fixture({rejectCapabilities:true});try{
  start(f);
  const request={id:'original-enable-sync',method:'experimentalFeature/enablement/set',params:{enablement:{memories:false,remote_plugin:true,daybreak_program_propagation:true}}};
  assert.doesNotThrow(()=>f.gate.write(encode(request)));
  assert.equal(f.writes.length,2);
  assert.deepEqual(f.policyErrors,[{id:request.id,error:{code:-32601,message:'Shared desktop policy does not support experimentalFeature/enablement/set',data:{source:'kanban-shared-policy',code:'SHARED_CAPABILITY_NOT_SUPPORTED',method:request.method}}}]);
  assert.equal(encode(f.policyErrors).includes('daybreak_program_propagation'),false);
  assert.throws(()=>f.gate.write(encode(request)),{code:'SHARED_DAEMON_DENIED'});
  f.gate.write(encode({id:'after-enable-refusal',method:'account/read',params:{refreshToken:false}}));
  assert.equal(f.writes.length,3);assert.equal(JSON.parse(f.writes[2]).method,'account/read');
  for(const method of ['experimentalFeature/enablement/unknown','config/value/write','turn/start'])assert.throws(()=>f.gate.write(encode({id:method,method,params:{}})),{code:'SHARED_DAEMON_DENIED'});
  f.state.live=false;assert.throws(()=>f.gate.write(encode({...request,id:'after-revocation'})),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.policyErrors.length,1);
 }finally{f.gate.close();}
 const early=fixture({rejectCapabilities:true});try{assert.throws(()=>early.gate.write(encode({id:'early',method:'experimentalFeature/enablement/set',params:{enablement:{}}})),{code:'SHARED_DAEMON_DENIED'});assert.deepEqual(early.policyErrors,[]);}finally{early.gate.close();}
});


test('startup rollout compression is a fixed no-params negative capability and keeps metadata usable',()=>{
 const f=fixture({rejectCapabilities:true});try{
  start(f);
  for(const [id,params] of [['compress-omitted',undefined],['compress-null',null],['compress-empty',{}]]){
   const request={id,method:'rollout/compress',...(params===undefined?{}:{params})};
   assert.doesNotThrow(()=>f.gate.write(encode(request)));
   const reply=f.policyErrors.at(-1);assert.equal(reply.id,id);assert.equal(reply.error.code,-32601);assert.equal(reply.error.data.code,'SHARED_CAPABILITY_NOT_SUPPORTED');assert.equal(reply.error.data.method,request.method);assert.equal(Object.hasOwn(reply,'result'),false);
   assert.throws(()=>f.gate.write(encode(request)),{code:'SHARED_DAEMON_DENIED'});
  }
  assert.equal(f.writes.length,2);
  for(const frame of [
   {id:'parameters',method:'rollout/compress',params:{threadId:'forbidden'}},
   {id:'array',method:'rollout/compress',params:[]},
   {id:'envelope',method:'rollout/compress',extra:true},
   ...['rollout/unknown','account/logout','turn/start','thread/resume'].map(method=>({id:method,method,params:{}}))
  ])assert.throws(()=>f.gate.write(encode(frame)),{code:'SHARED_DAEMON_DENIED'});
  f.gate.write(encode({id:'read-after-compression-refusal',method:'account/read',params:{refreshToken:false}}));assert.equal(f.writes.length,3);
  f.state.live=false;assert.throws(()=>f.gate.write(encode({id:'revoked-compress',method:'rollout/compress'})),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.policyErrors.length,3);
 }finally{f.gate.close();}
});


test("desktop attachment reads preserve native pages and errors only for the exact currently bound thread", () => {
  const f = fixture({consumeInitialize:true});
  try {
    f.gate.write(encode(init)); f.gate.receive(encode(initResult));
    assert.equal(f.receipts[0].consumeSync(),true);
    const params={threadId:f.state.attachmentThread,cursor:null,limit:50};
    const request={id:"attachments-first",method:"thread/attachment/list",params};
    const encoded=encode(request); f.gate.write(encoded); assert.equal(f.writes.at(-1),encoded);
    const page={id:request.id,result:{data:[{id:"native-attachment",attachmentType:"native-type",identityKey:"original-identity",createdAt:0,payload:{text:"original fixture payload",nested:[null,true]}}],nextCursor:"native-opaque-page-2"}};
    assert.equal(f.gate.receive(encode(page)),encode(page));
    const next={id:"attachments-second",method:request.method,params:{...params,cursor:page.result.nextCursor}};
    f.gate.write(encode(next)); assert.equal(f.writes.at(-1),encode(next));
    const nativeError={id:next.id,error:{code:-32000,message:"original native attachment error"}};
    assert.equal(f.gate.receive(encode(nativeError)),encode(nativeError));
    const implicit={id:"attachments-default",method:request.method,params:{threadId:params.threadId}};
    f.gate.write(encode(implicit));assert.equal(f.writes.at(-1),encode(implicit));
    assert.equal(f.gate.receive(encode({id:implicit.id,result:{data:[]}})),encode({id:implicit.id,result:{data:[]}}));
    let index=0;
    for(const patch of [{threadId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},{threadId:"not-a-uuid"},{cursor:1},{cursor:"x".repeat(4097)},{cursor:"bad\ncursor"},{limit:0},{limit:-1},{limit:101},{limit:1.5},{limit:"50"},{config:{}},{includePayload:false}]) {
      assert.throws(()=>f.gate.write(encode({id:"invalid-attachment-"+(++index),method:request.method,params:{...params,...patch}})),{code:"SHARED_DAEMON_DENIED"});
    }
    for(const method of ["thread/attachment/add","thread/attachment/remove","thread/attachment/owner/list"])
      assert.throws(()=>f.gate.write(encode({id:"other-attachment-"+(++index),method,params})),{code:"SHARED_DAEMON_DENIED"});
    const pending={id:"attachment-before-revoke",method:request.method,params};f.gate.write(encode(pending));
    f.state.attachmentLive=false;
    assert.throws(()=>f.gate.receive(encode({id:pending.id,result:{data:[]}})),{code:"SHARED_DAEMON_DENIED"});
    assert.throws(()=>f.gate.write(encode({id:"attachment-after-revoke",method:request.method,params})),{code:"SHARED_DAEMON_DENIED"});
  } finally {f.gate.close();}
});

test("desktop attachment page validation rejects malformed or oversized native pages without a fabricated result", () => {
  const attachment={id:"attachment",attachmentType:"type",identityKey:"identity",createdAt:0,payload:null};
  for(const badResult of [{data:[{...attachment,payload:undefined}]},{data:[{...attachment,createdAt:0.5}]},{data:[{...attachment,id:3}]},{data:[{...attachment,attachmentType:null}]},{data:[{...attachment,identityKey:{}}]},{data:[attachment,attachment]},{data:[],nextCursor:17},{data:[],nextCursor:"x".repeat(4097)},{data:"not-array"},{data:[],fabricated:true}]) {
    const f=fixture({consumeInitialize:true});
    try {
      f.gate.write(encode(init)); f.gate.receive(encode(initResult)); assert.equal(f.receipts[0].consumeSync(),true);
      const request={id:"malformed-attachment-page",method:"thread/attachment/list",params:{threadId:f.state.attachmentThread,limit:1}};
      f.gate.write(encode(request));
      assert.throws(()=>f.gate.receive(encode({id:request.id,result:badResult})),{code:"SHARED_DAEMON_DENIED"});
      assert.equal(f.writes.length,2);
    } finally {f.gate.close();}
  }
});
