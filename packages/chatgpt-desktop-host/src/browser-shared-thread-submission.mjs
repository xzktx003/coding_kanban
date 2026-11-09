const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const atom=x=>typeof x==='string'&&x.length>0&&x.length<=256&&!/[\x00-\x1f\x7f]/.test(x);
const PHASES=new Set(['request','configuration','scope','gesture-missing','gesture-used','gesture-expired','committed','target','identity','lifecycle','budget','intent','consume','create-target','no-submission']);
const denied=(phase='request')=>Object.assign(new Error('Shared composer submit unavailable'),{code:'SHARED_COMPOSER_SUBMIT_DENIED',phase:PHASES.has(phase)?phase:'request'});
/** The fixed original submit callback must run inside its original React
 * delegate's trusted click/Enter frame. The committed composer supplies the
 * identity; DOM text, URLs and an ordinary editing token never grant native
 * send rights. Native and server gates independently authorize actual writes.
 */
export function createBrowserSharedThreadSubmission({window:win,documentScope,sendMessage,getLifecycle,getComposer,isCurrent,timeoutMs=30000}={}){
 if(!win?.document||typeof win.crypto?.randomUUID!=='function'||[sendMessage,getLifecycle,getComposer,isCurrent].some(x=>typeof x!=='function'))throw denied();
 const flows=new Map(),observed=new WeakSet(),roots=new WeakSet();let active=null,invoking=null,captureTimer=null,disposed=false,firstDenial=null;
 const current=()=>{try{return !disposed&&isCurrent()===true}catch{return false}};
 function committed(){try{const capability=getComposer();const snapshot=capability?.getCommittedTarget?.();return snapshot?.target&&snapshot.editorDom?.isConnected===true&&snapshot.editorDom.ownerDocument===win.document?snapshot:null}catch{return null}}
 function same(a,b){return a&&b&&['hostId','conversationId','clientThreadId'].every(k=>a[k]===b[k])}
 function valid(flow){const life=getLifecycle();return current()&&flows.get(flow.attemptId)===flow&&life===flow.life&&!!life?.epoch&&same(committed()?.target,flow.target)}
 function finish(flow){if(flows.get(flow.attemptId)!==flow)return;flows.delete(flow.attemptId);win.clearTimeout(flow.timer);flow.rejectAck?.(denied());flow.rejectAck=null;}
 function invalidate(){active=null;if(captureTimer!==null){win.clearTimeout(captureTimer);captureTimer=null;}for(const flow of flows.values())finish(flow)}
 function originalRoot(root){try{return typeof win.Element==='function'&&root instanceof win.Element&&root.ownerDocument===win.document&&root.isConnected===true&&win.document.getElementById('root')===root}catch{return false}}
 // Capture only an event actually dispatching through the registered original
 // React root. Nested delegates can stop its bubble. No submit is synthesized:
 // only the pinned composer callback can consume this one event frame.
 function captureGesture(event){
  const click=event?.type==='click'&&event instanceof win.MouseEvent&&event.button===0;
  const enter=event?.type==='keydown'&&event instanceof win.KeyboardEvent&&event.key==='Enter'&&!event.repeat&&!event.isComposing&&!event.shiftKey&&!event.altKey;
  if(!current()||!(event instanceof win.Event)||event.isTrusted!==true||(!click&&!enter)||event.defaultPrevented||observed.has(event)||![1,2,3].includes(event.eventPhase))return;
  const root=win.document.getElementById('root'),snapshot=committed();
  if(!originalRoot(root)||!roots.has(root)||!snapshot||snapshot.canSubmit!==true||!root.contains(snapshot.editorDom)||!root.contains(event.target))return;
  if(enter&&event.target!==snapshot.editorDom&&!snapshot.editorDom.contains?.(event.target))return;
  const path=event.composedPath();if(!Array.isArray(path)||path.length>256||!path.includes(root))return;
  const frame={event,consumed:false};active=frame;if(captureTimer!==null)win.clearTimeout(captureTimer);
  // Microtasks can run between native listeners. eventPhase closes the frame
  // synchronously after dispatch; this task only reclaims its short reference.
  captureTimer=win.setTimeout(()=>{if(active===frame)active=null;captureTimer=null},0);
 }
 win.document.addEventListener?.('keydown',captureGesture,{capture:true,passive:true});
 win.document.addEventListener?.('click',captureGesture,{capture:true,passive:true});
 function wrapDelegatedListener(root,listener){
  if(originalRoot(root))roots.add(root);
  return function(...args){const event=args[0],prior=active;active=prior?.event===event?prior:null;
   try{
    if(current()&&event instanceof win.Event&&event.isTrusted===true&&!observed.has(event)&&event.currentTarget===root&&[2,3].includes(event.eventPhase)&&!event.defaultPrevented&&
       ((event.type==='click'&&event instanceof win.MouseEvent&&event.button===0)||(event.type==='keydown'&&event instanceof win.KeyboardEvent&&event.key==='Enter'&&!event.repeat&&!event.isComposing&&!event.shiftKey&&!event.altKey))){
      const path=event.composedPath();if(Array.isArray(path)&&path.length<=256&&path.includes(root))active??={event,consumed:false};
    }
    return Reflect.apply(listener,this,args);
   }finally{active=prior;}
  };
 }
 function intent(flow,details){
  if(!valid(flow)||flow.intentSent)throw denied();flow.intentSent=true;
  const type=flow.target.conversationId===null?'create':'send';
  let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});flow.resolveAck=resolve;flow.rejectAck=reject;
  const frame={type:'kanban-shared-'+type+'-intent',v:1,action:type,...documentScope,hostId:'kanban-shared-cli',...details,attemptId:flow.attemptId,sequence:flow.life.sequence,epoch:flow.life.epoch};
  void Promise.resolve(flow.life.promise).then(()=>{if(!valid(flow))throw denied();return sendMessage(frame)}).then(()=>{if(!valid(flow))throw denied();flow.sent=true;if(flow.ack!==undefined)settleAck(flow,flow.ack)},()=>finish(flow)).catch(()=>finish(flow));
  return promise;
 }
 function settleAck(flow,accepted){if(!valid(flow)||!flow.sent)return;if(accepted){flow.resolveAck?.();flow.resolveAck=null;flow.rejectAck=null;}else finish(flow)}
 function receive(event){
  const frame=event?.data;if(event?.source!==null||!frame||!['kanban-shared-create-intent-ack','kanban-shared-send-intent-ack'].includes(frame.type))return false;
  const flow=flows.get(frame.attemptId);if(!flow||!valid(flow)||typeof frame.accepted!=='boolean'||frame.sequence!==flow.life.sequence||frame.epoch!==flow.life.epoch)return true;
  const expected=flow.target.conversationId===null?'kanban-shared-create-intent-ack':'kanban-shared-send-intent-ack';
  if(frame.type!==expected||Object.keys(frame).sort().join(',')!=='accepted,attemptId,epoch,sequence,type')return true;
  flow.ack=frame.accepted;if(flow.sent)settleAck(flow,frame.accepted);return true;
 }
 // Only the pinned HG branch that really queued this original submission can
 // mark it while its original bf callback is still on the synchronous stack.
 // A resolved Promise alone is not evidence of deferral. PG resumes HG directly
 // later, without another bf gesture; neither this marker nor PG resets the TTL.
 function markComposerDeferred(identity){
  const flow=invoking;
  if(!flow||!identity||Object.keys(identity).sort().join(',')!=='clientThreadId,conversationId'||
     flow.claimed||!valid(flow)||identity.conversationId!==flow.target.conversationId||identity.clientThreadId!==flow.target.clientThreadId)return false;
  flow.deferred=true;return true;
 }
 function wrapComposerSubmit(original,getModel,onError=()=>{}){
  if(typeof original!=='function'||typeof getModel!=='function'||typeof onError!=='function')throw denied();
  const report=error=>{if(['SHARED_COMPOSER_SUBMIT_DENIED','SHARED_PROJECT_SELECTION_UNAVAILABLE'].includes(error?.code)){if(firstDenial===null&&error.code==='SHARED_COMPOSER_SUBMIT_DENIED'){firstDenial=PHASES.has(error.phase)?error.phase:'request';try{win.console?.warn?.('CHATGPT_SHARED_COMPOSER_DENIED '+firstDenial)}catch{}}try{Promise.resolve(onError(error)).catch(()=>{})}catch{}}return error};
  return function(...args){let model;try{model=getModel()}catch(error){throw report(error)}if(model?.hostId!=='kanban-shared-cli')return Reflect.apply(original,this,args);
   const capture=active,snapshot=committed(),life=getLifecycle(),target=snapshot?.target;
   if(!current())throw report(denied('scope'));
   if(!capture)throw report(denied('gesture-missing'));
   if(capture.consumed||observed.has(capture.event))throw report(denied('gesture-used'));
   if(![1,2,3].includes(capture.event.eventPhase))throw report(denied('gesture-expired'));
   if(snapshot?.canSubmit!==true||!target)throw report(denied('committed'));
   if(target.hostId!==model.hostId||target.conversationId!==model.conversationId)throw report(denied('target'));
   if(!atom(target.clientThreadId))throw report(denied('identity'));
   if(!life?.epoch)throw report(denied('lifecycle'));
   if(flows.size>=16)throw report(denied('budget'));
   if(capture.event.type==='keydown'&&capture.event.target!==snapshot.editorDom&&!snapshot.editorDom.contains?.(capture.event.target))throw report(denied());
   if(target.conversationId!==null&&!UUID.test(target.conversationId??''))throw report(denied());
   capture.consumed=true;observed.add(capture.event);
   const attemptId=win.crypto.randomUUID();if(!UUID.test(attemptId)||flows.has(attemptId))throw report(denied());
   const flow={attemptId,target:Object.freeze({...target}),life,claimed:false,deferred:false,intentSent:false,timer:null};flows.set(attemptId,flow);flow.timer=win.setTimeout(()=>finish(flow),timeoutMs);
   // Start the actual original callback in this exact event stack. It captures
   // its own editor text/settings before any new native-authorization await.
   let result;const priorInvoking=invoking;
   try{
    if(target.conversationId!==null){flow.intentPromise=intent(flow,{threadId:target.conversationId});void flow.intentPromise.catch(()=>{});}
    invoking=flow;
    result=Reflect.apply(original,this,args);
   }catch(error){finish(flow);throw report(error)}finally{invoking=priorInvoking}
   return Promise.resolve(result).then(value=>{if((!flow.claimed||!flow.intentSent)&&!flow.deferred)throw denied('no-submission');return value}).catch(error=>{finish(flow);throw report(error)}).finally(()=>{if(!flow.deferred)finish(flow)});
  };
 }
 async function consumeComposerSubmit({hostId,conversationId,clientThreadId}={}){
  if(hostId!=='kanban-shared-cli')return null;
  const matching=[...flows.values()].filter(f=>valid(f)&&!f.claimed&&f.target.hostId===hostId&&f.target.conversationId===conversationId&&(conversationId!==null||f.target.clientThreadId===clientThreadId));
  if(matching.length!==1)throw denied('consume');const flow=matching[0];flow.claimed=true;
  if(conversationId!==null){await flow.intentPromise;if(!valid(flow))throw denied();finish(flow);}
  return conversationId===null?{__kanbanSharedCreateAttempt:flow.attemptId,__kanbanSharedCreateClient:clientThreadId}:{__kanbanSharedSendAttempt:flow.attemptId};
 }
 async function prepareComposerCreate({hostId,clientThreadId,attemptId,projectId,cwd}={}){
  if(hostId!=='kanban-shared-cli')return {};
  const flow=flows.get(attemptId);
  if(!flow||!valid(flow)||!flow.claimed||flow.target.conversationId!==null||flow.target.clientThreadId!==clientThreadId||!atom(projectId)||typeof cwd!=='string'||!cwd.startsWith('/')||cwd.length>4096||/[\x00-\x1f\x7f]/.test(cwd))throw denied();
  await intent(flow,{projectId,cwd,clientThreadId});if(!valid(flow))throw denied();finish(flow);
  return {__kanbanSharedCreateAttempt:attemptId,__kanbanSharedCreateClient:clientThreadId};
 }
 return Object.freeze({wrapDelegatedListener,wrapComposerSubmit,markComposerDeferred,consumeComposerSubmit,prepareComposerCreate,receive,invalidate,dispose(){if(disposed)return;disposed=true;win.document.removeEventListener?.('keydown',captureGesture,{capture:true});win.document.removeEventListener?.('click',captureGesture,{capture:true});invalidate()}});
}
