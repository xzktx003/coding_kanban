'use strict';
const {Buffer}=require('node:buffer');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX=16*1024*1024,CHUNK=32*1024,MAX_FRAME=64*1024,MAX_PENDING=16,MAX_USED=8192;
const codes=new Set(['unavailable','limit']);
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Reflect.ownKeys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const validCursor=x=>x===null||(typeof x==='string'&&x.length<=4096&&!/[\x00-\x1f\x7f]/.test(x));
const base=['v','type','profileId','generation','viewId','requestId'];
const fail=()=>Object.assign(new Error('Shared catalog unavailable'),{code:'SHARED_CATALOG_UNAVAILABLE'});
function valid(frame,side,profileId,generation){
 try{
  if(!frame||frame.v!==1||frame.profileId!==profileId||frame.generation!==generation||!UUID.test(frame.viewId??'')||!UUID.test(frame.requestId??'')||Buffer.byteLength(JSON.stringify(frame))>MAX_FRAME)return false;
  if(side==='native'){
   if(frame.type==='shared-catalog-request')return exact(frame,[...base,'cursor','limit'])&&validCursor(frame.cursor)&&Number.isSafeInteger(frame.limit)&&frame.limit>0&&frame.limit<=50;
   if(frame.type==='shared-catalog-ack')return exact(frame,[...base,'sequence'])&&Number.isSafeInteger(frame.sequence)&&frame.sequence>0;
   if(frame.type==='shared-catalog-cancel')return exact(frame,base);
   return false;
  }
  if(side==='host'){
   if(frame.type==='shared-catalog-error')return exact(frame,[...base,'code'])&&codes.has(frame.code);
   return frame.type==='shared-catalog-chunk'&&exact(frame,[...base,'sequence','totalBytes','final','data'])&&Number.isSafeInteger(frame.sequence)&&frame.sequence>0&&Number.isSafeInteger(frame.totalBytes)&&frame.totalBytes>0&&frame.totalBytes<=MAX&&typeof frame.final==='boolean'&&typeof frame.data==='string'&&frame.data.length>0&&frame.data.length<=Math.ceil(CHUNK/3)*4&&/^[A-Za-z0-9+/]+={0,2}$/.test(frame.data);
  }
  return false;
 }catch{return false;}
}
function optionsOK(o){return o&&UUID.test(o.profileId??'')&&UUID.test(o.generation??'')&&typeof o.verifyCurrentSync==='function'&&typeof o.sendFrame==='function'&&typeof o.reserveBytes==='function'&&typeof o.releaseBytes==='function';}
function createHostCatalogIpc(o={}){
 if(!optionsOK(o)||typeof o.verifyViewSync!=='function'||typeof o.getPage!=='function')throw fail();
 const {profileId,generation}=o,pending=new Map(),used=new Map();let closed=false;
 const live=()=>{try{return !closed&&o.verifyCurrentSync()===true}catch{return false}};
 const view=id=>{try{return live()&&o.verifyViewSync(id)===true}catch{return false}};
 const frame=(type,r,extra={})=>({v:1,type,profileId,generation,viewId:r.viewId,requestId:r.requestId,...extra});
 function drop(r){if(!pending.delete(r.requestId))return;clearTimeout(r.timer);if(r.reserved){o.releaseBytes(r.reserved);r.reserved=0;}if(r.bytes){r.bytes.fill(0);r.bytes=null;}}
 function close(){if(closed)return;closed=true;for(const r of [...pending.values()])drop(r)}
 function send(value){try{Promise.resolve(o.sendFrame(value)).catch(close)}catch{close();throw fail()}}
 function reject(r,code){if(pending.get(r.requestId)!==r)return;drop(r);if(view(r.viewId))send(frame('shared-catalog-error',r,{code}));}
 function pump(r){if(pending.get(r.requestId)!==r)return;if(!view(r.viewId)){drop(r);return}if(!r.bytes||r.awaiting)return;
  const end=Math.min(r.bytes.length,r.offset+CHUNK);const data=r.bytes.subarray(r.offset,end).toString('base64');r.offset=end;r.awaiting=++r.sequence;
  send(frame('shared-catalog-chunk',r,{sequence:r.sequence,totalBytes:r.bytes.length,final:end===r.bytes.length,data}));
 }
 function receive(value){
  if(!valid(value,'native',profileId,generation)||!live()){close();return false;}
  if(value.type==='shared-catalog-request'){
   if(!view(value.viewId)||pending.size>=MAX_PENDING||used.size>=MAX_USED||used.has(value.requestId))return false;
   used.set(value.requestId,value.viewId);const r={viewId:value.viewId,requestId:value.requestId,sequence:0,offset:0,awaiting:0,bytes:null,reserved:0};
   r.timer=setTimeout(()=>reject(r,'unavailable'),30000);r.timer.unref?.();pending.set(r.requestId,r);
   let task;try{task=o.getPage(r.viewId,{cursor:value.cursor,limit:value.limit})}catch{reject(r,'unavailable');return true}
   Promise.resolve(task).then(page=>{
    if(pending.get(r.requestId)!==r)return;if(!view(r.viewId)){drop(r);return}
    try{const json=JSON.stringify(page),size=Buffer.byteLength(json);if(!size||size>MAX||o.reserveBytes(size)!==true){reject(r,'limit');return}r.reserved=size;r.bytes=Buffer.from(json);pump(r)}catch{reject(r,'unavailable')}
   },()=>reject(r,'unavailable'));return true;
  }
  const r=pending.get(value.requestId);
  // Retiring a view or settling its page can beat the native cancel. Only an
  // exact request/view already admitted in this account may clean up twice.
  if(!r&&value.type==='shared-catalog-cancel')return used.get(value.requestId)===value.viewId;
  if(!r||r.viewId!==value.viewId)return false;
  if(value.type==='shared-catalog-cancel'){drop(r);return true;}
  if(!view(r.viewId)||r.awaiting!==value.sequence||!r.bytes)return false;
  r.awaiting=0;if(r.offset===r.bytes.length)drop(r);else queueMicrotask(()=>pump(r));return true;
 }
 return Object.freeze({receive,retireView(id){for(const r of [...pending.values()])if(r.viewId===id)drop(r)},revoke(){for(const r of [...pending.values()])drop(r);for(const id of used.keys())used.set(id,null)},close});
}
function createNativeCatalogRelay(o={}){
 if(!optionsOK(o)||typeof o.getRecord!=='function'||typeof o.getOwnedRecord!=='function'||typeof o.sendToView!=='function')throw fail();
 const {profileId,generation}=o,pending=new Map(),used=new Set();let closed=false;
 const live=()=>{try{return !closed&&o.verifyCurrentSync()===true}catch{return false}};
 const recordOf=sender=>{try{const r=sender&&o.getRecord(sender.id);return live()&&r&&o.getOwnedRecord(sender)===r&&r.window?.webContents===sender&&!r.failed&&UUID.test(r.viewId??'')?r:null}catch{return null}};
 const current=r=>recordOf(r.sender)===r.record;
 const frame=(type,r,extra={})=>({v:1,type,profileId,generation,viewId:r.record.viewId,requestId:r.requestId,...extra});
 function drop(r){if(!pending.delete(r.requestId))return;clearTimeout(r.timer);if(r.held){o.releaseBytes(r.held);r.held=0;}}
 function close(){if(closed)return;for(const r of [...pending.values()]){if(live())try{o.sendFrame(frame('shared-catalog-cancel',r))}catch{}drop(r)}closed=true;}
 function send(value){try{Promise.resolve(o.sendFrame(value)).catch(close);return true}catch{close();return false}}
 function request(sender,message){
  if(!exact(message,['type','requestId','cursor','limit'])||message.type!=='kanban-shared-catalog-request'||!UUID.test(message.requestId??'')||!validCursor(message.cursor)||!Number.isSafeInteger(message.limit)||message.limit<1||message.limit>50)return false;
  const record=recordOf(sender);if(!record||pending.size>=MAX_PENDING||used.size>=MAX_USED||used.has(message.requestId)||[...pending.values()].some(x=>x.record===record))return false;
  const r={sender,record,requestId:message.requestId,sequence:0,offset:0,total:0,awaiting:0,held:0};used.add(r.requestId);pending.set(r.requestId,r);
  r.timer=setTimeout(()=>{if(current(r))try{o.sendToView(r.record,{type:'kanban-shared-catalog-error',requestId:r.requestId,code:'unavailable'});send(frame('shared-catalog-cancel',r))}catch{}drop(r)},30000);r.timer.unref?.();
  if(!send(frame('shared-catalog-request',r,{cursor:message.cursor,limit:message.limit}))){drop(r);return false}return true;
 }
 function ack(sender,message){
  if(!exact(message,['type','requestId','sequence'])||message.type!=='kanban-shared-catalog-ack'||!UUID.test(message.requestId??'')||!Number.isSafeInteger(message.sequence)||message.sequence<1)return false;
  const r=pending.get(message.requestId);if(!r||sender!==r.sender||!current(r)||r.awaiting!==message.sequence)return false;
  o.releaseBytes(r.held);r.held=0;r.awaiting=0;const final=r.offset===r.total;
  const accepted=send(frame('shared-catalog-ack',r,{sequence:message.sequence}));if(final)drop(r);return accepted;
 }
 function cancel(sender,message){
  if(!exact(message,['type','requestId'])||message.type!=='kanban-shared-catalog-cancel'||!UUID.test(message.requestId??''))return false;
  const r=pending.get(message.requestId);if(!r||sender!==r.sender||!current(r))return false;
  const accepted=send(frame('shared-catalog-cancel',r));drop(r);return accepted;
 }
 function receive(value){
  if(!valid(value,'host',profileId,generation)||!live())return false;const r=pending.get(value.requestId);
  if(!r||r.record.viewId!==value.viewId||!current(r))return false;
  if(value.type==='shared-catalog-error'){o.sendToView(r.record,{type:'kanban-shared-catalog-error',requestId:r.requestId,code:value.code});drop(r);return true}
  if(r.awaiting||value.sequence!==r.sequence+1||(r.total&&r.total!==value.totalBytes))return false;
  const bytes=Buffer.from(value.data,'base64');if(!bytes.length||bytes.length>CHUNK||bytes.toString('base64')!==value.data||r.offset+bytes.length>value.totalBytes||(!value.final&&bytes.length!==CHUNK)||value.final!==(r.offset+bytes.length===value.totalBytes))return false;
  const held=Buffer.byteLength(value.data);if(o.reserveBytes(held)!==true)return false;
  r.held=held;r.total=value.totalBytes;r.offset+=bytes.length;r.sequence=value.sequence;r.awaiting=value.sequence;
  try{o.sendToView(r.record,{type:'kanban-shared-catalog-chunk',requestId:r.requestId,sequence:value.sequence,totalBytes:value.totalBytes,final:value.final,data:value.data});return true}catch{drop(r);return false}
 }
 return Object.freeze({request,ack,cancel,receive,retire(sender){for(const r of [...pending.values()])if(r.sender===sender){send(frame('shared-catalog-cancel',r));drop(r)}},revoke(){for(const r of [...pending.values()])drop(r)},close});
}
function isCatalogFrame(frame,{side,profileId,generation}={}){return valid(frame,side,profileId,generation)}
module.exports={createHostCatalogIpc,createNativeCatalogRelay,isCatalogFrame};
