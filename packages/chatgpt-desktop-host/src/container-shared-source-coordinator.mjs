import {createContainerSharedAccountAuthority,createAccountBoundSharedAuthority} from './container-shared-account-authority.mjs';
import {createThreadSourceRegistry} from './thread-source-registry.mjs';
import {createSourceBoundSharedAuthority} from './container-shared-source-authority.mjs';
import {createContainerSharedFrameRouter} from './container-shared-frame-router.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createHostDirectoryIpc}=require('./shared-directory-ipc.cjs');
const {createHostCatalogIpc}=require('./shared-catalog-ipc.cjs');
const {createSharedAuthorityMemoryBudget}=require('./shared-thread-authority-channel.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const invalid=()=>Object.assign(new Error('Shared source coordinator unavailable'),{code:'CONTAINER_SHARED_SOURCE_UNAVAILABLE'});
/** Internal server-side coordinator. It must be constructed with owned native
 * and daemon identities; no option or endpoint is accepted from an HTTP peer. */
export function createContainerSharedSourceCoordinator({profileId,generation,daemonGeneration,daemon,privateSource,useNativeDirectory=false,verifyContainerSync,getOwnedView,verifyOwnedViewSync,writeNative,sharedThread,rpcGate,onDesktopFrame=null,onAccountRevision=()=>{},attachDaemonReceiver=true,memoryBudget,onFailure=()=>{}}={}){
 if(![profileId,generation,daemonGeneration].every(value=>UUID.test(value??''))||!daemon||!(daemon.signal instanceof AbortSignal)||
    ['assertCurrent','listThreads','readThreadMetadata','attachGateReceiver'].some(name=>typeof daemon[name]!=='function')||
    !privateSource||!UUID.test(privateSource.generation??'')||typeof useNativeDirectory!=='boolean'||typeof privateSource.verifySync!=='function'||(!useNativeDirectory&&['list','read'].some(name=>typeof privateSource[name]!=='function'))||
    [verifyContainerSync,getOwnedView,verifyOwnedViewSync,writeNative,onFailure,onAccountRevision].some(fn=>typeof fn!=='function')||
    typeof attachDaemonReceiver!=='boolean'||(onDesktopFrame!==null&&typeof onDesktopFrame!=='function')||
    (memoryBudget!==undefined&&(!memoryBudget||typeof memoryBudget.reserveBytes!=='function'||typeof memoryBudget.releaseBytes!=='function')))throw invalid();
 memoryBudget??=createSharedAuthorityMemoryBudget();
 let closed=false,router,registry,sourceBound,account,directory,catalog;
 const current=()=>{try{return !closed&&!daemon.signal.aborted&&verifyContainerSync()===true}catch{return false}};
 const owned=id=>{try{return current()&&UUID.test(id??'')&&verifyOwnedViewSync(id)===true?getOwnedView(id):null}catch{return null}};
 function close(){
  if(closed)return;directory?.close();directory=undefined;catalog?.close();closed=true;daemon.signal.removeEventListener('abort',onDaemonClose);
  router?.close();sourceBound?.close();registry?.close();account?.close();
 }
 function onDaemonClose(){close();try{onFailure(invalid())}catch{}}
 try{
  account=createContainerSharedAccountAuthority({profileId,generation,verifyContainerSync:current,daemon});
  const revision=()=>account.currentRevision();
  const getDirectory=()=>{
   if(!useNativeDirectory||!current()||revision()===null)throw invalid();
   if(!directory?.active)directory=createHostDirectoryIpc({profileId,generation,verifyCurrentSync:()=>current()&&revision()!==null,
    sendFrame:frame=>router.sendDirectoryFrame(frame),reserveBytes:memoryBudget.reserveBytes,releaseBytes:memoryBudget.releaseBytes});
   return directory;
  };
  registry=createThreadSourceRegistry({
   privateSource:{generation:privateSource.generation,getAccountRevision:revision,verifySync:()=>current()&&privateSource.verifySync()===true,list:params=>useNativeDirectory?getDirectory().fetch('thread/list',params):privateSource.list(params),read:id=>useNativeDirectory?getDirectory().fetch('thread/read',{threadId:id,includeTurns:false}):privateSource.read(id)},
   daemonSource:{generation:daemonGeneration,getAccountRevision:revision,verifySync:()=>{try{if(!current())return false;daemon.assertCurrent();return true}catch{return false}},list:params=>daemon.listThreads(params),read:id=>daemon.readThreadMetadata(id)},
   verifyViewSync:value=>!!value&&owned(value.viewId)===value,
  });
  const accountBound=createAccountBoundSharedAuthority({account,sharedThread});
  sourceBound=createSourceBoundSharedAuthority({registry,getOwnedView:owned,sharedThread:accountBound});
  router=createContainerSharedFrameRouter({profileId,generation,enabled:true,verifyContainerSync:current,verifyOwnedViewSync:id=>!!owned(id),writeNative,sharedThread:sourceBound.sharedThread,verifyCreatedBindingSync:binding=>sourceBound.verifyCreatedBindingSync(binding),memoryBudget,rpcGate,onDesktopFrame,
   onAccountFrame:frame=>{const ok=account.receive(frame);const currentRevision=revision();if(currentRevision===null){directory?.revoke();directory=undefined;catalog?.revoke();}onAccountRevision(currentRevision);return ok;},
   onDirectoryFrame:frame=>directory?.receive(frame)===true,onCatalogFrame:frame=>catalog?.receive(frame)===true,onFailure});
  catalog=createHostCatalogIpc({profileId,generation,verifyCurrentSync:()=>current()&&revision()!==null,verifyViewSync:id=>!!owned(id),
   sendFrame:frame=>router.sendCatalogFrame(frame),getPage:(id,{cursor,limit})=>list(id,{cursor,limit,useStateDbOnly:true},'daemon'),
   reserveBytes:memoryBudget.reserveBytes,releaseBytes:memoryBudget.releaseBytes});
  if(attachDaemonReceiver)daemon.attachGateReceiver(encoded=>router.receiveDaemon(encoded));
  daemon.signal.addEventListener('abort',onDaemonClose,{once:true});
  if(daemon.signal.aborted||!current())throw invalid();
 }catch(error){close();throw error;}
 async function list(viewId,params,kind){
  const before=owned(viewId),revision=account.currentRevision();if(!before||revision===null)throw invalid();
  const page=await (kind==='daemon'?registry.listDaemon(params):registry.listPrivate(params));
  if(owned(viewId)!==before||account.currentRevision()!==revision)throw invalid();
  const tokens=registry.issuePageTokens(before,page);
  return Object.freeze({page,tokens});
 }
 function retireView(viewId){const record=owned(viewId);if(record)registry.retireView(record);catalog?.retireView(viewId);sourceBound.retireView(viewId);}
 return Object.freeze({sharedThread:sourceBound.sharedThread,adoptCreatedBinding:(binding,token)=>sourceBound.adoptCreatedBinding(binding,token),registerCreatedFollow:(binding,control)=>current()&&router.registerCreatedFollow(binding,control),listDaemon:(viewId,params)=>list(viewId,params,'daemon'),listPrivate:(viewId,params)=>list(viewId,params,'private'),receiveNative:frame=>router.receiveNative(frame),receiveDesktopDaemon:encoded=>router.receiveDaemon(encoded),sendDesktopFrame:frame=>router.sendDesktopFrame(frame),accountRevision:account.currentRevision,
  verifyConnectedThreadSync:id=>current()&&router.verifyConnectedThreadSync(id)===true,retireView,close});
}
