'use strict';
const {randomUUID}=require('node:crypto');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_REQUEST=64*1024,MAX_RESPONSE=2*1024*1024,MAX_WRITES=64;
const base=['v','type','profileId','generation','streamId'];
const fields=Object.freeze({
 native:Object.freeze({'shared-desktop-open':[],'shared-desktop-write':['sequence','text'],'shared-desktop-received':['sequence'],'shared-desktop-close':[]}),
 host:Object.freeze({'shared-desktop-ready':[],'shared-desktop-written':['sequence'],'shared-desktop-message':['sequence','text'],'shared-desktop-retired':[]}),
});
const denied=()=>Object.assign(new Error('Shared desktop transport unavailable'),{code:'SHARED_DESKTOP_TRANSPORT_UNAVAILABLE'});

function isSharedDesktopTransportFrame(value,{side,profileId,generation}={}){
 try{
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||!fields[side])return false;
  const descriptors=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(value);
  if(names.some(name=>typeof name!=='string'||!Object.hasOwn(descriptors[name]??{},'value')))return false;
  const own=name=>descriptors[name]?.value,type=own('type'),extra=fields[side][type];
  if(!extra||names.length!==base.length+extra.length||!base.concat(extra).every(name=>names.includes(name))||own('v')!==1||
     own('profileId')!==profileId||own('generation')!==generation||!UUID.test(profileId??'')||!UUID.test(generation??'')||!UUID.test(own('streamId')??''))return false;
  if(extra.includes('sequence')&&(!Number.isSafeInteger(own('sequence'))||own('sequence')<1))return false;
  if(extra.includes('text')&&(typeof own('text')!=='string'||!own('text').length||Buffer.byteLength(own('text'))>(side==='native'?MAX_REQUEST:MAX_RESPONSE)))return false;
  return true;
 }catch{return false;}
}

/**
 * A real connection-shaped transport for the original AppServerConnection.
 * Its only destination is the already authenticated owner IPC. It has no
 * socket/path/URL input, does not spawn a CLI and does not initialize or resume
 * anything on its own. The server peer authorizes every RPC separately.
 */
function createNativeSharedDesktopTransport({profileId,generation,verifyRuntimeSync,sendFrame,beforeConnect=null,getDesktopMcpServerConfig=null,timeoutMs=15000}={}){
 if(!UUID.test(profileId??'')||!UUID.test(generation??'')||[verifyRuntimeSync,sendFrame].some(fn=>typeof fn!=='function')||
    (beforeConnect!==null&&typeof beforeConnect!=='function')||(getDesktopMcpServerConfig!==null&&typeof getDesktopMcpServerConfig!=='function')||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw denied();
 const streamId=randomUUID(),pending=new Map();
 let closed=false,opened=false,started=false,sequence=0,incoming=0,resolveOpen,rejectOpen,openTimer;
 const ready=new Promise((resolve,reject)=>{resolveOpen=resolve;rejectOpen=reject;});ready.catch(()=>{});
 const current=()=>{try{return !closed&&verifyRuntimeSync()===true;}catch{return false;}};
 const frame=(type,more={})=>({v:1,type,profileId,generation,streamId,...more});
 const connection={readyState:0,processId:null,onopen:null,onmessage:null,onerror:null,onclose:null,send,close:()=>close(true)};
 function emit(type,more){
  if(!current())throw denied();
  const value=frame(type,more);if(!isSharedDesktopTransportFrame(value,{side:'native',profileId,generation}))throw denied();
  const receipt=sendFrame(value);
  if(receipt&&typeof receipt.then==='function')Promise.resolve(receipt).catch(()=>close(false));
 }
 function close(notify=false){
  if(closed)return;
  if(notify&&current()&&started){try{emit('shared-desktop-close');}catch{}}
  closed=true;connection.readyState=3;clearTimeout(openTimer);
  for(const timer of pending.values())clearTimeout(timer);pending.clear();rejectOpen(denied());
  try{connection.onclose?.({type:'close',code:1006,reason:'Shared desktop transport retired',wasClean:false});}catch{}
 }
 function send(text){
  try{
   if(!current()||!opened||connection.readyState!==1||typeof text!=='string'||!text.length||Buffer.byteLength(text)>MAX_REQUEST||pending.size>=MAX_WRITES||sequence>=Number.MAX_SAFE_INTEGER)throw denied();
   const next=++sequence,timer=setTimeout(()=>close(false),timeoutMs);timer.unref?.();pending.set(next,timer);
   emit('shared-desktop-write',{sequence:next,text});
  }catch(error){close(false);throw error;}
 }
 function receive(value){
  try{
   if(!current()||!isSharedDesktopTransportFrame(value,{side:'host',profileId,generation})||value.streamId!==streamId||!started)throw denied();
   if(value.type==='shared-desktop-retired'){close(false);return true;}
   if(value.type==='shared-desktop-ready'){
    if(opened)throw denied();opened=true;connection.readyState=1;clearTimeout(openTimer);resolveOpen(connection);return true;
   }
   if(!opened)throw denied();
   if(value.type==='shared-desktop-written'){
    const timer=pending.get(value.sequence);if(!timer)throw denied();clearTimeout(timer);pending.delete(value.sequence);return true;
   }
   if(value.type==='shared-desktop-message'){
    if(value.sequence!==incoming+1||typeof connection.onmessage!=='function')throw denied();
    incoming=value.sequence;connection.onmessage({type:'message',data:value.text,receivedAtMs:performance.now()});
    emit('shared-desktop-received',{sequence:incoming});return true;
   }
   throw denied();
  }catch(error){close(false);throw error;}
 }
 async function connect(){
  if(!current()||started)throw denied();started=true;
  openTimer=setTimeout(()=>close(false),timeoutMs);openTimer.unref?.();
  try{if(beforeConnect!==null)await beforeConnect();if(!current())throw denied();emit('shared-desktop-open');return await ready;}catch(error){close(false);throw error;}
 }
 return Object.freeze({kind:'websocket',streamId,connect,supportsReconnect:()=>false,receive,close:()=>close(true),
  get desktopMcpServerConfig(){return current()&&getDesktopMcpServerConfig!==null?getDesktopMcpServerConfig():undefined;}});
}
module.exports={createNativeSharedDesktopTransport,isSharedDesktopTransportFrame};
