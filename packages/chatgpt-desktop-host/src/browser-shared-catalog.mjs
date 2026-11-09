const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_BYTES=16*1024*1024,CHUNK=32*1024;
const invalid=()=>Object.assign(new Error('Shared catalog unavailable'),{code:'SHARED_CATALOG_UNAVAILABLE'});
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const cursorOK=v=>v===null||(typeof v==='string'&&v.length<=4096&&!/[\x00-\x1f\x7f]/.test(v));
/** Frames reach receive only through the bridge's validated, scoped transport. */
export function createBrowserSharedCatalog({window:win,scopeLease,send}={}){
 if(!win?.crypto||typeof win.crypto.randomUUID!=='function'||typeof win.atob!=='function'||typeof win.btoa!=='function'||typeof win.setTimeout!=='function'||typeof win.clearTimeout!=='function'||!scopeLease||['getSnapshot','isCurrent','subscribe'].some(k=>typeof scopeLease[k]!=='function')||typeof send!=='function')throw invalid();
 let disposed=false,pending=null,scope=null,unsubscribe;const retired=new WeakSet();
 const object=v=>v!==null&&(typeof v==='object'||typeof v==='function');
 const current=v=>{try{return !disposed&&object(v)&&!retired.has(v)&&scope===v&&scopeLease.getSnapshot()===v&&scopeLease.isCurrent(v)===true}catch{return false}};
 function cleanup(r){if(pending!==r)return;pending=null;win.clearTimeout(r.timer);if(r.buffer){r.buffer.fill(0);r.buffer=null}}
 function cancel(r){try{Promise.resolve(send({type:'kanban-shared-catalog-cancel',requestId:r.id})).catch(()=>{})}catch{}}
 function reject(r,notify=true){if(pending!==r)return;if(notify)cancel(r);cleanup(r);r.reject(invalid())}
 function onScope(){if(object(scope))retired.add(scope);if(pending)reject(pending);scope=null;try{const next=scopeLease.getSnapshot();if(object(next)&&!retired.has(next)&&scopeLease.isCurrent(next)===true)scope=next}catch{}}
 try{unsubscribe=scopeLease.subscribe(onScope);if(typeof unsubscribe!=='function')throw invalid();onScope()}catch{disposed=true;try{unsubscribe?.()}catch{}throw invalid()}
 function loadPage(args){
  if(!exact(args,['cursor','limit'])||!cursorOK(args.cursor)||!Number.isSafeInteger(args.limit)||args.limit<1||args.limit>50||pending||!current(scope))return Promise.reject(invalid());
  const id=win.crypto.randomUUID();if(!UUID.test(id??''))return Promise.reject(invalid());
  return new Promise((resolve,rejectPromise)=>{
   const r={id,scope,resolve,reject:rejectPromise,sequence:0,total:0,offset:0,buffer:null,awaiting:false};pending=r;
   r.timer=win.setTimeout(()=>reject(r),30000);
   try{Promise.resolve(send({type:'kanban-shared-catalog-request',requestId:id,cursor:args.cursor,limit:args.limit})).catch(()=>reject(r))}catch{reject(r)}
  });
 }
 function receive(frame){
  if(!frame||typeof frame!=='object'||!['kanban-shared-catalog-chunk','kanban-shared-catalog-error'].includes(frame.type))return false;
  const r=pending;if(!r||frame.requestId!==r.id)return true;
  if(!current(r.scope)){reject(r);return true}
  if(frame.type==='kanban-shared-catalog-error'){
   if(!exact(frame,['type','requestId','code'])||!['unavailable','limit'].includes(frame.code)){reject(r);return true}
   reject(r,false);return true;
  }
  try{
   if(!exact(frame,['type','requestId','sequence','totalBytes','final','data'])||r.awaiting||frame.sequence!==r.sequence+1||!Number.isSafeInteger(frame.totalBytes)||frame.totalBytes<1||frame.totalBytes>MAX_BYTES||typeof frame.final!=='boolean'||typeof frame.data!=='string'||frame.data.length>Math.ceil(CHUNK/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(frame.data))throw invalid();
   const decoded=win.atob(frame.data);if(win.btoa(decoded)!==frame.data||!decoded.length||decoded.length>CHUNK)throw invalid();
   if(!r.buffer){r.total=frame.totalBytes;r.buffer=new Uint8Array(r.total)}
   if(r.total!==frame.totalBytes||r.offset+decoded.length>r.total||(!frame.final&&decoded.length!==CHUNK)||frame.final!==(r.offset+decoded.length===r.total))throw invalid();
   for(let i=0;i<decoded.length;i++)r.buffer[r.offset+i]=decoded.charCodeAt(i);
   r.offset+=decoded.length;r.sequence=frame.sequence;r.awaiting=true;
   Promise.resolve(send({type:'kanban-shared-catalog-ack',requestId:r.id,sequence:r.sequence})).then(()=>{
    if(pending!==r)return;if(!current(r.scope)){reject(r);return}r.awaiting=false;
    if(frame.final){try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(r.buffer));cleanup(r);r.resolve(value)}catch{reject(r)}}
   },()=>reject(r));
  }catch{reject(r)}
  return true;
 }
 function dispose(){if(disposed)return;if(pending)reject(pending);disposed=true;if(object(scope))retired.add(scope);scope=null;try{unsubscribe()}catch{}}
 return Object.freeze({loadPage,receive,dispose});
}
