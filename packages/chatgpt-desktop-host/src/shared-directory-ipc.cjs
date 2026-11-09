"use strict";
const {randomUUID}=require('node:crypto');
const {isAbsolute,normalize}=require('node:path');

// Private server/native protocol; callers supply the already-owned IPC and
// account/runtime guard. It never supplies its own connection or authority.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_FRAME=64*1024,CHUNK=32*1024,MAX_BYTES=16*1024*1024,MAX_PENDING=16,MAX_USED=8192;
const TYPES=new Set(['shared-directory-request','shared-directory-chunk','shared-directory-ack','shared-directory-error','shared-directory-close']);
const CODES=new Set(['SHARED_DIRECTORY_CLOSED','SHARED_DIRECTORY_REVOKED','SHARED_DIRECTORY_PROTOCOL','SHARED_DIRECTORY_DENIED','SHARED_DIRECTORY_LIMIT','SHARED_DIRECTORY_READ_FAILED','SHARED_DIRECTORY_TIMEOUT']);
const fail=code=>Object.assign(new Error('Shared directory unavailable'),{code});
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,names)=>obj(x)&&Reflect.ownKeys(x).length===names.length&&names.every(n=>Object.hasOwn(x,n));
const atom=x=>typeof x==='string'&&x.length>0&&x.length<=256&&!/[\x00-\x1f\x7f]/.test(x);
const cursor=x=>x==null||(typeof x==='string'&&x.length<=4096&&!/[\x00-\x1f\x7f]/.test(x));
const cwd=x=>typeof x==='string'&&x.length>1&&x.length<=4096&&isAbsolute(x)&&normalize(x)===x&&!/[\x00-\x1f\x7f]/.test(x);
const uuid=x=>typeof x==='string'&&UUID.test(x);
const base=['v','type','profileId','generation'];
const bound=(x,p,g)=>obj(x)&&x.v===1&&x.profileId===p&&x.generation===g&&TYPES.has(x.type);
function validFrame(frame,p,g){
 try{
  if(!bound(frame,p,g)||Buffer.byteLength(JSON.stringify(frame),'utf8')>MAX_FRAME)return false;
  if(frame.type==='shared-directory-close')return exact(frame,[...base,'code'])&&CODES.has(frame.code);
  if(!uuid(frame.requestId))return false;
  if(frame.type==='shared-directory-request')return exact(frame,[...base,'requestId','method','params']);
  if(frame.type==='shared-directory-ack')return exact(frame,[...base,'requestId','sequence'])&&Number.isSafeInteger(frame.sequence)&&frame.sequence>0;
  if(frame.type==='shared-directory-error')return exact(frame,[...base,'requestId','code'])&&CODES.has(frame.code);
  return exact(frame,[...base,'requestId','sequence','totalBytes','final','data'])&&
   Number.isSafeInteger(frame.sequence)&&frame.sequence>0&&Number.isSafeInteger(frame.totalBytes)&&frame.totalBytes>0&&frame.totalBytes<=MAX_BYTES&&
   typeof frame.final==='boolean'&&typeof frame.data==='string'&&frame.data.length>0&&frame.data.length<=Math.ceil(CHUNK/3)*4&&/^[A-Za-z0-9+/]+={0,2}$/.test(frame.data);
 }catch{return false;}
}
function paramsFor(method,input){
 try{
  if(!obj(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))throw 0;
  const d=Object.getOwnPropertyDescriptors(input),names=Reflect.ownKeys(input),out={};
  const allowed=method==='thread/read'?['threadId','includeTurns']:method==='thread/list'?
   ['limit','cursor','sortKey','modelProviders','sourceKinds','archived','sectionId','useStateDbOnly','originators','searchTerm','ancestorThreadId','parentThreadId','sortDirection']:null;
  if(!allowed||names.some(n=>typeof n!=='string'||!allowed.includes(n)||!Object.hasOwn(d[n]??{},'value')))throw 0;
  for(const n of names)out[n]=d[n].value;
  if(method==='thread/read'){
   if(names.length!==2||!uuid(out.threadId)||out.includeTurns!==false)throw 0;
   return out;
  }
  if(!Number.isSafeInteger(out.limit)||out.limit<1||out.limit>200||out.useStateDbOnly!==true||!cursor(out.cursor)||
   (out.sortKey!=null&&!['updated_at','created_at','recency_at'].includes(out.sortKey))||
   (out.sortDirection!=null&&!['asc','desc'].includes(out.sortDirection))||
   (out.archived!=null&&typeof out.archived!=='boolean')||(out.sectionId!=null&&!atom(out.sectionId))||
   (out.searchTerm!=null&&(typeof out.searchTerm!=='string'||out.searchTerm.length>1024||/[\x00-\x1f\x7f]/.test(out.searchTerm)))||
   ['ancestorThreadId','parentThreadId'].some(n=>out[n]!=null&&!uuid(out[n])))throw 0;
  for(const n of ['modelProviders','sourceKinds','originators']){
   const a=out[n];if(a==null)continue;
   if(!Array.isArray(a)||a.length>64)throw 0;
   const ad=Object.getOwnPropertyDescriptors(a),copy=[];
   if(Reflect.ownKeys(a).some(k=>typeof k!=='string'||(k!=='length'&&!/^(0|[1-9]\d*)$/.test(k))))throw 0;
   for(let i=0;i<a.length;i++){if(!ad[i]||!Object.hasOwn(ad[i],'value')||!atom(ad[i].value))throw 0;copy.push(ad[i].value);}
   out[n]=copy;
  }
  return out;
 }catch{throw fail('SHARED_DIRECTORY_DENIED');}
}
function validateResult(method,params,value){
 // Only an authenticated fixed reader may prove absence; error frames never do.
 if(method==='thread/read'&&value===null)return true;
 if(!obj(value))return false;
 if(method==='thread/list')return Array.isArray(value.data)&&value.data.length<=params.limit&&Object.hasOwn(value,'nextCursor')&&cursor(value.nextCursor);
 return obj(value.thread)&&value.thread.id===params.threadId&&cwd(value.thread.cwd)&&
  (value.thread.turns===undefined||(Array.isArray(value.thread.turns)&&value.thread.turns.length===0));
}
function makeBase(options){
 const {profileId,generation,sendFrame,verifyCurrentSync,onClose,reserveBytes,releaseBytes,timeoutMs=30000}=options??{};
 if(!uuid(profileId)||!uuid(generation)||typeof sendFrame!=='function'||typeof verifyCurrentSync!=='function'||
  (onClose!==undefined&&typeof onClose!=='function')||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||
  !((reserveBytes===undefined&&releaseBytes===undefined)||(typeof reserveBytes==='function'&&typeof releaseBytes==='function')))throw fail('SHARED_DIRECTORY_DENIED');
 // Optional same-process budget callbacks must be synchronous and atomic:
 // false or a thrown reserve means no bytes were acquired; release returns void.
 function reserve(n){try{if(reserveBytes===undefined)return true;const result=reserveBytes(n);if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{});return result===true;}catch{return false;}}
 function release(n){
  if(n===0||releaseBytes===undefined)return true;
  try{const result=releaseBytes(n);if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});return false;}return result!==false;}catch{return false;}
 }
 const frame=(type,extra={})=>({v:1,type,profileId,generation,...extra});
 let active=true,stopHook=()=>{};
 const live=()=>{try{return active&&verifyCurrentSync()===true;}catch{return false;}};
 function stop(code='SHARED_DIRECTORY_CLOSED',notify=true){
  if(!active)return;active=false;
  try{stopHook(code);}catch{}
  if(notify){try{Promise.resolve(sendFrame(frame('shared-directory-close',{code}))).catch(()=>{});}catch{}}
  try{onClose?.(code);}catch{}
 }
 function send(value){
  if(!live()){stop('SHARED_DIRECTORY_REVOKED');throw fail('SHARED_DIRECTORY_REVOKED');}
  if(!validFrame(value,profileId,generation)){stop('SHARED_DIRECTORY_PROTOCOL');throw fail('SHARED_DIRECTORY_PROTOCOL');}
  try{
   const result=Promise.resolve(sendFrame(value));
   result.catch(()=>stop('SHARED_DIRECTORY_CLOSED'));
   return result;
  }catch{stop('SHARED_DIRECTORY_CLOSED');throw fail('SHARED_DIRECTORY_CLOSED');}
 }
 return {profileId,generation,timeoutMs,frame,live,stop,send,reserve,release,setStopHook(fn){stopHook=fn;},get active(){return active;}};
}

function createHostDirectoryIpc(options={}){
 const c=makeBase(options),pending=new Map(),used=new Set();let reservedBytes=0;
 function drop(record,code){
  if(!pending.delete(record.id))return false;
  clearTimeout(record.timer);if(record.buffer){reservedBytes-=record.total;record.buffer.fill(0);record.buffer=null;}
  const charge=record.charge;record.charge=0;
  const released=c.release(charge);
  if(code||!released)record.reject(fail(released?code:'SHARED_DIRECTORY_PROTOCOL'));
  if(!released)c.stop('SHARED_DIRECTORY_PROTOCOL');
  return released;
 }
 c.setStopHook(code=>{for(const record of [...pending.values()])drop(record,code);});
 function fetch(method,params){
  if(!c.live()){c.stop('SHARED_DIRECTORY_REVOKED');return Promise.reject(fail('SHARED_DIRECTORY_REVOKED'));}
  let normalized;try{normalized=paramsFor(method,params);}catch(error){return Promise.reject(error);}
  if(pending.size>=MAX_PENDING||used.size>=MAX_USED)return Promise.reject(fail('SHARED_DIRECTORY_LIMIT'));
  const id=randomUUID();if(used.has(id)){c.stop('SHARED_DIRECTORY_PROTOCOL');return Promise.reject(fail('SHARED_DIRECTORY_PROTOCOL'));}used.add(id);
  return new Promise((resolve,reject)=>{
   const record={id,method,params:normalized,resolve,reject,total:0,charge:0,buffer:null,offset:0,sequence:0,awaitingAck:false};
   record.timer=setTimeout(()=>c.stop('SHARED_DIRECTORY_TIMEOUT'),c.timeoutMs);record.timer.unref?.();pending.set(id,record);
   try{c.send(c.frame('shared-directory-request',{requestId:id,method,params:normalized}));}catch{/* stop rejects every pending request */}
  });
 }
 function receive(frame){
  if(!c.active)return false;
  if(!validFrame(frame,c.profileId,c.generation)){c.stop('SHARED_DIRECTORY_PROTOCOL');return false;}
  if(frame.type==='shared-directory-close'){c.stop(frame.code,false);return true;}
  if(!c.live()){c.stop('SHARED_DIRECTORY_REVOKED');return false;}
  if(!['shared-directory-chunk','shared-directory-error'].includes(frame.type)){c.stop('SHARED_DIRECTORY_PROTOCOL');return false;}
  const r=pending.get(frame.requestId);if(!r){c.stop('SHARED_DIRECTORY_PROTOCOL');return false;}
  if(frame.type==='shared-directory-error'){drop(r,frame.code);return true;}
  try{
   if(r.awaitingAck||frame.sequence!==r.sequence+1)throw 0;
   const part=Buffer.from(frame.data,'base64');
   if(part.length<1||part.length>CHUNK||part.toString('base64')!==frame.data)throw 0;
   if(!r.buffer){
    if(frame.sequence!==1||reservedBytes+frame.totalBytes>MAX_BYTES)throw 0;
    if(!c.reserve(frame.totalBytes)){c.stop('SHARED_DIRECTORY_LIMIT');return false;}
    r.total=frame.totalBytes;r.charge=r.total;r.buffer=Buffer.allocUnsafe(r.total);reservedBytes+=r.total;
   }
   if(frame.totalBytes!==r.total||r.offset+part.length>r.total||(!frame.final&&part.length!==CHUNK)||frame.final!==(r.offset+part.length===r.total))throw 0;
   part.copy(r.buffer,r.offset);r.offset+=part.length;r.sequence=frame.sequence;r.awaitingAck=true;
   queueMicrotask(()=>{
    if(!c.active||pending.get(r.id)!==r)return;
    if(!c.live()){c.stop('SHARED_DIRECTORY_REVOKED');return;}
    r.awaitingAck=false;
    let sent;try{sent=c.send(c.frame('shared-directory-ack',{requestId:r.id,sequence:frame.sequence}));}catch{return;}
    if(frame.final)sent.then(()=>{
     if(!c.active||pending.get(r.id)!==r)return;
     try{
      if(!c.live()){c.stop('SHARED_DIRECTORY_REVOKED');return;}
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(r.buffer));
      if(!validateResult(r.method,r.params,value))throw 0;
      if(drop(r))r.resolve(value);
     }catch{c.stop('SHARED_DIRECTORY_PROTOCOL');}
    }).catch(()=>{});
   });
   return true;
  }catch{c.stop('SHARED_DIRECTORY_PROTOCOL');return false;}
 }
 return Object.freeze({fetch,receive,close:()=>c.stop(),revoke:()=>c.stop('SHARED_DIRECTORY_REVOKED'),get active(){return c.active;}});
}

function createNativeDirectoryIpc(options={}){
 const c=makeBase(options),execute=options.execute;
 if(typeof execute!=='function')throw fail('SHARED_DIRECTORY_DENIED');
 const pending=new Map(),used=new Set();let retainedBytes=0,firstReadFailure=null;
 // Keep one private first cause for the owning host. No raw error crosses IPC.
 const readFailed=error=>{if(firstReadFailure===null)firstReadFailure=error;};
 function drop(r,cancel=false){
  if(!pending.delete(r.id))return false;
  clearTimeout(r.timer);if(cancel)r.controller.abort();if(r.bytes){retainedBytes-=r.bytes.length;r.bytes.fill(0);r.bytes=null;}
  const charge=r.charge;r.charge=0;
  const released=c.release(charge);if(!released)c.stop('SHARED_DIRECTORY_PROTOCOL');
  return released;
 }
 c.setStopHook(()=>{for(const r of [...pending.values()])drop(r,true);});
 function rejectRequest(r,code){
  if(pending.get(r.id)!==r)return;
  if(!drop(r,code==='SHARED_DIRECTORY_TIMEOUT'))return;
  try{c.send(c.frame('shared-directory-error',{requestId:r.id,code}));}catch{}
 }
 function pump(r){
  if(!c.active||pending.get(r.id)!==r)return;
  if(!c.live()){c.stop('SHARED_DIRECTORY_REVOKED');return;}
  if(!r.bytes||r.awaiting!==null)return;
  const end=Math.min(r.bytes.length,r.offset+CHUNK),data=r.bytes.subarray(r.offset,end).toString('base64');
  r.offset=end;r.awaiting=++r.sequence;
  try{c.send(c.frame('shared-directory-chunk',{requestId:r.id,sequence:r.sequence,totalBytes:r.bytes.length,final:end===r.bytes.length,data}));}catch{}
 }
 function receive(frame){
  if(!c.active)return false;
  if(!validFrame(frame,c.profileId,c.generation)){c.stop('SHARED_DIRECTORY_PROTOCOL');return false;}
  if(frame.type==='shared-directory-close'){c.stop(frame.code,false);return true;}
  if(!c.live()){c.stop('SHARED_DIRECTORY_REVOKED');return false;}
  if(frame.type==='shared-directory-ack'){
   const r=pending.get(frame.requestId);
   if(!r||r.awaiting!==frame.sequence||!r.bytes){c.stop('SHARED_DIRECTORY_PROTOCOL');return false;}
   r.awaiting=null;
   if(r.offset===r.bytes.length)drop(r);else queueMicrotask(()=>pump(r));
   return true;
  }
  if(frame.type!=='shared-directory-request'||used.has(frame.requestId)){c.stop('SHARED_DIRECTORY_PROTOCOL');return false;}
  let params;try{params=paramsFor(frame.method,frame.params);}catch{c.stop('SHARED_DIRECTORY_DENIED');return false;}
  if(used.size>=MAX_USED){c.stop('SHARED_DIRECTORY_LIMIT');return false;}
  used.add(frame.requestId);
  if(pending.size>=MAX_PENDING){try{c.send(c.frame('shared-directory-error',{requestId:frame.requestId,code:'SHARED_DIRECTORY_LIMIT'}));}catch{}return false;}
  const r={id:frame.requestId,method:frame.method,params,controller:new AbortController(),bytes:null,charge:0,offset:0,sequence:0,awaiting:null};
  r.timer=setTimeout(()=>rejectRequest(r,'SHARED_DIRECTORY_TIMEOUT'),c.timeoutMs);r.timer.unref?.();pending.set(r.id,r);
  let output;
  try{output=execute(frame.method,params,{signal:r.controller.signal});}catch(error){readFailed(error);rejectRequest(r,'SHARED_DIRECTORY_READ_FAILED');return true;}
  Promise.resolve(output).then(value=>{
   if(!c.active||pending.get(r.id)!==r)return;
   if(!c.live()){c.stop('SHARED_DIRECTORY_REVOKED');return;}
   try{
    if(!validateResult(r.method,r.params,value))throw 0;
    const encoded=JSON.stringify(value);
    if(typeof encoded!=='string')throw 0;
    const size=Buffer.byteLength(encoded,'utf8');
    if(!size||size>MAX_BYTES||retainedBytes+size>MAX_BYTES){rejectRequest(r,'SHARED_DIRECTORY_LIMIT');return;}
    if(!c.reserve(size)){rejectRequest(r,'SHARED_DIRECTORY_LIMIT');return;}
    r.charge=size;
    r.bytes=Buffer.from(encoded,'utf8');retainedBytes+=r.bytes.length;
    pump(r);
   }catch{rejectRequest(r,'SHARED_DIRECTORY_READ_FAILED');}
  },error=>{readFailed(error);rejectRequest(r,'SHARED_DIRECTORY_READ_FAILED');});
  return true;
 }
 return Object.freeze({receive,close:()=>c.stop(),revoke:()=>c.stop('SHARED_DIRECTORY_REVOKED'),getFirstReadFailure:()=>firstReadFailure,get active(){return c.active;}});
}
function isDirectoryFrame(frame,{side,profileId,generation}={}){
 if(!validFrame(frame,profileId,generation))return false;
 return side==='host'?['shared-directory-request','shared-directory-ack','shared-directory-close'].includes(frame.type):
  side==='native'?['shared-directory-chunk','shared-directory-error','shared-directory-close'].includes(frame.type):false;
}
module.exports={createHostDirectoryIpc,createNativeDirectoryIpc,isDirectoryFrame};
