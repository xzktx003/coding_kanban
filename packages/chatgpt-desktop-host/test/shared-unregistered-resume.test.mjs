import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSharedDaemonRpcGate} from '../src/shared-daemon-rpc-gate.mjs';
const encode=JSON.stringify,thread=randomUUID();
const sdkResume=(id,changes={})=>({id,method:'thread/resume',params:{threadId:thread,history:null,path:null,model:null,modelProvider:null,cwd:null,approvalPolicy:null,sandbox:null,config:null,personality:null,excludeTurns:true,...changes}});
function fixture({capability=true,deliver}={}){
 const writes=[],errors=[],state={read:true,binding:true,history:true};
 const gate=createSharedDaemonRpcGate({verifyReadSync:()=>state.read,verifyBindingSync:()=>state.binding,verifyHistorySync:()=>state.history,write:frame=>{writes.push(frame)},desktop:{daemonVersion:'0.166.0',verifyInitializeSync:()=>true,...(capability?{deliverUnsupportedCapabilitySync:response=>{errors.push(response);return deliver?.(response)}}:{})}});
 gate.write(encode({id:'init',method:'initialize',params:{clientInfo:{name:'codex_desktop',version:'1'},capabilities:{experimentalApi:true}}}));
 gate.receive(encode({id:'init',result:{userAgent:'codex_app_server/0.166.0',codexHome:'/owned/home'}}));gate.write(encode({method:'initialized',params:{}}));
 const binding={hostId:'kanban-shared-cli',runtimeGeneration:randomUUID(),daemonGeneration:randomUUID(),accountRevision:1,projectId:'owned-project',threadId:thread,viewId:randomUUID(),clientId:randomUUID()};
 const control=()=>({attemptId:randomUUID(),signal:new AbortController().signal,deadline:performance.now()+30000});
 return{gate,writes,errors,state,binding,control};
}
test('unregistered original SDK resume returns an explicit error without native writes or retiring unrelated reads',()=>{
 const f=fixture();try{
  const requests=[sdkResume('sdk-default'),sdkResume('sdk-options',{cwd:'/owned/project',path:'/owned/history',developerInstructions:'owned instructions',config:{'features.example':true}}),{id:'canonical',method:'thread/resume',params:{threadId:thread,excludeTurns:true}}];
  for(const request of requests){
   assert.doesNotThrow(()=>f.gate.write(encode(request)));
   assert.deepEqual(f.errors.at(-1),{id:request.id,error:{code:-32601,message:'Shared desktop policy requires an explicit thread/resume intent',data:{source:'kanban-shared-policy',code:'SHARED_RESUME_INTENT_REQUIRED',method:'thread/resume'}}});
   assert.equal(Object.hasOwn(f.errors.at(-1),'result'),false);assert.equal(encode(f.errors.at(-1)).includes(thread),false);
   assert.throws(()=>f.gate.write(encode(request)),{code:'SHARED_DAEMON_DENIED'});
   assert.throws(()=>f.gate.receive(encode({id:request.id,result:{thread:{id:thread}}})),{code:'SHARED_DAEMON_DENIED'});
  }
  assert.equal(f.writes.length,2);
  const read={id:'read-after-denial',method:'account/read',params:{refreshToken:false}},reply={id:read.id,result:{account:null,requiresOpenaiAuth:false}};
  f.gate.write(encode(read));assert.equal(f.gate.receive(encode(reply)),encode(reply));assert.equal(f.writes.length,3);
 }finally{f.gate.close()}
});
test('resume capability error does not accept malformed, unknown or revoked input',()=>{
 const f=fixture();try{
  const changes=[{extra:true},{threadId:'wrong'},{threadId:null},{history:[]},{path:[]},{cwd:{}},{model:'new-model'},{approvalPolicy:'never'},{sandbox:'danger-full-access'},{personality:'friendly'},{config:[]},{excludeTurns:false},{developerInstructions:{}},{cwd:'bad\npath'}];
  for(const [i,change]of changes.entries())assert.throws(()=>f.gate.write(encode(sdkResume('bad'+i,change))),{code:'SHARED_DAEMON_DENIED'});
  for(const frame of [{...sdkResume('extra-frame'),extra:true},sdkResume('bad-jsonrpc'),{id:'unknown',method:'thread/resume/unknown',params:{threadId:thread,excludeTurns:true}},{id:'missing',method:'thread/resume',params:{threadId:thread}}]){
   if(frame.id==='bad-jsonrpc')frame.jsonrpc='1.0';assert.throws(()=>f.gate.write(encode(frame)),{code:'SHARED_DAEMON_DENIED'});
  }
  f.state.read=false;assert.throws(()=>f.gate.write(encode(sdkResume('revoked'))),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.errors.length,0);assert.equal(f.writes.length,2);
 }finally{f.gate.close()}
 const strict=fixture({capability:false});try{assert.throws(()=>strict.gate.write(encode(sdkResume('no-desktop-error-sink'))),{code:'SHARED_DAEMON_DENIED'});assert.equal(strict.writes.length,2)}finally{strict.gate.close()}
});
test('registered explicit resume keeps its original synchronous binding, history, deadline and wire guards',()=>{
 for(const invalid of [null,'binding','history','deadline']){
  const f=fixture();try{
   const request={id:'explicit-'+invalid,method:'thread/resume',params:{threadId:thread,excludeTurns:true}},control=f.control();
   assert.equal(f.gate.registerConnect(f.binding,request,control),true);
   if(invalid==='deadline')control.deadline=performance.now()-1;else if(invalid)f.state[invalid]=false;
   if(invalid){assert.throws(()=>f.gate.write(encode(request)),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.writes.length,2)}
   else{f.gate.write(encode(request));assert.equal(f.writes.at(-1),encode(request));const reply={id:request.id,error:{code:-32600,message:'original native refusal',data:{original:true}}};assert.equal(f.gate.receive(encode(reply)),encode(reply));assert.equal(f.writes.length,3)}
   assert.equal(f.errors.length,0);
  }finally{f.gate.close()}
 }
});
test('unregistered denial delivery failures stay fail closed and cannot repeat the id',()=>{
 for(const deliver of [()=>{throw Error('owned sink failure')},()=>Promise.resolve()]){
  const f=fixture({deliver});try{const request=sdkResume('sink-failed');assert.throws(()=>f.gate.write(encode(request)),{code:'SHARED_DAEMON_OUTCOME_UNKNOWN'});assert.throws(()=>f.gate.write(encode(request)),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.errors.length,1);assert.equal(f.writes.length,2)}finally{f.gate.close()}
 }
 const f=fixture({deliver:()=>{f.state.read=false}});try{assert.throws(()=>f.gate.write(encode(sdkResume('revoked-during-delivery'))),{code:'SHARED_DAEMON_OUTCOME_UNKNOWN'});assert.equal(f.errors.length,1);assert.equal(f.writes.length,2)}finally{f.gate.close()}
});
