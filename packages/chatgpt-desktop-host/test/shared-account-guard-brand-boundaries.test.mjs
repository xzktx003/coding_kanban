import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chmod,mkdtemp,rm} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as observers from '../src/shared-daemon-observer.mjs';
import {createContainerSharedAccountAuthority,createAccountBoundSharedAuthority} from '../src/container-shared-account-authority.mjs';

const sha=createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex');
const fixturePath=fileURLToPath(new URL('./owned-ws-daemon.mjs',import.meta.url));
const fingerprint=createHash('sha256').update(JSON.stringify(['shared-account-principal-v1','fixture-account','fixture-user'])).digest('hex');
function ticks(pid){const text=fs.readFileSync('/proc/'+pid+'/stat','utf8');return text.slice(text.lastIndexOf(')')+2).trim().split(/\s+/)[19];}
async function ownObserver(t){
 const dir=await mkdtemp(join(tmpdir(),'shared-account-brand-'));await chmod(dir,0o700);
 const socketPath=join(dir,'daemon.sock'),seen=[];
 const child=spawn(process.execPath,[fixturePath,'app-server',socketPath,dir,'normal'],{stdio:['ignore','ignore','pipe','ipc']});child.stderr.resume();child.on('message',message=>seen.push(message));
 let timer;try{await Promise.race([new Promise((resolve,reject)=>{child.on('message',message=>{if(message.ready)resolve();});child.once('error',reject);child.once('exit',()=>reject(Error('owned protocol fixture exited')));}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('owned protocol fixture readiness timeout')),3000);})]);}finally{clearTimeout(timer);}
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}await rm(dir,{recursive:true,force:true});});
 const observer=await observers.startSharedDaemonObserver({daemon:{pid:child.pid,startTicks:ticks(child.pid),socketPath,daemonGeneration:randomUUID(),exeSha256:sha},codexHome:dir,timeoutMs:1500});t.after(()=>observer.close());
 return{child,observer,seen};
}
function accountFor(t,daemon,verifyContainerSync=()=>true){
 const profileId=randomUUID(),generation=randomUUID(),account=createContainerSharedAccountAuthority({profileId,generation,verifyContainerSync,daemon});t.after(()=>account.close());
 assert.equal(account.receive({v:1,type:'shared-account-observation',profileId,generation,revision:1,observationId:randomUUID(),fingerprint,expiresAtMs:Date.now()+60000}),true);
 return account;
}
function kernelChecks(run){
 const original=fs.readFileSync;let count=0;
 try{
  // Observe real kernel-table reads; do not mock process identity, replies or
  // credentials. Production observer and account factories execute unchanged.
  fs.readFileSync=function(path,...args){const result=original.call(this,path,...args);if(String(path)==='/proc/net/unix')count++;return result;};syncBuiltinESMExports();
  const value=run();return{value,count};
 }finally{fs.readFileSync=original;syncBuiltinESMExports();}
}
function delegate(overrides={}){return{resolveBinding:async()=>({accountRevision:1}),verifyViewSync:()=>true,verifyBindingSync:()=>true,verifyHistorySync:()=>true,verifyReadSync:()=>true,write:()=>true,...overrides};}

test('only actual frozen observer and account brands merge adjacent checks without skipping the post-delegate or write checks',async t=>{
 const f=await ownObserver(t),account=accountFor(t,f.observer);
 const revision=kernelChecks(()=>account.currentRevision());assert.equal(revision.value,1);assert.equal(revision.count,1,'actual matchesFingerprint already performs the required daemon identity check');
 assert.equal(Object.isFrozen(f.observer),true);assert.equal(observers.isSharedDaemonObserver(f.observer),true);
 let writes=0;const guarded=createAccountBoundSharedAuthority({account,sharedThread:delegate({write(){writes++;return 'written';}})});
 const read=kernelChecks(()=>guarded.verifyReadSync({}));assert.equal(read.value,true);assert.equal(read.count,2,'one current check and a separate post-delegate recheck remain');
 const write=kernelChecks(()=>guarded.write('owned encoded command'));assert.equal(write.value,'written');assert.equal(write.count,2,'the actual write retains its final revision recheck');assert.equal(writes,1);
 for(const fake of [Object.freeze({...f.observer}),new Proxy(f.observer,{}),Object.freeze({isSharedDaemonObserver:true,...f.observer})]){
  assert.equal(observers.isSharedDaemonObserver(fake),false,'same fields, functions or a proxy cannot mint the observer brand');
  const copied=accountFor(t,fake),check=kernelChecks(()=>copied.currentRevision());assert.equal(check.value,1);assert.equal(check.count,2,'unbranded observers keep both generic checks');
 }
 for(const copied of [Object.freeze({...account}),new Proxy(account,{})]){
  const unbranded=createAccountBoundSharedAuthority({account:copied,sharedThread:delegate()}),read=kernelChecks(()=>unbranded.verifyReadSync({}));assert.equal(read.value,true);assert.equal(read.count,3,'a copied account cannot skip its generic adjacent revision check');
 }
 assert.equal(f.seen.some(frame=>['thread/start','thread/resume','turn/start'].includes(frame.method)),false);
});

test('actual branded account rechecks reject delegate revocation, throws and late asynchronous binding',async t=>{
 const f=await ownObserver(t);
 for(const mode of ['close','throw']){
  const account=accountFor(t,f.observer);let called=0;
  const guarded=createAccountBoundSharedAuthority({account,sharedThread:delegate({verifyReadSync(){called++;if(mode==='close')account.close();else throw Error('owned delegate rejected');return true;}})});
  assert.equal(guarded.verifyReadSync({}),false);assert.equal(called,1);
 }
 const account=accountFor(t,f.observer);let finish;
 const guarded=createAccountBoundSharedAuthority({account,sharedThread:delegate({resolveBinding:()=>new Promise(resolve=>{finish=resolve;})})});
 const binding=guarded.resolveBinding({});account.close();finish({accountRevision:1});await assert.rejects(binding,{code:'CONTAINER_SHARED_ACCOUNT_UNAVAILABLE'});
});

test('actual branded account cannot turn a successful current read into an unchecked write',async t=>{
 const f=await ownObserver(t);let containerChecks=0,containerCurrent=true,writes=0;
 const account=accountFor(t,f.observer,()=>{containerChecks++;const result=containerCurrent;if(containerChecks===1)containerCurrent=false;return result;});
 // receive performs one container check; arrange the transition strictly
 // between this write's initial current read and final revision check.
 containerChecks=0;containerCurrent=true;
 const guarded=createAccountBoundSharedAuthority({account,sharedThread:delegate({write(){writes++;}})});
 assert.throws(()=>guarded.write('must not reach the writer'),{code:'CONTAINER_SHARED_ACCOUNT_UNAVAILABLE'});assert.equal(writes,0);assert.equal(containerChecks,2);
 containerCurrent=true;assert.throws(()=>guarded.write('must stay revoked'),{code:'CONTAINER_SHARED_ACCOUNT_UNAVAILABLE'});assert.equal(writes,0);
});

test('a same-value native account notification revokes the actual observer and all account wrappers',async t=>{
 const f=await ownObserver(t),account=accountFor(t,f.observer),guarded=createAccountBoundSharedAuthority({account,sharedThread:delegate()});assert.equal(guarded.verifyReadSync({}),true);
 const revoked=new Promise(resolve=>f.observer.signal.addEventListener('abort',resolve,{once:true}));f.child.send({type:'revoke'});await revoked;
 assert.equal(account.currentRevision(),null);assert.equal(guarded.verifyReadSync({}),false);assert.throws(()=>guarded.write('revoked'),{code:'CONTAINER_SHARED_ACCOUNT_UNAVAILABLE'});assert.equal(observers.isSharedDaemonObserver(f.observer),true,'brand denotes origin, never current authorization');
 assert.equal(f.seen.some(frame=>['thread/start','thread/resume','turn/start'].includes(frame.method)),false);
});
