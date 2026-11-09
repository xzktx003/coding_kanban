import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';
const {createHostCatalogIpc,createNativeCatalogRelay}=createRequire(import.meta.url)('../src/shared-catalog-ipc.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(fn){for(let i=0;i<100&&!fn();i++)await tick();assert.ok(fn(),'expected frame');}
function fixture(){
 const profileId=randomUUID(),generation=randomUUID(),viewId=randomUUID(),requestId=randomUUID(),threadId=randomUUID(),sender={id:7},record={senderId:7,viewId,window:{webContents:sender}},events=[],calls=[];let host,native,live=true;
 const payload={page:{data:[{id:threadId,cwd:'/fixture',preview:'x'.repeat(100000),canAcceptDirectInput:true}],nextCursor:'next'},tokens:[{threadId,token:'A'.repeat(43)}]};
 const budget=()=>{let used=0;return {reserveBytes(n){if(used+n>16*1024*1024)return false;used+=n;return true},releaseBytes(n){assert.ok(n<=used);used-=n},get used(){return used}}};
 const hb=budget(),nb=budget();
 host=createHostCatalogIpc({profileId,generation,verifyCurrentSync:()=>live,verifyViewSync:id=>live&&id===viewId,sendFrame:frame=>queueMicrotask(()=>native.receive(frame)),getPage:async(id,args)=>(calls.push([id,args]),payload),...hb});
 native=createNativeCatalogRelay({profileId,generation,verifyCurrentSync:()=>live,getRecord:id=>id===7?record:null,getOwnedRecord:s=>s===sender?record:null,sendFrame:frame=>queueMicrotask(()=>host.receive(frame)),sendToView:(_record,frame)=>events.push(frame),...nb});
 return {profileId,generation,viewId,requestId,threadId,sender,record,events,calls,host,native,payload,hb,nb,revoke(){live=false;native.revoke();host.revoke()},close(){native.close();host.close()}};
}
test('owned view receives a real source page in ordered acknowledged chunks',async()=>{
 const f=fixture();try{
 assert.equal(f.native.request(f.sender,{type:'kanban-shared-catalog-request',requestId:f.requestId,cursor:null,limit:50}),true);
 const chunks=[];let sequence=1;
 for(;;){await until(()=>f.events.length>=sequence);const frame=f.events[sequence-1];assert.equal(frame.type,'kanban-shared-catalog-chunk');assert.equal(frame.sequence,sequence);chunks.push(Buffer.from(frame.data,'base64'));
  assert.equal(f.native.ack(f.sender,{type:'kanban-shared-catalog-ack',requestId:f.requestId,sequence}),true);
  if(frame.final)break;sequence++;}
 await tick();assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()),f.payload);assert.ok(chunks.length>1);assert.deepEqual(f.calls,[[f.viewId,{cursor:null,limit:50}]]);assert.equal(f.hb.used,0);assert.equal(f.nb.used,0);
 }finally{f.close()}
});
test('foreign view, duplicate requests and stale account cannot receive or acknowledge a page',async()=>{
 const f=fixture();try{const request={type:'kanban-shared-catalog-request',requestId:f.requestId,cursor:null,limit:50};assert.equal(f.native.request({id:7},request),false);assert.equal(f.native.request(f.sender,request),true);assert.equal(f.native.request(f.sender,request),false);await until(()=>f.events.length>0);assert.equal(f.native.ack({id:7},{type:'kanban-shared-catalog-ack',requestId:f.requestId,sequence:1}),false);f.revoke();await tick();assert.equal(f.hb.used,0);assert.equal(f.nb.used,0);}finally{f.close()}
});
