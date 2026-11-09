import {createRequire} from 'node:module';
import {normalizeContainerSharedAuthority} from './container-shared-authority.mjs';
import {isSharedDaemonObserver} from './shared-daemon-observer.mjs';
const accountBrands=new WeakSet(),nativeRevisionReaders=new WeakMap();
// Provenance only: every invocation must still run the original fresh usable
// checks. A copied, wrapped or cross-source getter never inherits this scope.
export function isNativeSharedAccountRevisionReader(reader,daemon,generation,profileId){
 const scope=nativeRevisionReaders.get(reader);
 return !!scope&&scope.daemon===daemon&&scope.generation===generation&&scope.profileId===profileId;
}
const {isSharedThreadAuthorityFrame}=createRequire(import.meta.url)('./shared-thread-authority-wire.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const invalid=()=>Object.assign(new Error('Shared account authority unavailable'),{code:'CONTAINER_SHARED_ACCOUNT_UNAVAILABLE'});
/** Accept observations only from the already verified, ordered owned native
 * channel. Neither this object nor its callbacks are available to HTTP/UI. */
export function createContainerSharedAccountAuthority({profileId,generation,verifyContainerSync,daemon}={}){
 if(!UUID.test(profileId??'')||!UUID.test(generation??'')||typeof verifyContainerSync!=='function'||
    !daemon||typeof daemon.assertCurrent!=='function'||typeof daemon.matchesFingerprint!=='function'||
    !(daemon.signal instanceof AbortSignal)||!Number.isSafeInteger(daemon.expiresAtMs))throw invalid();
 const nativeObserver=isSharedDaemonObserver(daemon);
 let closed=false,lastRevision=-1,observation=null;
 const runtime=()=>{
  if(closed)return false;
  try{if(!daemon.signal.aborted&&verifyContainerSync()===true)return true;}catch{}
  closed=true;observation=null;return false;
 };
 function usable(){
  if(!runtime()||!observation||observation.invalid)return false;
  if(observation.expiresAtMs<=Date.now()||daemon.expiresAtMs<=Date.now()){observation.invalid=true;return false;}
  // The immutable native matcher itself performs assertCurrent. Only that
  // proven implementation avoids the immediately duplicated kernel check.
  // Custom observers retain their independent original assertion.
  try{if(!nativeObserver)daemon.assertCurrent();if(daemon.matchesFingerprint(observation.fingerprint)===true)return true;observation.invalid=true;return false;}catch{closed=true;observation=null;return false;}
 }
 function receive(frame){
  if(!runtime()||!isSharedThreadAuthorityFrame(frame,{side:'native',profileId,generation})||
     !['shared-account-observation','shared-account-revoked'].includes(frame.type)||frame.revision<=lastRevision)return false;
  if(frame.type==='shared-account-observation'){
   if(observation)return false;
   observation={observationId:frame.observationId,revision:frame.revision,fingerprint:frame.fingerprint,expiresAtMs:frame.expiresAtMs};
  }else{
   if(!observation||frame.observationId!==observation.observationId)return false;
   observation=null;
  }
  lastRevision=frame.revision;
  return true;
 }
 function currentRevision(){return usable()?observation.revision:null;}
 function verifyRevisionSync(revision){return Number.isSafeInteger(revision)&&usable()&&observation.revision===revision;}
 function close(){closed=true;observation=null;}
 const authority=Object.freeze({receive,currentRevision,verifyRevisionSync,close});
 if(nativeObserver){
  Object.freeze(currentRevision);
  nativeRevisionReaders.set(currentRevision,Object.freeze({daemon,generation,profileId}));
  accountBrands.add(authority);
 }
 return authority;
}

/** Compose real account observation with the existing server-owned authority.
 * It adds no permissions: the delegate must still prove view, history, intent
 * and exact daemon write itself. */
export function createAccountBoundSharedAuthority({account,sharedThread}={}){
 if(!account||typeof account.currentRevision!=='function'||typeof account.verifyRevisionSync!=='function')throw invalid();
 const delegate=normalizeContainerSharedAuthority(sharedThread);
 if(!delegate)throw invalid();
 // A native-backed immutable account already ran usable inside this exact
 // currentRevision call. Never reuse its result across operations or awaits.
 const current=()=>{try{const revision=account.currentRevision();return Number.isSafeInteger(revision)&&revision>=0&&(accountBrands.has(account)||account.verifyRevisionSync(revision)===true)?revision:null;}catch{return null;}};
 const check=(name,value,revision)=>{try{return revision!==null&&delegate[name](value)===true&&account.verifyRevisionSync(revision)===true;}catch{return false;}};
 return Object.freeze({
  async resolveBinding(request){
   const revision=current();if(revision===null)throw invalid();
   const binding=await delegate.resolveBinding(request);
   if(!binding||binding.accountRevision!==revision||!account.verifyRevisionSync(revision))throw invalid();
   return binding;
  },
  verifyViewSync:value=>check('verifyViewSync',value,current()),
  verifyBindingSync:value=>{const revision=current();return value?.accountRevision===revision&&check('verifyBindingSync',value,revision);},
  verifyHistorySync:value=>{const revision=current();return value?.accountRevision===revision&&check('verifyHistorySync',value,revision);},
  verifyReadSync:value=>check('verifyReadSync',value,current()),
  write(encoded){const revision=current();if(revision===null||!account.verifyRevisionSync(revision))throw invalid();return delegate.write(encoded);},
 });
}
