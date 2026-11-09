import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSharedDaemonRpcGate} from '../src/shared-daemon-rpc-gate.mjs';
const encode=JSON.stringify,threadId=randomUUID();
function fixture(){
 const writes=[],state={live:true};
 const gate=createSharedDaemonRpcGate({verifyReadSync:frame=>state.live&&(frame.method!=='thread/readState/update'||frame.params?.threadId===threadId),verifyBindingSync:()=>false,verifyHistorySync:()=>false,write:encoded=>writes.push(encoded),desktop:{daemonVersion:'0.166.0',verifyInitializeSync:()=>true}});
 gate.write(encode({id:'init',method:'initialize',params:{clientInfo:{name:'codex_desktop',version:'1'},capabilities:{experimentalApi:true}}}));gate.receive(encode({id:'init',result:{userAgent:'codex_app_server/0.166.0',codexHome:'/owned/home'}}));gate.write(encode({method:'initialized',params:{}}));return{gate,writes,state};
}
const request=(id,patch={})=>({id,method:'thread/readState/update',params:{threadId,expectedRevision:'opaque seen revision',operation:{type:'read'},...patch}});
test('scoped native read-state edits preserve exact revisions, operations, native results and conflicts',()=>{
 const f=fixture();try{
  for(const [i,value]of [{revision:'next',firstUnread:null},{revision:'unread',firstUnread:{type:'threadStart'}},{revision:'turn',firstUnread:{type:'turn',turnId:''}},{revision:''}].entries()){
   const frame=request('state'+i,{operation:{type:i%2?'unread':'read'}});f.gate.write(encode(frame));assert.equal(f.writes.at(-1),encode(frame));const response={id:frame.id,result:{readState:value}};assert.equal(f.gate.receive(encode(response)),encode(response));
  }
  const stale=request('conflict');f.gate.write(encode(stale));const error={id:stale.id,error:{code:-32009,message:'original revision conflict',data:{readState:{revision:'actual',firstUnread:null}}}};assert.equal(f.gate.receive(encode(error)),encode(error));
  assert.throws(()=>f.gate.write(encode(stale)),{code:'SHARED_DAEMON_DENIED'});
  const after={id:'after-state',method:'account/read',params:{refreshToken:false}};f.gate.write(encode(after));assert.equal(f.gate.receive(encode({id:after.id,result:{account:null}})),encode({id:after.id,result:{account:null}}));
 }finally{f.gate.close()}
});
test('read-state metadata never admits malformed or foreign frames and rechecks current scope at reply',()=>{
 const f=fixture();try{
  for(const [i,patch]of [{threadId:randomUUID()},{threadId:'wrong'},{expectedRevision:1},{operation:{type:'other'}},{operation:{type:'read',extra:true}},{extra:true}].entries())assert.throws(()=>f.gate.write(encode(request('bad'+i,patch))),{code:'SHARED_DAEMON_DENIED'});
  assert.equal(f.writes.length,2);const frame=request('revoked-reply');f.gate.write(encode(frame));f.state.live=false;assert.throws(()=>f.gate.receive(encode({id:frame.id,result:{readState:{revision:'next'}}})),{code:'SHARED_DAEMON_DENIED'});assert.throws(()=>f.gate.write(encode(request('after-revoke'))),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.writes.length,3);
 }finally{f.gate.close()}
 for(const result of [{},{readState:{}},{readState:{revision:1}},{readState:{revision:'next',extra:true}},{readState:{revision:'next',firstUnread:{type:'turn'}}},{readState:{revision:'next',firstUnread:{type:'threadStart',extra:true}}},{readState:{revision:'next'},extra:true}]){
  const f=fixture();try{const frame=request('bad-result');f.gate.write(encode(frame));assert.throws(()=>f.gate.receive(encode({id:frame.id,result})),{code:'SHARED_DAEMON_DENIED'})}finally{f.gate.close()}
 }
});
