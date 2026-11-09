import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSharedDaemonRpcGate} from '../src/shared-daemon-rpc-gate.mjs';
const threadId=randomUUID();
function fixture({resolve=true,onWrite}={}){
 const binding=Object.freeze({hostId:'kanban-shared-cli',runtimeGeneration:randomUUID(),daemonGeneration:randomUUID(),accountRevision:1,projectId:'owned-project',threadId,viewId:randomUUID(),clientId:randomUUID()}),state={live:true,binding,write:true,history:true},writes=[],receipts=[];
 const equal=b=>b&&Object.keys(binding).every(k=>b[k]===binding[k]);
 const gate=createSharedDaemonRpcGate({verifyReadSync:()=>state.live,verifyBindingSync:b=>state.live&&state.write&&equal(b),verifyHistorySync:b=>state.live&&state.history&&equal(b),write:text=>{writes.push(text);onWrite?.(JSON.parse(text),state);},
  desktop:{daemonVersion:'0.166.0',verifyInitializeSync:()=>true,registerInitializeConsumptionSync:r=>receipts.push(r),...(resolve?{resolveThreadNameBindingSync:id=>id===threadId?state.binding:null}:{})}});
 gate.write(JSON.stringify({id:'init',method:'initialize',params:{clientInfo:{name:'codex_desktop',version:'26.1027.51404'}}}));gate.receive(JSON.stringify({id:'init',result:{userAgent:'codex_app_server/0.166.0',codexHome:'/owned/daemon/.codex'}}));assert.equal(receipts[0].consumeSync(),true);
 return{gate,binding,state,writes};
}
const nameRequest=(id='original-name',name='  原始名称\nsecond line  ')=>({id,method:'thread/name/set',params:{threadId,name}});

test('exact already-created binding preserves original native name, result, errors and no-retry IDs',()=>{
 const f=fixture();try{
  const frame=nameRequest(),text=JSON.stringify(frame);f.gate.write(text);assert.equal(f.writes.at(-1),text);
  const result=JSON.stringify({id:frame.id,result:{}});assert.equal(f.gate.receive(result),result);
  assert.throws(()=>f.gate.write(text),{code:'SHARED_DAEMON_DENIED'});
  const second=nameRequest('native-name-rejection','');f.gate.write(JSON.stringify(second));
  const failure=JSON.stringify({id:second.id,error:{code:-32602,message:'owned native validation error',data:{field:'name'}}});assert.equal(f.gate.receive(failure),failure);
  f.gate.write(JSON.stringify({id:'after-name',method:'account/read',params:{refreshToken:false}}));assert.equal(JSON.parse(f.writes.at(-1)).method,'account/read');
 }finally{f.gate.close();}
});

test('unknown thread, resumed-only missing origin, malformed names and sibling writers cannot use name capability',()=>{
 for(const patch of [{threadId:randomUUID()},{threadId:'not-a-uuid'},{name:null},{name:17},{path:'/owned/another-root'},{approvalPolicy:'never'}]){
  const f=fixture();try{const frame=nameRequest();Object.assign(frame.params,patch);assert.throws(()=>f.gate.write(JSON.stringify(frame)),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.writes.length,1);}finally{f.gate.close();}
 }
 for(const f of [fixture({resolve:false}),fixture()]){try{f.state.binding=null;assert.throws(()=>f.gate.write(JSON.stringify(nameRequest())),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.writes.length,1);}finally{f.gate.close();}}
 const f=fixture();try{for(const method of ['thread/delete','thread/archive','thread/rollback'])assert.throws(()=>f.gate.write(JSON.stringify({...nameRequest(method),method})),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.writes.length,1);}finally{f.gate.close();}
});

test('name write and reply independently require the same captured owned eight-field binding',()=>{
 for(const change of ['read','write','history','binding']){
  const f=fixture();try{
   const frame=nameRequest();f.gate.write(JSON.stringify(frame));
   if(change==='read')f.state.live=false;if(change==='write')f.state.write=false;if(change==='history')f.state.history=false;if(change==='binding')f.state.binding=Object.freeze({...f.binding});
   assert.throws(()=>f.gate.receive(JSON.stringify({id:frame.id,result:{}})),{code:'SHARED_DAEMON_OUTCOME_UNKNOWN'});assert.equal(f.writes.length,2);
   assert.throws(()=>f.gate.write(JSON.stringify(frame)));assert.equal(f.writes.length,2);
  }finally{f.gate.close();}
 }
 for(const change of ['read','write','history']){const f=fixture();try{if(change==='read')f.state.live=false;if(change==='write')f.state.write=false;if(change==='history')f.state.history=false;assert.throws(()=>f.gate.write(JSON.stringify(nameRequest())),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.writes.length,1);}finally{f.gate.close();}}
});

test('write-time revocation and non-object success never become synthetic name success',()=>{
 const f=fixture({onWrite:(frame,state)=>{if(frame.method==='thread/name/set')state.write=false;}});try{assert.throws(()=>f.gate.write(JSON.stringify(nameRequest())),{code:'SHARED_DAEMON_OUTCOME_UNKNOWN'});assert.equal(f.writes.length,2);}finally{f.gate.close();}
 for(const result of [null,[],true,'success']){const x=fixture();try{const frame=nameRequest();x.gate.write(JSON.stringify(frame));assert.throws(()=>x.gate.receive(JSON.stringify({id:frame.id,result})),{code:'SHARED_DAEMON_OUTCOME_UNKNOWN'});}finally{x.gate.close();}}
});
