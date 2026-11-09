import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,openSync,readSync,closeSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createSharedDaemonRpcGate} from '../src/shared-daemon-rpc-gate.mjs';
import {createSharedThreadSendAuthority} from '../src/shared-thread-send.mjs';
const require=createRequire(import.meta.url),{z}=require('zod');
const root=process.env.CHATGPT_DESKTOP_TEST_LINUX_ROOT;
function original(){
 const file=openSync(join(root,'resources/app.asar'),'r');
 function readAt(n,at){const b=Buffer.alloc(n);assert.equal(readSync(file,b,0,n,at),n);return b;}
 let main,sdk,entry;
 try{
  const h=readAt(16,0),index=JSON.parse(readAt(h.readUInt32LE(12),16)),start=8+h.readUInt32LE(4);
  function member(name,expected){let e=index;for(const p of name.split('/'))e=e.files[p];const b=readAt(e.size,start+Number(e.offset));assert.equal(createHash('sha256').update(b).digest('hex'),expected);return b.toString();}
  main=member('.vite/build/early-bootstrap-439-a0f25ba32c465de1.js','c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333');
  sdk=member('.vite/build/early-bootstrap-339-af4b764b02ba589c.js','f717cf6c18dd50ef4adce39ccf532f4e3e740211ce8c276363175b6a5e883c22');
  entry=member('.vite/build/early-bootstrap.js','466efbe496786705721ae93dd7cd2be7c08d0f760d53adf984dfde77af93fecf');
 }finally{closeSync(file);}
 const cut=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i);assert.ok(i>=0&&j>i);return s.slice(i,j);};
 const bundle={};new Function('exports',sdk)(bundle);
 // Load only the original lodash omit and config DTO dependencies. The entry's
 // module dictionary is evaluated without executing its native bootstrap.
 const a=entry.indexOf('a={')+2,b=entry.indexOf(',i={};function r(e){');assert.ok(a>2&&b>a);
 const modules={...new Function('require','return ('+entry.slice(a,b)+');')(require),...bundle.modules},cache=new Map();
 function webpack(id){if(id===35553)return z;if(id===71415)return {JF:()=>{throw Error('Unexpected feature lookup');}};if(id===84698)return {D:()=>true,r:()=>0};if(cache.has(id))return cache.get(id).exports;const fn=modules[id];assert.equal(typeof fn,'function','Original pure module '+id+' must exist');const m={exports:{}};cache.set(id,m);fn(m,m.exports,webpack);return m.exports;}
 webpack.n=value=>()=>value;webpack.d=(target,getters,values)=>{for(const[k,get]of Object.entries(getters??{}))Object.defineProperty(target,k,{get,enumerable:true});Object.assign(target,values);};webpack.g=globalThis;webpack.nmd=m=>m;
 const dto=webpack(16109),omit=webpack(45140);
 const resume=new Function('q','tx','eu','return ({'+cut(sdk,'async resumeThread(e,t){','spawn(e){')+'}).resumeThread;')({nrG:dto.nr,hR3:dto.hR,u_h:dto.u_},()=>omit,{randomUUID});
 const prediction=new Function(cut(main,'async function FL({','(0,em.vB9)("cumberbatch")')+';return FL;')();
 const resumeAttempt=new Function('yl',cut(main,'async function C_({','async function CP(')+';return C_;')({R:error=>error?.message});
 const Turns=new Function('eu',cut(sdk,'class rf{','function rg(')+';return rf;')({randomUUID});
 return {resume,prediction,resumeAttempt,Turns};
}
function fixture(t){
 const binding={hostId:'kanban-shared-cli',runtimeGeneration:randomUUID(),daemonGeneration:randomUUID(),accountRevision:1,projectId:'owned-project',threadId:randomUUID(),viewId:randomUUID(),clientId:randomUUID()},record={viewId:binding.viewId},writes=[],errors=[],requests=[],state={live:true};
 const authority=createSharedThreadSendAuthority({getOwnedView:()=>record,verifyOwnedViewSync:()=>state.live,verifyBindingSync:b=>state.live&&JSON.stringify(b)===JSON.stringify(binding),verifyExplicitIntentSync:()=>state.live,verifySelectionSync:()=>state.live});
 const receipts=[],gate=createSharedDaemonRpcGate({verifyReadSync:()=>state.live,verifyBindingSync:()=>state.live,verifyHistorySync:()=>state.live,write:text=>writes.push(JSON.parse(text)),turn:authority,desktop:{daemonVersion:'0.166.0',verifyInitializeSync:()=>state.live,registerInitializeConsumptionSync:r=>receipts.push(r),deliverUnsupportedCapabilitySync:r=>errors.push(r)}});
 t.after(()=>gate.close());
 gate.write(JSON.stringify({id:'owned-init',method:'initialize',params:{clientInfo:{name:'codex_desktop',version:'26.1027.51404'}}}));gate.receive(JSON.stringify({id:'owned-init',result:{userAgent:'codex_app_server/0.166.0',codexHome:'/owned/daemon/.codex'}}));assert.equal(receipts[0].consumeSync(),true);
 const client={hostConfig:{id:'kanban-shared-cli',kind:'local'},options:{},initializedAppServerVersion:'0.166.0',ensureReady:async()=>{assert.equal(state.live,true);},async sendInternalRequest(frame){requests.push(frame);gate.write(JSON.stringify(frame));const error=errors.find(r=>r.id===frame.id);assert.ok(error,'Exact unregistered resume must receive an explicit capability error');return error;}};
 return {binding,record,writes,errors,requests,state,authority,gate,client};
}
function refusal(f){assert.equal(f.errors.length,1);assert.equal(f.errors[0].error.code,-32601);assert.equal(f.errors[0].error.data.code,'SHARED_RESUME_INTENT_REQUIRED');assert.equal(Object.hasOwn(f.errors[0],'result'),false);assert.equal(f.writes.some(r=>r.method==='thread/resume'),false);assert.equal(f.state.live,true);}
async function nextTurn(f,o){
 const producer=new o.Turns(()=>assert.fail('No automation callback'),()=>assert.fail('No synthetic notification'));
 let submitted;
 const result=await producer.startTurn({threadId:f.binding.threadId,input:[{type:'text',text:'owned follow-up contract',text_elements:[]}],model:'owned-model',effort:'low'},null,async frame=>{
  // The authority and gate receive the actual JSON wire DTO, which omits
  // original optional undefined fields without inventing any field values.
  submitted=JSON.parse(JSON.stringify(frame));f.authority.registerSend(f.binding,submitted,{attemptId:randomUUID(),signal:new AbortController().signal,deadline:performance.now()+1000});
  f.gate.write(JSON.stringify(frame));const response={id:frame.id,result:{turn:{id:randomUUID(),items:[],status:'inProgress',error:null}}};assert.equal(f.gate.receive(JSON.stringify(response)),JSON.stringify(response));return response;
 });
 assert.equal(f.writes.filter(r=>r.method==='turn/start').length,1);assert.deepEqual(f.writes.at(-1),submitted);assert.equal(result.turn.status,'inProgress');assert.equal(f.state.live,true);
}

test('fixed original prediction caller through SDK resume DTO gets a capability error and the next original ordinary turn still dispatches',{skip:!root?'Requires explicit pinned original desktop root':false},async t=>{
 const o=original(),f=fixture(t);f.client.resumeThread=o.resume;
 await assert.rejects(o.prediction({client:f.client,threadId:f.binding.threadId,latestTurnId:randomUUID(),generationTrigger:'live',prompt:'owned prediction branch',promptVersion:'owned',signal:new AbortController().signal}),/requires an explicit thread\/resume intent/);
 refusal(f);assert.equal(f.requests.length,1);const p=f.requests[0].params;assert.equal(p.threadId,f.binding.threadId);assert.equal(p.history,null);assert.equal(p.path,null);assert.equal(p.model,null);assert.equal(p.modelProvider,null);assert.equal(p.cwd,null);assert.equal(p.approvalPolicy,null);assert.equal(p.sandbox,null);assert.equal(p.config,null);assert.equal(p.personality,null);assert.equal(p.excludeTurns,true);
 await nextTurn(f,o);
});

test('original manager resume retry loop does not retry an explicit capability error or retire the connection',{skip:!root?'Requires explicit pinned original desktop root':false},async t=>{
 const o=original(),f=fixture(t);let calls=0,produced;const stop=Error('Owned producer capture only');
 await assert.rejects(o.resume.call({...f.client,sendInternalRequest:async frame=>{produced=frame;throw stop;}},f.binding.threadId),error=>error===stop);
 await assert.rejects(o.resumeAttempt({sendRequest:async(method,params)=>{calls++;const frame={id:'owned-manager-resume:'+randomUUID(),method,params};const response=await f.client.sendInternalRequest(frame);if(response.error)throw Error(response.error.message);return response.result;},request:produced.params,options:{},schedule:()=>assert.fail('Policy refusal must not schedule a resume retry'),isCurrentResumeAttempt:()=>true,setRetryCleanup:()=>assert.fail('No retry cleanup should be needed')}),/requires an explicit thread\/resume intent/);
 assert.equal(calls,1);refusal(f);await nextTurn(f,o);
});
