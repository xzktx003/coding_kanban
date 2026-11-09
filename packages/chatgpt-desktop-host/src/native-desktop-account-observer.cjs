"use strict";
const {createHash,randomUUID}=require("node:crypto");
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const atom=value=>typeof value==="string"&&value.length>0&&value.length<=512&&!/[\x00-\x1f\x7f]/.test(value);
const bad=cause=>Object.assign(new Error("Desktop account observation unavailable",{cause}),{code:"SHARED_ACCOUNT_OBSERVATION_UNAVAILABLE"});
// Original nx(requestId,error) exposes jsonRpcCode and own undefined data.
// CLI SHA is verified separately by the server-owned synchronous callback.
const missingError=(error,threadId)=>{
 try{
  const d=Object.getOwnPropertyDescriptors(error);
  return Object.hasOwn(d.message??{},"value")&&d.message.value===`thread not loaded: ${threadId}`&&
   Object.hasOwn(d.jsonRpcCode??{},"value")&&d.jsonRpcCode.value===-32600&&
   Object.hasOwn(d.data??{},"value")&&d.data.value===undefined&&!Object.hasOwn(d,"code");
 }catch{return false;}
};
const principalOf=value=>value&&atom(value.accountId)&&atom(value.userId)&&
  Number.isSafeInteger(value.expiresAtMs)&&value.expiresAtMs>Date.now()
  ? {accountId:value.accountId,userId:value.userId,expiresAtMs:value.expiresAtMs}:null;
const samePrincipal=(a,b)=>a&&b&&a.accountId===b.accountId&&a.userId===b.userId&&a.expiresAtMs===b.expiresAtMs;
const fingerprint=principal=>createHash("sha256").update(JSON.stringify(["shared-account-principal-v1",principal.accountId,principal.userId])).digest("hex");
function accountMatches(result,principal){
  if(!result||typeof result!=="object"||result.account?.type!=="chatgpt"||result.requiresOpenaiAuth!==true)return false;
  const routing=result.workspaceRouting;
  if(routing!==undefined&&routing!==null){
    if(typeof routing!=="object"||Array.isArray(routing))return false;
    const id=routing.chatgptAccountId;
    if(id!==undefined&&id!==null&&(!atom(id)||id!==principal.accountId))return false;
  }
  return true;
}
/** Observe only a pinned native AppServerManager's own connection. This never
 * supplies account authority from the renderer, an auth file, email or plan. */
function createNativeDesktopAccountObserver({profileId,generation,verifyRuntimeSync,sendFrame,onRevoke=()=>{},verifyThreadReadCliIdentitySync}={}){
 if(!UUID.test(profileId??"")||!UUID.test(generation??"")||typeof verifyRuntimeSync!=="function"||typeof sendFrame!=="function"||typeof onRevoke!=="function"||(verifyThreadReadCliIdentitySync!==undefined&&typeof verifyThreadReadCliIdentitySync!=="function"))throw bad();
 let disposed=false,connection=null,releaseListeners=[],revision=0,observed=null,pending=false,scheduled=false,again=false,timer=null;
 const owners=new Map();
 const runtime=()=>{try{return !disposed&&verifyRuntimeSync()===true;}catch{return false;}};
 function live(c){
  try{return runtime()&&connection===c&&owners.size>0&&[...owners].every(([o,x])=>x===c&&o.connection===c&&!o.disposed&&o.isCurrent()===true)&&c.getConnectionState()==="connected"&&c.backendAuth?.hasPendingAccountChange===false;}catch{return false;}
 }
 function emit(frame){try{sendFrame(frame);return true;}catch{return false;}}
 function revoke(){
  revision++;
  if(timer){clearTimeout(timer);timer=null;}
  if(!observed)return;
  const previous=observed;observed=null;
  try{onRevoke();}catch{}
  emit({v:1,type:"shared-account-revoked",profileId,generation,revision,observationId:previous.observationId});
 }
 function schedule(){
  if(disposed)return;
  if(pending){again=true;return;}
  if(scheduled)return;
  scheduled=true;queueMicrotask(()=>{scheduled=false;void refresh();});
 }
 async function refresh(){
  if(pending){again=true;return;}
  const c=connection, started=revision;
  if(!c||!live(c))return;
  pending=true;
  try{
   // These are native connection methods: getAccount issues exactly
   // account/read(refreshToken:false), and getRequestAuthenticatedPrincipal uses
   // the original no-refresh principal derivation on that same connection.
   const first=await c.getAccount();
   if(started!==revision||!live(c))return;
   const principal=principalOf(await c.getRequestAuthenticatedPrincipal());
   if(!principal||started!==revision||!live(c)||!accountMatches(first,principal))return;
   const second=await c.getAccount();
   const cached=principalOf(c.getCachedAuthenticatedPrincipal());
   if(started!==revision||!live(c)||!samePrincipal(principal,cached)||!accountMatches(second,principal))return;
   const observationId=randomUUID();
   const frame={v:1,type:"shared-account-observation",profileId,generation,revision,observationId,fingerprint:fingerprint(principal),expiresAtMs:principal.expiresAtMs};
   if(!emit(frame))return;
   observed={observationId,principal};
   timer=setTimeout(()=>{timer=null;revoke();},Math.min(2147483647,Math.max(0,principal.expiresAtMs-Date.now())));timer.unref?.();
  }catch{/* Failed and unknown observations remain unavailable. */}
  finally{pending=false;if(again){again=false;schedule();}}
 }
 function changed(){revoke();schedule();}
 function detachConnection(){
  revoke();
  for(const release of releaseListeners.splice(0))try{release();}catch{}
  connection=null;
 }
 function reconcile(){
  const values=new Set(owners.values());
  const next=values.size===1?values.values().next().value:null;
  if(next===connection)return;
  detachConnection();
  if(!next||!runtime())return;
  const required=["getConnectionState","getAccount","getRequestAuthenticatedPrincipal","getCachedAuthenticatedPrincipal","registerInternalNotificationHandler","registerInternalAuthenticatedPrincipalChangeHandler","registerInternalConnectionStateHandler"];
  if(required.some(name=>typeof next[name]!=="function"))return;
  connection=next;
  try{
   for(const subscribe of [
    () => next.registerInternalNotificationHandler(frame=>{if(["account/updated","account/login/completed","account/logout/completed"].includes(frame?.method))changed();}),
    () => next.registerInternalAuthenticatedPrincipalChangeHandler(()=>changed()),
    () => next.registerInternalConnectionStateHandler(()=>changed())
   ]) {
    const release=subscribe();
    if(typeof release!=="function")throw bad();
    releaseListeners.push(release);
   }
  }catch{detachConnection();return;}
  schedule();
 }
 function attach(owner){
  if(disposed||!owner||typeof owner!=="object"||!owner.connection||typeof owner.isCurrent!=="function"||owners.has(owner))throw bad();
  owners.set(owner,owner.connection);reconcile();let active=true;
  return()=>{if(!active)return;active=false;owners.delete(owner);reconcile();};
 }
 function verifyCurrentSync(){
  if(!observed)return false;
  try {
   if(live(connection)&&samePrincipal(observed.principal,principalOf(connection.getCachedAuthenticatedPrincipal())))return true;
  } catch {}
  revoke();return false;
 }
 function missingContractCurrent(c){
  try{return c.initializedAppServerVersion==="0.166.0-alpha.5.1"&&typeof verifyThreadReadCliIdentitySync==="function"&&verifyThreadReadCliIdentitySync(c)===true;}catch{return false;}
 }
 async function executeDirectory(method,params,{signal}={}){
  if(!signal||typeof signal.aborted!=="boolean"||signal.aborted||!verifyCurrentSync())throw bad();
  const c=connection,started=revision;
  let result;
  if(method==="thread/list"&&params&&typeof params==="object"&&params.useStateDbOnly===true&&Number.isSafeInteger(params.limit)&&params.limit>0&&params.limit<=200&&typeof c.listThreads==="function")
   result=await c.listThreads(params);
  else if(method==="thread/read"&&params&&Object.keys(params).sort().join(",")==="includeTurns,threadId"&&UUID.test(params.threadId??"")&&params.includeTurns===false&&typeof c.readThread==="function"){
   const pinnedBefore=missingContractCurrent(c);
   try{
    const thread=await c.readThread(params.threadId,{includeTurns:false});
    if(!thread)throw bad();
    result={thread};
   }catch(error){
    if(pinnedBefore&&missingContractCurrent(c)&&missingError(error,params.threadId))result=null;
    else throw bad(error);
   }
  }else throw bad();
  if(signal.aborted||started!==revision||c!==connection||!verifyCurrentSync())throw bad();
  return result;
 }
 function dispose(){if(disposed)return;detachConnection();owners.clear();disposed=true;}
 return Object.freeze({attach,verifyCurrentSync,executeDirectory,dispose});
}
module.exports={createNativeDesktopAccountObserver};
