import {createRequire} from 'node:module';
import {encodeWireValue} from './wire-value.mjs';
import {createContainerSharedAuthority} from './container-shared-authority.mjs';
const require=createRequire(import.meta.url);
const {isSharedThreadAuthorityFrame}=require('./shared-thread-authority-wire.cjs');
const {isDirectoryFrame}=require('./shared-directory-ipc.cjs');
const {isCatalogFrame}=require('./shared-catalog-ipc.cjs');
const {isSharedDesktopTransportFrame}=require('./native-shared-desktop-transport.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_BYTES=8*1024*1024, MAX_WRITES=64;
const fail=()=>Object.assign(new Error('Shared container frame unavailable'),{code:'CONTAINER_SHARED_FRAME_DENIED'});

/**
 * Owner-only demultiplexer for the existing authenticated container stream.
 * The caller supplies a synchronously guarded write that starts the actual
 * owned native IPC write before returning; this module does not manufacture
 * account, daemon or view authority. Default construction remains disabled.
 */
export function createContainerSharedFrameRouter({profileId,generation,enabled=false,verifyContainerSync,verifyOwnedViewSync,writeNative,sharedThread,verifyCreatedBindingSync,memoryBudget,rpcGate,onDesktopFrame=null,onAccountFrame=null,onDirectoryFrame=null,onCatalogFrame=null,onFailure=()=>{}}={}) {
 if(!UUID.test(profileId??'')||!UUID.test(generation??'')||typeof enabled!=='boolean'||typeof onFailure!=='function'||(onAccountFrame!==null&&typeof onAccountFrame!=='function')||(onDirectoryFrame!==null&&typeof onDirectoryFrame!=='function')||(onCatalogFrame!==null&&typeof onCatalogFrame!=='function')||(onDesktopFrame!==null&&typeof onDesktopFrame!=='function'))throw fail();
 if(enabled && [verifyContainerSync,verifyOwnedViewSync,writeNative].some(x=>typeof x!=='function'))throw fail();
 let closed=false, authority, queuedBytes=0, queuedWrites=0;
 const alive=()=>{try{return !closed&&enabled&&verifyContainerSync()===true;}catch{return false;}};
 function close(){if(closed)return;closed=true;authority?.close();}
 function sendFrame(frame,kind='authority'){
   if(!alive()||!(kind==='desktop'?isSharedDesktopTransportFrame(frame,{side:'host',profileId,generation}):kind==='directory'?isDirectoryFrame(frame,{side:'host',profileId,generation}):kind==='catalog'?isCatalogFrame(frame,{side:'host',profileId,generation}):isSharedThreadAuthorityFrame(frame,{side:'host',profileId,generation})))throw fail();
   let encoded,bytes;
   try {encoded=encodeWireValue(frame);bytes=Buffer.byteLength(encoded,'utf8');}catch{throw fail();}
   if(queuedWrites>=MAX_WRITES||queuedBytes+bytes>MAX_BYTES){close();throw fail();}
   queuedWrites++;queuedBytes+=bytes;
   let sent;
   try {
     if(!alive())throw fail();
     // This call must synchronously start the bound native write. A later
     // completion is only its receipt; it is never retried on uncertainty.
     sent=writeNative(encoded);
   } catch(error){queuedWrites--;queuedBytes-=bytes;close();throw error;}
   return Promise.resolve(sent).catch(error=>{close();try{onFailure(fail());}catch{}throw error;})
     .finally(()=>{queuedWrites--;queuedBytes-=bytes;});
 }
 if(enabled)authority=createContainerSharedAuthority({profileId,generation,verifyContainerSync:alive,verifyOwnedViewSync,sendFrame,sharedThread,verifyCreatedBindingSync,memoryBudget,rpcGate});
 function receiveNative(frame){
   if(!frame||typeof frame!=='object'||Array.isArray(frame)||typeof frame.type!=='string')throw fail();
   if(!frame.type.startsWith('shared-'))return false;
   const directory=frame.type.startsWith('shared-directory-');
   const catalog=frame.type.startsWith('shared-catalog-');
   const desktop=frame.type.startsWith('shared-desktop-');
   if(!alive()||!(desktop?isSharedDesktopTransportFrame(frame,{side:'native',profileId,generation}):directory?isDirectoryFrame(frame,{side:'native',profileId,generation}):catalog?isCatalogFrame(frame,{side:'native',profileId,generation}):isSharedThreadAuthorityFrame(frame,{side:'native',profileId,generation}))){close();throw fail();}
   try {
     if(desktop){if(!onDesktopFrame||onDesktopFrame(frame)!==true)throw fail();}
     else if(directory){if(!onDirectoryFrame||onDirectoryFrame(frame)!==true)throw fail();}
     else if(catalog){if(!onCatalogFrame||onCatalogFrame(frame)!==true)throw fail();}
     else if(frame.type==='shared-account-observation'||frame.type==='shared-account-revoked'){
       if(!onAccountFrame||onAccountFrame(frame)!==true)throw fail();
     }else authority.receive(frame);
     return true;
   }catch(error){close();throw error;}
 }
 function receiveDaemon(encoded){
   if(!alive()||typeof encoded!=='string'){close();throw fail();}
   try {if(authority.receiveDaemon(encoded)!==true){close();throw fail();}return true;}catch(error){close();throw error;}
 }
 return Object.freeze({receiveNative,receiveDaemon,sendDesktopFrame:frame=>sendFrame(frame,'desktop'),sendDirectoryFrame:frame=>sendFrame(frame,'directory'),sendCatalogFrame:frame=>sendFrame(frame,'catalog'),
  registerCreatedFollow:(binding,control)=>alive()&&authority.registerCreatedFollow(binding,control),
  verifyConnectedThreadSync:id=>alive()&&authority.verifyConnectedThreadSync(id)===true,close});
}
