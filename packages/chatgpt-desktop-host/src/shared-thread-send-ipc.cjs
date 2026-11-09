'use strict';
const {randomUUID}=require('node:crypto');const {performance}=require('node:perf_hooks');
const {UUID,keys,copyBinding,copySharedThreadSendFrame}=require('./shared-thread-send-schema.cjs');
const denied=()=>Object.assign(new Error('Shared send control unavailable'),{code:'SHARED_SEND_DENIED'});
const unknown=()=>Object.assign(new Error('Shared send acknowledgment unknown'),{code:'SHARED_DAEMON_OUTCOME_UNKNOWN'});
const authorizationControls=new WeakMap();
function isSharedThreadSendAuthorizationControl(control,binding,frame){try{const source=authorizationControls.get(control);return !!source&&source.current()&&JSON.stringify(copyBinding(binding))===source.binding&&JSON.stringify(copySharedThreadSendFrame(frame,binding))===source.frame;}catch{return false;}}
const exact=(x,n)=>keys(x,n),envelope=['v','type','profileId','generation','id'];
function targetValid(t){return exact(t,['hostId','threadId','viewId'])&&t.hostId==='kanban-shared-cli'&&[t.threadId,t.viewId].every(v=>UUID.test(v??''));}
function dataValid(op,d){try{if(!UUID.test(d?.attemptId??''))return false;if(op==='binding')return exact(d,['target','attemptId'])&&targetValid(d.target);if(op==='authorize'&&exact(d,['binding','frame','attemptId'])){copyBinding(d.binding);copySharedThreadSendFrame(d.frame,d.binding);return true;}}catch{}return false;}
function resultValid(op,d){try{if(op==='authorize')return d===true;if(op==='binding'){copyBinding(d);return true;}}catch{}return false;}
function isSharedThreadSendFrame(frame,{side,profileId,generation}={}){try{
 if(!frame||frame.v!==1||frame.profileId!==profileId||frame.generation!==generation||!UUID.test(frame.id??'')||Buffer.byteLength(JSON.stringify(frame))>64*1024)return false;
 if(side==='host')return frame.type==='shared-send-cancel'?exact(frame,envelope):frame.type==='shared-send-request'&&exact(frame,[...envelope,'op','data'])&&dataValid(frame.op,frame.data);
 return side==='native'&&frame.type==='shared-send-reply'&&exact(frame,[...envelope,'op','ok',...(frame.ok===true?['data']:['code'])])&&['binding','authorize'].includes(frame.op)&&typeof frame.ok==='boolean'&&(frame.ok?resultValid(frame.op,frame.data):['SHARED_SEND_DENIED','SHARED_DAEMON_OUTCOME_UNKNOWN'].includes(frame.code));
 }catch{return false;}}
function common(o){if(![o.profileId,o.generation].every(x=>UUID.test(x??''))||[o.verifyCurrentSync,o.sendFrame].some(f=>typeof f!=='function'))throw denied();}
// Only the existing authenticated, owned native/host channel transports this
// fixed binding/authorize control. It carries no arbitrary RPC, path or dispatch.
function createNativeSharedThreadSendClient(o={}){
 common(o);const {profileId,generation,verifyCurrentSync,sendFrame}=o,pending=new Map(),leases=new Map();let closed=false;
 const current=()=>{try{return !closed&&verifyCurrentSync()===true;}catch{return false;}};
 function finish(id,error,data){const v=pending.get(id)??leases.get(id);if(!v)return;if(!error&&v.op==='authorize'&&data===true&&pending.has(id)){pending.delete(id);leases.set(id,v);v.resolve(data);return;}pending.delete(id);leases.delete(id);clearTimeout(v.timer);v.signal.removeEventListener('abort',v.abort);error?v.reject(error):v.resolve(data);}
 function request(op,data,control){
  if(!current()||!dataValid(op,data)||!(control?.signal instanceof AbortSignal)||control.signal.aborted||!Number.isFinite(control.deadline)||control.deadline<=performance.now()||control.deadline-performance.now()>30000||pending.size+leases.size>=16)return Promise.reject(denied());
  const id=randomUUID(),frame={v:1,type:'shared-send-request',profileId,generation,id,op,data:JSON.parse(JSON.stringify(data))};
  if(!isSharedThreadSendFrame(frame,{side:'host',profileId,generation}))return Promise.reject(denied());
  return new Promise((resolve,reject)=>{
   const abort=()=>{try{if(current())Promise.resolve(sendFrame({v:1,type:'shared-send-cancel',profileId,generation,id})).catch(()=>{});}catch{}finish(id,op==='authorize'?unknown():denied());};
   const value={op,data:frame.data,signal:control.signal,resolve,reject,abort,timer:setTimeout(abort,Math.max(1,Math.ceil(control.deadline-performance.now())))};value.timer.unref?.();pending.set(id,value);control.signal.addEventListener('abort',abort,{once:true});
   try{Promise.resolve(sendFrame(frame)).catch(()=>finish(id,op==='authorize'?unknown():denied()));}catch{finish(id,op==='authorize'?unknown():denied());}
  });
 }
 function receive(frame){if(!current()||!isSharedThreadSendFrame(frame,{side:'native',profileId,generation}))return false;const v=pending.get(frame.id);if(!v||v.op!==frame.op)return false;
  if(frame.ok){if(v.op==='binding'&&['hostId','threadId','viewId'].some(k=>frame.data[k]!==v.data.target[k]))return false;finish(frame.id,null,JSON.parse(JSON.stringify(frame.data)));}else finish(frame.id,Object.assign(denied(),{code:frame.code}));return true;}
 function close(){for(const v of leases.values())v.abort();closed=true;for(const[id,v]of pending)finish(id,v.op==='authorize'?unknown():denied());}
 return Object.freeze({resolveSendBinding:(target,control)=>request('binding',{target,attemptId:control?.attemptId},control),authorizeSend:(binding,frame,control)=>request('authorize',{binding,frame,attemptId:control?.attemptId},control),receive,close});
}
function createHostSharedThreadSendEndpoint(o={}){
 common(o);const {profileId,generation,verifyCurrentSync,sendFrame,onBinding,onAuthorize}=o;if([onBinding,onAuthorize].some(f=>typeof f!=='function'))throw denied();
 const pending=new Map(),used=new Set();let closed=false;const current=()=>{try{return !closed&&verifyCurrentSync()===true;}catch{return false;}};
 function retire(v,abort=true){if(pending.get(v.id)===v)pending.delete(v.id);clearTimeout(v.timer);if(abort)v.controller.abort();}
 function receive(frame){
  if(!current()||!isSharedThreadSendFrame(frame,{side:'host',profileId,generation}))return false;
  if(frame.type==='shared-send-cancel'){const v=pending.get(frame.id);if(!v)return false;retire(v);return true;}
  if(pending.size>=16||used.size>=8192||used.has(frame.id))return false;used.add(frame.id);
  const input=JSON.parse(JSON.stringify(frame)),controller=new AbortController(),v={id:frame.id,viewId:input.data.binding?.viewId??input.data.target.viewId,controller,deadline:performance.now()+30000,timer:null};pending.set(v.id,v);v.timer=setTimeout(()=>retire(v),30000);v.timer.unref?.();
  void(async()=>{let reply;const control=Object.freeze({attemptId:input.data.attemptId,signal:controller.signal,deadline:v.deadline});try{if(input.op==='authorize')authorizationControls.set(control,{binding:JSON.stringify(copyBinding(input.data.binding)),frame:JSON.stringify(copySharedThreadSendFrame(input.data.frame,input.data.binding)),current:()=>current()&&pending.get(v.id)===v&&!controller.signal.aborted&&performance.now()<v.deadline});const data=input.op==='binding'?await onBinding(input.data.target,control):await onAuthorize(input.data.binding,input.data.frame,control);if(!resultValid(input.op,data))throw denied();reply={v:1,type:'shared-send-reply',profileId,generation,id:input.id,op:input.op,ok:true,data};}catch(error){reply={v:1,type:'shared-send-reply',profileId,generation,id:input.id,op:input.op,ok:false,code:error?.code==='SHARED_DAEMON_OUTCOME_UNKNOWN'?'SHARED_DAEMON_OUTCOME_UNKNOWN':'SHARED_SEND_DENIED'};}
   if(!current()||pending.get(v.id)!==v||controller.signal.aborted||performance.now()>=v.deadline)return;if(!isSharedThreadSendFrame(reply,{side:'native',profileId,generation})){retire(v);return;}
   try{await sendFrame(reply);}catch{}finally{
    // An acknowledged authorization must retain its AbortSignal until the
    // same-writer guard/reply settles or its fixed TTL expires. Do not abort it
    // merely because this control ACK reached native.
    if(!(input.op==='authorize'&&reply.ok))retire(v,false);
   }
  })();return true;
 }
 function retireView(viewId){for(const v of pending.values())if(v.viewId===viewId)retire(v);}
 function close(){closed=true;for(const v of pending.values())retire(v);}
 return Object.freeze({receive,retireView,close});
}
module.exports={isSharedThreadSendAuthorizationControl,isSharedThreadSendFrame,createNativeSharedThreadSendClient,createHostSharedThreadSendEndpoint};
