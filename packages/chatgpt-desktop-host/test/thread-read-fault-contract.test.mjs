import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdtemp,chmod,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createThreadSourceRegistry} from '../src/thread-source-registry.mjs';
import {startSharedDaemonObserver} from '../src/shared-daemon-observer.mjs';
const require=createRequire(import.meta.url);
const {createNativeDesktopAccountObserver}=require('../src/native-desktop-account-observer.cjs');
const {createHostDirectoryIpc,createNativeDirectoryIpc}=require('../src/shared-directory-ipc.cjs');
const VERSION='0.166.0-alpha.5.1',id='11111111-1111-4111-8111-111111111111';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
// Exact original nx(requestId,error) shape: jsonRpcCode, own undefined data.
function nativeError(code,message,data){return Object.assign(Error(message),{jsonRpcCode:code,data});}
function missing(threadId=id){return nativeError(-32600,`thread not loaded: ${threadId}`);}
async function native(t,optionsIn={}){
 const {version=VERSION,read=async()=>{throw missing()}}=optionsIn;
 const proof=Object.hasOwn(optionsIn,'proof')?optionsIn.proof:true;
 const profileId=randomUUID(),generation=randomUUID(),frames=[];
 const principal={accountId:'fixture',userId:'fixture-user',expiresAtMs:Date.now()+60000};
 let notification,verify=proof;
 const connection={initializedAppServerVersion:version,backendAuth:{hasPendingAccountChange:false},
  getConnectionState:()=> 'connected',getAccount:async()=>({requiresOpenaiAuth:true,account:{type:'chatgpt'}}),
  getRequestAuthenticatedPrincipal:async()=>principal,getCachedAuthenticatedPrincipal:()=>principal,
  registerInternalNotificationHandler:fn=>(notification=fn,()=>{}),
  registerInternalAuthenticatedPrincipalChangeHandler:()=>()=>{},registerInternalConnectionStateHandler:()=>()=>{},
  readThread:read,listThreads:async()=>({data:[],nextCursor:null})};
 const options={profileId,generation,verifyRuntimeSync:()=>true,sendFrame:frame=>frames.push(frame)};
 if(proof!==undefined)options.verifyThreadReadCliIdentitySync=c=>c===connection&&verify===true;
 const observer=createNativeDesktopAccountObserver(options);t.after(()=>observer.dispose());
 observer.attach({connection,disposed:false,isCurrent:()=>true});await tick();
 return {observer,connection,profileId,generation,frames,signal:new AbortController().signal,
  revoke:()=>notification({method:'account/updated',params:{}}),setProof:value=>{verify=value}};
}
const read=(f)=>f.observer.executeDirectory('thread/read',{threadId:id,includeTurns:false},{signal:f.signal});
test('only pinned original SDK missing error becomes a metadata absence',async t=>{
 const f=await native(t);assert.equal(await read(f),null);
});
for(const [name,options] of [
 ['unknown version',{version:'0.166.0'}],['wrong binary proof',{proof:false}],['missing binary proof',{proof:undefined}],
 ['wrong requested UUID',{read:async()=>{throw missing(randomUUID())}}],
 ['extra whitespace',{read:async()=>{throw nativeError(-32600,`thread not loaded: ${id} `)}}],
 ['same code other message',{read:async()=>{throw nativeError(-32600,'invalid thread id')}}],
 ['unexpected data',{read:async()=>{throw nativeError(-32600,`thread not loaded: ${id}`,null)}}],
 ['wrong code property',{read:async()=>{throw Object.assign(Error(`thread not loaded: ${id}`),{code:-32600})}}],
 ['permission',{read:async()=>{throw nativeError(-32603,'failed to read /private/account/secret: Permission denied')}}],
 ['corrupt JSON',{read:async()=>{throw nativeError(-32603,'failed to read /private/account/secret: rollout is empty')}}],
])test(`native metadata ${name} remains unknown, never absence`,async t=>{
 const f=await native(t,options);
 await assert.rejects(read(f),error=>error.code==='SHARED_ACCOUNT_OBSERVATION_UNAVAILABLE'&&!error.message.includes('/private/'));
});
test('known missing cannot cross an account revocation while awaiting the reply',async t=>{
 let rejectRead;const f=await native(t,{read:()=>new Promise((_,reject)=>{rejectRead=reject})});
 const pending=read(f);f.revoke();rejectRead(missing());
 await assert.rejects(pending,{code:'SHARED_ACCOUNT_OBSERVATION_UNAVAILABLE'});
});
test('binary proof is checked after a missing reply as well as before it',async t=>{
 let rejectRead;const f=await native(t,{read:()=>new Promise((_,reject)=>{rejectRead=reject})});
 const pending=read(f);f.setProof(false);rejectRead(missing());await assert.rejects(pending);
});
async function directory(t,f){
 const sent=[];let host,native;
 const send=(side,frame)=>{sent.push(frame);queueMicrotask(()=>side==='host'?native.receive(frame):host.receive(frame));};
 host=createHostDirectoryIpc({profileId:f.profileId,generation:f.generation,verifyCurrentSync:()=>f.observer.verifyCurrentSync(),sendFrame:frame=>send('host',frame)});
 native=createNativeDirectoryIpc({profileId:f.profileId,generation:f.generation,verifyCurrentSync:()=>f.observer.verifyCurrentSync(),sendFrame:frame=>send('native',frame),execute:(...args)=>f.observer.executeDirectory(...args)});
 t.after(()=>{host.close();native.close()});return {host,native,sent};
}
const source=(generation,list,read)=>({generation,getAccountRevision:()=>1,verifySync:()=>true,list,read});
async function registry(t,foreignRead){
 const view={},ownRow={id,cwd:'/fixture/project'};
 const local=source(randomUUID(),async()=>({data:[],nextCursor:null}),foreignRead);
 const selected=source(randomUUID(),async()=>({data:[ownRow],nextCursor:null}),async()=>({thread:ownRow}));
 const registry=createThreadSourceRegistry({privateSource:local,daemonSource:selected,verifyViewSync:v=>v===view});t.after(()=>registry.close());
 const page=await registry.listDaemon({}),[token]=registry.issuePageTokens(view,page);
 return {registry,resolve:()=>registry.resolveFromPage(view,token.token,id)};
}
test('confirmed absence survives bounded private IPC and allows a page-bound resolution',async t=>{
 const f=await native(t),ipc=await directory(t,f),r=await registry(t,threadId=>ipc.host.fetch('thread/read',{threadId,includeTurns:false}));
 const resolved=await r.resolve();assert.equal(resolved.executionDomain,'daemon');assert.equal(r.registry.verifyResolvedSync(resolved),true);
 assert.ok(ipc.sent.some(frame=>frame.type==='shared-directory-chunk'&&Buffer.from(frame.data,'base64').toString()==='null'));
});
for(const message of ['failed to read /private/secret: Permission denied','failed to read /private/secret: invalid JSON'])test(`private source failure is not absence: ${message.split(': ').at(-1)}`,async t=>{
 const original=nativeError(-32603,message),f=await native(t,{read:async()=>{throw original}}),ipc=await directory(t,f);
 const r=await registry(t,threadId=>ipc.host.fetch('thread/read',{threadId,includeTurns:false}));
 await assert.rejects(r.resolve(),{code:'THREAD_SOURCE_UNAVAILABLE'});
 assert.ok(!JSON.stringify(ipc.sent).includes('/private/secret'));
 assert.equal(ipc.native.getFirstReadFailure().cause,original);
});
test('selected read failure cannot use a list fallback or hide its private first cause',async t=>{
 const view={},row={id,cwd:'/fixture/project'},original=Error('/private/secret invalid JSON');let lists=0;
 const selected=source(randomUUID(),async()=>{lists++;return {data:[row],nextCursor:null}},async()=>{throw original});
 const empty=source(randomUUID(),async()=>({data:[],nextCursor:null}),async()=>null);
 const registry=createThreadSourceRegistry({privateSource:empty,daemonSource:selected,verifyViewSync:v=>v===view});t.after(()=>registry.close());
 const page=await registry.listDaemon({}),[token]=registry.issuePageTokens(view,page);
 await assert.rejects(registry.resolveFromPage(view,token.token,id),error=>error.code==='THREAD_SOURCE_UNAVAILABLE'&&error.cause===original&&!error.message.includes('/private/secret'));
 assert.equal(lists,1);
});
test('an unlisted duplicate in the opposite domain cannot resolve through a page token',async t=>{
 const r=await registry(t,async()=>({thread:{id,cwd:'/another'}}));await assert.rejects(r.resolve(),{code:'THREAD_SOURCE_AMBIGUOUS'});
});
for(const mode of ['missing','permission'])test(`owned Unix WS peer preserves ${mode} error; synthetic binary cannot satisfy original CLI pin`,async t=>{
 const dir=await mkdtemp(join(tmpdir(),'thread-read-contract-'));await chmod(dir,0o700);
 const socketPath=join(dir,'daemon.sock'),fixture=fileURLToPath(new URL('./thread-read-faults-ws-daemon.mjs',import.meta.url));
 const child=spawn(process.execPath,[fixture,'app-server',socketPath,dir,mode],{env:{PATH:process.env.PATH,HOME:dir},stdio:['ignore','ignore','pipe','ipc']});let stderr='';child.stderr.on('data',data=>{stderr+=String(data).slice(0,4096-stderr.length)});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}await rm(dir,{recursive:true,force:true});});
 let timer;await Promise.race([new Promise((resolve,reject)=>{child.on('message',frame=>{if(frame.ready)resolve()});child.once('error',reject);child.once('exit',()=>reject(Error(stderr||'peer exited')))}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('peer timeout '+stderr)),3000)})]).finally(()=>clearTimeout(timer));
 const stat=readFileSync(`/proc/${child.pid}/stat`,'utf8'),startTicks=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)[19];
 const daemon={pid:child.pid,startTicks,socketPath,daemonGeneration:randomUUID(),exeSha256:createHash('sha256').update(readFileSync(process.execPath)).digest('hex')};
 const observer=await startSharedDaemonObserver({daemon,codexHome:dir,timeoutMs:1000});t.after(()=>observer.close());
 // A caller mutating an old registration cannot impersonate the pinned CLI.
 daemon.exeSha256='6253fb59fc4c21a9134b2f73237650eaec4a3d9380e5af12f3f1e9040dc24c14';
 await assert.rejects(observer.readThreadMetadata(id),error=>error.code==='SHARED_DAEMON_RPC_FAILED'&&error.cause?.code===(mode==='missing'?-32600:-32603)&&!error.message.includes('/private/secret'));
 await assert.rejects(observer.readThread(id),{code:'SHARED_DAEMON_RPC_FAILED'});
});
