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
 function webpack(id){if(id===35553)return z;if(cache.has(id))return cache.get(id).exports;const fn=modules[id];assert.equal(typeof fn,'function','Original pure module '+id+' must exist');const m={exports:{}};cache.set(id,m);fn(m,m.exports,webpack);return m.exports;}
 webpack.n=value=>()=>value;webpack.d=(target,getters,values)=>{for(const[k,get]of Object.entries(getters??{}))Object.defineProperty(target,k,{get,enumerable:true});Object.assign(target,values);};webpack.g=globalThis;webpack.nmd=m=>m;
 const ReadState=new Function('yo','ro','xC',cut(main,'class xI{','let xx=')+';return xI;')(webpack(85172),webpack(71415),z.object({jsonRpcCode:z.number()}));
 const Turns=new Function('eu',cut(sdk,'class rf{','function rg(')+';return rf;')({randomUUID});
 const ErrorFromResponse=new Function('nU',cut(sdk,'function nx(e,t){','var nV=')+';return nx;')(z.object({code:z.string()}));
 return {ReadState,Turns,ErrorFromResponse};
}
// Controlled JSON-RPC response fixtures test the original consumer and gate;
// these are not live-daemon, model or GUI acceptance receipts.
function fixture(t,{nativeError=null}={}){
 const binding={hostId:'kanban-shared-cli',runtimeGeneration:randomUUID(),daemonGeneration:randomUUID(),accountRevision:1,projectId:'owned-project',threadId:randomUUID(),viewId:randomUUID(),clientId:randomUUID()},record={viewId:binding.viewId},turnId=randomUUID(),writes=[],receipts=[],debug=[],replies=[],rpcErrors=[],state={live:true};
 const authority=createSharedThreadSendAuthority({getOwnedView:()=>record,verifyOwnedViewSync:()=>state.live,verifyBindingSync:b=>state.live&&JSON.stringify(b)===JSON.stringify(binding),verifyExplicitIntentSync:()=>state.live,verifySelectionSync:()=>state.live});
 const gate=createSharedDaemonRpcGate({verifyReadSync:frame=>state.live&&(!frame.params?.threadId||frame.params.threadId===binding.threadId),verifyBindingSync:()=>state.live,verifyHistorySync:()=>state.live,write:text=>writes.push(JSON.parse(text)),turn:authority,desktop:{daemonVersion:'0.166.0',verifyInitializeSync:()=>state.live,registerInitializeConsumptionSync:r=>receipts.push(r)}});
 t.after(()=>gate.close());gate.write(JSON.stringify({id:'owned-init',method:'initialize',params:{clientInfo:{name:'codex_desktop',version:'26.1027.51404'}}}));gate.receive(JSON.stringify({id:'owned-init',result:{userAgent:'codex_app_server/0.166.0',codexHome:'/owned/daemon/.codex'}}));assert.equal(receipts[0].consumeSync(),true);
 const previous={revision:'owned-native-row-revision:1',firstUnread:{type:'turn',turnId}},updated={revision:'owned-native-row-revision:2',firstUnread:null};
 const transport={hostId:binding.hostId,getAppServerVersion:()=> '0.166.0',async sendRequest(method,params,options){
  const frame={id:method+':'+randomUUID(),method,params};gate.write(JSON.stringify(frame));
  let response;if(method==='thread/read')response={id:frame.id,result:{thread:{id:binding.threadId},readState:previous}};
  else if(method==='thread/turns/list')response={id:frame.id,result:{data:[{id:turnId,status:'completed',items:[]}],nextCursor:null}};
  else if(method==='thread/readState/update')response=nativeError?{id:frame.id,error:nativeError}:{id:frame.id,result:{readState:updated}};
  else throw Error('Unexpected original receipt method');
  const text=JSON.stringify(response);assert.equal(gate.receive(text),text);replies.push(response);
  if(response.error){const error=o.ErrorFromResponse(method,response.error);rpcErrors.push(error);throw error;}return response.result;
 }};
 const o=original(),saved={syncWithServer:true,isReady:()=>true,set(){},has:()=>false,subscribe:()=>()=>{}},reader=new o.ReadState(saved,transport,{debug:(message,fields)=>debug.push({message,error:fields.sensitive.error})},()=>assert.fail('Update reply alone must not fabricate a local receive event'));
 return {binding,turnId,record,writes,state,authority,gate,debug,replies,previous,updated,reader,o,rpcErrors};
}
async function receipt(f){assert.equal(f.reader.acknowledgeRead(f.binding.threadId,false,f.turnId),undefined);for(let n=0;n<20&&f.reader.pending.has(f.binding.threadId);n++)await new Promise(setImmediate);assert.equal(f.reader.pending.size,0);}

async function nextTurn(f){
 const p=new f.o.Turns(()=>assert.fail('No automation'),()=>assert.fail('No synthetic notification'));
 let submitted;await p.startTurn({threadId:f.binding.threadId,input:[{type:'text',text:'owned receipt follow-up contract',text_elements:[]}],model:'owned-model',effort:'low'},null,async raw=>{
  submitted=JSON.parse(JSON.stringify(raw));f.authority.registerSend(f.binding,submitted,{attemptId:randomUUID(),signal:new AbortController().signal,deadline:performance.now()+1000});f.gate.write(JSON.stringify(submitted));const response={id:raw.id,result:{turn:{id:randomUUID(),status:'inProgress',items:[],error:null}}};assert.equal(f.gate.receive(JSON.stringify(response)),JSON.stringify(response));return response;
 });assert.equal(f.writes.filter(r=>r.method==='turn/start').length,1);assert.deepEqual(f.writes.at(-1),submitted);assert.equal(f.writes.some(r=>['thread/resume','thread/start'].includes(r.method)),false);
}
const options={skip:!root?'Requires explicitly supplied pinned desktop original':false};
test('complete original read receipt producer carries the exact observed revision through the owned gate without acquiring a task writer',options,async t=>{
 const f=fixture(t);assert.equal(f.reader.canSync,true);await receipt(f);
 assert.deepEqual(f.debug.map(v=>({message:v.message,code:v.error.code,stack:v.error.stack?.split('\n').find(line=>line.includes('shared-daemon-rpc-gate'))})),[]);assert.equal(f.reader.unavailable,false);
 const frames=f.writes.slice(1);assert.deepEqual(frames.map(r=>r.method),['thread/read','thread/turns/list','thread/readState/update']);assert.deepEqual(frames[2].params,{threadId:f.binding.threadId,expectedRevision:f.previous.revision,operation:{type:'read'}});assert.deepEqual(f.replies.at(-1).result,{readState:f.updated});
 assert.equal(f.writes.some(r=>r.method==='turn/start'),false);await nextTurn(f);
});
test('original receipt consumer preserves a server revision rejection without retry and allows a separately authorized original next turn',options,async t=>{
 const nativeError={code:-32000,message:'owned native revision conflict',data:{currentRevision:'owned-native-row-revision:3'}};const f=fixture(t,{nativeError});await receipt(f);
 assert.equal(f.debug.length,1);assert.equal(f.debug[0].message,'Could not send thread read receipt');assert.equal(f.debug[0].error,f.rpcErrors[0]);assert.equal(f.debug[0].error.jsonRpcCode,nativeError.code);assert.equal(f.debug[0].error.message,nativeError.message);assert.equal(f.debug[0].error.data,nativeError.data);assert.equal(f.reader.unavailable,false);assert.equal(f.reader.attempted.has(f.binding.threadId),true);
 f.reader.acknowledgeRead(f.binding.threadId,false,f.turnId);assert.equal(f.writes.filter(r=>r.method==='thread/readState/update').length,1);await nextTurn(f);
});
test('server method absence disables only original read synchronization and preserves next-turn dispatch',options,async t=>{
 const nativeError={code:-32601,message:'owned native method unavailable'},f=fixture(t,{nativeError});await receipt(f);assert.equal(f.debug[0].error,f.rpcErrors[0]);assert.equal(f.debug[0].error.jsonRpcCode,nativeError.code);assert.equal(f.debug[0].error.message,nativeError.message);assert.equal(f.debug[0].error.data,nativeError.data);assert.equal(f.reader.unavailable,true);assert.equal(f.reader.canSync,false);
 f.reader.acknowledgeRead(f.binding.threadId,true,f.turnId);assert.equal(f.writes.filter(r=>r.method==='thread/readState/update').length,1);await nextTurn(f);
});
test('foreign or revoked history proof cannot dispatch a receipt, resume or ordinary turn',options,async t=>{
 const f=fixture(t);for(const threadId of [randomUUID(),f.binding.threadId]){if(threadId===f.binding.threadId)f.state.live=false;assert.throws(()=>f.gate.write(JSON.stringify({id:randomUUID(),method:'thread/readState/update',params:{threadId,expectedRevision:'owned-native-row-revision:1',operation:{type:'read'}}})),{code:'SHARED_DAEMON_DENIED'});}
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].method,'initialize');
});
