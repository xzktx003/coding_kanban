const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Identity={leaseId:string;token:string};
export type NativeVisibilityState="connecting"|"protected"|"inactive"|"unavailable";

/** Own metadata connection only; official native input/iframe/MessagePorts stay untouched. */
export function startNativeVisibilityClient({profileId,instanceId,onState,view=window}:{
  profileId:string;instanceId:string;onState(value:NativeVisibilityState):void;view?:Window&typeof globalThis;
}) {
  if(!UUID.test(profileId)||!UUID.test(instanceId))throw Error("exact native visibility profile and instance required");
  const url=new URL(`/api/native-codex/clients/${profileId}/visibility`,view.location.href);
  if(!["https:","http:"].includes(url.protocol))throw Error("same-origin native visibility URL required");
  url.protocol=url.protocol==="https:"?"wss:":"ws:";
  const key=`kanban.codex.visibility-lease.v1:${profileId}`;
  let identity:Identity|null=null,socket:WebSocket|null=null,state:NativeVisibilityState|undefined;
  let stopped=false,leaving=false,active=false,hidden=view.document.hidden,epoch=0,attempt=0,freshRetry=false;
  let wanted:string[]=[],sent="",sequence=0,pendingSequence:number|null=null,helloReceived=false;
  let retryTimer:number|undefined,helloTimer:number|undefined,hiddenTimer:number|undefined;
  const publish=(value:NativeVisibilityState)=>{if(!stopped&&state!==value){state=value;onState(value)}};
  try{
    const raw=view.sessionStorage.getItem(key);
    if(raw&&raw.length<=1024&&view.performance.getEntriesByType?.("navigation")[0]&&(view.performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).type==="reload"){
      const saved=JSON.parse(raw);
      if(saved&&Object.keys(saved).sort().join(",")==="instanceId,leaseId,token"&&saved.instanceId===instanceId&&typeof saved.leaseId==="string"&&UUID.test(saved.leaseId)&&typeof saved.token==="string"&&/^[0-9a-f]{64}$/.test(saved.token))
        identity={leaseId:saved.leaseId,token:saved.token};
    }
    // An opener's sessionStorage can be cloned into a new tab. Only a real
    // reload may resume it; new navigation gets an independent page lease.
    if(!identity)view.sessionStorage.removeItem(key);
  }catch{/* Persistence is optional; failure never selects another page. */}
  const desired=()=>active&&!hidden?wanted:[];
  const closeOwn=()=>{
    epoch++;view.clearTimeout(helloTimer);helloTimer=undefined;
    const previous=socket;socket=null;previous?.close();
  };
  const flush=()=>{
    if(stopped||leaving||!socket||socket.readyState!==1||!helloReceived||pendingSequence!==null)return;
    const ids=desired(),signature=JSON.stringify(ids);
    if(sent===signature)return;
    sent=signature;pendingSequence=++sequence;publish("connecting");
    const target=socket,generation=epoch;
    view.clearTimeout(helloTimer);
    helloTimer=view.setTimeout(()=>{if(!stopped&&!leaving&&socket===target&&epoch===generation){publish("unavailable");target.close()}},5000);
    try{socket.send(JSON.stringify({type:"visible",sequence,threadIds:ids}))}catch{publish("unavailable");socket.close()}
  };
  const connect=()=>{
    if(stopped||leaving||socket)return;
    attempt++;publish("connecting");
    const current=new view.WebSocket(url.href),generation=++epoch;socket=current;
    const owns=()=>!stopped&&!leaving&&socket===current&&generation===epoch;
    let terminal=false,renew=false;
    helloReceived=false;pendingSequence=null;sequence=0;sent="";
    helloTimer=view.setTimeout(()=>{if(owns()){publish("unavailable");current.close()}},5000);
    current.addEventListener("open",()=>{
      if(!owns())return;
      current.send(JSON.stringify({type:"hello",instanceId,...(identity??{})}));
    });
    current.addEventListener("message",event=>{
      if(!owns())return;
      try{
        if(typeof event.data!=="string"||event.data.length>8192)throw Error("bounded visibility metadata required");
        const value=JSON.parse(event.data);
        if(value?.type==="error"){
          terminal=true;
          if(value.code==="lease-unavailable"&&!freshRetry){
            freshRetry=true;renew=true;identity=null;
            try{view.sessionStorage.removeItem(key)}catch{/* Optional storage. */}
          }
          publish("unavailable");current.close();return;
        }
        if(!helloReceived){
          if(!value||Object.keys(value).sort().join(",")!=="leaseId,token,type"||value.type!=="hello"||typeof value.leaseId!=="string"||!UUID.test(value.leaseId)||typeof value.token!=="string"||!/^[0-9a-f]{64}$/.test(value.token))throw Error("exact visibility lease required");
          helloReceived=true;identity={leaseId:value.leaseId,token:value.token};view.clearTimeout(helloTimer);
          try{view.sessionStorage.setItem(key,JSON.stringify({instanceId,...identity}))}catch{/* Keep this connection's identity in memory. */}
          flush();return;
        }
        if(!value||Object.keys(value).sort().join(",")!=="sequence,type"||value.type!=="ack"||value.sequence!==pendingSequence)throw Error("exact visibility acknowledgement required");
        pendingSequence=null;attempt=0;view.clearTimeout(helloTimer);
        if(sent!==JSON.stringify(desired()))flush();
        else publish(desired().length?"protected":"inactive");
      }catch{terminal=true;publish("unavailable");current.close()}
    });
    current.addEventListener("error",()=>{if(owns())publish("unavailable")});
    current.addEventListener("close",event=>{
      if(!owns())return;
      socket=null;view.clearTimeout(helloTimer);publish("unavailable");
      if((renew||(!terminal&&event.code!==1008))&&attempt<3)
        retryTimer=view.setTimeout(connect,[250,1000,2000][Math.min(attempt,2)]);
    });
  };
  const visibilityChanged=()=>{
    if(stopped||leaving)return;
    view.clearTimeout(hiddenTimer);
    if(view.document.hidden){
      // Navigation can hide before pagehide. Preserve the last snapshot for
      // the server's disconnect grace instead of clearing it during reload.
      hiddenTimer=view.setTimeout(()=>{hidden=true;flush()},100);
    }else{hidden=false;flush()}
  };
  const pageHide=()=>{leaving=true;view.clearTimeout(hiddenTimer);view.clearTimeout(retryTimer);closeOwn()};
  const pageShow=()=>{if(!leaving||stopped)return;leaving=false;hidden=view.document.hidden;connect()};
  view.document.addEventListener("visibilitychange",visibilityChanged);
  view.addEventListener("pagehide",pageHide);view.addEventListener("pageshow",pageShow);
  connect();
  return {
    setVisible(threadIds:string[],isActive:boolean){
      if(stopped)return false;
      if(!Array.isArray(threadIds)||threadIds.length>256||threadIds.some(id=>typeof id!=="string"||!UUID.test(id))||typeof isActive!=="boolean"){
        publish("unavailable");return false;
      }
      const ids=[...new Set(threadIds)].sort();
      if(ids.length>64){publish("unavailable");return false}
      wanted=ids;active=isActive;flush();return true;
    },
    stop(){
      if(stopped)return;stopped=true;
      view.clearTimeout(retryTimer);view.clearTimeout(hiddenTimer);closeOwn();identity=null;wanted=[];
      view.document.removeEventListener("visibilitychange",visibilityChanged);
      view.removeEventListener("pagehide",pageHide);view.removeEventListener("pageshow",pageShow);
    },
  };
}
