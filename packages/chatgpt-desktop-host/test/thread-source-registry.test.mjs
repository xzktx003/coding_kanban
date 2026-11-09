import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createThreadSourceRegistry} from '../src/thread-source-registry.mjs';
const uuid=randomUUID;
function source(data=[]) {
 let rev=1,live=true;
 return {generation:uuid(),getAccountRevision:()=>rev,verifySync:()=>live,
  list:async()=>({data,nextCursor:'cursor-next',backwardsCursor:null}),
  read:async threadId=>{const found=data.find(x=>x.id===threadId);return found?{thread:{...found}}:null;},
  setRevision:value=>{rev=value},setLive:value=>{live=value}};
}
test('actual provider records register source without trusting renderer origin, preserving original page',async()=>{
 const privateId=uuid(),sharedId=uuid(),p=source([{id:privateId,cwd:'/projects/private',name:'Private'}]),d=source([{id:sharedId,cwd:'/projects/shared',name:'CLI',preview:'hello'}]);
 const registry=createThreadSourceRegistry({privateSource:p,daemonSource:d});
 const actual=await registry.listDaemon({cursor:'opaque'});assert.deepEqual(actual,{data:[{id:sharedId,cwd:'/projects/shared',name:'CLI',preview:'hello'}],nextCursor:'cursor-next',backwardsCursor:null});
 await registry.listPrivate({});const a=await registry.resolve(privateId),b=await registry.resolve(sharedId);
 assert.equal(a.executionDomain,'private');assert.equal(b.executionDomain,'daemon');assert.equal(b.generation,d.generation);assert.equal(b.accountRevision,1);assert.equal(b.cwd,'/projects/shared');
 assert.equal(registry.verifyResolvedSync(b),true);
 await assert.rejects(registry.resolve(sharedId,{executionDomain:'private'}),{code:'THREAD_SOURCE_INVALID'});
});
test('the same UUID in both execution domains is ambiguous even when cwd matches',async()=>{
 const id=uuid(),p=source([{id,cwd:'/projects/shared'}]),d=source([{id,cwd:'/projects/shared'}]);const registry=createThreadSourceRegistry({privateSource:p,daemonSource:d});
 await registry.listPrivate({});await registry.listDaemon({});await assert.rejects(registry.resolve(id),{code:'THREAD_SOURCE_AMBIGUOUS'});
});
test('account change, unknown identity and retired connection cannot revive old sources',async()=>{
 const id=uuid(),p=source([{id,cwd:'/projects/a'}]),d=source([]),registry=createThreadSourceRegistry({privateSource:p,daemonSource:d});
 await registry.listPrivate({});const resolved=await registry.resolve(id);p.setRevision(null);assert.equal(registry.verifyResolvedSync(resolved),false);
 p.setRevision(1);await assert.rejects(registry.resolve(id),{code:'THREAD_SOURCE_UNAVAILABLE'});
 p.setRevision(2);await registry.listPrivate({});const next=await registry.resolve(id);assert.equal(next.accountRevision,2);
 p.setLive(false);assert.equal(registry.verifyResolvedSync(next),false);p.setLive(true);await assert.rejects(registry.resolve(id),{code:'THREAD_SOURCE_UNAVAILABLE'});
});
test('late old list results cannot replace newer thread metadata or cross account revisions',async()=>{
 const id=uuid(),p=source([]),d=source([]), waits=[];p.list=()=>new Promise(resolve=>waits.push(resolve));p.read=async()=>({thread:{id,cwd:'/projects/new'}});
 const registry=createThreadSourceRegistry({privateSource:p,daemonSource:d});const old=registry.listPrivate({cursor:'old'}),newer=registry.listPrivate({cursor:'new'});
 waits[1]({data:[{id,cwd:'/projects/new'}],nextCursor:null});await newer;waits[0]({data:[{id,cwd:'/projects/old'}],nextCursor:null});await assert.rejects(old,{code:'THREAD_SOURCE_STALE'});
 assert.equal((await registry.resolve(id)).cwd,'/projects/new');
 const pending=registry.listPrivate({cursor:'page'});p.setRevision(2);waits[2]({data:[{id,cwd:'/projects/stale'}],nextCursor:null});await assert.rejects(pending,{code:'THREAD_SOURCE_STALE'});
});
test('a changed thread cwd, account or competing source during the fresh read denies the selected target',async()=>{
 const id=uuid(),p=source([{id,cwd:'/projects/original'}]),d=source([]);let finish;p.read=()=>new Promise(resolve=>{finish=resolve});
 const registry=createThreadSourceRegistry({privateSource:p,daemonSource:d});await registry.listPrivate({});const pending=registry.resolve(id);p.setRevision(2);finish({thread:{id,cwd:'/projects/original'}});await assert.rejects(pending,{code:'THREAD_SOURCE_STALE'});
});
test('a renderer-supplied copy of an origin is not a server-issued resolution',async()=>{
 const id=uuid(),p=source([{id,cwd:'/projects/private'}]),d=source([]),registry=createThreadSourceRegistry({privateSource:p,daemonSource:d});
 await registry.listPrivate({});const resolved=await registry.resolve(id);assert.equal(registry.verifyResolvedSync(resolved),true);assert.equal(registry.verifyResolvedSync({...resolved}),false);
});
test('a superseded response for the same original list request cannot register new unrelated rows',async()=>{
 const oldId=uuid(),newId=uuid(),p=source([]),d=source([]),waiting=[];p.list=()=>new Promise(resolve=>waiting.push(resolve));
 const registry=createThreadSourceRegistry({privateSource:p,daemonSource:d});
 const old=registry.listPrivate({cursor:null,limit:100}),newer=registry.listPrivate({limit:100,cursor:null});
 waiting[1]({data:[{id:newId,cwd:'/new'}],nextCursor:null});await newer;
 waiting[0]({data:[{id:oldId,cwd:'/old'}],nextCursor:null});await assert.rejects(old,{code:'THREAD_SOURCE_STALE'});
});
test('a fresh identical page preserves the existing source capability',async()=>{
 const id=uuid(),p=source([{id,cwd:'/projects/private'}]),d=source([]),registry=createThreadSourceRegistry({privateSource:p,daemonSource:d});
 await registry.listPrivate({});const first=await registry.resolve(id);assert.equal(registry.verifyResolvedSync(first),true);
 await registry.listPrivate({});assert.equal(registry.verifyResolvedSync(first),true);const next=await registry.resolve(id);assert.equal(registry.verifyResolvedSync(next),true);
});
test('renderer-origin data and accessor properties cannot execute or select a source',async()=>{
 const p=source([]),d=source([]),registry=createThreadSourceRegistry({privateSource:p,daemonSource:d});let touched=false;
 const params={};Object.defineProperty(params,'cursor',{enumerable:true,get(){touched=true;return null}});
 await assert.rejects(registry.listDaemon(params),{code:'THREAD_SOURCE_INVALID'});assert.equal(touched,false);
 await assert.rejects(registry.listPrivate({origin:'daemon'}),{code:'THREAD_SOURCE_INVALID'});
});
test('an unlisted duplicate from the other actual connection is ambiguous',async()=>{
 const id=uuid(),p=source([{id,cwd:'/private'}]),d=source([{id,cwd:'/daemon'}]);
 const registry=createThreadSourceRegistry({privateSource:p,daemonSource:d});await registry.listPrivate({});
 await assert.rejects(registry.resolve(id),{code:'THREAD_SOURCE_AMBIGUOUS'});
});
test('an unverified opposite source cannot be treated as evidence of absence',async()=>{
 const id=uuid(),p=source([{id,cwd:'/private'}]),d=source([]);d.read=async()=>{throw Error('unknown')};
 const registry=createThreadSourceRegistry({privateSource:p,daemonSource:d});await registry.listPrivate({});
 await assert.rejects(registry.resolve(id),{code:'THREAD_SOURCE_UNAVAILABLE'});
});
test('list and metadata with turn bodies are rejected rather than presented as a clipped directory',async()=>{
 const id=uuid(),p=source([{id,cwd:'/projects/a',turns:[{items:[{type:'commandExecution'}]}]}]),d=source([]),registry=createThreadSourceRegistry({privateSource:p,daemonSource:d});
 await assert.rejects(registry.listPrivate({}),{code:'THREAD_SOURCE_INVALID'});
});
test('preserves all original native thread fields including the input permission',{skip:!process.env.CHATGPT_SOURCE_NATIVE_EVIDENCE},async()=>{
 const {readFile}=await import('node:fs/promises');const evidence=JSON.parse(await readFile(process.env.CHATGPT_SOURCE_NATIVE_EVIDENCE,'utf8'));const row=evidence.activeRead.result.thread;
 assert.ok(Object.hasOwn(row,'canAcceptDirectInput'));assert.deepEqual(row.turns,[]);
 const p=source([row]),d=source([]),registry=createThreadSourceRegistry({privateSource:p,daemonSource:d});
 const page=await registry.listPrivate({limit:100,useStateDbOnly:true});assert.deepEqual(page.data[0],row);assert.equal(page.data[0].canAcceptDirectInput,row.canAcceptDirectInput);
 const origin=await registry.resolve(row.id);assert.equal(origin.cwd,row.cwd);
});
test('page capabilities do not remove ambiguity between actual duplicate domains',async()=>{
 const id=uuid(),p=source([{id,cwd:'/private'}]),d=source([{id,cwd:'/daemon'}]),view={id:1};
 const registry=createThreadSourceRegistry({privateSource:p,daemonSource:d,verifyViewSync:value=>value===view});
 const pageA=await registry.listPrivate({}),pageB=await registry.listDaemon({});
 await assert.rejects(registry.resolve(id),{code:'THREAD_SOURCE_AMBIGUOUS'});
 const [a]=registry.issuePageTokens(view,pageA),[b]=registry.issuePageTokens(view,pageB);assert.notEqual(a.token,b.token);
 await assert.rejects(registry.resolveFromPage(view,a.token,id),{code:'THREAD_SOURCE_AMBIGUOUS'});
 await assert.rejects(registry.resolveFromPage(view,b.token,id),{code:'THREAD_SOURCE_AMBIGUOUS'});
});
test('source tokens reject forged pages, other views, stale account and retired views',async()=>{
 const id=uuid(),p=source([]),d=source([{id,cwd:'/daemon'}]),view={id:1},other={id:2};let live=true;
 const registry=createThreadSourceRegistry({privateSource:p,daemonSource:d,verifyViewSync:value=>live&&(value===view||value===other)});
 const page=await registry.listDaemon({});assert.throws(()=>registry.issuePageTokens(view,structuredClone(page)),{code:'THREAD_SOURCE_INVALID'});
 const [issued]=registry.issuePageTokens(view,page);
 await assert.rejects(registry.resolveFromPage(other,issued.token,id),{code:'THREAD_SOURCE_UNAVAILABLE'});
 await assert.rejects(registry.resolveFromPage(view,'A'.repeat(43),id),{code:'THREAD_SOURCE_UNAVAILABLE'});
 await assert.rejects(registry.resolveFromPage(view,issued.token,uuid()),{code:'THREAD_SOURCE_UNAVAILABLE'});
 const resolved=await registry.resolveFromPage(view,issued.token,id);assert.equal(registry.verifyResolvedSync(resolved),true);
 registry.retireView(view);assert.equal(registry.verifyResolvedSync(resolved),false);await assert.rejects(registry.resolveFromPage(view,issued.token,id),{code:'THREAD_SOURCE_UNAVAILABLE'});
 const [issuedAgain]=registry.issuePageTokens(view,page);d.setRevision(2);await assert.rejects(registry.resolveFromPage(view,issuedAgain.token,id),{code:'THREAD_SOURCE_UNAVAILABLE'});
});
test('page resolution cannot infer absence from an unavailable daemon',async()=>{
 const id=uuid(),p=source([{id,cwd:'/private'}]),d=source([]),view={id:1};const registry=createThreadSourceRegistry({privateSource:p,daemonSource:d,verifyViewSync:value=>value===view});
 const page=await registry.listPrivate({}),[issued]=registry.issuePageTokens(view,page);d.setLive(false);
 await assert.rejects(registry.resolveFromPage(view,issued.token,id),{code:'THREAD_SOURCE_UNAVAILABLE'});
});
test('original list options with undefined fields retain standard JSON omission semantics',async()=>{
 let seen;const p=source([]),d=source([]);p.list=async params=>(seen=params,{data:[],nextCursor:null});
 const registry=createThreadSourceRegistry({privateSource:p,daemonSource:d});await registry.listPrivate({limit:100,useStateDbOnly:true,originators:undefined});
 assert.deepEqual(seen,{limit:100,useStateDbOnly:true});
});
test('a selected read error never falls back to a page from the source',async()=>{
 const id=uuid(),view={id:1},p=source([]),d=source([{id,cwd:'/daemon',turns:[]}]);let present=true,lists=0;
 d.read=async()=>{throw Error('thread not loaded')};d.list=async params=>{lists++;assert.deepEqual(params,{limit:50,cursor:'cursor'});return {data:present?[{id,cwd:'/daemon',turns:[]}]:[],nextCursor:null}};
 const registry=createThreadSourceRegistry({privateSource:p,daemonSource:d,verifyViewSync:v=>v===view});
 const page=await registry.listDaemon({limit:50,cursor:'cursor'}),[issued]=registry.issuePageTokens(view,page);
 await assert.rejects(registry.resolveFromPage(view,issued.token,id),{code:'THREAD_SOURCE_UNAVAILABLE'});assert.equal(lists,1);
 present=false;await assert.rejects(registry.resolveFromPage(view,issued.token,id),{code:'THREAD_SOURCE_UNAVAILABLE'});assert.equal(lists,1);
});
