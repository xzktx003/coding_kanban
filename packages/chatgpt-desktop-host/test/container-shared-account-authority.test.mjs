import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createContainerSharedAccountAuthority} from '../src/container-shared-account-authority.mjs';
const setup=()=>{
 const profileId=randomUUID(),generation=randomUUID(),observationId=randomUUID(),fingerprint='a'.repeat(64), signal=new AbortController();let valid=true, matches=true;
 const daemon={signal:signal.signal,expiresAtMs:Date.now()+60000,assertCurrent:()=>{if(!valid)throw Error('identity');},matchesFingerprint:value=>matches&&value===fingerprint};
 const authority=createContainerSharedAccountAuthority({profileId,generation,verifyContainerSync:()=>valid,daemon});
 const frame={v:1,type:'shared-account-observation',profileId,generation,revision:1,observationId,fingerprint,expiresAtMs:Date.now()+60000};
 return {authority,frame,daemon,stop:()=>{valid=false},mismatch:()=>{matches=false},signal};
};
test('only owned matching actual desktop and daemon observations authorize a current account revision',()=>{
 const f=setup();assert.equal(f.authority.currentRevision(),null);assert.equal(f.authority.receive(f.frame),true);assert.equal(f.authority.currentRevision(),1);assert.equal(f.authority.verifyRevisionSync(1),true);
 assert.equal(f.authority.receive({v:1,type:'shared-account-revoked',profileId:f.frame.profileId,generation:f.frame.generation,revision:2,observationId:f.frame.observationId}),true);
 assert.equal(f.authority.verifyRevisionSync(1),false);assert.equal(f.authority.receive(f.frame),false);f.authority.close();
});
test('cross-scope, duplicate, expired, changed daemon and mismatched identity fail closed',()=>{
 const f=setup();assert.equal(f.authority.receive({...f.frame,profileId:randomUUID()}),false);assert.equal(f.authority.receive({...f.frame,expiresAtMs:Date.now()-1}),true);assert.equal(f.authority.verifyRevisionSync(1),false);
 assert.equal(f.authority.receive({v:1,type:'shared-account-revoked',profileId:f.frame.profileId,generation:f.frame.generation,revision:2,observationId:f.frame.observationId}),true);
 const next={...f.frame,revision:3,observationId:randomUUID(),expiresAtMs:Date.now()+60000};f.mismatch();assert.equal(f.authority.receive(next),true);assert.equal(f.authority.currentRevision(),null);
 f.stop();assert.equal(f.authority.receive({...next,revision:4,observationId:randomUUID()}),false);f.authority.close();
});
test('an unverified native or daemon identity never silently becomes valid again',()=>{
 let live=true,daemonOK=true;
 const profileId=randomUUID(),generation=randomUUID(),observationId=randomUUID(),signal=new AbortController();
 const daemon={signal:signal.signal,expiresAtMs:Date.now()+60000,assertCurrent:()=>{if(!daemonOK)throw Error('missing')},matchesFingerprint:()=>true};
 const authority=createContainerSharedAccountAuthority({profileId,generation,verifyContainerSync:()=>live,daemon});
 const frame={v:1,type:'shared-account-observation',profileId,generation,revision:1,observationId,fingerprint:'b'.repeat(64),expiresAtMs:Date.now()+60000};
 assert.equal(authority.receive(frame),true);assert.equal(authority.verifyRevisionSync(1),true);live=false;assert.equal(authority.verifyRevisionSync(1),false);live=true;assert.equal(authority.verifyRevisionSync(1),false);authority.close();
});
test('shared thread authority must bind and recheck the observed desktop revision immediately before actual writes',async()=>{
 const {createAccountBoundSharedAuthority}=await import('../src/container-shared-account-authority.mjs');
 let revision=3,writes=0;
 const account={currentRevision:()=>revision,verifyRevisionSync:value=>value===revision&&revision!==null};
 const base={resolveBinding:async()=>({accountRevision:3}),verifyViewSync:()=>true,verifyBindingSync:()=>true,verifyHistorySync:()=>true,verifyReadSync:()=>true,write:()=>{writes++}};
 const guarded=createAccountBoundSharedAuthority({account,sharedThread:base});
 assert.equal((await guarded.resolveBinding({})).accountRevision,3);assert.equal(guarded.verifyBindingSync({accountRevision:3}),true);guarded.write('encoded');assert.equal(writes,1);
 revision=null;assert.equal(guarded.verifyBindingSync({accountRevision:3}),false);assert.equal(guarded.verifyReadSync({}),false);assert.throws(()=>guarded.write('encoded'));assert.equal(writes,1);
});
test('account change during the asynchronous history binding cannot authorize the old revision',async()=>{
 const {createAccountBoundSharedAuthority}=await import('../src/container-shared-account-authority.mjs');let revision=3,finish;
 const account={currentRevision:()=>revision,verifyRevisionSync:value=>value===revision};
 const base={resolveBinding:()=>new Promise(resolve=>{finish=resolve}),verifyViewSync:()=>true,verifyBindingSync:()=>true,verifyHistorySync:()=>true,verifyReadSync:()=>true,write:()=>{}};
 const guarded=createAccountBoundSharedAuthority({account,sharedThread:base}),result=guarded.resolveBinding({});revision=4;finish({accountRevision:3});await assert.rejects(result);
});
