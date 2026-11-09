import {normalizeContainerSharedAuthority} from './container-shared-authority.mjs';
import {consumeSharedCreatedSource} from './shared-created-thread-adoption.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
export const SHARED_CLI_HOST_ID='kanban-shared-cli';
const MAX_BINDINGS=8192;
const invalid=()=>Object.assign(new Error('Shared source authority unavailable'),{code:'CONTAINER_SHARED_SOURCE_UNAVAILABLE'});
const equal=(a,b)=>{
 const keys=['hostId','runtimeGeneration','daemonGeneration','accountRevision','projectId','threadId','viewId','clientId'];
 return a&&b&&Object.keys(a).sort().join(',')===keys.slice().sort().join(',')&&Object.keys(b).sort().join(',')===keys.slice().sort().join(',')&&keys.every(key=>a[key]===b[key]);
};
/** Compose source provenance with the existing server-owned gate. The token
 * proves only an exact view/page origin; the delegate still proves history,
 * gesture, account and daemon write authority. */
export function createSourceBoundSharedAuthority({registry,getOwnedView,sharedThread}={}){
 const delegate=normalizeContainerSharedAuthority(sharedThread);
 if(!registry||typeof registry.resolveFromPage!=='function'||typeof registry.verifyResolvedSync!=='function'||typeof getOwnedView!=='function'||!delegate)throw invalid();
 let closed=false;const bindings=new Map();
 const view=id=>{try{return !closed&&UUID.test(id??'')?getOwnedView(id):null}catch{return null}};
 const live=(value,readOnly=false)=>{
  try{
   if(closed||!value||!UUID.test(value.clientId??''))return false;
   const registered=bindings.get(value.clientId);
   return !!registered&&equal(value,registered.binding)&&view(value.viewId)===registered.view&&
    (registered.created?(readOnly?registered.created.verifyReadSync?.()===true:registered.created.verifySync()===true):registry.verifyResolvedSync(registered.source)===true);
  }catch{return false;}
 };
 const authority=Object.freeze({
  async resolveBinding(request){
   if(closed||!request||Object.keys(request).sort().join(',')!=='hostId,sourceToken,threadId,viewId'||request.hostId!==SHARED_CLI_HOST_ID||
      !UUID.test(request.threadId??'')||!UUID.test(request.viewId??'')||typeof request.sourceToken!=='string'||!TOKEN.test(request.sourceToken)||bindings.size>=MAX_BINDINGS)throw invalid();
   const owned=view(request.viewId);if(!owned)throw invalid();
   const target=await registry.resolveFromPage(owned,request.sourceToken,request.threadId);
   if(closed||view(request.viewId)!==owned||!registry.verifyResolvedSync(target)||target.executionDomain!=='daemon')throw invalid();
   const binding=await delegate.resolveBinding(Object.freeze({viewId:request.viewId,hostId:request.hostId,threadId:request.threadId,source:target}));
   if(!binding||binding.hostId!==request.hostId||binding.threadId!==target.threadId||binding.viewId!==request.viewId||
      binding.daemonGeneration!==target.generation||binding.accountRevision!==target.accountRevision||!UUID.test(binding.clientId??'')||
      bindings.has(binding.clientId)||view(request.viewId)!==owned||!registry.verifyResolvedSync(target))throw invalid();
   const stable=Object.freeze({...binding});bindings.set(stable.clientId,{binding:stable,source:target,view:owned});return stable;
  },
  verifyViewSync(request){try{return request?.hostId===SHARED_CLI_HOST_ID&&!!view(request.viewId)&&delegate.verifyViewSync({viewId:request.viewId,hostId:request.hostId,threadId:request.threadId})===true;}catch{return false;}},
  verifyBindingSync(binding){try{return live(binding)&&delegate.verifyBindingSync(binding)===true&&live(binding);}catch{return false;}},
  verifyHistorySync(binding){try{return live(binding,true)&&delegate.verifyHistorySync(binding)===true&&live(binding,true);}catch{return false;}},
  verifyReadSync(frame){try{return !closed&&delegate.verifyReadSync(frame)===true;}catch{return false;}},
  write(encoded){if(closed)throw invalid();return delegate.write(encoded);},
 });
 function adoptCreatedBinding(binding,token){
  if(closed||!binding||!UUID.test(binding.clientId??'')||bindings.has(binding.clientId)||bindings.size>=MAX_BINDINGS)throw invalid();
  const owned=view(binding.viewId);if(!owned)throw invalid();
  const created=consumeSharedCreatedSource(token,binding,owned);
  if(!created||created.origin!=='native-start-response'||!created.verifySync()||delegate.verifyBindingSync(binding)!==true||delegate.verifyHistorySync(binding)!==true||view(binding.viewId)!==owned)throw invalid();
  const stable=Object.freeze({...binding});bindings.set(stable.clientId,{binding:stable,created,view:owned});return true;
 }
 function retireView(viewId){for(const [id,value] of bindings)if(value.binding.viewId===viewId)bindings.delete(id);}
 function close(){closed=true;bindings.clear();}
 return Object.freeze({sharedThread:authority,adoptCreatedBinding,
  verifyCreatedBindingSync:binding=>live(binding)&&!!bindings.get(binding.clientId)?.created&&authority.verifyBindingSync(binding)&&authority.verifyHistorySync(binding),retireView,close});
}
