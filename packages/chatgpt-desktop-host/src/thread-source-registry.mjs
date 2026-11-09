import {isAbsolute,resolve} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PAGE=16*1024*1024,MAX_REQUEST=64*1024,MAX_ROWS=200,MAX_ENTRIES=8192,MAX_PENDING=64,MAX_VIEWS=16,MAX_VIEW_TOKENS=1024;
const LIST_KEYS=new Set(['limit','cursor','sortKey','modelProviders','sourceKinds','archived','sectionId','useStateDbOnly','originators','searchTerm','ancestorThreadId','parentThreadId','sortDirection']);
const problem=(code,cause)=>Object.assign(new Error('Thread source unavailable',{cause}),{code});
const invalid=()=>problem('THREAD_SOURCE_INVALID'), unavailable=cause=>problem('THREAD_SOURCE_UNAVAILABLE',cause), stale=()=>problem('THREAD_SOURCE_STALE');
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const pathOK=x=>typeof x==='string'&&x.length>1&&Buffer.byteLength(x)<=4096&&isAbsolute(x)&&resolve(x)===x&&!/[\x00-\x1f\x7f]/.test(x);
const cursorOK=x=>x===null||(typeof x==='string'&&x.length<=4096&&!/[\x00-\x1f\x7f]/.test(x));
function snapshot(value,max){
 try {const text=JSON.stringify(value);if(typeof text!=='string'||Buffer.byteLength(text)>max)throw invalid();return JSON.parse(text);}
 catch {throw invalid();}
}
function source(provider,executionDomain){
 if(!object(provider)||!UUID.test(provider.generation??'')||['getAccountRevision','verifySync','list','read'].some(k=>typeof provider[k]!=='function'))throw invalid();
 // Capture the fixed, server-owned connection and functions at construction;
 // request data and renderer messages never provide an execution domain.
 return {executionDomain,generation:provider.generation,
  getAccountRevision:provider.getAccountRevision.bind(provider),verifySync:provider.verifySync.bind(provider),
  list:provider.list.bind(provider),read:provider.read.bind(provider),
  maxRevision:-1,activeRevision:null,invalidRevision:-1,retired:false,latestQueries:new Map()};
}
/** Server-side source provenance. Entries arise only from the two fixed
 * connection readers; a thread UUID or a renderer-supplied label is no proof. */
export function createThreadSourceRegistry({privateSource,daemonSource,verifyViewSync=()=>false}={}){
 if(typeof verifyViewSync!=='function')throw invalid();
 const local=source(privateSource,'private'),daemon=source(daemonSource,'daemon'),sources=[local,daemon];
 let closed=false,ordinal=0,pending=0,count=0;
 const entries=new Map(),resolutions=new WeakMap(),pages=new WeakMap(),viewTokens=new Map();
 function clearDomain(s){
  for(const [id,byDomain] of entries){if(byDomain.delete(s.executionDomain))count--;if(!byDomain.size)entries.delete(id);}
  s.latestQueries.clear();
 }
 function scope(s){
  if(closed||s.retired)return null;
  let valid=false,revision=null;
  try{valid=s.verifySync()===true;revision=s.getAccountRevision();}catch{}
  if(!valid){if(s.maxRevision>=0){s.retired=true;clearDomain(s);}s.activeRevision=null;return null;}
  if(!Number.isSafeInteger(revision)||revision<0){
   if(s.activeRevision!==null){s.invalidRevision=Math.max(s.invalidRevision,s.activeRevision);clearDomain(s);}
   s.activeRevision=null;return null;
  }
  if(revision<s.maxRevision||revision<=s.invalidRevision)return null;
  if(s.activeRevision!==null&&revision!==s.activeRevision){s.invalidRevision=Math.max(s.invalidRevision,s.activeRevision);clearDomain(s);}
  s.maxRevision=Math.max(s.maxRevision,revision);s.activeRevision=revision;
  return {executionDomain:s.executionDomain,generation:s.generation,accountRevision:revision};
 }
 const sameScope=(a,b)=>!!a&&!!b&&a.executionDomain===b.executionDomain&&a.generation===b.generation&&a.accountRevision===b.accountRevision;
 function liveEntries(id){
  const byDomain=entries.get(id);if(!byDomain)return [];
  const result=[];
  for(const [domain,item] of byDomain){
   if(!sameScope(scope(item.provider),item.scope)){if(byDomain.delete(domain))count--;}
   else result.push(item);
  }
  if(!byDomain.size)entries.delete(id);
  return result;
 }
 function request(params){
  try{
   if(!object(params)||![Object.prototype,null].includes(Object.getPrototypeOf(params)))throw invalid();
   const descriptions=Object.getOwnPropertyDescriptors(params),keys=Reflect.ownKeys(descriptions),value={};
   for(const key of keys){
    const field=descriptions[key];
    if(typeof key!=="string"||!LIST_KEYS.has(key)||!field.enumerable||!Object.hasOwn(field,"value"))throw invalid();
    let item=field.value;
    if(item===undefined)continue;
    if(Array.isArray(item)){
     const items=Object.getOwnPropertyDescriptors(item),length=items.length?.value;
     if(!Number.isSafeInteger(length)||length>64||Reflect.ownKeys(items).length!==length+1)throw invalid();
     const copy=[];for(let i=0;i<length;i++){
      const entry=items[String(i)];if(!entry||!Object.hasOwn(entry,"value")||typeof entry.value!=="string"||!entry.value||entry.value.length>256||/[\x00-\x1f\x7f]/.test(entry.value))throw invalid();copy.push(entry.value);
     }item=copy;
    } else if(!(item===null||typeof item==='string'||typeof item==='boolean'||Number.isSafeInteger(item)))throw invalid();
    value[key]=item;
   }
   if(Buffer.byteLength(JSON.stringify(value))>MAX_REQUEST)throw invalid();
   return value;
  }catch{throw invalid();}
 }
 function rowsOf(page){
  if(!object(page)||!Array.isArray(page.data)||page.data.length>MAX_ROWS||!Object.hasOwn(page,'nextCursor')||!cursorOK(page.nextCursor)||
     (Object.hasOwn(page,'backwardsCursor')&&!cursorOK(page.backwardsCursor)))throw invalid();
  const ids=new Set();
  for(const row of page.data){if(!object(row)||!UUID.test(row.id??'')||!pathOK(row.cwd)||ids.has(row.id)||(row.turns!==undefined&&(!Array.isArray(row.turns)||row.turns.length!==0)))throw invalid();ids.add(row.id);}
  return page.data;
 }
 async function bounded(fn){
  if(closed||pending>=MAX_PENDING)throw unavailable();
  pending++;try{return await fn();}finally{pending--;}
 }
 async function list(s,params){
  const args=request(params),start=scope(s);
  if(!start)throw unavailable();
  const seq=++ordinal;
  const queryKey=createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(args).sort().map(key=>[key,args[key]])))).digest('hex');
  if(!s.latestQueries.has(queryKey)&&s.latestQueries.size>=MAX_ENTRIES)throw unavailable();
  s.latestQueries.set(queryKey,seq);
  return bounded(async()=>{
   const result=snapshot(await s.list(args),MAX_PAGE),rows=rowsOf(result);
   if(!sameScope(start,scope(s))||s.latestQueries.get(queryKey)!==seq)throw stale();
   let extra=0;
   for(const row of rows){
    const byDomain=entries.get(row.id),old=byDomain?.get(s.executionDomain);
    if(old&&old.scope.generation===start.generation&&old.scope.accountRevision===start.accountRevision&&old.ordinal>seq)throw stale();
    if(!old)extra++;
   }
   if(count+extra>MAX_ENTRIES)throw unavailable();
   // No asynchronous boundary between the final source check and commit.
   if(!sameScope(start,scope(s))||s.latestQueries.get(queryKey)!==seq)throw stale();
   const pageItems=[];
   for(const row of rows){
    let byDomain=entries.get(row.id);if(!byDomain){byDomain=new Map();entries.set(row.id,byDomain);}
    const old=byDomain.get(s.executionDomain);
    if(!old)count++;
    const item=old&&sameScope(old.scope,start)&&old.cwd===row.cwd?old:{provider:s,scope:start,id:row.id,cwd:row.cwd,ordinal:seq};
    item.ordinal=seq;item.queryArgs=args;
    byDomain.set(s.executionDomain,item);pageItems.push(item);
   }
   pages.set(result,{provider:s,scope:start,items:pageItems});
   return result;
  });
 }
 function selected(id){
  const found=liveEntries(id);
  if(found.length>1)throw problem('THREAD_SOURCE_AMBIGUOUS');
  if(found.length!==1)throw unavailable();
  return found[0];
 }
 async function resolveThread(id,...extra){
  if(extra.length||!UUID.test(id??''))throw invalid();
  const item=selected(id),start=scope(item.provider),other=item.provider===local?daemon:local,opposite=scope(other);
  if(!sameScope(start,item.scope)||!opposite)throw unavailable();
  // A missing row on a loaded page proves nothing about an unvisited page.
  // Each fixed reader must perform an actual metadata read. A null result is
  // accepted only from the server-owned reader as a confirmed native absence;
  // rejected/unknown responses can never prove that the UUID is unique.
  const [own,foreign]=await Promise.allSettled([
   bounded(async()=>snapshot(await item.provider.read(id),MAX_PAGE)),
   bounded(async()=>snapshot(await other.read(id),MAX_PAGE)),
  ]);
  if(!sameScope(start,scope(item.provider))||!sameScope(opposite,scope(other)))throw stale();
  if(own.status!=='fulfilled'||foreign.status!=='fulfilled')throw unavailable(own.status==='rejected'?own.reason:foreign.reason);
  if(foreign.value!==null){
   const thread=foreign.value?.thread;
   if(!object(thread)||thread.id!==id||!pathOK(thread.cwd)||(thread.turns!==undefined&&(!Array.isArray(thread.turns)||thread.turns.length!==0)))throw unavailable();
   throw problem('THREAD_SOURCE_AMBIGUOUS');
  }
  const current=selected(id),detail=own.value;
  if(current!==item||!object(detail)||!object(detail.thread)||detail.thread.id!==id||detail.thread.cwd!==item.cwd||!pathOK(detail.thread.cwd)||(detail.thread.turns!==undefined&&(!Array.isArray(detail.thread.turns)||detail.thread.turns.length!==0)))throw stale();
  const result=Object.freeze({...item.scope,threadId:id,cwd:item.cwd});resolutions.set(result,{item,view:null,token:null});return result;
 }
 function currentView(view){try{return !closed&&object(view)&&verifyViewSync(view)===true;}catch{return false;}}
 function liveItem(item){
  return !!item&&sameScope(item.scope,scope(item.provider))&&entries.get(item.id)?.get(item.scope.executionDomain)===item;
 }
 function issuePageTokens(view,page){
  const receipt=object(page)&&pages.get(page);
  if(!currentView(view)||!receipt)throw invalid();
  if(!sameScope(receipt.scope,scope(receipt.provider))||receipt.items.some(item=>!liveItem(item)))throw stale();
  let tokens=viewTokens.get(view);
  if(!tokens){if(viewTokens.size>=MAX_VIEWS)throw unavailable();tokens=new Map();viewTokens.set(view,tokens);}
  for(const [token,item] of tokens)if(!liveItem(item))tokens.delete(token);
  let needed=0;for(const item of receipt.items)if(![...tokens.values()].includes(item))needed++;
  if(tokens.size+needed>MAX_VIEW_TOKENS)throw unavailable();
  return Object.freeze(receipt.items.map(item=>{
   let token;for(const [key,value] of tokens)if(value===item){token=key;break;}
   if(!token){do{token=randomBytes(32).toString('base64url');}while(tokens.has(token));tokens.set(token,item);}
   return Object.freeze({threadId:item.id,token});
  }));
 }
 async function resolveFromPage(view,token,id,...extra){
  if(extra.length||!currentView(view)||typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token)||!UUID.test(id??''))throw unavailable();
  const item=viewTokens.get(view)?.get(token);
  if(!item||item.id!==id||!liveItem(item))throw unavailable();
  const start=scope(item.provider),selectedOrdinal=item.ordinal,other=item.provider===local?daemon:local,opposite=scope(other);
  if(!start||!opposite)throw unavailable();
  // A page token binds a selected source, not proof of absence in the other
  // execution domain. Both fixed readers must complete actual metadata reads.
  // No list fallback can turn a permission/corruption failure into success.
  const [own,foreign]=await Promise.allSettled([
   bounded(async()=>snapshot(await item.provider.read(id),MAX_PAGE)),
   bounded(async()=>snapshot(await other.read(id),MAX_PAGE)),
  ]);
  if(!currentView(view)||viewTokens.get(view)?.get(token)!==item||!sameScope(start,scope(item.provider))||!sameScope(opposite,scope(other))||!liveItem(item)||item.ordinal!==selectedOrdinal)throw stale();
  if(own.status!=='fulfilled'||foreign.status!=='fulfilled')throw unavailable(own.status==='rejected'?own.reason:foreign.reason);
  if(foreign.value!==null){
   const thread=foreign.value?.thread;
   if(!object(thread)||thread.id!==id||!pathOK(thread.cwd)||(thread.turns!==undefined&&(!Array.isArray(thread.turns)||thread.turns.length!==0)))throw unavailable();
   throw problem('THREAD_SOURCE_AMBIGUOUS');
  }
  const detail=own.value;
  if(!object(detail)||!object(detail.thread)||detail.thread.id!==id||detail.thread.cwd!==item.cwd||!pathOK(detail.thread.cwd)||
     (detail.thread.turns!==undefined&&(!Array.isArray(detail.thread.turns)||detail.thread.turns.length!==0)))throw stale();
  const result=Object.freeze({...item.scope,threadId:id,cwd:item.cwd});resolutions.set(result,{item,view,token});return result;
 }
 function verifyResolvedSync(value){
  if(!object(value)||!resolutions.has(value)||Object.keys(value).sort().join(',')!=='accountRevision,cwd,executionDomain,generation,threadId'||!UUID.test(value.threadId??'')||!pathOK(value.cwd))return false;
  try{
   const resolution=resolutions.get(value),item=resolution.item;
   if(resolution.view!==null){if(!currentView(resolution.view)||viewTokens.get(resolution.view)?.get(resolution.token)!==item||!liveItem(item))return false;}
   else if(selected(value.threadId)!==item)return false;
   return sameScope(value,item.scope)&&value.cwd===item.cwd;
  }catch{return false;}
 }
 function retireView(view){viewTokens.delete(view);}
 function close(){closed=true;entries.clear();viewTokens.clear();count=0;for(const s of sources){s.retired=true;s.latestQueries.clear();}}
 return Object.freeze({listPrivate:params=>list(local,params),listDaemon:params=>list(daemon,params),issuePageTokens,resolve:resolveThread,resolveFromPage,verifyResolvedSync,retireView,close});
}
