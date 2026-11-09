import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {createConnection} from 'node:net';
import {isAbsolute,resolve} from 'node:path';
import WebSocket from 'ws';
import {captureSharedDaemonIdentity} from './shared-daemon-identity.mjs';

const observerBrands=new WeakSet();
/** Provenance only: every branded matcher still performs its full live guard. */
export const isSharedDaemonObserver=value=>observerBrands.has(value);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const atom=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!/[\x00-\x1f\x7f]/.test(value);
const problem=code=>Object.assign(new Error('Shared daemon authorization unavailable'),{code});
const identityFailure=()=>problem('SHARED_DAEMON_IDENTITY_CHANGED');
const authFailure=()=>problem('SHARED_DAEMON_AUTH_UNVERIFIED');
const queueFailure=()=>problem('SHARED_DAEMON_QUEUE_FULL');
const invalidRead=()=>problem('SHARED_DAEMON_READ_INVALID');
const rpcFailure=cause=>Object.assign(new Error('Shared daemon authorization unavailable',{cause}),{code:'SHARED_DAEMON_RPC_FAILED'});
// Original 0.166.0-alpha.5.1 receipts bind this exact no-data fault to this CLI.
// Every other binary, version, message or RPC error remains unknown.
const MISSING_CLI_SHA256='6253fb59fc4c21a9134b2f73237650eaec4a3d9380e5af12f3f1e9040dc24c14';
const confirmedMissing=(error,threadId,version,exeSha256)=>version==='0.166.0-alpha.5.1'&&exeSha256===MISSING_CLI_SHA256&&
 obj(error)&&Object.keys(error).sort().join(',')==='code,message'&&error.code===-32600&&error.message===`thread not loaded: ${threadId}`;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest();
const equal=(a,b)=>Buffer.isBuffer(a)&&Buffer.isBuffer(b)&&a.length===b.length&&timingSafeEqual(a,b);
const pathOK=value=>typeof value==='string'&&value.length>1&&value.length<=4096&&isAbsolute(value)&&resolve(value)===value&&!/[\x00-\x1f\x7f]/.test(value);
const obj=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const paramAtom=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\x00-\x1f\x7f]/.test(value);
const cursor=value=>value==null||(typeof value==='string'&&value.length<=4096&&!/[\x00-\x1f\x7f]/.test(value));

// Same narrow thread/list contract as the existing gate. Copy own data fields
// before awaiting; no URL, path, origin or renderer authority is accepted.
function listParams(value){
 try{
  if(!obj(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw invalidRead();
  const allowed=['limit','cursor','sortKey','modelProviders','sourceKinds','archived','sectionId','useStateDbOnly','originators','searchTerm','ancestorThreadId','parentThreadId','sortDirection'];
  const descriptors=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(value),out={};
  if(names.some(name=>typeof name!=='string'||!allowed.includes(name)||!Object.hasOwn(descriptors[name]??{},'value'))||
     !names.includes('limit')||!names.includes('useStateDbOnly'))throw invalidRead();
  for(const name of names)out[name]=descriptors[name].value;
  if(!Number.isSafeInteger(out.limit)||out.limit<1||out.limit>200||out.useStateDbOnly!==true||!cursor(out.cursor)||
     (out.sortKey!=null&&!['updated_at','created_at','recency_at'].includes(out.sortKey))||
     (out.sortDirection!=null&&!['asc','desc'].includes(out.sortDirection))||
     (out.archived!=null&&typeof out.archived!=='boolean')||
     (out.sectionId!=null&&!paramAtom(out.sectionId))||
     (out.searchTerm!=null&&(typeof out.searchTerm!=='string'||out.searchTerm.length>1024||/[\x00-\x1f\x7f]/.test(out.searchTerm)))||
     ['ancestorThreadId','parentThreadId'].some(name=>out[name]!=null&&(typeof out[name]!=='string'||!UUID.test(out[name]))))throw invalidRead();
  for(const name of ['modelProviders','sourceKinds','originators']){
   const entries=out[name];if(entries==null)continue;
   if(!Array.isArray(entries)||entries.length>64)throw invalidRead();
   const d=Object.getOwnPropertyDescriptors(entries),copy=[];
   if(Reflect.ownKeys(entries).some(key=>typeof key!=='string'||(key!=='length'&&!/^(0|[1-9]\d*)$/.test(key))))throw invalidRead();
   for(let i=0;i<entries.length;i++){
    const item=d[String(i)];if(!item||!Object.hasOwn(item,'value')||!paramAtom(item.value))throw invalidRead();copy.push(item.value);
   }
   out[name]=copy;
  }
  return out;
 }catch{throw invalidRead();}
}

// Returns only ephemeral digests. Token bytes and claims never leave this
// module or cross the native/user-facing authority channel.
function accountDigests(account,auth){
 try{
  const routing=account?.workspaceRouting,origin=new URL(routing?.backendOrigin);
  if(!obj(account)||account.requiresOpenaiAuth!==true||account.account?.type!=='chatgpt'||
     !obj(routing)||!atom(routing.chatgptAccountId)||origin.protocol!=='https:'||
     origin.origin!==routing.backendOrigin||origin.username||origin.password||
     !['NO_CONSTRAINT','us','us_cr'].includes(routing.accountRoutingOverride)||
     !obj(auth)||!['chatgpt','chatgptAuthTokens'].includes(auth.authMethod)||
     typeof auth.authToken!=='string'||auth.authToken.length>65536||
     !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(auth.authToken))throw authFailure();
  const payload=Buffer.from(auth.authToken.split('.')[1],'base64url');
  if(payload.length>32768)throw authFailure();
  let claims;try{claims=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload));}finally{payload.fill(0);}
  const native=claims?.['https://api.openai.com/auth'];
  if(!obj(native))throw authFailure();
  // Fixed desktop original's principal conversion, including nullish precedence.
  const accountId=native.chatgpt_account_id??native.account_id,userId=native.user_id??native.chatgpt_user_id;
  const expiresAtMs=claims.exp*1000;
  if(!atom(accountId)||!atom(userId)||accountId!==routing.chatgptAccountId||
     !Number.isSafeInteger(claims.exp)||claims.exp<=0||!Number.isSafeInteger(expiresAtMs)||expiresAtMs<=Date.now())throw authFailure();
  const principal=digest(['shared-account-principal-v1',accountId,userId]);
  const scope=digest(['desktop-shared-account-v1',accountId,userId,routing.backendOrigin,routing.accountRoutingOverride]);
  return {principal,scope,expiresAtMs};
 }catch{throw authFailure();}
}

/**
 * Read-only observation on a separately owned connection to a server-selected,
 * already running daemon. Never starts a daemon or resumes/sends a thread.
 * This observer is only one necessary gate, not a grant by itself. Registration,
 * desktop identity, history, user gesture, and write authority remain separate.
 */
export async function startSharedDaemonObserver({daemon,codexHome,timeoutMs=15000}={}){
 if(!obj(daemon)||!pathOK(codexHome)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw authFailure();
 // Snapshot the one server registration before any await; later mutation of
 // its SHA or socket cannot change the classifier or the captured transport.
 daemon=Object.freeze({pid:daemon.pid,startTicks:daemon.startTicks,socketPath:daemon.socketPath,daemonGeneration:daemon.daemonGeneration,exeSha256:daemon.exeSha256});
 const identity=captureSharedDaemonIdentity(daemon),abort=new AbortController();
 let ws,closed=false,noticeCount=0,bound=false,nextId=0,expiresAtMs=0,expiryTimer,gateReceiver,firstNoticeResolve,firstNoticeReject;
 const observerIdPrefix=`kanban-observer:${randomUUID()}:`;
 const pending=new Map();
 const gatePending=new Set();
 const rpcKey=id=>typeof id==='string'?`string:${id}`:Number.isSafeInteger(id)?`number:${id}`:null;
 const firstNotice=new Promise((resolvePromise,reject)=>{firstNoticeResolve=resolvePromise;firstNoticeReject=reject;});
 firstNotice.catch(()=>{});
 const stop=()=>{
  if(closed)return;
  closed=true;clearTimeout(expiryTimer);identity.close();abort.abort();firstNoticeReject(identityFailure());
  for(const request of pending.values()){clearTimeout(request.timer);request.reject(identityFailure());}
  pending.clear();gatePending.clear();
  if(ws&&ws.readyState!==WebSocket.CLOSED)ws.terminate();
 };
 const assertCurrent=()=>{
  if(closed||!bound)throw identityFailure();
  if(Date.now()>=expiresAtMs){stop();throw identityFailure();}
  try{identity.assertCurrent();}catch{stop();throw identityFailure();}
 };
 const sendEncoded=encoded=>{
  if(closed||!ws||ws.readyState!==WebSocket.OPEN||ws.bufferedAmount+Buffer.byteLength(encoded)>8*1024*1024)throw identityFailure();
  identity.assertCurrent();
  ws.send(encoded,{binary:false,compress:false},error=>{if(error)stop();});
 };
 const send=value=>sendEncoded(JSON.stringify(value));
 const request=(method,params)=>new Promise((resolvePromise,reject)=>{
  if(closed)return reject(identityFailure());
  if(pending.size+gatePending.size>=64)return reject(queueFailure());
  const id=observerIdPrefix+(++nextId),timer=setTimeout(()=>{pending.delete(id);reject(identityFailure());stop();},timeoutMs);
  pending.set(id,{resolve:resolvePromise,reject,timer});
  try{send({id,method,params});}catch(error){clearTimeout(timer);pending.delete(id);reject(error);stop();}
 });
 try{
  identity.assertCurrent();
  ws=new WebSocket('ws://localhost/',{createConnection:()=>createConnection({path:daemon.socketPath}),perMessageDeflate:false,maxPayload:16*1024*1024,handshakeTimeout:timeoutMs});
  ws.on('message',(data,binary)=>{
   try{
    if(binary)throw identityFailure();
    const encoded=new TextDecoder('utf-8',{fatal:true}).decode(data),frame=JSON.parse(encoded);
    if(!obj(frame))throw identityFailure();
    if(frame.method==='account/updated'){
     if(++noticeCount!==1||bound)throw identityFailure();
     firstNoticeResolve();return;
    }
    if(frame.method==='account/login/completed'||frame.method==='account/gatewayOAuth/changed')throw identityFailure();
    if(!Object.hasOwn(frame,'method')&&typeof frame.id==='string'&&frame.id.startsWith(observerIdPrefix)){
     const p=pending.get(frame.id);
     if(!p||Object.hasOwn(frame,'error')===Object.hasOwn(frame,'result'))throw identityFailure();
     pending.delete(frame.id);clearTimeout(p.timer);
     if(Object.hasOwn(frame,'error'))p.reject(rpcFailure(frame.error));else p.resolve(frame.result);
     return;
    }
    if(gateReceiver){
     assertCurrent();
     const key=Object.hasOwn(frame,'method')?null:rpcKey(frame.id);
     if(!Object.hasOwn(frame,'method')&&(!key||!gatePending.has(key)))throw identityFailure();
     if(gateReceiver(encoded)!==true)throw identityFailure();
     if(key)gatePending.delete(key);
     return;
    }
    // Before gate installation no shared thread has been connected. A
    // notification may describe other clients; a stray reply is never adopted.
    if(!Object.hasOwn(frame,'method'))throw identityFailure();
   }catch{stop();}
  });
  ws.on('error',stop);ws.on('close',stop);
  await new Promise((resolvePromise,reject)=>{
   const timer=setTimeout(()=>{stop();reject(identityFailure());},timeoutMs);
   const finish=error=>{clearTimeout(timer);ws.off('open',onOpen);abort.signal.removeEventListener('abort',onAbort);error?reject(error):resolvePromise();};
   const onOpen=()=>finish(),onAbort=()=>finish(identityFailure());
   ws.once('open',onOpen);abort.signal.addEventListener('abort',onAbort,{once:true});
  });
  identity.assertCurrent();
  const initialized=await request('initialize',{clientInfo:{name:'kanban-shared-observer',version:'1.0.0'},capabilities:{experimentalApi:true}});
  const version=/^[A-Za-z][A-Za-z0-9 _.-]{0,127}\/([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)(?:\s|$)/.exec(initialized?.userAgent??'')?.[1];
  if(!['0.166.0','0.166.0-alpha.5.1'].includes(version)||initialized.codexHome!==codexHome)throw authFailure();
  send({method:'initialized'});
  let waitTimer;
  try{await Promise.race([firstNotice,new Promise((_,reject)=>{waitTimer=setTimeout(()=>reject(identityFailure()),timeoutMs);})]);}finally{clearTimeout(waitTimer);}
  const account1=await request('account/read',{refreshToken:false});
  const auth1=await request('getAuthStatus',{includeToken:true,refreshToken:false});
  const first=accountDigests(account1,auth1);auth1.authToken=null;
  const account2=await request('account/read',{refreshToken:false});
  const auth2=await request('getAuthStatus',{includeToken:true,refreshToken:false});
  const second=accountDigests(account2,auth2);auth2.authToken=null;
  if(!equal(first.scope,second.scope)||!equal(first.principal,second.principal)||noticeCount!==1||closed)throw authFailure();
  identity.assertCurrent();expiresAtMs=Math.min(first.expiresAtMs,second.expiresAtMs);bound=true;
  const checkExpiry=()=>{const remaining=expiresAtMs-Date.now();if(remaining<=0)stop();else{expiryTimer=setTimeout(checkExpiry,Math.min(remaining,2147483647));expiryTimer.unref();}};
  checkExpiry();
  const observer=Object.freeze({
   signal:abort.signal,
   configurationProtocolVersion:version,
   expiresAtMs,
   assertCurrent,
   matchesFingerprint(value){
    assertCurrent();
    return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)&&equal(first.principal,Buffer.from(value,'hex'));
   },
   matchesPrincipal(value){
    assertCurrent();
    if(!obj(value)||!atom(value.accountId)||!atom(value.userId))return false;
    return equal(first.principal,digest(['shared-account-principal-v1',value.accountId,value.userId]));
   },
   // Private server wiring only. Every call must already have passed the
   // caller's synchronous view/account/history/intent gate.
   attachGateReceiver(receiver){
    assertCurrent();if(gateReceiver||typeof receiver!=='function')throw identityFailure();
    gateReceiver=receiver;
   },
   writeGateFrame(encoded){
    assertCurrent();
    if(!gateReceiver||typeof encoded!=='string'||Buffer.byteLength(encoded)>64*1024)throw identityFailure();
    let frame;try{frame=JSON.parse(encoded);}catch{throw identityFailure();}
    if(!obj(frame)||(Object.hasOwn(frame,'method')&&typeof frame.id==='string'&&frame.id.startsWith(observerIdPrefix)))throw identityFailure();
    const key=Object.hasOwn(frame,'method')&&Object.hasOwn(frame,'id')?rpcKey(frame.id):null;
    if(Object.hasOwn(frame,'method')&&Object.hasOwn(frame,'id')&&!key)throw identityFailure();
    if(key){if(gatePending.has(key)||pending.size+gatePending.size>=64)throw queueFailure();gatePending.add(key);}
    try{sendEncoded(encoded);}catch(error){if(key)gatePending.delete(key);throw error;}
   },
   async listThreads(params){
    assertCurrent();const copied=listParams(params);
    const response=await request('thread/list',copied);
    assertCurrent();
    if(!obj(response)||!Array.isArray(response.data)||response.data.length>copied.limit||
       !Object.hasOwn(response,'nextCursor')||!cursor(response.nextCursor))throw invalidRead();
    return response;
   },
   async readModelPage(cursor=null){
    assertCurrent();
    if(cursor!==null&&(typeof cursor!=='string'||cursor.length<1||cursor.length>4096||/[\x00-\x1f\x7f]/.test(cursor)))throw invalidRead();
    const result=await request('model/list',{limit:100,includeHidden:false,...cursor===null?{}:{cursor}});
    assertCurrent();
    if(!obj(result)||!Array.isArray(result.data)||result.data.length>100||Buffer.byteLength(JSON.stringify(result))>2*1024*1024||
       result.nextCursor!=null&&(typeof result.nextCursor!=='string'||result.nextCursor.length<1||result.nextCursor.length>4096||/[\x00-\x1f\x7f]/.test(result.nextCursor)))throw invalidRead();
    return result;
   },
   async readProjectConfig(cwd){
    assertCurrent();if(!pathOK(cwd))throw invalidRead();
    const result=await request('config/read',{cwd,includeLayers:true});
    assertCurrent();if(!obj(result)||!obj(result.config)||!obj(result.origins)||!Array.isArray(result.layers))throw invalidRead();return result;
   },
   async readRequirements(){
    assertCurrent();const result=await request('configRequirements/read',null);
    assertCurrent();if(!obj(result))throw invalidRead();return result;
   },
   async readThreadMetadata(threadId){
    assertCurrent();if(typeof threadId!=='string'||!UUID.test(threadId))throw authFailure();
    let response;
    try{response=await request('thread/read',{threadId,includeTurns:false});}
    catch(error){assertCurrent();if(confirmedMissing(error?.cause,threadId,version,daemon.exeSha256))return null;throw error;}
    assertCurrent();
    if(!obj(response)||!obj(response.thread)||response.thread.id!==threadId||!pathOK(response.thread.cwd)||
       (response.thread.turns!==undefined&&(!Array.isArray(response.thread.turns)||response.thread.turns.length!==0)))throw invalidRead();
    return response;
   },
   async readThread(threadId){
    assertCurrent();if(typeof threadId!=='string'||!UUID.test(threadId))throw authFailure();
    let response;
    try{response=await request('thread/read',{threadId,includeTurns:false});}
    catch(error){assertCurrent();if(confirmedMissing(error?.cause,threadId,version,daemon.exeSha256))return null;throw error;}
    assertCurrent();
    if(response?.thread?.id!==threadId||!pathOK(response.thread.cwd))throw authFailure();
    return Object.freeze({thread:Object.freeze({id:threadId,cwd:response.thread.cwd})});
   },
   close:stop,
  });
  observerBrands.add(observer);return observer;
 }catch(error){stop();throw error?.code==='SHARED_DAEMON_AUTH_UNVERIFIED'?error:identityFailure();}
}
