import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {openWebviewArchive} from '../src/assets.mjs';
import {createBrowserSharedThreadNavigation} from '../src/browser-shared-thread-navigation.mjs';

const ASAR=process.env.CHATGPT_DESKTOP_TEST_MAC_ASAR;
const ARCHIVE='bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95';
const HOST='kanban-shared-cli',hostsAtom={},managerAtom={},statusAtom={},accountAtom={},deferredAtom={};
let originalPromise;
function originalFunctions(){
 return originalPromise??=(async()=>{
  const archive=await openWebviewArchive({asarPath:ASAR,sha256:ARCHIVE});
  try{
   const sources=[];
   for(const member of ['webview/assets/app-initial-18b189e867e7.js','webview/assets/renderer-app-server-managers-a8b5f2800211.js','webview/assets/app-shared-601019a330d7.js']){
    const resource=await archive.acquireAsset(member);try{sources.push(resource.body.toString('utf8'))}finally{resource.release()}
   }
   const extract=(source,start,end)=>{assert.equal(source.split(start).length-1,1);const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(b>a);return source.slice(a,b)};
   return {Jh:extract(sources[0],'function Jh(','var Yh,act;'),tm:extract(sources[1],'function tm(','var nm'),rendererSha256:createHash('sha256').update(sources[1]).digest('hex'),
    hostsUsesOriginalSignal:sources[0].includes('Uh=ir(Q,()=>[Ln])'),sharedSha256:createHash('sha256').update(sources[2]).digest('hex'),
    signalRuntime:[extract(sources[2],'function CW(','function DW('),extract(sources[2],'function DW(','function pQe('),extract(sources[2],'function LQe(','var BW,'),extract(sources[2],'function D1e(','function O1e(')].join('\n')};
  }finally{await archive.close()}
 })();
}

// Only the RPC/atom boundaries are unit stand-ins. The code exercising them is
// the hash-pinned original Jh and tm, never a reimplementation of their logic.
// No model request, CLI, browser, network provider or real account is used.
function fixture(original,{ready=false,preexisting=false}={}){
 const values=new Map([[hostsAtom,preexisting?['local',HOST]:['local']]]),families=new Map(),watches=new Set();let hostReads=0;
 const scope={
  get(atom,key){if(atom===hostsAtom)hostReads++;if(key===undefined)return values.get(atom);return families.get(atom)?.get(key)??(atom===statusAtom?{status:'unavailable',client:null}:null)},
  set(atom,key,value){
   if(arguments.length===2){value=typeof key==='function'?key(values.get(atom)):key;values.set(atom,value)}
   else{let map=families.get(atom);if(!map)families.set(atom,map=new Map());map.set(key,value)}
   for(const watch of [...watches])if(watch.active&&watch.dependencies.has(atom))watch.run();
  },
  watch(callback){const record={active:true,dependencies:new Set(),run(){record.dependencies.clear();callback({get:(atom,key)=>{record.dependencies.add(atom);return scope.get(atom,key)}})}};watches.add(record);record.run();return()=>{record.active=false;watches.delete(record)}},
 };
 const admissions=[],subscribed=[],channels=new Map(),clients=[],accounts=[],requestCalls=[];
 const lease=()=>({onRpcBroken(){},[Symbol.dispose](){}});
 const pending=()=>{const resolved=lease();return{onRpcBroken(){},then(a,b){return Promise.resolve(resolved).then(a,b)},[Symbol.dispose](){}}};
 class NativeManagerRef{
  constructor(host){this.host=host;this.disposed=false;this.subscriptions=[];clients.push(this)}
  onRpcBroken(){}
  subscribe(message){this.subscriptions.push(message);return pending()}
  sendRequest(...args){requestCalls.push(args);throw Error('No native request is allowed in this registration test')}
  [Symbol.dispose](){this.disposed=true}
 }
 const native={
  dup(){return this},onRpcBroken(){},[Symbol.dispose](){},
  openAccount(host){const account={host,disposed:false,[Symbol.dispose](){this.disposed=true}};accounts.push(account);return account},
  subscribe(host,callback){subscribed.push(host);channels.set(host,callback);callback(host==='local'?{status:'ready',manager:{dup:()=>new NativeManagerRef(host)}}:{status:'loading'});return pending()},
 };
 const readyNative=()=>channels.get(HOST)?.({status:'ready',manager:{dup:()=>new NativeManagerRef(HOST)}});
 const gc=()=>({u:value=>value,d(){}}),deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});void promise.catch(()=>{});admissions.push(promise);return{promise,resolve,reject}};
 class DeferredProxy{constructor(getPromise){const rpc={dup(){return rpc},onRpcBroken(){},[Symbol.dispose](){}};getPromise();return()=>rpc}}
 const Jh=new Function('gc','Gh','Yh','Uh','act','Ds','Vr',original.Jh+';return Jh;')(gc,statusAtom,managerAtom,hostsAtom,deferredAtom,deferred,DeferredProxy);
 class Sampler{collectSnapshot(){throw Error('No snapshot requested')}recordDeltaBytes(){throw Error('No content events requested')}}
 const unused=()=>{throw Error('Unrelated native operation was invoked')};
 const tm=new Function('U','on','ko','nm','xu','Kp','js','vu','xt','Zn','$p','xs','Yp','zt','Y',original.tm+';return tm;')(hostsAtom,statusAtom,accountAtom,300,Sampler,()=>()=>{},unused,unused,{},()=>true,unused,unused,unused,{},unused);
 const manager=tm(scope,native);scope.set(managerAtom,manager);
 let token={},sourceReady=ready;const scopeListeners=new Set(),sourceListeners=new Set();
 const win={document:{addEventListener(){},removeEventListener(){}},crypto:{randomUUID},setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}};
 const nav=createBrowserSharedThreadNavigation({window:win,documentScope:{profileId:randomUUID(),generation:randomUUID(),viewId:randomUUID()},scopeLease:{getSnapshot:()=>token,isCurrent:value=>value!==null&&value===token,subscribe:fn=>{scopeListeners.add(fn);return()=>scopeListeners.delete(fn)}},sendMessage(){},isSourceReady:()=>sourceReady,subscribeSource:fn=>{sourceListeners.add(fn);return()=>sourceListeners.delete(fn)}},{createProbe:()=>({dispose(){}}),createRoot:()=>({value:{},active:true,restored:true})});
 return{scope,nav,manager,Jh,admissions,subscribed,clients,accounts,requestCalls,readyNative,
  source(value){sourceReady=value;for(const fn of [...sourceListeners])fn()},
  sameToken(){for(const fn of [...scopeListeners])fn()},
  newToken(){token={};for(const fn of [...scopeListeners])fn()},
  lateSourceCallbacks:()=>[...sourceListeners],hostReadCount:()=>hostReads,lastHostWatchCallback:()=>[...watches].filter(record=>record.dependencies.has(hostsAtom)).at(-1)?.run,
  dispose(){nav.dispose();manager.dispose()},
 };
}

test('pinned original Jh reproduces unavailable RPC when only the private menu source is ready',{skip:!ASAR&&'Requires the pinned original Mac archive'},async()=>{
 const original=await originalFunctions();assert.equal(original.rendererSha256,'a5d0be339b1c20927c5b59e92f5088fdf14a65bd3b9b92cedbe8f5cc20b8abe9');
 const f=fixture(original,{ready:true});try{
  const rpc=f.Jh(f.scope,HOST);assert.ok(rpc);assert.deepEqual(f.subscribed,['local']);
  await assert.rejects(f.admissions.at(-1),{message:'AppServerManager RPC is unavailable for hostId: '+HOST});
  assert.equal(f.requestCalls.length,0);
 }finally{f.dispose()}
});
test('verified host registration drives the original tm subscribe, original Jh RPC and exact revocation',{skip:!ASAR&&'Requires the pinned original Mac archive'},async()=>{
 const f=fixture(await originalFunctions());try{
  const release=f.nav.bindAppServerHosts?.(f.scope,hostsAtom)??(()=>{});
  assert.deepEqual(f.subscribed,['local']);
  f.source(true);
  // Before the fix this is the same original error seen by the real GUI.
  f.readyNative();const rpc=f.manager.forHost(HOST);
  assert.equal(f.subscribed.filter(host=>host===HOST).length,1);
  assert.equal(f.Jh(f.scope,HOST),rpc);assert.equal(rpc.host,HOST);
  assert.equal(rpc.subscriptions.length,2);assert.equal(f.requestCalls.length,0);
  const local=f.manager.forHost('local');assert.notEqual(rpc,local);
  f.source(false);assert.equal(rpc.disposed,true);assert.equal(local.disposed,false);
  assert.throws(()=>f.manager.forHost(HOST),{message:'AppServerManager RPC is unavailable for hostId: '+HOST});
  assert.deepEqual(f.scope.get(hostsAtom),['local']);release();
 }finally{f.dispose()}
});
test('retired same-token and released document callbacks cannot revive an original shared RPC client',{skip:!ASAR&&'Requires the pinned original Mac archive'},async()=>{
 const f=fixture(await originalFunctions(),{ready:true});try{
  const release=f.nav.bindAppServerHosts?.(f.scope,hostsAtom)??(()=>{});f.readyNative();const rpc=f.manager.forHost(HOST);
  f.sameToken();assert.equal(rpc.disposed,true);assert.deepEqual(f.scope.get(hostsAtom),['local']);
  f.source(true);assert.deepEqual(f.scope.get(hostsAtom),['local']);
  f.newToken();f.readyNative();const next=f.manager.forHost(HOST);assert.notEqual(next,rpc);
  const late=f.lateSourceCallbacks();release();for(const fn of late)fn();
  assert.deepEqual(f.scope.get(hostsAtom),['local']);assert.equal(next.disposed,true);assert.equal(f.requestCalls.length,0);
 }finally{f.dispose()}
});
test('a preexisting original shared host is not owned or removed by this document binding',{skip:!ASAR&&'Requires the pinned original Mac archive'},async()=>{
 const f=fixture(await originalFunctions(),{ready:true,preexisting:true});try{
  const release=f.nav.bindAppServerHosts?.(f.scope,hostsAtom)??(()=>{});release();f.source(false);
  assert.deepEqual(f.scope.get(hostsAtom),['local',HOST]);assert.equal(f.requestCalls.length,0);
 }finally{f.dispose()}
});

// Execute the shipped Jotai store and primitive signal writer separately from
// the tm RPC-boundary fixture above. Only the bundler's lazy initializer is a
// local boundary; store.set, D1e/LQe/DW and the fQe updater writer are original.
test('the pinned original Uh signal writer applies functional updates in the real original store',{skip:!ASAR&&'Requires the pinned original Mac archive'},async()=>{
 const original=await originalFunctions();assert.equal(original.hostsUsesOriginalSignal,true);
 assert.equal(original.sharedSha256,'02dd01d1e7c076ec44f10bb8446976f07be9eb007d1c32445adf5cda13221116');
 const lazy=fn=>{let done=false;return()=>{if(!done){done=true;fn()}}};
 const {store,atom}=new Function('t',"let hQe=0;"+original.signalRuntime+";uQe();let jG=DW(false);return {store:HZe(),atom:D1e(()=>['local'])};")(lazy);
 assert.deepEqual(store.get(atom),['local']);let calls=0;
 store.set(atom,hosts=>{calls++;assert.ok(Array.isArray(hosts));return [...hosts,HOST]});
 assert.equal(calls,1);assert.deepEqual(store.get(atom),['local',HOST]);
 store.set(atom,hosts=>hosts.filter(host=>host!==HOST));assert.deepEqual(store.get(atom),['local']);
});

test('later original Uh replacement is reconciled through original tm without reviving revoked or retired hosts',{skip:!ASAR&&'Requires the pinned original Mac archive'},async()=>{
 const f=fixture(await originalFunctions(),{ready:true});try{
  const release=f.nav.bindAppServerHosts(f.scope,hostsAtom);f.readyNative();const first=f.manager.forHost(HOST);
  assert.equal(f.subscribed.filter(host=>host===HOST).length,1);
  await Promise.resolve();f.scope.set(hostsAtom,['local','ssh:fixture-peer']);f.readyNative();
  const second=f.manager.forHost(HOST);assert.notEqual(second,first);assert.equal(first.disposed,true);
  assert.equal(f.subscribed.filter(host=>host===HOST).length,2);assert.deepEqual(f.scope.get(hostsAtom),['local','ssh:fixture-peer',HOST]);
  assert.equal(f.Jh(f.scope,HOST),second);assert.equal(second.disposed,false);assert.equal(f.requestCalls.length,0);
  f.source(false);assert.equal(second.disposed,true);await Promise.resolve();f.scope.set(hostsAtom,['local','ssh:next-fixture-peer']);
  assert.deepEqual(f.scope.get(hostsAtom),['local','ssh:next-fixture-peer']);assert.equal(f.subscribed.filter(host=>host===HOST).length,2);
  assert.throws(()=>f.manager.forHost(HOST),{message:'AppServerManager RPC is unavailable for hostId: '+HOST});
  f.source(true);f.readyNative();const third=f.manager.forHost(HOST);assert.equal(f.subscribed.filter(host=>host===HOST).length,3);
  f.sameToken();assert.equal(third.disposed,true);await Promise.resolve();f.scope.set(hostsAtom,['local','ssh:retired-fixture-peer']);f.source(true);
  assert.deepEqual(f.scope.get(hostsAtom),['local','ssh:retired-fixture-peer']);assert.equal(f.subscribed.filter(host=>host===HOST).length,3);
  const late=f.lastHostWatchCallback();assert.equal(typeof late,'function');release();const reads=f.hostReadCount();late();release();
  assert.equal(f.hostReadCount(),reads);assert.equal(f.subscribed.filter(host=>host===HOST).length,3);assert.equal(f.requestCalls.length,0);
 }finally{f.dispose()}
});
