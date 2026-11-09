import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chmod,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startOwnedSharedThreadAuthority} from '../src/owned-shared-thread-authority.mjs';
import * as accounts from '../src/container-shared-account-authority.mjs';
const sha=createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex');
const fingerprint=createHash('sha256').update(JSON.stringify(['shared-account-principal-v1','fixture-account','fixture-user'])).digest('hex');
const fixturePath=fileURLToPath(new URL('./owned-provider-ws-daemon.mjs',import.meta.url));
const denied={code:'SHARED_OWNED_AUTHORITY_UNAVAILABLE'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){const end=Date.now()+2000;while(!check()){if(Date.now()>end)throw Error('owned fixture deadline');await tick();}}
function kernelChecks(run){const original=fs.readFileSync;let count=0;try{fs.readFileSync=function(path,...args){const value=original.call(this,path,...args);if(String(path)==='/proc/net/unix')count++;return value;};syncBuiltinESMExports();return{value:run(),get count(){return count;}};}finally{fs.readFileSync=original;syncBuiltinESMExports();}}
async function provider(t,{profileId=randomUUID(),runtimeGeneration=randomUUID(),legacy=false}={}){
 const root=await mkdtemp(join(tmpdir(),'native-account-reader-'));await chmod(root,0o700);const home=join(root,'home'),cwd=join(root,'project');await mkdir(home,{mode:0o700});await mkdir(cwd,{mode:0o700});
 const seen=[],socketPath=join(root,'daemon.sock'),child=spawn(process.execPath,[fixturePath,'app-server',socketPath,home,cwd],{stdio:['ignore','ignore','pipe','ipc']});child.stderr.resume();child.on('message',message=>seen.push(message));await until(()=>seen.some(message=>message.ready));
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}await rm(root,{recursive:true,force:true});});
 const text=fs.readFileSync('/proc/'+child.pid+'/stat','utf8'),startTicks=text.slice(text.lastIndexOf(')')+2).trim().split(/\s+/)[19],daemon={pid:child.pid,startTicks,socketPath,daemonGeneration:randomUUID(),exeSha256:sha};
 const viewId=randomUUID(),view={viewId};let reader=()=>1,containerCurrent=true,onOwned=()=>{};
 const p=await startOwnedSharedThreadAuthority({daemon,codexHome:home,runtimeGeneration,...legacy?{}:{profileId},projects:[{projectId:'owned-project',cwd}],getOwnedView:id=>{onOwned();return id===viewId?view:null;},getAccountRevision:()=>reader(),verifyExecutionDomainSync:()=>true,timeoutMs:1500});t.after(()=>p.close());
 const createAccount=(scope={},observe=true)=>{
  const id=scope.profileId??profileId,generation=scope.generation??runtimeGeneration,observer=scope.daemon??p.daemon,account=accounts.createContainerSharedAccountAuthority({profileId:id,generation,daemon:observer,verifyContainerSync:()=>containerCurrent}),observationId=randomUUID();t.after(()=>account.close());
  if(observe)assert.equal(account.receive({v:1,type:'shared-account-observation',profileId:id,generation,revision:1,observationId,fingerprint,expiresAtMs:Date.now()+60000}),true);
  return account;
 };
 return{p,child,seen,profileId,runtimeGeneration,viewId,createAccount,useReader:value=>{reader=value;},container:value=>{containerCurrent=value;},onOwned:value=>{onOwned=value;}};
}

test('the exact original account reader avoids only the adjacent daemon check and still reads the kernel every time',async t=>{
 const f=await provider(t),account=f.createAccount();f.useReader(account.currentRevision);
 // The unmodified implementation has no attach path and performs two actual
 // kernel listener checks. The new branch must reduce that real duplication.
 if(typeof f.p.attachNativeAccountRevisionReader==='function')assert.equal(f.p.attachNativeAccountRevisionReader(account.currentRevision),true);
 for(let n=0;n<4;n++){const result=kernelChecks(()=>f.p.sharedThread.verifyReadSync({}));assert.equal(result.value,true);assert.equal(result.count,1,'each call must freshly check the exact native account/daemon once');}
 assert.equal(Object.isFrozen(account.currentRevision),true);
 let replies=0;f.p.daemon.attachGateReceiver(()=>{replies++;return true;});
 const write=kernelChecks(()=>f.p.sharedThread.write(JSON.stringify({id:'owned-check-write',method:'configRequirements/read'})));assert.equal(write.count,3,'provider current, observer write gate and actual send all retain their identity checks');await until(()=>replies===1);
 assert.equal(f.seen.some(frame=>['thread/start','thread/resume','turn/start'].includes(frame.method)),false);
});

test('wrappers, proxies, same revision, other profiles, generations and daemons cannot attach a reader',async t=>{
 const f=await provider(t),a=f.createAccount(),other=await provider(t,{profileId:f.profileId,runtimeGeneration:f.runtimeGeneration});
 const crossProfile=f.createAccount({profileId:randomUUID()}),crossGeneration=f.createAccount({generation:randomUUID()}),crossDaemon=f.createAccount({daemon:other.p.daemon});
 assert.equal(typeof f.p.attachNativeAccountRevisionReader,'function');
 for(const reader of [()=>1,()=>a.currentRevision(),a.currentRevision.bind(null),new Proxy(a.currentRevision,{}),Object.assign(()=>1,{isNativeSharedAccountRevisionReader:true}),crossProfile.currentRevision,crossGeneration.currentRevision,crossDaemon.currentRevision]){
  assert.equal(accounts.isNativeSharedAccountRevisionReader(reader,f.p.daemon,f.runtimeGeneration,f.profileId),false);assert.throws(()=>f.p.attachNativeAccountRevisionReader(reader),denied);
 }
 assert.equal(accounts.isNativeSharedAccountRevisionReader(a.currentRevision,f.p.daemon,f.runtimeGeneration,f.profileId),true);assert.equal(f.p.attachNativeAccountRevisionReader(a.currentRevision),true);assert.throws(()=>f.p.attachNativeAccountRevisionReader(a.currentRevision),denied);
 const legacy=await provider(t,{legacy:true}),legacyAccount=legacy.createAccount();assert.throws(()=>legacy.p.attachNativeAccountRevisionReader(legacyAccount.currentRevision),denied);legacy.useReader(legacyAccount.currentRevision);assert.equal(kernelChecks(()=>legacy.p.sharedThread.verifyReadSync({})).count,2,'missing expected profile keeps the original independent checks');
});

test('origin brands cannot authorize an unobserved or closed account and do not survive a same-value native account notification',async t=>{
 const unobserved=await provider(t),empty=unobserved.createAccount({},false);assert.equal(unobserved.p.attachNativeAccountRevisionReader(empty.currentRevision),true);assert.equal(unobserved.p.sharedThread.verifyReadSync({}),false);
 const f=await provider(t),a=f.createAccount();assert.equal(f.p.attachNativeAccountRevisionReader(a.currentRevision),true);assert.equal(f.p.sharedThread.verifyReadSync({}),true);a.close();assert.equal(f.p.sharedThread.verifyReadSync({}),false);assert.throws(()=>f.p.sharedThread.write('{}'),denied);assert.equal(accounts.isNativeSharedAccountRevisionReader(a.currentRevision,f.p.daemon,f.runtimeGeneration,f.profileId),true);
 const changed=await provider(t),account=changed.createAccount();changed.p.attachNativeAccountRevisionReader(account.currentRevision);assert.equal(changed.p.sharedThread.verifyReadSync({}),true);const revoked=new Promise(resolve=>changed.p.daemon.signal.addEventListener('abort',resolve,{once:true}));changed.child.send({type:'revoke'});await revoked;assert.equal(changed.p.sharedThread.verifyReadSync({}),false);assert.throws(()=>changed.p.sharedThread.write('{}'),denied);
});

test('an await or later write cannot reuse a previously valid native account result',async t=>{
 const f=await provider(t),a=f.createAccount();f.p.attachNativeAccountRevisionReader(a.currentRevision);let armed=true;f.onOwned(()=>{if(armed){armed=false;queueMicrotask(()=>a.close());}});
 await assert.rejects(f.p.sharedThread.resolveBinding({viewId:f.viewId,hostId:'kanban-shared-cli',threadId:randomUUID()}),denied);assert.equal(f.p.sharedThread.verifyReadSync({}),false);
 const beforeWrite=await provider(t),account=beforeWrite.createAccount();beforeWrite.p.attachNativeAccountRevisionReader(account.currentRevision);assert.equal(beforeWrite.p.sharedThread.verifyReadSync({}),true);beforeWrite.container(false);assert.throws(()=>beforeWrite.p.sharedThread.write(JSON.stringify({id:'must-not-write',method:'configRequirements/read'})),denied);await tick();assert.equal(beforeWrite.seen.some(frame=>frame.method==='configRequirements/read'),false);beforeWrite.container(true);assert.equal(beforeWrite.p.sharedThread.verifyReadSync({}),false,'an observed retirement remains revoked');
});
