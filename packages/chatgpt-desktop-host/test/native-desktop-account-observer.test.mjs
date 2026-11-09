import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createNativeDesktopAccountObserver}=require('../src/native-desktop-account-observer.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
  const profileId=randomUUID(), generation=randomUUID(), sent=[], calls=[];
  let notifications,principals,states, connected='connected';
  let principal={accountId:'workspace-1',userId:'user-1',expiresAtMs:Date.now()+60000};
  let account={account:{type:'chatgpt',email:'must-not-leak@example.invalid',planType:'pro'},requiresOpenaiAuth:true,workspaceRouting:{chatgptAccountId:'workspace-1'}};
  const connection={
    backendAuth:{hasPendingAccountChange:false},
    getConnectionState:()=>connected,
    getAccount:async()=>{calls.push('account/read');return account;},
    getRequestAuthenticatedPrincipal:async()=>{calls.push('principal');return principal;},
    getCachedAuthenticatedPrincipal:()=>principal,
    registerInternalNotificationHandler:fn=>(notifications=fn,()=>{notifications=null;}),
    registerInternalAuthenticatedPrincipalChangeHandler:fn=>(principals=fn,()=>{principals=null;}),
    registerInternalConnectionStateHandler:fn=>(states=fn,()=>{states=null;}),
  };
  const owner={connection,isCurrent:()=>true,disposed:false};
  const observer=createNativeDesktopAccountObserver({profileId,generation,verifyRuntimeSync:()=>true,sendFrame:x=>sent.push(x)});
  return {observer,owner,connection,sent,calls,accountUpdate:()=>notifications({method:'account/updated',params:{authMode:'chatgpt'}}),principalUpdate:()=>principals({current:principal}),disconnect:()=>{connected='disconnected';states(connected);},setAccount:value=>{account=value},setPrincipal:value=>{principal=value}};
}
test('observes the owned real connection account/read and principal without exposing account data',async()=>{
 const f=fixture();f.observer.attach(f.owner);await tick();
 assert.deepEqual(f.calls,['account/read','principal','account/read']);
 assert.equal(f.sent.length,1);const observed=f.sent[0];
 assert.equal(observed.type,'shared-account-observation');
 assert.equal(observed.fingerprint,createHash('sha256').update(JSON.stringify(['shared-account-principal-v1','workspace-1','user-1'])).digest('hex'));
 assert.ok(!JSON.stringify(observed).includes('must-not-leak'));
 assert.ok(!JSON.stringify(observed).includes('workspace-1'));
 assert.ok(!JSON.stringify(observed).includes('user-1'));
 f.observer.dispose();assert.equal(f.sent.at(-1).type,'shared-account-revoked');
});
test('same-value changes revoke immediately, then fresh actual reads establish a new observation',async()=>{
 const f=fixture();f.observer.attach(f.owner);await tick();const first=f.sent[0];
 f.accountUpdate();assert.equal(f.sent.at(-1).type,'shared-account-revoked');
 assert.equal(f.sent.at(-1).observationId,first.observationId);
 await tick();const second=f.sent.at(-1);assert.equal(second.type,'shared-account-observation');assert.notEqual(second.observationId,first.observationId);assert.ok(second.revision>first.revision);
 f.principalUpdate();assert.equal(f.sent.at(-1).type,'shared-account-revoked');
 f.disconnect();await tick();assert.equal(f.sent.at(-1).type,'shared-account-revoked');f.observer.dispose();
});
test('workspace mismatch or missing principal cannot produce authority',async()=>{
 const f=fixture();f.setAccount({account:{type:'chatgpt'},requiresOpenaiAuth:true,workspaceRouting:{chatgptAccountId:'different-workspace'}});f.observer.attach(f.owner);await tick();assert.equal(f.sent.length,0);
 f.setAccount({account:{type:'chatgpt'},requiresOpenaiAuth:true});f.setPrincipal({accountId:'workspace-1'});f.accountUpdate();await tick();assert.equal(f.sent.length,0);f.observer.dispose();
});
test('account notifications during either read prevent a stale result being emitted',async()=>{
 const f=fixture();let resolve;f.connection.getAccount=()=>new Promise(r=>{resolve=r});f.observer.attach(f.owner);await tick();f.accountUpdate();f.disconnect();resolve({account:{type:'chatgpt'},requiresOpenaiAuth:true});await tick();assert.deepEqual(f.sent,[]);f.observer.dispose();
});
test('a silently retired owner or changed cached principal invalidates on guarded access',async()=>{
 const f=fixture();f.observer.attach(f.owner);await tick();assert.equal(f.observer.verifyCurrentSync(),true);
 f.setPrincipal({accountId:'workspace-1',userId:'other-user',expiresAtMs:Date.now()+60000});
 assert.equal(f.observer.verifyCurrentSync(),false);assert.equal(f.sent.at(-1).type,'shared-account-revoked');f.observer.dispose();
});
test('partial listener registration is cleaned if another original listener is unavailable',async()=>{
 const f=fixture();let released=0;f.connection.registerInternalNotificationHandler=()=>()=>{released++};f.connection.registerInternalAuthenticatedPrincipalChangeHandler=()=>{throw Error('closed')};
 f.observer.attach(f.owner);await tick();assert.equal(released,1);assert.deepEqual(f.sent,[]);f.observer.dispose();
});
test('native authority wire accepts only strict owner-scoped account observations and revocations',()=>{
 const {isSharedThreadAuthorityFrame}=require('../src/shared-thread-authority-wire.cjs');
 const profileId=randomUUID(),generation=randomUUID(),observationId=randomUUID();
 const options={side:'native',profileId,generation};
 const frame={v:1,type:'shared-account-observation',profileId,generation,revision:1,observationId,fingerprint:'a'.repeat(64),expiresAtMs:Date.now()+60000};
 assert.equal(isSharedThreadAuthorityFrame(frame,options),true);
 assert.equal(isSharedThreadAuthorityFrame({...frame,email:'bad@example.invalid'},options),false);
 assert.equal(isSharedThreadAuthorityFrame({...frame,fingerprint:'x'},options),false);
 assert.equal(isSharedThreadAuthorityFrame({...frame,profileId:randomUUID()},options),false);
 assert.equal(isSharedThreadAuthorityFrame({v:1,type:'shared-account-revoked',profileId,generation,revision:2,observationId},options),true);
});
test('opt-in native integration observes the actual connection passed by the original host event binding',async()=>{
 const {createNativeSharedThreadIntegration}=require('../src/native-shared-thread-integration.cjs');
 const f=fixture(),sent=[],profileId=randomUUID(),generation=randomUUID();let originalHandlers, released=0;
 f.connection.registerHostEventHandler=handlers=>(originalHandlers=handlers,()=>{released++});
 const native=createNativeSharedThreadIntegration({profileId,generation,getRecord:()=>null,getOwnedRecord:()=>null,verifyRuntimeSync:()=>true,sendToView:()=>{},sendFrame:frame=>sent.push(frame),desktopAccountObservation:true});
 const handlers={onNotification(){},onRequest(){return true}};
 const release=native.registerHostEvents(f.owner,{getHostId:()=>"local"},handlers);
 assert.equal(originalHandlers,handlers);await tick();assert.equal(sent[0]?.type,'shared-account-observation');
 f.accountUpdate();assert.equal(sent.at(-1).type,'shared-account-revoked');release();assert.equal(released,1);native.dispose();
});
test('pinned original connection methods issue only no-refresh account/read and reject pending identity change',{skip:!process.env.CHATGPT_DESKTOP_CONNECTION_CHUNK},async()=>{
 const {readFile}=await import('node:fs/promises'), {Script,createContext}=await import('node:vm');
 const bytes=await readFile(process.env.CHATGPT_DESKTOP_CONNECTION_CHUNK);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'f717cf6c18dd50ef4adce39ccf532f4e3e740211ce8c276363175b6a5e883c22');
 const source=bytes.toString('utf8');
 const select=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
 const accountMethod=select('async getAccount(){await this.ensureReady();let e=await this.sendInternalRequest(', 'async listThreads(');
 const identityMethod=select('async getRequestAuthenticatedPrincipal(){','getCachedAuthenticatedPrincipal(){');
 const methods=new Script(`({${accountMethod},${identityMethod}})`).runInContext(createContext({eu:{randomUUID}}));
 const calls=[];const original={...methods,backendAuth:{hasPendingAccountChange:false},authTokenGeneration:1,ensureReady:async()=>{},sendInternalRequest:async x=>(calls.push(x),{result:{account:{type:'chatgpt'}}}),getCachedAuthenticatedPrincipal:()=>undefined,getAuthenticatedPrincipal:async()=>({accountId:'a',userId:'u',expiresAtMs:Date.now()+60000})};
 assert.equal((await original.getAccount()).account.type,'chatgpt');assert.equal(calls[0].method,'account/read');assert.deepEqual(JSON.parse(JSON.stringify(calls[0].params)),{refreshToken:false});
 assert.equal((await original.getRequestAuthenticatedPrincipal()).userId,'u');original.backendAuth.hasPendingAccountChange=true;assert.equal(await original.getRequestAuthenticatedPrincipal(),null);
});

test('an unnotified in-progress original account change revokes at the synchronous final guard',async()=>{
 const f=fixture();f.observer.attach(f.owner);await tick();assert.equal(f.observer.verifyCurrentSync(),true);
 f.connection.backendAuth.hasPendingAccountChange=true;assert.equal(f.observer.verifyCurrentSync(),false);assert.equal(f.sent.at(-1).type,'shared-account-revoked');
 f.connection.backendAuth.hasPendingAccountChange=false;assert.equal(f.observer.verifyCurrentSync(),false);f.observer.dispose();
});
test('pinned original AppServerManager binding feeds the real integration observer',{skip:!process.env.CHATGPT_PICKER_NATIVE_CHUNK},async()=>{
 const {readFile}=await import('node:fs/promises'), {Script,createContext}=await import('node:vm');
 const {adaptNativeSharedThreadChunk}=require('../src/native-shared-thread-policy.cjs');
 const {createNativeSharedThreadIntegration}=require('../src/native-shared-thread-integration.cjs');
 const source=adaptNativeSharedThreadChunk({body:await readFile(process.env.CHATGPT_PICKER_NATIVE_CHUNK)}).body.toString('utf8');
 const begin=source.indexOf('bind(e){if(this.assertCurrent(),this.disposed||0!==this.cleanup.length)'),end=source.indexOf('async callInteractiveDynamicAppTool(',begin);assert.ok(begin>=0&&end>begin);
 const profileId=randomUUID(),generation=randomUUID(),sent=[],notify=new Set(),principalHandlers=new Set(),stateHandlers=new Set();
 const add=set=>handler=>(set.add(handler),()=>set.delete(handler));
 const principal={accountId:'workspace-1',userId:'user-1',expiresAtMs:Date.now()+60000};
 const connection={backendAuth:{hasPendingAccountChange:false},getConnectionState:()=>'connected',getAccount:async()=>({account:{type:'chatgpt'},requiresOpenaiAuth:true,workspaceRouting:{chatgptAccountId:'workspace-1'}}),getRequestAuthenticatedPrincipal:async()=>principal,getCachedAuthenticatedPrincipal:()=>principal,
 registerInternalNotificationHandler:add(notify),registerInternalAuthenticatedPrincipalChangeHandler:add(principalHandlers),registerInternalConnectionStateHandler:add(stateHandlers),registerHostEventHandler:()=>()=>{}};
 const integration=createNativeSharedThreadIntegration({profileId,generation,getRecord:()=>null,getOwnedRecord:()=>null,verifyRuntimeSync:()=>true,sendToView:()=>{},sendFrame:frame=>sent.push(frame),desktopAccountObservation:true});
 const context=createContext({yc:{IB:()=>true},el:{JXB:x=>x},__kanbanRegisterSharedHostEvents:(...args)=>integration.registerHostEvents(...args)});
 const methods=new Script(`({${source.slice(begin,end)}})`).runInContext(context);
 const owner={...methods,connection,cleanup:[],disposed:false,requests:new Map(),assertCurrent(){},assertLifetimeCurrent(){},isCurrent:()=>true};
 const manager={getHostId:()=>"local",onNotification(){},onRequest(){},addThreadDeletedListener:()=>()=>{}};
 owner.bind(manager);await tick();assert.equal(sent[0]?.type,'shared-account-observation');
 for(const handler of notify)handler({method:'account/updated',params:{authMode:'chatgpt'}});
 assert.equal(sent.at(-1)?.type,'shared-account-revoked');
 for(const release of owner.cleanup)release();integration.dispose();
});

test('private directory reads use only the observed original connection and reject stale account results',async()=>{
 const f=fixture();const requests=[];let complete;
 f.connection.listThreads=async params=>{requests.push(['thread/list',params]);return {data:[],nextCursor:'next'}};
 f.connection.readThread=(id,options)=>{requests.push(['thread/read',id,options]);return new Promise(resolve=>{complete=resolve})};
 f.observer.attach(f.owner);await tick();
 const signal=new AbortController().signal;
 assert.deepEqual(await f.observer.executeDirectory('thread/list',{limit:5,useStateDbOnly:true},{signal}),{data:[],nextCursor:'next'});
 const pending=f.observer.executeDirectory('thread/read',{threadId:'11111111-1111-4111-8111-111111111111',includeTurns:false},{signal});
 f.accountUpdate();complete({id:'11111111-1111-4111-8111-111111111111',cwd:'/work',turns:[]});
 await assert.rejects(pending,{code:'SHARED_ACCOUNT_OBSERVATION_UNAVAILABLE'});
 assert.deepEqual(requests,[['thread/list',{limit:5,useStateDbOnly:true}],['thread/read','11111111-1111-4111-8111-111111111111',{includeTurns:false}]]);
 await tick();await assert.rejects(f.observer.executeDirectory('thread/resume',{threadId:'11111111-1111-4111-8111-111111111111'},{signal}),{code:'SHARED_ACCOUNT_OBSERVATION_UNAVAILABLE'});
 f.observer.dispose();
});
