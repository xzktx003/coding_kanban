import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createBrowserSharedCatalog} from '../src/browser-shared-catalog.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){let scope={},listener;const sent=[];const win={crypto:{randomUUID},atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),setTimeout,clearTimeout};
 const lease={getSnapshot:()=>scope,isCurrent:x=>x===scope,subscribe:fn=>(listener=fn,()=>{})};
 const c=createBrowserSharedCatalog({window:win,scopeLease:lease,send:async frame=>sent.push(frame)});
 return {c,sent,revoke(){scope=null;listener()}};
}
test('browser reassembles only ordered host chunks and acknowledges every real chunk',async()=>{
 const f=fixture(),pending=f.c.loadPage({cursor:null,limit:50});await tick();const id=f.sent[0].requestId,obj={page:{data:[],nextCursor:null},tokens:[]},bytes=Buffer.from(JSON.stringify(obj)),data=bytes.toString('base64');
 assert.equal(f.c.receive({type:'kanban-shared-catalog-chunk',requestId:id,sequence:1,totalBytes:bytes.length,final:true,data}),true);
 assert.deepEqual(await pending,obj);assert.deepEqual(f.sent[1],{type:'kanban-shared-catalog-ack',requestId:id,sequence:1});f.c.dispose();
});
test('invalid order and account-scope retirement reject without accepting stale data',async()=>{
 const f=fixture(),pending=f.c.loadPage({cursor:null,limit:50});await tick();const id=f.sent[0].requestId;
 assert.equal(f.c.receive({type:'kanban-shared-catalog-chunk',requestId:id,sequence:2,totalBytes:1,final:true,data:'eA=='}),true);await assert.rejects(pending);
 const next=f.c.loadPage({cursor:null,limit:50});await tick();f.revoke();await assert.rejects(next);assert.equal(f.c.receive({type:'kanban-shared-catalog-error',requestId:id,code:'unavailable'}),true);f.c.dispose();
});
