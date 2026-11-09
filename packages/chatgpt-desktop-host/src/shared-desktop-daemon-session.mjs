import {createConnection} from 'node:net';
import {createRequire} from 'node:module';
import WebSocket from 'ws';
import {captureSharedDaemonIdentity} from './shared-daemon-identity.mjs';
import {createSharedDaemonRpcGate} from './shared-daemon-rpc-gate.mjs';
import {isSupportedDaemonVersion} from './daemon-cli-adapter.mjs';
import {isSharedThreadCreationAuthority,takeSharedThreadCreationReceipt} from './shared-thread-creation.mjs';
import {createSharedCreatedReplyHold,isSharedCreatedThreadAdoption} from './shared-created-thread-adoption.mjs';
import {classifySharedServerNotification} from './shared-server-notification-policy.mjs';
const {isSharedDesktopTransportFrame}=createRequire(import.meta.url)('./native-shared-desktop-transport.cjs');
const {createSharedAuthorityMemoryBudget}=createRequire(import.meta.url)('./shared-thread-authority-channel.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_RESPONSE=2*1024*1024,MAX_QUEUE=8*1024*1024,MAX_WRITES=64;
const deferredMethods=new Set(['configWarning','remoteControl/status/changed','item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval','item/tool/requestUserInput']);
const key=id=>typeof id==='string'?`s:${id}`:Number.isSafeInteger(id)?`n:${id}`:null;
const error=code=>Object.assign(new Error('Shared desktop daemon session unavailable'),{code});
const denied=()=>error('SHARED_DESKTOP_DAEMON_UNAVAILABLE');

/**
 * Fixed trusted-server endpoint for the original desktop SDK transport. A
 * single real Unix WebSocket carries its initialize/read requests and all
 * explicitly authorized shared requests. The separate account observer is not
 * used as a substitute desktop writer. No socket is mounted in the container.
 *
 * verifySessionSync must include the independently verified account, execution
 * domain/tool configuration and current owned container. It is checked again
 * with the captured daemon identity immediately before every actual ws.send.
 * This API never starts, stops or discovers a daemon and is not an HTTP API.
 */
export function createSharedDesktopDaemonSession({profileId,generation,daemon,daemonVersion,verifyContainerSync,verifySessionSync,
 verifyReadSync,verifyBindingSync,verifyHistorySync,verifyInitializeSync,verifyInitialAccountNotificationSync,
 verifyServerEventSync,authorizeServerReplySync,sendFrame,receiveAuthority,onFailure=()=>{},verifyStartupNotificationSync=()=>false,verifyThreadMetadataSync,resolveThreadNameBindingSync,executionDomain,creation,createdAdoption,turn,modelSelection,artifacts,memoryBudget,timeoutMs=15000}={}){
 if(!UUID.test(profileId??'')||!UUID.test(generation??'')||!isSupportedDaemonVersion(daemonVersion)||
    [verifyContainerSync,verifySessionSync,verifyReadSync,verifyBindingSync,verifyHistorySync,verifyInitializeSync,verifyInitialAccountNotificationSync,
     verifyServerEventSync,authorizeServerReplySync,sendFrame,receiveAuthority,onFailure,verifyStartupNotificationSync].some(fn=>typeof fn!=='function')||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||
    (memoryBudget!==undefined&&(!memoryBudget||typeof memoryBudget.reserveBytes!=='function'||typeof memoryBudget.releaseBytes!=='function')))throw denied();
 if((creation!==undefined||createdAdoption!==undefined)&&(!isSharedThreadCreationAuthority(creation)||!isSharedCreatedThreadAdoption(createdAdoption)))throw denied();
 if(verifyThreadMetadataSync!==undefined&&typeof verifyThreadMetadataSync!=='function')throw denied();
 if(resolveThreadNameBindingSync!==undefined&&typeof resolveThreadNameBindingSync!=='function')throw denied();
 const memory=memoryBudget??createSharedAuthorityMemoryBudget(),allocations=new Set();
 const identity=captureSharedDaemonIdentity(daemon),abort=new AbortController(),routes=new Map(),queue=[],inputQueue=[],deliveryReceipts=new Set(),resolutionBarriers=new Map();
 function reserve(bytes){if(memory.reserveBytes(bytes)!==true)throw error('SHARED_DESKTOP_DAEMON_QUEUE_FULL');const token={bytes};allocations.add(token);return token;}
 function release(token){if(allocations.delete(token))memory.releaseBytes(token.bytes);}
 let ws,streamId=null,opened=false,connecting=false,closed=false,initialAccountAccepted=false,accountNotifications=0,openTimer,writeSequence=0,readSequence=0,queuedBytes=0,queuedWrites=0,awaiting=null,writeOrigin=null,initializeReceipt=null,inputBytes=0,heldBytes=0,heldCount=0,inputScheduled,inputDispatching=false;
 const retainedBytes=()=>queuedBytes+queue.reduce((total,item)=>total+item.bytes,0)+inputBytes+heldBytes;
 const retainedCount=()=>queuedWrites+queue.length+inputQueue.length+heldCount;
 const heldMemory={reserveBytes(bytes){if(memory.reserveBytes(bytes)!==true)return false;heldBytes+=bytes;heldCount++;return true;},releaseBytes(bytes){heldBytes-=bytes;heldCount--;memory.releaseBytes(bytes);}};
 function containerCurrent(){try{if(closed||verifyContainerSync()!==true)return false;identity.assertCurrent();return true;}catch{return false;}}
 function current(){try{if(closed||verifySessionSync()!==true)return false;identity.assertCurrent();return true;}catch{return false;}}
 function currentOrThrow(){if(!current())throw denied();}
 const scoped=(type,more={})=>({v:1,type,profileId,generation,streamId,...more});
 function report(code,cause=null,phase=null){
  const failure=error(code);
  if(cause instanceof Error)Object.defineProperty(failure,'cause',{value:cause});
  if(typeof cause?.code==='string'&&/^SHARED_[A-Z_]+$/.test(cause.code))failure.causeCode=cause.code;
  if(UUID.test(cause?.threadId??''))failure.createdThreadId=cause.threadId;
  if(phase)failure.phase=phase;
  try{onFailure(failure);}catch{}
 }
 function emit(type,more={}){
  currentOrThrow();const frame=scoped(type,more);
  if(!isSharedDesktopTransportFrame(frame,{side:'host',profileId,generation}))throw denied();
  const bytes=Buffer.byteLength(JSON.stringify(frame));
  if(retainedCount()>=MAX_WRITES||retainedBytes()+bytes>MAX_QUEUE)throw error('SHARED_DESKTOP_DAEMON_QUEUE_FULL');
  const allocation=reserve(bytes);queuedWrites++;queuedBytes+=bytes;
  let result;
  try{currentOrThrow();result=sendFrame(frame);}catch(cause){queuedWrites--;queuedBytes-=bytes;release(allocation);throw cause;}
  const completion=Promise.resolve(result).catch(cause=>{close('SHARED_DESKTOP_DAEMON_NATIVE_WRITE_FAILED',cause,'native-output');throw cause;})
   .finally(()=>{queuedWrites--;queuedBytes-=bytes;release(allocation);});
  void completion.catch(()=>{});return completion;
 }
 function close(code=null,cause=null,phase=null){
  if(closed)return;
  if(streamId&&current()){try{emit('shared-desktop-retired');}catch{}}
  closed=true;clearTimeout(openTimer);clearTimeout(awaiting?.timer);clearImmediate(inputScheduled);inputScheduled=undefined;inputQueue.length=0;inputBytes=0;awaiting=null;initializeReceipt=null;
  for(const delivery of deliveryReceipts)delivery.reject(error('SHARED_DESKTOP_DAEMON_UNAVAILABLE'));deliveryReceipts.clear();queue.length=0;routes.clear();resolutionBarriers.clear();
  for(const allocation of allocations)release(allocation);
  createdHold?.close();gate.close();identity.close();
  // Source abort listeners synchronously retire the source. Report the actual
  // first failure before those listeners can suppress its owner callback.
  if(code)report(code,cause,phase);
  abort.abort();if(ws&&ws.readyState!==WebSocket.CLOSED)ws.terminate();
 }
 function rawWrite(encoded){
  currentOrThrow();
  if(!writeOrigin||!opened||!ws||ws.readyState!==WebSocket.OPEN||typeof encoded!=='string'||ws.bufferedAmount+Buffer.byteLength(encoded)>MAX_QUEUE)throw denied();
  const value=JSON.parse(encoded);
  // A received resolution invalidates this exact server-response id before
  // the FIFO reaches its original approval observer. Client RPC ids have a
  // separate namespace and are never treated as server approval responses.
  if(!Object.hasOwn(value,'method')&&resolutionBarriers.has(key(value.id)))throw denied();
  if(Object.hasOwn(value,'method')&&Object.hasOwn(value,'id')){
   const id=key(value.id);if(!id||routes.has(id)||routes.size>=MAX_WRITES)throw denied();routes.set(id,writeOrigin);
  }
  // No await, microtask or callback sits between these final guards and the
  // actual write. Callback failure retires the owned stream; it never retries.
  currentOrThrow();identity.assertCurrent();
  ws.send(encoded,{binary:false,compress:false},cause=>{if(cause)close('SHARED_DESKTOP_DAEMON_SOCKET_WRITE_FAILED');});
 }
 const gate=createSharedDaemonRpcGate({verifyReadSync:frame=>current()&&verifyReadSync(frame)===true,
  verifyBindingSync:binding=>current()&&verifyBindingSync(binding)===true,
  verifyHistorySync:binding=>current()&&verifyHistorySync(binding)===true,write:rawWrite,executionDomain,creation,turn,modelSelection,artifacts,
  desktop:{daemonVersion,verifyInitializeSync:result=>current()&&verifyInitializeSync(result)===true,
   ...(resolveThreadNameBindingSync?{resolveThreadNameBindingSync:threadId=>current()?resolveThreadNameBindingSync(threadId):null}:{}),
   registerInitializeConsumptionSync:receipt=>{
    if(initializeReceipt||!receipt||typeof receipt.consumeSync!=='function')throw denied();initializeReceipt=receipt;
   },
   deliverUnsupportedReadSync:response=>{currentOrThrow();toNative(JSON.stringify(response));},
   deliverUnsupportedCapabilitySync:response=>{currentOrThrow();toNative(JSON.stringify(response));},
   verifyStartupNotificationSync:frame=>current()&&verifyStartupNotificationSync(frame)===true,
   verifyInitialAccountNotificationSync:frame=>{
    const accepted=current()&&verifyInitialAccountNotificationSync(frame)===true;
    if(accepted)initialAccountAccepted=true;return accepted;
   },
   verifyServerEventSync:frame=>current()&&verifyServerEventSync(frame)===true,
   authorizeServerReplySync:(request,response)=>current()&&authorizeServerReplySync(request,response)===true}});
 const createdHold=creation?createSharedCreatedReplyHold({creationAuthority:creation,adoption:createdAdoption,verifyCurrentSync:current,memoryBudget:heldMemory,
  getQueuedBytes:()=>queuedBytes+queue.reduce((total,item)=>total+item.bytes,0)+inputBytes,getQueuedWrites:()=>queuedWrites+queue.length+inputQueue.length,
  pauseInput:()=>ws.pause(),resumeInput:resumeIfIdle,
  releaseReply:(text,binding)=>{
   currentOrThrow();const frame=JSON.parse(text),id=key(frame.id);
   if(!id||routes.get(id)!=='native'||frame.result?.thread?.id!==binding.threadId||verifyBindingSync(binding)!==true||verifyHistorySync(binding)!==true)throw denied();
   routes.delete(id);return toNative(text,null,true);
  },releaseFollowing:(data,binary)=>processMessage(data,binary),onFailure:cause=>close('SHARED_DESKTOP_DAEMON_CREATED_ADOPTION_FAILED',cause,'created-adoption')}):null;
 function writeAs(origin,encoded){
  currentOrThrow();if(writeOrigin!==null)throw denied();writeOrigin=origin;
  try{return gate.write(encoded);}finally{writeOrigin=null;}
 }
 function pump(){
  if(closed||awaiting||!queue.length)return;
  const item=queue[0],sequence=++readSequence;
  if(!Number.isSafeInteger(sequence))return close('SHARED_DESKTOP_DAEMON_QUEUE_FULL');
  const timer=setTimeout(()=>close('SHARED_DESKTOP_DAEMON_NATIVE_CONSUMPTION_TIMEOUT',null,awaiting?.written?'native-consumption':'native-output-pending'),timeoutMs);timer.unref?.();
  awaiting={sequence,item,timer,written:false};
  try{
   const completion=emit('shared-desktop-message',{sequence,text:item.text});
   void completion.then(()=>{
    if(awaiting?.sequence===sequence)awaiting.written=true;
    if(item.delivery){item.delivery.written=true;finishDelivery(item.delivery);}
   },cause=>{if(item.delivery)rejectDelivery(item.delivery,cause);});
  }catch(cause){if(item.delivery)rejectDelivery(item.delivery,cause);close('SHARED_DESKTOP_DAEMON_NATIVE_WRITE_FAILED',cause,'native-output');}
 }
 function finishDelivery(delivery){if(deliveryReceipts.has(delivery)&&delivery.written&&delivery.consumed){deliveryReceipts.delete(delivery);delivery.resolve();}}
 function rejectDelivery(delivery,cause){if(deliveryReceipts.delete(delivery))delivery.reject(cause);}
 function toNative(text,initialization=null,waitForDelivery=false){
  const bytes=Buffer.byteLength(text);
  if(bytes>MAX_RESPONSE||retainedCount()>=MAX_WRITES||retainedBytes()+bytes>MAX_QUEUE)throw error('SHARED_DESKTOP_DAEMON_QUEUE_FULL');
  const allocation=reserve(bytes),item={text,bytes,allocation,initialization};let receipt;
  if(waitForDelivery){const delivery={written:false,consumed:false};receipt=new Promise((resolve,reject)=>{delivery.resolve=resolve;delivery.reject=reject;});void receipt.catch(()=>{});item.delivery=delivery;deliveryReceipts.add(delivery);}
  queue.push(item);ws.pause();pump();return receipt;
 }
 function resumeIfIdle(){if(!closed&&opened&&!queue.length&&!awaiting&&!inputQueue.length&&!createdHold?.active)ws.resume();}
 function scheduleInput(){
  if(closed||inputScheduled||inputDispatching||!inputQueue.length)return;
  inputScheduled=setImmediate(()=>{inputScheduled=undefined;drainInput();});
 }
 function drainInput(){
  if(closed||inputDispatching||!inputQueue.length)return;
  const item=inputQueue.shift();inputBytes-=item.bytes;release(item.allocation);inputDispatching=true;
  try{if(!createdHold?.bufferFollowing(item.data,false))processMessage(item.data,false);}
  catch(cause){close('SHARED_DESKTOP_DAEMON_RESPONSE_DENIED',cause,'daemon-receive');}
  finally{inputDispatching=false;if(!closed){scheduleInput();resumeIfIdle();}}
 }
 function onMessage(data,binary){
  if(closed)return;
  // Preserve the original synchronous initialize/first account confirmation.
  // Once confirmed, normal receiver batches must yield to the native JSONL
  // reader. No permission or identity decision is cached across that yield.
  if(!initialAccountAccepted){if(createdHold?.bufferFollowing(data,binary))return;processMessage(data,binary);return;}
  try{
   if(binary||!(data instanceof Uint8Array)||data.byteLength>MAX_RESPONSE)throw denied();
   const frame=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
   if(!frame||typeof frame!=='object'||Array.isArray(frame))throw denied();
   // A later account notice revokes immediately, before queued dispatch or a
   // native continuation can write. It cannot wait behind the metadata batch.
   if(frame.method==='account/updated'){close('SHARED_DESKTOP_DAEMON_ACCOUNT_CHANGED');return;}
   // Unknown notifications may revoke authority. Their existing rejection
   // must remain immediate; only recognized metadata/requests may be deferred.
   if(Object.hasOwn(frame,'method')&&!classifySharedServerNotification(frame)&&!deferredMethods.has(frame.method))throw denied();
   const bytes=data.byteLength;
   if(retainedCount()>=MAX_WRITES||retainedBytes()+bytes>MAX_QUEUE)throw error('SHARED_DESKTOP_DAEMON_QUEUE_FULL');
   if(frame.method==='serverRequest/resolved'){const id=key(frame.params.requestId);resolutionBarriers.set(id,(resolutionBarriers.get(id)??0)+1);}
   const allocation=reserve(bytes);
   inputQueue.push({data:Buffer.from(data),bytes,allocation});inputBytes+=bytes;
   ws.pause();scheduleInput();
  }catch(cause){close('SHARED_DESKTOP_DAEMON_RESPONSE_DENIED',cause,'daemon-receive');}
 }
 function processMessage(data,binary){
  let resolutionId;
  try{
   currentOrThrow();if(binary||data.length>MAX_RESPONSE)throw denied();
   const text=new TextDecoder('utf-8',{fatal:true}).decode(data),frame=JSON.parse(text);
   if(!frame||typeof frame!=='object'||Array.isArray(frame))throw denied();
   if(frame.method==='serverRequest/resolved')resolutionId=key(frame.params?.requestId);
   if(verifyThreadMetadataSync){
    const classified=classifySharedServerNotification(frame);
    if(classified?.threadId){
     if(verifyThreadMetadataSync(classified.threadId)!==true)return;
     if(frame.method==='thread/started'){
      const t=frame.params.thread;
      if((t.turns!==undefined&&(!Array.isArray(t.turns)||t.turns.length!==0))||Object.hasOwn(t,'items')||Object.hasOwn(t,'messages'))throw denied();
     }
    }
   }
   if(Object.hasOwn(frame,'method')){
    const checked=gate.receive(text);if(checked!==text)throw denied();
    if(frame.method==='account/updated'&&(!initialAccountAccepted||++accountNotifications!==1)){
     close('SHARED_DESKTOP_DAEMON_ACCOUNT_CHANGED');return;
    }
    // Thread events use the existing exact follower/approval path once. Sending
    // them to both SDK and that path would apply one original event twice.
    if(typeof frame.params?.threadId==='string'){
     if(receiveAuthority(text)!==true)throw denied();
    }else toNative(text);
    return;
   }
   const id=key(frame.id),origin=id&&routes.get(id);if(!origin)throw denied();
   if(origin==='native'){
    if(gate.receive(text)!==text)throw denied();
    const receipt=creation?takeSharedThreadCreationReceipt(creation,frame.id):null;
    if(receipt){if(createdHold.begin(receipt,text)!==true)throw denied();return;}
    routes.delete(id);toNative(text,initializeReceipt?.responseId===frame.id?initializeReceipt:null);
   }else{
    // The authority channel calls this same gate's receive exactly once while
    // producing its already-budgeted RPC reply. It cannot adopt native IDs.
    if(receiveAuthority(text)!==true||routes.has(id))throw denied();
   }
  }catch(cause){close('SHARED_DESKTOP_DAEMON_RESPONSE_DENIED',cause,'daemon-receive');}
  finally{
   // After normal FIFO dispatch, observeResolved has retired the old approval.
   // Held creation frames keep this barrier until their real later dispatch.
   const remaining=resolutionBarriers.get(resolutionId);if(remaining===1)resolutionBarriers.delete(resolutionId);else if(remaining>1)resolutionBarriers.set(resolutionId,remaining-1);
  }
 }
 async function open(){
  currentOrThrow();
  ws=new WebSocket('ws://localhost/',{createConnection:()=>{
   currentOrThrow();return createConnection({path:daemon.socketPath});
  },perMessageDeflate:false,maxPayload:MAX_RESPONSE,handshakeTimeout:timeoutMs});
  ws.on('message',onMessage);ws.on('error',()=>close('SHARED_DESKTOP_DAEMON_SOCKET_FAILED'));
  ws.on('close',()=>close('SHARED_DESKTOP_DAEMON_SOCKET_CLOSED'));
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>done(denied()),timeoutMs);
   const done=cause=>{clearTimeout(timer);ws.off('open',openedHandler);abort.signal.removeEventListener('abort',aborted);cause?reject(cause):resolve();};
   const openedHandler=()=>done(),aborted=()=>done(denied());
   ws.once('open',openedHandler);abort.signal.addEventListener('abort',aborted,{once:true});
   if(abort.signal.aborted)aborted();
  });
  currentOrThrow();opened=true;clearTimeout(openTimer);emit('shared-desktop-ready');
 }
 function authorizationChanged(){
  if(closed)return;
  if(!containerCurrent())return close('SHARED_DESKTOP_DAEMON_IDENTITY_CHANGED');
  if(opened||connecting){if(!current())close('SHARED_DESKTOP_DAEMON_AUTHORITY_REVOKED');return;}
  if(streamId&&current()){connecting=true;void open().catch(cause=>close('SHARED_DESKTOP_DAEMON_OPEN_FAILED',cause,'desktop-open'));}
 }
 function receiveNative(frame){
  if(typeof frame?.type!=='string'||!frame.type.startsWith('shared-desktop-'))return false;
  try{
   if(!containerCurrent()||!isSharedDesktopTransportFrame(frame,{side:'native',profileId,generation}))throw denied();
   if(frame.type==='shared-desktop-open'){
    if(streamId!==null)throw denied();streamId=frame.streamId;
    openTimer=setTimeout(()=>close('SHARED_DESKTOP_DAEMON_AUTHORITY_TIMEOUT'),timeoutMs);openTimer.unref?.();
    authorizationChanged();return true;
   }
   if(frame.streamId!==streamId)throw denied();
   if(frame.type==='shared-desktop-close'){close();return true;}
   currentOrThrow();if(!opened)throw denied();
   if(frame.type==='shared-desktop-received'){
    if(!awaiting||frame.sequence!==awaiting.sequence)throw denied();
    const item=queue[0];if(item.initialization){
     // The fixed native transport emits this ACK only after the original SDK's
     // onmessage returns. An ACK for any other output cannot confirm initialize.
     if(item.initialization!==initializeReceipt||initializeReceipt.consumeSync()!==true)throw denied();initializeReceipt=null;
    }
    clearTimeout(awaiting.timer);release(queue.shift().allocation);awaiting=null;
    if(item.delivery){item.delivery.consumed=true;finishDelivery(item.delivery);}
    pump();resumeIfIdle();return true;
   }
   if(frame.type==='shared-desktop-write'){
    if(frame.sequence!==writeSequence+1)throw denied();writeSequence=frame.sequence;writeAs('native',frame.text);emit('shared-desktop-written',{sequence:frame.sequence});return true;
   }
   throw denied();
  }catch(cause){close('SHARED_DESKTOP_DAEMON_REQUEST_DENIED',cause,'native-request');throw cause;}
 }
 const authorityGate=Object.freeze({
  registerConnect:(...args)=>{currentOrThrow();return gate.registerConnect(...args);},
  write:encoded=>writeAs('authority',encoded),
  receive(encoded){
   currentOrThrow();const frame=JSON.parse(encoded),id=key(frame.id);if(!id||routes.get(id)!=='authority')throw denied();
   const checked=gate.receive(encoded);routes.delete(id);return checked;
  },close,
 });
 return Object.freeze({receiveNative,authorityGate,authorizationChanged,signal:abort.signal,close});
}
