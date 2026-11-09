import { createBrowserSidebarNavigationProbe } from "./browser-sidebar-navigation-probe.mjs";
import { createRootWithDelegateProbe } from "./browser-react-root-probe.mjs";
import { createBrowserSharedThreadSubmission } from "./browser-shared-thread-submission.mjs";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PENDING=16;
const failure=()=>Object.assign(new Error("Shared thread navigation unavailable"),{code:"SHARED_NAV_UNAVAILABLE"});
const object=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).sort().join(",")===keys.slice().sort().join(",");
const atom=value=>typeof value==="string"&&value.length>0&&value.length<=256&&!/[\x00-\x1f\x7f]/.test(value);

/** One document's trusted-event -> original route -> per-view intent handoff. */
export function createBrowserSharedThreadNavigation(options={},dependencies={}) {
  const {window:win,documentScope,scopeLease,sendMessage,timeoutMs=30000,onFailure=()=>{},getComposer=()=>null,isSourceReady=()=>false,subscribeSource=()=>()=>{}}=options;
  const createProbe=dependencies.createProbe??createBrowserSidebarNavigationProbe;
  const createRoot=dependencies.createRoot??createRootWithDelegateProbe;
  if(!win?.document||typeof win.addEventListener!=="function"||typeof win.removeEventListener!=="function"||
     typeof win.crypto?.randomUUID!=="function"||!scopeLease||typeof scopeLease.getSnapshot!=="function"||
     typeof scopeLease.isCurrent!=="function"||typeof scopeLease.subscribe!=="function"||
     typeof sendMessage!=="function"||typeof onFailure!=="function"||typeof createProbe!=="function"||typeof createRoot!=="function"||typeof isSourceReady!=="function"||typeof subscribeSource!=="function"||
     !Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||
     !exact(documentScope,["profileId","generation","viewId"])||
     ![documentScope.profileId,documentScope.generation,documentScope.viewId].every(value=>UUID.test(value??""))) throw failure();
  const scope=Object.freeze({...documentScope}),retired=new WeakSet(),pending=new Map(),approvals=new Map(),hostBindings=new Set();
  let disposed=false,failed=false,token=null,probe=null,life=null,sequence=0,unsubscribe,originalNavigate=null,submission=null;
  let readySettled=false,resolveReady,rejectReady;
  const readyPromise=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject});
  void readyPromise.catch(()=>{});
  const isToken=value=>value!==null&&(typeof value==="object"||typeof value==="function");
  function retire(record){
    if(pending.get(record.candidate.attemptId)!==record)return;
    pending.delete(record.candidate.attemptId);win.clearTimeout(record.timer);
    if(!record.settled){record.settled=true;record.resolve(false)}
  }
  function finish(record,accepted=false){
    if(pending.get(record.candidate.attemptId)!==record||record.settled)return;
    record.settled=true;record.resolve(accepted);
    if(!accepted||record.claimed)retire(record);
  }
  function invalidate(){
    submission?.invalidate();
    if(isToken(token))retired.add(token);
    token=null;
    if(probe){probe.dispose();probe=null;}
    for(const record of pending.values())retire(record);
    for(const record of approvals.values())settleApproval(record,record.sent?"unknown":"denied");
    if(life){win.clearTimeout(life.timer);life.resolve(false);life=null;}
  }
  function fail(){
    if(disposed||failed)return;
    failed=true;invalidate();
    if(!readySettled){readySettled=true;rejectReady(failure());}
    try{onFailure({code:"SHARED_NAV_UNAVAILABLE"})}catch{}
  }
  function current(expected=token){
    if(disposed||failed||!isToken(expected)||token!==expected)return false;
    try{return scopeLease.getSnapshot()===expected&&scopeLease.isCurrent(expected)===true&&!retired.has(expected)}catch{return false}
  }
  function settleLife(record){
    if(disposed||failed||life!==record||!record.sent||!record.ack)return;
    win.clearTimeout(record.timer);record.resolve(true);
    if(!readySettled){readySettled=true;resolveReady();}
  }
  function publish(next){
    invalidate();
    if(disposed||failed)return;
    if(sequence>=Number.MAX_SAFE_INTEGER){fail();return;}
    if(isToken(next)&&!retired.has(next)){
      try{if(scopeLease.isCurrent(next)===true)token=next}catch{}
    }
    let epoch=null;
    try{if(token)epoch=win.crypto.randomUUID()}catch{fail();return}
    if(epoch!==null&&!UUID.test(epoch)){fail();return;}
    let resolve;
    const promise=new Promise(done=>{resolve=done});
    const record={sequence:++sequence,epoch,token,promise,resolve,sent:false,ack:false,timer:null};
    life=record;
    record.timer=win.setTimeout(()=>{if(life===record)fail()},timeoutMs);
    if(token){
      try{probe=createProbe({window:win,documentScope:scope,scopeLease,onAttempt});}
      catch{fail();return;}
    }
    try{
      const sent=sendMessage({type:"kanban-shared-connect-lifecycle",sequence:record.sequence,epoch:record.epoch});
      Promise.resolve(sent).then(()=>{if(life===record&&!disposed&&!failed){record.sent=true;settleLife(record)}},()=>{if(life===record)fail()});
    }catch{fail()}
  }
  function observeScope(){
    if(disposed||failed)return;
    let next=null;try{next=scopeLease.getSnapshot()}catch{}
    publish(next);
  }
  // The pinned original WE supplies its real scope and Uh host-list atom.
  // Appending this verified host lets the original tm factory subscribe to
  // AppHost.appServerManagers and publish its own Gh.client; no client is made
  // here. Only this binding's added entry is removed during retirement.
  function bindAppServerHosts(originalScope,hostsAtom){
    if(disposed||failed||!originalScope||typeof originalScope.get!=="function"||typeof originalScope.set!=="function"||typeof originalScope.watch!=="function"||!object(hostsAtom)||hostBindings.size!==0)throw failure();
    let closed=false,owned=false,offScope=null,offSource=null,offHosts=null,reconciling=false,again=false;
    const eligible=()=>{try{return !closed&&current()&&isSourceReady()===true}catch{return false}};
    function removeOwned(){
      if(!owned)return;
      owned=false;originalScope.set(hostsAtom,hosts=>{if(!Array.isArray(hosts))throw failure();return hosts.includes("kanban-shared-cli")?hosts.filter(host=>host!=="kanban-shared-cli"):hosts});
    }
    function release(){
      if(closed)return;closed=true;hostBindings.delete(release);
      try{offHosts?.()}catch{}try{offScope?.()}catch{}try{offSource?.()}catch{}
      offHosts=null;offScope=null;offSource=null;try{removeOwned()}catch{fail()}
    }
    function reconcile(){
      if(closed)return;
      if(!eligible()){removeOwned();return}
      const existing=originalScope.get(hostsAtom);if(!Array.isArray(existing))throw failure();
      if(existing.includes("kanban-shared-cli"))return;
      originalScope.set(hostsAtom,hosts=>{if(!Array.isArray(hosts))throw failure();if(!eligible()||hosts.includes("kanban-shared-cli"))return hosts;owned=true;return [...hosts,"kanban-shared-cli"]});
    }
    const observe=()=>{
      if(closed)return;if(reconciling){again=true;return}reconciling=true;
      try{let passes=0;do{again=false;reconcile();if(++passes>=4&&again)throw failure()}while(again&&!closed)}catch{release();fail()}finally{reconciling=false}
    };
    hostBindings.add(release);
    try{offScope=scopeLease.subscribe(observe);offSource=subscribeSource(observe);offHosts=originalScope.watch(scope=>{if(closed)return;scope.get(hostsAtom);observe()});if(typeof offScope!=="function"||typeof offSource!=="function"||typeof offHosts!=="function")throw failure();observe()}catch(error){release();throw error}
    return release;
  }
  function onAttempt(candidate){
    const hasSourceToken=object(candidate)&&Object.hasOwn(candidate,"sourceToken");
    if(!current()||!life||!exact(candidate,["v","action","attemptId","profileId","generation","viewId","hostId","threadId",...(hasSourceToken?["sourceToken"]:[])])||
       (hasSourceToken&&(typeof candidate.sourceToken!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(candidate.sourceToken)))||candidate.v!==1||candidate.action!=="connect"||!UUID.test(candidate.attemptId??"")||!UUID.test(candidate.threadId??"")||
       !atom(candidate.hostId)||candidate.profileId!==scope.profileId||candidate.generation!==scope.generation||candidate.viewId!==scope.viewId||
       pending.size>=MAX_PENDING||pending.has(candidate.attemptId))return;
    const captured=life, capturedToken=token;
    let resolve;const accepted=new Promise(done=>{resolve=done});
    const record={candidate,captured,capturedToken,accepted,resolve,sent:false,ack:null,timer:null};
    pending.set(candidate.attemptId,record);
    record.timer=win.setTimeout(()=>retire(record),timeoutMs);
    void (async()=>{
      if(!await captured.promise||life!==captured||!current(capturedToken)||pending.get(candidate.attemptId)!==record){finish(record);return}
      try{
        await sendMessage({type:"kanban-shared-connect-intent",...candidate,sequence:captured.sequence,epoch:captured.epoch});
        if(life!==captured||!current(capturedToken)||pending.get(candidate.attemptId)!==record){finish(record);return}
        record.sent=true;if(record.ack!==null)finish(record,record.ack);
      }catch{finish(record)}
    })();
  }
  function approvalError(state){return Object.assign(new Error("Shared approval unavailable"),{code:state==="unknown"?"SHARED_APPROVAL_OUTCOME_UNKNOWN":"SHARED_APPROVAL_DENIED"})}
  function settleApproval(record,state){
    if(approvals.get(record.actionId)!==record)return;
    approvals.delete(record.actionId);win.clearTimeout(record.timer);
    if(state==="resolved")record.resolve();else record.reject(approvalError(state));
  }
  // Called synchronously by the pinned original approval-button callbacks,
  // before their own optional asynchronous approval-nudge flow.
  function beginApproval(target){
    if(!current()||!life||!life.epoch||!exact(target,["hostId","threadId","requestId","itemId"])||
       !atom(target.hostId)||!UUID.test(target.threadId??"")||
       !(atom(target.requestId)||(Number.isSafeInteger(target.requestId)&&target.requestId>=0))||!atom(target.itemId))return null;
    const captured=life,capturedToken=token,identity=Object.freeze({...target});let used=false;
    return Object.freeze({async send(requestId,decision){
      if(used||requestId!==identity.requestId||approvals.size>=MAX_PENDING)throw approvalError("denied");
      used=true;
      let copy;try{copy=JSON.parse(JSON.stringify(decision))}catch{throw approvalError("denied")}
      if(!await captured.promise||life!==captured||!current(capturedToken))throw approvalError("denied");
      let actionId;try{actionId=win.crypto.randomUUID()}catch{throw approvalError("denied")}
      if(!UUID.test(actionId)||approvals.has(actionId))throw approvalError("denied");
      let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});
      const record={actionId,captured,capturedToken,resolve,reject,sent:false,timer:null};
      approvals.set(actionId,record);
      record.timer=win.setTimeout(()=>settleApproval(record,record.sent?"unknown":"denied"),timeoutMs);
      try{
        if(life!==captured||!current(capturedToken))throw approvalError("denied");
        record.sent=true;
        Promise.resolve(sendMessage({type:"kanban-shared-approval-intent",v:1,action:"approval",actionId,...scope,...identity,decision:copy,sequence:captured.sequence,epoch:captured.epoch}))
          .catch(()=>settleApproval(record,"unknown"));
      }catch{settleApproval(record,record.sent?"unknown":"denied")}
      return await promise;
    }});
  }
  function onMessage(event){
    if(submission?.receive(event))return;
    if(event.source!==null)return;
    const frame=event.data;
    if(exact(frame,["type","actionId","sequence","epoch","state"])&&frame.type==="kanban-shared-approval-result"&&["resolved","denied","unknown"].includes(frame.state)){
      const record=approvals.get(frame.actionId);
      if(record&&life===record.captured&&frame.sequence===record.captured.sequence&&frame.epoch===record.captured.epoch&&current(record.capturedToken))settleApproval(record,frame.state);
      return;
    }
    if(exact(frame,["type","sequence","epoch"])&&frame.type==="kanban-shared-connect-lifecycle-ack"){
      if(life&&frame.sequence===life.sequence&&frame.epoch===life.epoch){life.ack=true;settleLife(life)}
      return;
    }
    if(!exact(frame,["type","attemptId","sequence","epoch","accepted"])||
       frame.type!=="kanban-shared-connect-intent-ack"||typeof frame.accepted!=="boolean")return;
    const record=pending.get(frame.attemptId);
    if(!record||life!==record.captured||frame.sequence!==record.captured.sequence||frame.epoch!==record.captured.epoch||!current(record.capturedToken))return;
    record.ack=frame.accepted;if(record.sent)finish(record,frame.accepted);
  }
  function wrapNavigation(navigate){
    if(typeof navigate!=="function")throw failure();
    originalNavigate=navigate;
    return function(...args){
      // Private and ordinary remote navigation keep the original path.
      const target=current()&&args[1]==="kanban-shared-cli"?probe:null;
      return Reflect.apply(target?target.wrapNavigation(navigate):navigate,this,args);
    };
  }
  // Invoke the original provider only for an acknowledged, exact shared-row
  // click. The source capability stays in the host intent, never in the URL.
  function navigateSharedThread({threadId,hostId,sourceToken,options}={}){
    if(hostId!=="kanban-shared-cli"||!UUID.test(threadId??"")||typeof sourceToken!=="string"||
       !/^[A-Za-z0-9_-]{43}$/.test(sourceToken)||!exact(options,["state"])||!object(options.state)||
       typeof originalNavigate!=="function")return false;
    const marker=Object.getOwnPropertyDescriptor(options.state,"__chatgptDesktopConnectAttempt");
    if(!marker||!Object.hasOwn(marker,"value")||!UUID.test(marker.value??""))return false;
    const record=pending.get(marker.value),candidate=record?.candidate;
    if(!record||record.routed||!record.settled||record.ack!==true||!record.sent||life!==record.captured||
       !current(record.capturedToken)||candidate.hostId!==hostId||candidate.threadId!==threadId||candidate.sourceToken!==sourceToken)return false;
    record.routed=true;
    try{return Reflect.apply(originalNavigate,undefined,[threadId,hostId,options])===true}catch{return false}
  }
  function createRootForNavigation(original,root){
    const delegate={wrapDelegatedListener(actual,listener){
      let last=null,wrapped=null;
      const forwarding=function(...args){
        const target=current()?probe:null;
        if(target!==last){last=target;wrapped=target?target.wrapDelegatedListener(actual,listener):null}
        return Reflect.apply(wrapped??listener,this,args);
      };
      return submission.wrapDelegatedListener(actual,forwarding);
    }};
    const result=createRoot({window:win,root,createRoot:original,probe:delegate});
    if(!result.active||!result.restored)fail();
    return result.value;
  }
  async function consumeRoute(options){
    const captured=probe,capturedToken=token;
    if(!captured||!current(capturedToken))return null;
    let candidate;
    try{candidate=await captured.consumeAttempt(options)}catch{return null}
    if(!candidate||captured!==probe||!current(capturedToken))return null;
    const record=pending.get(candidate.attemptId);
    if(!record||record.candidate!==candidate||record.claimed)return null;
    record.claimed=true;
    const accepted=await record.accepted;
    retire(record);
    return accepted&&captured===probe&&current(capturedToken)?candidate.attemptId:null;
  }
  function activateExplicit({event,hostId,threadId,state,sourceToken,navigate,isCurrent}={}){
    const captured=probe,capturedToken=token;
    if(!captured||!current(capturedToken)||typeof navigate!=="function"||typeof isCurrent!=="function"||typeof captured.prepareExplicit!=="function")return Promise.resolve(false);
    try{if(isCurrent()!==true)return Promise.resolve(false)}catch{return Promise.resolve(false)}
    const action=captured.prepareExplicit({event,hostId,threadId,state,sourceToken});
    if(!action)return Promise.resolve(false);
    const record=pending.get(action.candidate.attemptId);
    if(!record){action.cancel();return Promise.resolve(false)}
    return completeExplicit({action,record,captured,capturedToken,hostId,threadId,navigate,isCurrent});
  }
  async function completeExplicit({action,record,captured,capturedToken,hostId,threadId,navigate,isCurrent}){
    const accepted=await record.accepted;
    let live=false;try{live=accepted&&captured===probe&&current(capturedToken)&&isCurrent()===true}catch{}
    if(!live){action.cancel();retire(record);return false}
    try{
      if(navigate(threadId,hostId,{state:action.state})!==true || !current(capturedToken) || isCurrent()!==true || !action.commit()){
        action.cancel();retire(record);return false;
      }
      return true;
    }catch{action.cancel();retire(record);return false}
  }
  submission=createBrowserSharedThreadSubmission({window:win,documentScope:scope,sendMessage,getLifecycle:()=>life,getComposer,isCurrent:current,timeoutMs});
  try{
    win.addEventListener("message",onMessage);
    unsubscribe=scopeLease.subscribe(observeScope);
    if(typeof unsubscribe!=="function")throw failure();
    observeScope();
  }catch{disposed=true;submission?.dispose();invalidate();win.removeEventListener("message",onMessage);try{unsubscribe?.()}catch{}throw failure()}
  return Object.freeze({bindAppServerHosts,wrapComposerSubmit:submission.wrapComposerSubmit,markComposerDeferred:submission.markComposerDeferred,consumeComposerSubmit:submission.consumeComposerSubmit,prepareComposerCreate:submission.prepareComposerCreate,createRoot:createRootForNavigation,wrapNavigation,navigateSharedThread,consumeRoute,activateExplicit,beginApproval,
    ready:()=>readyPromise,
    dispose(){if(disposed)return;const active=life;disposed=true;for(const release of [...hostBindings])release();originalNavigate=null;submission?.dispose();invalidate();win.removeEventListener("message",onMessage);
      if(!readySettled){readySettled=true;rejectReady(failure())}try{unsubscribe()}catch{}
      if(active&&sequence<Number.MAX_SAFE_INTEGER)try{const sent=sendMessage({type:"kanban-shared-connect-lifecycle",sequence:++sequence,epoch:null});Promise.resolve(sent).catch(()=>{})}catch{}
    },
  });
}
