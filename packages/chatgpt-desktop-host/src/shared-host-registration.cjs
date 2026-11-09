'use strict';
// This hook is installed only by the explicitly configured native owner. The
// provider must return a host-verified source; no renderer value is accepted.
const HOST_ID='kanban-shared-cli';
const fail=()=>Object.assign(new Error('Shared source unavailable'),{code:'SHARED_HOST_UNAVAILABLE'});
function createSharedHostRegistration({getVerifiedSourceSync,subscribeSource,onState=()=>{},onFailure=()=>{}}={}){
 if([getVerifiedSourceSync,subscribeSource,onState,onFailure].some(x=>typeof x!=='function'))throw fail();
 const owners=new WeakSet();
 return function registerOriginalOwner(owner){
  if(!owner||typeof owner!=='object'||owners.has(owner))throw fail();
  const connections=owner.appServerConnectionRegistry,hosts=owner.executionHostRegistry,managers=owner.hostAppServerManagers;
  if(!connections||!hosts||!managers||!owner.disposables||
     ['getMaybeConnection','addConnection','removeConnection'].some(x=>typeof connections[x]!=='function')||
     ['getMaybe','add','remove'].some(x=>typeof hosts[x]!=='function')||
     ['subscribe','getCurrent'].some(x=>typeof managers[x]!=='function')||typeof owner.disposables.add!=='function')throw fail();
  owners.add(owner);
  let disposed=false,active=null,releaseSource=null,releaseState=null,releaseManager=null,reconciling=false,again=false,lastState=null;
  const safeReport=()=>{try{onFailure(fail())}catch{}};
  function publish(){
   let ready=false;
   try{
    const instance=active&&managers.getCurrent(HOST_ID);
    ready=!disposed&&!!active&&getVerifiedSourceSync()===active&&valid(active)&&
     connections.getMaybeConnection(HOST_ID)===active.connection&&hosts.getMaybe(HOST_ID)===active.executionHost&&
     instance?.connection===active.connection&&!!instance.resource?.manager;
   }catch{}
   const state=ready?'ready':'unavailable';if(state===lastState)return;lastState=state;
   try{onState(state)}catch{safeReport()}
  }
  function remove(){
   const old=active;active=null;
   publish();
   const release=releaseState;releaseState=null;try{release?.()}catch{safeReport()}
   if(!old)return;
   // Remove only the exact objects installed by this owner, never a replacement.
   try{if(connections.getMaybeConnection(HOST_ID)===old.connection)connections.removeConnection(HOST_ID)}catch{safeReport()}
   try{if(hosts.getMaybe(HOST_ID)===old.executionHost)hosts.remove(HOST_ID)}catch{safeReport()}
  }
  function valid(value){
   try{
    const c=value?.connection,h=value?.executionHost,config=c?.hostConfig;
    return value?.hostId===HOST_ID&&typeof value.isCurrent==='function'&&value.isCurrent()===true&&
     c&&h&&c!==connections.getMaybeConnection('local')&&h!==hosts.getMaybe('local')&&
     c.hostId===HOST_ID&&h.id===HOST_ID&&config&&config.id===HOST_ID&&h.hostConfig===config&&
     typeof c.appServerVersion==='string'&&c.appServerVersion.length>0&&c.appServerVersion.length<=128&&
     ['getConnectionState','registerInternalConnectionStateHandler','registerInternalNotificationHandler','registerHostEventHandler','handleHostRequest','getThreadPrewarmPolicy','getPendingRequestCount'].every(name=>typeof c[name]==='function')&&
     c.getConnectionState()==='connected';
   }catch{return false}
  }
  function reconcile(){
   if(disposed)return;
   if(reconciling){again=true;return}
   reconciling=true;
   try{
    do{
     again=false;let value=null;try{value=getVerifiedSourceSync()}catch{safeReport()}
     if(active&&(value!==active||!valid(value)||connections.getMaybeConnection(HOST_ID)!==active.connection||hosts.getMaybe(HOST_ID)!==active.executionHost))remove();
     if(!active&&valid(value)&&connections.getMaybeConnection(HOST_ID)==null&&hosts.getMaybe(HOST_ID)==null){
      // Execution host must be installed first: the original connection-added
      // observer can synchronously ask for the corresponding execution host.
      try{
       hosts.add(HOST_ID,value.executionHost);
       if(!valid(value)||hosts.getMaybe(HOST_ID)!==value.executionHost)throw fail();
       connections.addConnection(HOST_ID,value.connection);
       if(connections.getMaybeConnection(HOST_ID)!==value.connection||!valid(value))throw fail();
       active=value;
       releaseState=value.connection.registerInternalConnectionStateHandler(reconcile);
       if(typeof releaseState!=='function')throw fail();
      }catch{
       if(!active)active=value;
       remove();safeReport();
      }
     }
     publish();
    }while(again&&!disposed);
   }finally{reconciling=false}
  }
  function dispose(){if(disposed)return;disposed=true;try{releaseSource?.()}catch{safeReport()}releaseSource=null;remove();try{releaseManager?.()}catch{safeReport()}releaseManager=null}
  try{
   releaseManager=managers.subscribe(HOST_ID,publish);if(typeof releaseManager!=='function')throw fail();
   releaseSource=subscribeSource(reconcile);if(typeof releaseSource!=='function')throw fail();owner.disposables.add(dispose);reconcile();
  }
  catch(error){dispose();throw error}
  return dispose;
 };
}
module.exports={HOST_ID,createSharedHostRegistration};
