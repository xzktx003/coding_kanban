import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import {createSharedThreadCreationAuthority} from "../src/shared-thread-creation.mjs";
import {createSharedDaemonRpcGate} from "../src/shared-daemon-rpc-gate.mjs";
const originalDirectory=process.env.CHATGPT_DESKTOP_SDK_SERIALIZER_DIR;
function originalSerializer(){
 const method=readFileSync(new URL("rt-sendMessage.js",new URL("file://"+originalDirectory+"/")),"utf8");
 assert.equal(createHash("sha256").update(method).digest("hex"),"04d0ab608dd0b94567b439f7405c14af40e8e47a2119d8896ebd9935e1df98aa");
 const send=new Function("nc","n9","nQ","q","n8",`return ({${method}}).sendMessage`)({l3:Error},()=>({}),()=>false,{iwv:"local",V57:"remote-control"},()=>null);
 const preparation=readFileSync(new URL("rG.js",new URL("file://"+originalDirectory+"/")),"utf8");
 const prep=new Function(`${preparation};return new rG`)();
 return {prep,serialize(frame){let encoded;send.call({options:{hostId:"kanban-shared-cli",hostKind:"ssh",transportKind:"websocket",getConnection:()=>({send:text=>{encoded=text}}),logger:{trace(){},debug(){}}},outgoingMessageSizeTracker:{track:()=>[]},rememberSharedThread(){}},prep.prepare(frame));return encoded;}};
}
function fixture(){
 const view={viewId:randomUUID()},scope={hostId:"kanban-shared-cli",runtimeGeneration:randomUUID(),daemonGeneration:randomUUID(),accountRevision:1,projectId:"owned",cwd:"/private/owned",viewId:view.viewId,creationNonce:randomUUID()};let policyCurrent=true,permissionChecks=0;const writes=[];
 const authority=createSharedThreadCreationAuthority({getOwnedView:()=>view,verifyOwnedViewSync:()=>true,verifyProjectSync:()=>true,verifyExplicitIntentSync:()=>true,verifyPermissionSelectionSync:(_scope,params)=>{permissionChecks++;return policyCurrent&&params.cwd===scope.cwd&&params.permissions===":workspace"&&params.approvalPolicy==="on-request"&&params.approvalsReviewer==="user";}});
 const frame={id:"original-sdk-create:"+randomUUID(),method:"thread/start",params:{cwd:scope.cwd,approvalPolicy:"on-request",approvalsReviewer:"user",permissions:":workspace",runtimeWorkspaceRoots:[scope.cwd]}};
 const gate=createSharedDaemonRpcGate({creation:authority,verifyReadSync:()=>true,verifyBindingSync:()=>false,verifyHistorySync:()=>false,write:encoded=>writes.push(encoded),desktop:{daemonVersion:"0.166.0",verifyInitializeSync:result=>result.codexHome==="/private/fixture",registerInitializeConsumptionSync:receipt=>{fixture.consume=receipt;}}});
 gate.write(JSON.stringify({id:"initialize",method:"initialize",params:{clientInfo:{name:"codex_desktop",version:"1"},capabilities:{experimentalApi:true}}}));gate.receive(JSON.stringify({id:"initialize",result:{userAgent:"codex-cli/0.166.0",codexHome:"/private/fixture"}}));assert.equal(fixture.consume.consumeSync(),true);writes.length=0;
 authority.registerCreate(scope,frame,{signal:new AbortController().signal,deadline:performance.now()+5000});
 return{authority,frame,scope,gate,writes,revokePermissions(){policyCurrent=false;},permissionChecks:()=>permissionChecks,close(){gate.close();authority.close();}};
}
test("actual fixed SDK preparation and serialization preserve the authorized business frame",{skip:!originalDirectory},()=>{
 const original=originalSerializer(),f=fixture();try{const encoded=original.serialize(f.frame);f.gate.write(encoded);assert.equal(f.writes[0],encoded);assert.equal(f.permissionChecks(),2);}finally{f.close();}
});
test("the actual SDK final preparation cannot add an unauthorized business field, and its first exact denial is retained",{skip:!originalDirectory},()=>{
 const original=originalSerializer(),f=fixture();try{original.prep.install({read:()=>({enrolled:true})});const encoded=original.serialize(f.frame);assert.equal(JSON.parse(encoded).params.daybreakProgramPropagationEnrolled,true);assert.throws(()=>f.gate.write(encoded),error=>{assert.equal(error.code,"SHARED_DAEMON_DENIED");assert.equal(error.cause?.code,"SHARED_CREATE_DENIED");assert.equal(error.cause?.phase,"request-params");assert.equal(Object.getOwnPropertyDescriptor(error,"cause").enumerable,false);return true;});assert.equal(f.writes.length,0);}finally{f.close();}
});
test("permission revocation at the actual serialized gate write remains a hard denial with the precise original cause",{skip:!originalDirectory},()=>{
 const original=originalSerializer(),f=fixture();try{f.revokePermissions();assert.throws(()=>f.gate.write(original.serialize(f.frame)),error=>{assert.equal(error.code,"SHARED_DAEMON_DENIED");assert.equal(error.cause?.phase,"permission-proof");return true;});assert.equal(f.writes.length,0);}finally{f.close();}
});

test("actual original r7 request dispatch adds only bounded trace metadata while the full gate preserves native wire and permission proof",{skip:!originalDirectory},()=>{
 const original=originalSerializer(),f=fixture();
 const trace={traceparent:"00-11111111111111111111111111111111-2222222222222222-01",tracestate:"acme=original"};
 const queueBody=readFileSync(new URL("r7-sendRequest.js",new URL("file://"+originalDirectory+"/")),"utf8");
 assert.equal(createHash("sha256").update(queueBody).digest("hex"),"4d9ea10fc4f64fd8672240886170bcb643e949bc6d9768cc8b440f5bce2d05de");
 let serialized;const context={backendAuth:{beginAccountChange(){}},options:{transport:{kind:"websocket"}},threadStartPreparation:original.prep,messageDelivery:{sendMessage(frame){serialized=original.serialize(frame);f.gate.write(serialized);}}};
 const dispatch=new Function("q","nw","t5",`return (${queueBody})`).call(context,{PpM:()=>trace,f5g:(_options,invoke)=>invoke()},()=>{throw Error("Unexpected turn mutation")},String);
 try{dispatch({...f.frame,trace},undefined,undefined,undefined);assert.equal(f.writes.length,1);assert.equal(f.writes[0],serialized);assert.deepEqual(JSON.parse(serialized).trace,trace);assert.equal(f.permissionChecks(),2);}finally{f.close();}
});

test("bounded SDK trace cannot smuggle business keys or change authorized permissions; empty trace is only metadata",{skip:!originalDirectory},()=>{
 for(const trace of [null,{traceparent:"00-11111111111111111111111111111111-2222222222222222-01"},{traceparent:"00-00000000000000000000000000000000-2222222222222222-01"},{traceparent:"00-11111111111111111111111111111111-2222222222222222-01",permissions:":danger-full-access"}]){
  const original=originalSerializer(),f=fixture();try{const encoded=original.serialize({...f.frame,trace});if(trace===null||Object.keys(trace).length===1&&!trace.traceparent.includes("-00000000000000000000000000000000-")){f.gate.write(encoded);assert.equal(f.writes[0],encoded);}else{assert.throws(()=>f.gate.write(encoded),error=>{assert.equal(error.cause?.phase,"request-trace");return true;});assert.equal(f.writes.length,0);}}finally{f.close();}
 }
 const original=originalSerializer(),f=fixture();try{const frame={...f.frame,trace:{traceparent:"00-11111111111111111111111111111111-2222222222222222-01"},params:{...f.frame.params,approvalPolicy:"never"}};assert.throws(()=>f.gate.write(original.serialize(frame)),error=>{assert.equal(error.cause?.phase,"permission-proof");return true;});assert.equal(f.writes.length,0);}finally{f.close();}
});

const providerDirectory=process.env.CHATGPT_DESKTOP_SDK_ENROLLMENT_PROVIDER_DIR;
function originalProvider(context,host,record){
 const text=readFileSync(new URL('provider-read.js',new URL('file://'+providerDirectory+'/')),'utf8');
 assert.equal(createHash('sha256').update(text).digest('hex'),'96b883e9f1129e8ee585e36b6446fc0aa4a983db9ba64b3671d1ff65817a6909');
 return new Function('e','t',`return (${text})`).call(context,host,record);
}
test('actual original enrollment provider emits false while unconfirmed or unenrolled, and the final gate preserves the original disabled SDK default',{skip:!originalDirectory||!providerDirectory},()=>{
 for(const state of ['unconfirmed','unenrolled','unsupported']){
  const original=originalSerializer(),f=fixture(),host={hostId:'kanban-shared-cli'},record={generation:4,acknowledgedGeneration:state==='unconfirmed'?null:4,supportsPropagation:state==='unconfirmed'?null:state==='unsupported'?false:true,acknowledgedEnrollment:false},context={disposed:false,connections:new Map()};
  context.connections.set(host.hostId,record);const provider=originalProvider(context,host,record);assert.equal(provider.read().enrolled,state==='unsupported'?undefined:false);original.prep.install(provider);
  try{const encoded=original.serialize(f.frame),params=JSON.parse(encoded).params;assert.equal(Object.hasOwn(params,'daybreakProgramPropagationEnrolled'),state!=='unsupported');if(state!=='unsupported')assert.equal(params.daybreakProgramPropagationEnrolled,false);f.gate.write(encoded);assert.equal(f.writes[0],encoded);assert.equal(f.permissionChecks(),2);}finally{f.close();}
 }
});
test('actual acknowledged enrollment true and any nonliteral false remain unsupported business changes',{skip:!originalDirectory||!providerDirectory},()=>{
 const original=originalSerializer(),f=fixture(),host={hostId:'kanban-shared-cli'},record={generation:4,acknowledgedGeneration:4,supportsPropagation:true,acknowledgedEnrollment:true},context={disposed:false,connections:new Map()};context.connections.set(host.hostId,record);const provider=originalProvider(context,host,record);assert.equal(provider.read().enrolled,true);original.prep.install(provider);
 try{assert.throws(()=>f.gate.write(original.serialize(f.frame)),error=>{assert.equal(error.cause?.phase,'request-params');return true;});assert.equal(f.writes.length,0);}finally{f.close();}
 for(const value of [null,'false',0,{},true]){const fixtureValue=fixture();try{assert.throws(()=>fixtureValue.gate.write(JSON.stringify({...fixtureValue.frame,params:{...fixtureValue.frame.params,daybreakProgramPropagationEnrolled:value}})),error=>{assert.equal(error.cause?.phase,'request-params');return true;});assert.equal(fixtureValue.writes.length,0);}finally{fixtureValue.close();}}
});
