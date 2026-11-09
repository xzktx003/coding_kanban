import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createSharedDaemonRpcGate} from '../src/shared-daemon-rpc-gate.mjs';
const threadId=randomUUID(),method='thread/queue/list',source=process.env.CHATGPT_QUEUE_ORIGINAL_NATIVE_CHUNK;
function fixture(){
 const writes=[],state={current:true,threadId};
 const gate=createSharedDaemonRpcGate({verifyReadSync:frame=>state.current&&(frame.method!==method||frame.params.threadId===state.threadId),verifyBindingSync:()=>false,verifyHistorySync:()=>false,write:text=>writes.push(text),desktop:{daemonVersion:'0.166.0',verifyInitializeSync:r=>r.codexHome==='/owned'}});
 gate.write(JSON.stringify({id:'init',method:'initialize',params:{clientInfo:{name:'codex_desktop',version:'fixture'},capabilities:{experimentalApi:true}}}));gate.receive(JSON.stringify({id:'init',result:{userAgent:'owned/0.166.0',codexHome:'/owned'}}));gate.write(JSON.stringify({method:'initialized',params:{}}));
 return{gate,writes,state};
}
const request=(id=1,params={})=>({id,method,params:{threadId,cursor:null,...params}});
const queued={id:'owned-queue',clientUserMessageId:'owned-client',input:[{type:'text',text:'owned queued text',text_elements:[{byteRange:{start:0,end:5},placeholder:null}]},{type:'image',url:'https://owned.example.invalid/image',detail:'low'},{type:'audio',url:'https://owned.example.invalid/audio'}]};
test('desktop queue reads preserve original request bytes, native cursor pages, input values, and native errors',()=>{
 const f=fixture();try{
  for(const [i,result]of [{data:[queued],nextCursor:'native-cursor'},{data:[],nextCursor:null},{data:[queued]}].entries()){
   const frame=request(i+1),wire=JSON.stringify(frame);f.gate.write(wire);assert.equal(f.writes.at(-1),wire);const reply=JSON.stringify({id:frame.id,result});assert.equal(f.gate.receive(reply),reply);
  }
  const frame=request(5);f.gate.write(JSON.stringify(frame));const failure=JSON.stringify({id:5,error:{code:-32603,message:'original native missing rollout error'}});assert.equal(f.gate.receive(failure),failure);
 }finally{f.gate.close();}
});
test('queue reads never grant unknown thread, stale scope, malformed params, or sibling queue mutations',()=>{
 for(const change of [f=>({threadId:randomUUID()}),f=>{f.state.current=false;return{};},()=>({cursor:{}}),()=>({limit:101}),()=>({limit:-1}),()=>({limit:1.5}),()=>({extra:true})]){
  const f=fixture();try{assert.throws(()=>f.gate.write(JSON.stringify(request(1,change(f)))),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.writes.length,2);}finally{f.gate.close();}
 }
 for(const suffix of ['add','update','delete','reorder','start']){const f=fixture();try{assert.throws(()=>f.gate.write(JSON.stringify({...request(),method:'thread/queue/'+suffix})),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.writes.length,2);}finally{f.gate.close();}}
 const f=fixture();try{f.gate.write(JSON.stringify(request()));f.state.current=false;assert.throws(()=>f.gate.receive(JSON.stringify({id:1,result:{data:[]}})),{code:'SHARED_DAEMON_DENIED'});}finally{f.gate.close();}
});
test('malformed native queue results cannot become accepted partial pages',()=>{
 for(const result of [{},{data:{}},{data:[],nextCursor:1},{data:[],extra:true},{data:[{...queued,input:null}]},{data:[{...queued,id:1}]},{data:[{...queued,extra:true}]},{data:[{id:'q',input:[]}]},{data:[{...queued,input:[{type:'unknown'}]}]}]){
  const f=fixture();try{f.gate.write(JSON.stringify(request()));assert.throws(()=>f.gate.receive(JSON.stringify({id:1,result})));}finally{f.gate.close();}
 }
});
test('complete pinned original native queue refresh follows only native cursors and propagates the original error',{skip:!source&&'Requires explicitly supplied pinned original native chunk'},async()=>{
 const body=readFileSync(source,'utf8');assert.equal(createHash('sha256').update(body).digest('hex'),'c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333');
 const a=body.indexOf('y=async(t,r)=>{let n=u.get(t);'),b=body.indexOf(',v=async e=>',a);assert.ok(a>=0&&b>a);const original=body.slice(a+2,b);assert.equal(createHash('sha256').update(original).digest('hex'),'7d728c15da2985885525e66d21ec6a9e55da879c32e7635c28ce68d723698366');
 for(const fail of [false,true]){
  const f=fixture(),u=new Map(),h=new Set(),d=new Map(),seen=[],originalError=Object.assign(new Error('owned native queue error'),{code:-32603});let nextId=10;
  const e={async sendRequest(method,params){seen.push({method,params});const id=++nextId;f.gate.write(JSON.stringify({id,method,params}));const reply=fail?{id,error:{code:originalError.code,message:originalError.message}}:{id,result:seen.length===1?{data:[queued],nextCursor:'original-next'}:{data:[]}};const received=JSON.parse(f.gate.receive(JSON.stringify(reply)));if(received.error)throw originalError;return received.result;}};
  const refresh=new Function('e','u','h','d','m','f','ra','let y='+original+';return y;')(e,u,h,d,false,()=>{},()=>assert.deepEqual);
  try{if(fail){await assert.rejects(refresh(threadId),error=>error===originalError);assert.equal(d.size,0);}else{await refresh(threadId);assert.deepEqual(seen.map(x=>x.params),[{threadId,cursor:null},{threadId,cursor:'original-next'}]);assert.deepEqual(d.get(threadId).items,[queued]);}assert.equal(u.size,0);}finally{f.gate.close();}
 }
});
