import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedDaemonRpcGate} from '../src/shared-daemon-rpc-gate.mjs';
const encode=JSON.stringify,request={id:'sdk-init',method:'initialize',params:{clientInfo:{name:'codex_desktop',version:'fixture'},capabilities:{experimentalApi:true}}};
const warning={method:'configWarning',params:{summary:'Fixture sandbox prerequisite warning',details:null}};
const remote={method:'remoteControl/status/changed',params:{status:'disabled',serverName:'fixture-host',installationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',environmentId:null}};
function fixture(callback=()=>true){return createSharedDaemonRpcGate({verifyReadSync:()=>true,verifyBindingSync:()=>false,verifyHistorySync:()=>false,write(){},desktop:{daemonVersion:'0.166.0-alpha.5.1',verifyInitializeSync:()=>true,verifyStartupNotificationSync:callback}});}
function initializedResult(gate){gate.write(encode(request));gate.receive(encode({id:request.id,result:{userAgent:'fixture/0.166.0-alpha.5.1',codexHome:'/fixture'}}));}

test('actual supported startup metadata is accepted after initialize result before initialized, without inventing a causal trigger',()=>{
 const gate=fixture();try{
  assert.throws(()=>gate.receive(encode(warning)));initializedResult(gate);
  for(const event of [warning,remote,{...warning,emittedAtMs:123}])assert.equal(gate.receive(encode(event)),encode(event));
  gate.write(encode({method:'initialized'}));assert.equal(gate.receive(encode(warning)),encode(warning));
  assert.throws(()=>gate.write(encode({id:'task',method:'turn/start',params:{}})),{code:'SHARED_DAEMON_DENIED'});
 }finally{gate.close();}
});
test('startup metadata requires its fixed shape and synchronous owner proof; unknown remote states and fields remain denied',()=>{
 for(const callback of [()=>false,()=>Promise.resolve(true)]){const gate=fixture(callback);try{initializedResult(gate);assert.throws(()=>gate.receive(encode(warning)));}finally{gate.close();}}
 const gate=fixture();try{initializedResult(gate);
  for(const frame of [{...warning,id:4},{...warning,params:{...warning.params,extra:true}},{...remote,params:{...remote.params,status:'enabled'}},{...remote,params:{...remote.params,environmentId:'another'}},{...warning,emittedAtMs:-1}])assert.throws(()=>gate.receive(encode(frame)));
 }finally{gate.close();}
});
