import {startOwnedSharedThreadAuthority} from './owned-shared-thread-authority.mjs';
import {createSharedDesktopDaemonSession} from './shared-desktop-daemon-session.mjs';
import {createContainerSharedSourceCoordinator} from './container-shared-source-coordinator.mjs';
import {createSharedMcpProxy} from './shared-mcp-proxy.mjs';
import {encodeWireValue} from './wire-value.mjs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createSharedThreadCreationAuthority,inspectSharedThreadCreationReceipt} from './shared-thread-creation.mjs';
import {createSharedCreatedThreadAdoption} from './shared-created-thread-adoption.mjs';
import {createSharedNativeModelSelection,ensureSharedNativeModelSelection} from './shared-native-model-selection.mjs';
import {createSharedThreadSendAuthority} from './shared-thread-send.mjs';
import {classifySharedServerNotification} from './shared-server-notification-policy.mjs';
import {createSharedThreadArtifactAuthority} from './shared-thread-artifacts.mjs';
const {createSharedAuthorityMemoryBudget}=createRequire(import.meta.url)('./shared-thread-authority-channel.cjs');
const {isSharedMcpFrame}=createRequire(import.meta.url)('./shared-mcp-wire.cjs');
const {isSharedThreadCreationFrame,createHostSharedThreadCreationEndpoint}=createRequire(import.meta.url)('./shared-thread-creation-ipc.cjs');
const {isSharedThreadSendFrame,isSharedThreadSendAuthorizationControl,createHostSharedThreadSendEndpoint}=createRequire(import.meta.url)('./shared-thread-send-ipc.cjs');
const denied=()=>Object.assign(new Error('Owned shared desktop source unavailable'),{code:'OWNED_SHARED_DESKTOP_SOURCE_UNAVAILABLE'});
const factoryBrands=new WeakSet();

/** Internal server factory capability; JSON and structural lookalikes cannot
 * select a source. An explicit alternate source constructor exists solely for
 * controlled fixtures; it still receives the production launcher identities
 * and its actual guarded writer. No HTTP option can supply executable code.
 */
export function createOwnedSharedDesktopSourceFactory(registration,{sourceConstructor=startOwnedSharedDesktopSource,nativeAppTools=sourceConstructor===startOwnedSharedDesktopSource}={}){
 if(!registration||typeof registration!=='object'||Array.isArray(registration)||typeof sourceConstructor!=='function'||typeof nativeAppTools!=='boolean')throw denied();
 const allowed=['daemon','codexHome','daemonVersion','projects','verifyExecutionDomainSync','executionDomainPolicy','authorizeServerReplySync','onFailure','timeoutMs'];
 const fixed={};for(const name of Reflect.ownKeys(registration)){
  const field=Object.getOwnPropertyDescriptor(registration,name);if(typeof name!=='string'||!allowed.includes(name)||!field||!Object.hasOwn(field,'value'))throw denied();
  fixed[name]=field.value;
 }
 const preserve=fixed.executionDomainPolicy==='preserve-native-cli';
 if(!fixed.daemon||typeof fixed.daemon!=='object'||!Array.isArray(fixed.projects)||
    (preserve?nativeAppTools||fixed.daemonVersion!=='0.166.0'||fixed.verifyExecutionDomainSync!==undefined:fixed.executionDomainPolicy!==undefined||typeof fixed.verifyExecutionDomainSync!=='function'))throw denied();
 const copyOwn=(value,names)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).length!==names.length)throw denied();
  const result={};for(const name of names){const field=Object.getOwnPropertyDescriptor(value,name);if(!field||!Object.hasOwn(field,'value'))throw denied();result[name]=field.value;}return Object.freeze(result);
 };
 fixed.daemon=copyOwn(fixed.daemon,['pid','startTicks','socketPath','daemonGeneration','exeSha256']);
 const roots=[];for(let i=0;i<fixed.projects.length;i++){const field=Object.getOwnPropertyDescriptor(fixed.projects,String(i));if(!field||!Object.hasOwn(field,'value'))throw denied();roots.push(copyOwn(field.value,['projectId','cwd']));}
 fixed.projects=Object.freeze(roots);Object.freeze(fixed);
 const used=new Set();
 const factory=Object.freeze({requiresAppTools:nativeAppTools,async create(context){
  const names=['profileId','generation','getOwnedView','verifyOwnedViewSync','verifyContainerSync','writeNative'];
  if(!context||typeof context!=='object'||Reflect.ownKeys(context).length!==names.length||names.some(name=>!Object.hasOwn(Object.getOwnPropertyDescriptor(context,name)??{},'value')))throw denied();
  const key=String(context.profileId)+'/'+String(context.generation);if(used.has(key)||used.size>=256)throw denied();used.add(key);
  return sourceConstructor({...fixed,...context,nativeAppTools,privateSource:{generation:context.generation,verifySync:context.verifyContainerSync},useNativeDirectory:true});
 }});
 factoryBrands.add(factory);return factory;
}
export function isOwnedSharedDesktopSourceFactory(value){return!!value&&factoryBrands.has(value);}

/**
 * Explicit trusted-server assembly. It first establishes a read-only daemon
 * account observer; the original desktop transport opens its separate writer
 * only after the authenticated native account observation matches. All shared
 * resume requests then use that original desktop writer and the same gate.
 *
 * The server may preserve the native daemon's configuration with the built-in
 * executionDomainPolicy and nativeAppTools:false. Full Desktop App Tools still
 * require independent daemon/Desktop equivalence through the explicit callback.
 * Neither route infers policy from a project name or a successful unit test.
 */
export async function startOwnedSharedDesktopSource({profileId,generation,daemon,codexHome,daemonVersion,projects,
 getOwnedView,verifyOwnedViewSync,verifyContainerSync,verifyExecutionDomainSync,executionDomainPolicy,writeNative,privateSource,useNativeDirectory=false,nativeAppTools=false,
 authorizeServerReplySync=()=>false,onFailure=()=>{},timeoutMs=15000}={}){
 const preserve=executionDomainPolicy==='preserve-native-cli';
 if([getOwnedView,verifyOwnedViewSync,verifyContainerSync,writeNative,authorizeServerReplySync,onFailure].some(fn=>typeof fn!=='function')||typeof nativeAppTools!=='boolean'||
    (preserve?nativeAppTools||daemonVersion!=='0.166.0'||verifyExecutionDomainSync!==undefined:executionDomainPolicy!==undefined||typeof verifyExecutionDomainSync!=='function'))throw denied();
 let provider,session,coordinator,mcp,mcpStarting,mcpStreamId,creation,createdAdoption,creationIpc,turn,turnIpc,modelSelection,artifacts,createRegistration=null,closed=false,failureReported=false;
 const createTickets=new Map(),createAttempts=new Set(),sendBindings=new Map(),metadataBindings=new Map();
 const memoryBudget=createSharedAuthorityMemoryBudget();
 const current=()=>{try{return !closed&&verifyContainerSync()===true;}catch{return false;}};
 function retireTicket(ticket){clearTimeout(ticket.timer);ticket.controller.abort();createTickets.delete(ticket.scope.creationNonce);}
 function close(){if(closed)return;closed=true;for(const ticket of createTickets.values())retireTicket(ticket);sendBindings.clear();metadataBindings.clear();creationIpc?.close();turnIpc?.close();creation?.close();turn?.close();createdAdoption?.close();modelSelection?.close();artifacts?.close();mcp?.close();coordinator?.close();session?.close();provider?.close();}
 function failed(cause){if(closed||failureReported)return;failureReported=true;close();try{onFailure(cause instanceof Error?cause:denied());}catch{}}
 try{
  provider=await startOwnedSharedThreadAuthority({daemon,codexHome,runtimeGeneration:generation,profileId,projects,timeoutMs,executionDomainPolicy,
   getOwnedView,getAccountRevision:()=>coordinator?.accountRevision()??null,
   verifyExecutionDomainSync:preserve?undefined:scope=>current()&&(!nativeAppTools||!!mcp?.config)&&verifyExecutionDomainSync(scope,nativeAppTools?mcp.config:undefined)===true});
  const bindingKey=b=>`${b.viewId}/${b.threadId}`;
  const rememberBinding=b=>{if(!preserve)return;sendBindings.set(bindingKey(b),b);let byView=metadataBindings.get(b.threadId);if(!byView){byView=new Map();metadataBindings.set(b.threadId,byView);}byView.set(b.viewId,b);};
  const threadCurrent=id=>{for(const binding of metadataBindings.get(id)?.values()??[])if(coordinator?.sharedThread.verifyHistorySync(binding)===true)return true;return false;};
  const threadWritable=id=>{for(const binding of metadataBindings.get(id)?.values()??[])if(coordinator?.sharedThread.verifyBindingSync(binding)===true&&coordinator.sharedThread.verifyHistorySync(binding)===true)return true;return false;};
  const createdNameBinding=id=>{
   if(!preserve||!current())return null;
   for(const binding of metadataBindings.get(id)?.values()??[])if(binding.threadId===id&&
    provider.executionProof.getAttestationSync(binding)?.policyOrigin==='native-start-response'&&
    coordinator?.sharedThread.verifyBindingSync(binding)===true&&coordinator.sharedThread.verifyHistorySync(binding)===true&&current())return binding;
   return null;
  };
  const sameScope=(a,b)=>a&&b&&['hostId','runtimeGeneration','daemonGeneration','accountRevision','projectId','cwd','viewId','creationNonce'].every(k=>a[k]===b[k]);
  const ticketCurrent=t=>{try{return current()&&t&&!t.controller.signal.aborted&&performance.now()<t.deadline&&getOwnedView(t.scope.viewId)===t.view&&verifyOwnedViewSync(t.scope.viewId)===true&&provider.executionProof.getRevisionSync()===t.proofRevision&&provider.executionProof.verifyProjectSync(t.scope)===true;}catch{return false;}};
  const writeCreationControl=frame=>{
   if(!current()||!(isSharedThreadCreationFrame(frame,{side:'native',profileId,generation})||isSharedThreadSendFrame(frame,{side:'native',profileId,generation})))throw denied();
   return writeNative(encodeWireValue(frame),()=>current());
  };
  if(preserve){
   artifacts=createSharedThreadArtifactAuthority({codexHome,projects,verifyCurrentSync:current,
    verifyReadSync:()=>provider.sharedThread.verifyReadSync()===true,
    verifyBindingSync:binding=>coordinator?.sharedThread.verifyBindingSync(binding)===true,
    verifyHistorySync:binding=>coordinator?.sharedThread.verifyHistorySync(binding)===true,
    getBindingForThreadSync:threadId=>[...(metadataBindings.get(threadId)?.values()??[])].find(binding=>provider.executionProof.getCreatedArtifactRootSync(binding)!==null)??null,
    authorizeDirectorySync:(binding,path)=>provider.executionProof.authorizeCreatedArtifactRootSync(binding,path)===true,
    onReceipt:(binding,receipt)=>provider.executionProof.applyArtifactReceiptSync(binding,receipt)===true});
   modelSelection=createSharedNativeModelSelection({getAccountRevision:()=>coordinator?.accountRevision()??null,verifyCurrentSync:()=>current()&&provider.sharedThread.verifyReadSync()===true});
   creation=createSharedThreadCreationAuthority({modelSelection,getOwnedView,verifyOwnedViewSync,verifyPermissionSelectionSync:(scope,params)=>ticketCurrent(createTickets.get(scope.creationNonce))&&provider.executionProof.verifyPermissionSelectionSync(scope,params)===true,verifyProjectSync:scope=>current()&&ticketCurrent(createTickets.get(scope.creationNonce))&&sameScope(scope,createTickets.get(scope.creationNonce).scope),
    verifyExplicitIntentSync:(scope,frame,control)=>!!createRegistration&&sameScope(scope,createRegistration.ticket.scope)&&ticketCurrent(createRegistration.ticket)&&
      control.signal===createRegistration.ticket.controller.signal&&JSON.stringify(frame)===JSON.stringify(createRegistration.frame)});
   createdAdoption=createSharedCreatedThreadAdoption({creationAuthority:creation,provider,getOwnedView,verifyOwnedViewSync,verifyCurrentSync:current,
    adoptSourceBinding:(binding,token)=>coordinator.adoptCreatedBinding(binding,token),onAdopted:(binding,receipt)=>{
     const snapshot=inspectSharedThreadCreationReceipt(receipt,creation),ticket=snapshot&&createTickets.get(snapshot.data.scope.creationNonce);
     if(!ticketCurrent(ticket)||ticket.requestId!==snapshot.data.requestId||coordinator.registerCreatedFollow(binding,{attemptId:ticket.attemptId,signal:ticket.controller.signal,deadline:ticket.deadline})!==true)throw denied();ticket.binding=binding;rememberBinding(binding);if(provider.executionProof.getCreatedArtifactRootSync(binding)!==null&&artifacts.registerBinding(binding)!==true)throw denied();
    }});
   creationIpc=createHostSharedThreadCreationEndpoint({profileId,generation,verifyCurrentSync:current,sendFrame:writeCreationControl,
    async onScope(target,control){
     let proofRevision=provider.executionProof.getRevisionSync();
     const revision=coordinator?.accountRevision(),matches=projects.filter(p=>p.cwd===target.cwd),project=matches.length===1?matches[0]:null,view=getOwnedView(target.viewId);
     if(!project||!view||view.viewId!==target.viewId||verifyOwnedViewSync(target.viewId)!==true||!Number.isSafeInteger(revision)||revision<0||
        createAttempts.has(control.attemptId)||createAttempts.size>=8192||createTickets.size>=16)throw denied();
     createAttempts.add(control.attemptId);
     const projectScope=Object.freeze({hostId:'kanban-shared-cli',runtimeGeneration:generation,daemonGeneration:daemon.daemonGeneration,accountRevision:revision,projectId:project.projectId,cwd:project.cwd,viewId:target.viewId});
     if(provider.executionProof.verifyProjectSync(projectScope)!==true){
      for(const old of createTickets.values())retireTicket(old);
      proofRevision=await provider.revalidateProjectForIntent(projectScope,{expectedRevision:proofRevision,signal:control.signal,deadline:control.deadline,
       verifyCurrentSync:()=>current()&&coordinator.accountRevision()===revision&&getOwnedView(target.viewId)===view&&verifyOwnedViewSync(target.viewId)===true});
      if(!proofRevision)throw denied();
     }
     if(control.signal.aborted||performance.now()>=control.deadline||!current()||coordinator.accountRevision()!==revision||getOwnedView(target.viewId)!==view||verifyOwnedViewSync(target.viewId)!==true||provider.executionProof.getRevisionSync()!==proofRevision||createTickets.size>=16)throw denied();
     const scope=Object.freeze({...projectScope,creationNonce:randomUUID()});
     const ticket={scope,view,proofRevision,attemptId:control.attemptId,controller:new AbortController(),deadline:Math.min(control.deadline,performance.now()+30000),state:'issued',timer:null,binding:null};
     if(!ticketCurrent(ticket))throw denied();createTickets.set(scope.creationNonce,ticket);
     ticket.timer=setTimeout(()=>retireTicket(ticket),Math.max(1,ticket.deadline-performance.now()));ticket.timer.unref?.();return scope;
    },async onAuthorize(scope,frame,control){
     const ticket=createTickets.get(scope.creationNonce);if(!ticketCurrent(ticket)||ticket.state!=='issued'||!sameScope(scope,ticket.scope))throw denied();
     if(frame.params.model!==undefined){
      await ensureSharedNativeModelSelection(modelSelection,ticket.scope,{model:frame.params.model,...frame.params.config?.model_reasoning_effort===undefined?{}:{reasoningEffort:frame.params.config.model_reasoning_effort}},
       {source:provider.daemon,signal:control.signal,deadline:Math.min(ticket.deadline,control.deadline),verifyCurrentSync:()=>ticketCurrent(ticket)&&ticket.state==='issued'&&sameScope(scope,ticket.scope)});
      if(!ticketCurrent(ticket)||ticket.state!=='issued'||!sameScope(scope,ticket.scope)||control.signal.aborted||performance.now()>=control.deadline)throw denied();
     }
     const abort=()=>ticket.controller.abort();control.signal.addEventListener('abort',abort,{once:true});if(control.signal.aborted)abort();
     createRegistration={ticket,frame};
     try{if(creation.registerCreate(ticket.scope,frame,{signal:ticket.controller.signal,deadline:Math.min(ticket.deadline,control.deadline)})!==true)throw denied();}
     finally{createRegistration=null;}
     ticket.state='registered';ticket.requestId=frame.id;return true;
    },onBinding(scope,threadId){const ticket=createTickets.get(scope.creationNonce);if(!ticketCurrent(ticket)||!sameScope(scope,ticket.scope)||ticket.binding?.threadId!==threadId||coordinator.sharedThread.verifyBindingSync(ticket.binding)!==true)throw denied();return ticket.binding;}});
   turn=createSharedThreadSendAuthority({getOwnedView,verifyOwnedViewSync,verifyPermissionsSync:(params,binding)=>current()&&provider.executionProof.verifyBoundPermissionSelectionSync(binding,params)===true,verifyBindingSync:binding=>current()&&coordinator?.sharedThread.verifyBindingSync(binding)===true,
    verifyExplicitIntentSync:(binding,frame,control)=>isSharedThreadSendAuthorizationControl(control,binding,frame),verifySelectionSync:(params,binding)=>{
     const model=params.model??params.collaborationMode?.settings?.model,effort=params.effort??params.collaborationMode?.settings?.reasoning_effort;
     return model==null&&effort==null||modelSelection.verifySelectionSync(binding,{model,...effort==null?{}:{reasoningEffort:effort}});
    }});
   turnIpc=createHostSharedThreadSendEndpoint({profileId,generation,verifyCurrentSync:current,sendFrame:writeCreationControl,
    onBinding(target){const binding=sendBindings.get(bindingKey(target));if(!binding||coordinator.sharedThread.verifyBindingSync(binding)!==true||coordinator.sharedThread.verifyHistorySync(binding)!==true)throw denied();return binding;},
    onAuthorize:(binding,frame,control)=>turn.registerSend(binding,frame,control)});
  }
  session=createSharedDesktopDaemonSession({profileId,generation,daemon,daemonVersion,timeoutMs,memoryBudget,verifyContainerSync:current,executionDomain:provider.executionDomain,creation,createdAdoption,turn,modelSelection,artifacts,
   verifySessionSync:()=>current()&&coordinator?.sharedThread.verifyReadSync()===true,
   // Attachments and queued inputs contain persisted bodies. Only an already bound eight-field
   // history capability may read them; a preference edit does not acquire or
   // require a writer, while account/daemon/root/owned-view changes still deny.
   verifyReadSync:frame=>coordinator?.sharedThread.verifyReadSync(frame)===true&&
    (!['thread/attachment/list','thread/queue/list','thread/readState/update'].includes(frame?.method)||threadCurrent(frame.params?.threadId)),
   verifyBindingSync:binding=>coordinator?.sharedThread.verifyBindingSync(binding)===true,
   verifyHistorySync:binding=>coordinator?.sharedThread.verifyHistorySync(binding)===true,
   ...(preserve?{resolveThreadNameBindingSync:createdNameBinding}:{}),
   verifyInitializeSync:result=>result?.codexHome===codexHome&&provider.sharedThread.verifyReadSync()===true,
   verifyStartupNotificationSync:()=>provider.sharedThread.verifyReadSync()===true,
   ...(preserve?{verifyThreadMetadataSync:threadCurrent}:{}),
   verifyInitialAccountNotificationSync:()=>provider.sharedThread.verifyReadSync()===true,
   verifyServerEventSync:frame=>{if(provider.sharedThread.verifyReadSync()!==true)return false;if(!preserve)return true;const classified=classifySharedServerNotification(frame);return classified?.kind==='account'||classified?.kind==='host-metadata'||threadCurrent(classified?.threadId??frame?.params?.threadId);},
   authorizeServerReplySync:(request,response)=>current()&&(!preserve||threadWritable(request?.params?.threadId))&&authorizeServerReplySync(request,response)===true&&(!preserve||threadWritable(request?.params?.threadId)),
   sendFrame:frame=>coordinator.sendDesktopFrame(frame),receiveAuthority:encoded=>coordinator.receiveDesktopDaemon(encoded),onFailure:failed});
  const sharedThread=Object.freeze({...provider.sharedThread,async resolveBinding(request){const binding=await provider.sharedThread.resolveBinding(request);rememberBinding(binding);return binding;},write:encoded=>session.authorityGate.write(encoded)});
  coordinator=createContainerSharedSourceCoordinator({profileId,generation,daemonGeneration:daemon.daemonGeneration,
   daemon:provider.daemon,privateSource,useNativeDirectory,verifyContainerSync:current,getOwnedView,verifyOwnedViewSync,writeNative,sharedThread,
   rpcGate:session.authorityGate,onDesktopFrame:session.receiveNative,onAccountRevision:()=>session.authorizationChanged(),attachDaemonReceiver:false,memoryBudget,onFailure:failed});
  provider.attachNativeAccountRevisionReader(coordinator.accountRevision);
  session.signal.addEventListener('abort',close,{once:true});provider.daemon.signal.addEventListener('abort',()=>failed(Object.assign(denied(),{code:'SHARED_DAEMON_AUTHORITY_REVOKED',phase:'daemon-authority'})),{once:true});
  if(!current()||provider.daemon.signal.aborted||session.signal.aborted)throw denied();
  function receiveNative(frame){
   if(!current())throw denied();
   if(typeof frame?.type==='string'&&frame.type.startsWith('shared-create-')){if(!creationIpc||creationIpc.receive(frame)!==true)throw denied();return true;}
   if(typeof frame?.type==='string'&&frame.type.startsWith('shared-send-')){if(!turnIpc||turnIpc.receive(frame)!==true)throw denied();return true;}
   if(typeof frame?.type==='string'&&frame.type.startsWith('shared-mcp-')){
    if(!nativeAppTools||!isSharedMcpFrame(frame,{side:'native',profileId,generation}))throw denied();
    if(frame.type==='shared-mcp-register'){
     if(mcp||mcpStarting)throw denied();mcpStreamId=frame.streamId;
     mcpStarting=createSharedMcpProxy({profileId,generation,streamId:mcpStreamId,verifyRuntimeSync:current,
      verifyScopeSync:()=>current()&&coordinator.sharedThread.verifyReadSync()===true,
      verifyThreadSync:id=>current()&&coordinator.verifyConnectedThreadSync(id)===true,memoryBudget,timeoutMs,onFailure:failed,
      sendFrame:(value,verifyRequestSync)=>{
       if(!current()||typeof verifyRequestSync!=='function'||verifyRequestSync()!==true||!isSharedMcpFrame(value,{side:'host',profileId,generation})||value.streamId!==mcpStreamId)throw denied();
       return writeNative(encodeWireValue(value),()=>current()&&verifyRequestSync()===true);
      },
     }).then(value=>{
      if(!current()){value.close();throw denied();}mcp=value;
      if(value.receive(frame)!==true)throw denied();
     }).catch(failed);return true;
    }
    if(!mcp||frame.streamId!==mcpStreamId)throw denied();return mcp.receive(frame);
   }
   if(frame?.type==='shared-desktop-open'&&nativeAppTools&&(!mcp?.config||frame.streamId!==mcpStreamId))throw denied();
   return coordinator.receiveNative(frame);
  }
  return Object.freeze({receiveNative,signal:session.signal,
   listDaemon:(...args)=>coordinator.listDaemon(...args),listPrivate:(...args)=>coordinator.listPrivate(...args),
   accountRevision:()=>coordinator.accountRevision(),
   retireView(viewId){for(const ticket of createTickets.values())if(ticket.scope.viewId===viewId)retireTicket(ticket);for(const[key,binding]of sendBindings)if(binding.viewId===viewId){sendBindings.delete(key);const byView=metadataBindings.get(binding.threadId);byView?.delete(viewId);if(!byView?.size)metadataBindings.delete(binding.threadId);}creationIpc?.retireView(viewId);turnIpc?.retireView(viewId);creation?.retireView(viewId);turn?.retireView(viewId);provider.retireView(viewId);coordinator.retireView(viewId);},close});
 }catch(error){close();throw error;}
}
