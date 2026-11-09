import {createServer} from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {createRequire} from 'node:module';
const {isSharedMcpFrame}=createRequire(import.meta.url)('./shared-mcp-wire.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_REQUEST=64*1024,MAX_RESPONSE=2*1024*1024,MAX_BYTES=8*1024*1024;
const requestHeaders=['content-type','accept','mcp-session-id','mcp-protocol-version'];
const methods=new Set(['initialize','notifications/initialized','ping','tools/list','tools/call','notifications/cancelled']);
const aliases=['openai/threadId','openai/thread_id','codexThreadId','codex_thread_id','threadId','thread_id'];
const denied=()=>Object.assign(new Error('Shared MCP proxy unavailable'),{code:'SHARED_MCP_PROXY_UNAVAILABLE'});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const rpcId=value=>typeof value==='string'?value.length>0&&value.length<=256:Number.isSafeInteger(value);
const key=value=>`${typeof value}:${value}`;
function threadOf(request){
 const meta=request.params?._meta;if(!object(meta))return null;
 const values=[];
 for(const name of aliases)if(Object.hasOwn(meta,name))values.push(meta[name]);
 if(Object.hasOwn(meta,'x-codex-turn-metadata')){
  let turn=meta['x-codex-turn-metadata'];
  if(typeof turn==='string')try{turn=JSON.parse(turn)}catch{return null;}
  if(!object(turn))return null;
  if(Object.hasOwn(turn,'thread_id'))values.push(turn.thread_id);
 }
 if(Object.hasOwn(meta,'thread')){
  if(!object(meta.thread)||!Object.hasOwn(meta.thread,'id'))return null;
  values.push(meta.thread.id);
 }
 return values.length&&values.every(value=>typeof value==='string'&&UUID.test(value)&&value===values[0])?values[0]:null;
}

/** Owned loopback transport only. Tools and model results come solely from the
 * pinned native MCP endpoint through authenticated owner IPC, never this host. */
export async function createSharedMcpProxy({profileId,generation,streamId,verifyRuntimeSync,verifyScopeSync,verifyThreadSync,sendFrame,memoryBudget,onFailure=()=>{},timeoutMs=15000,requestTimeoutMs}={}){
 if(![profileId,generation,streamId].every(value=>UUID.test(value??''))||
  [verifyRuntimeSync,verifyScopeSync,verifyThreadSync,sendFrame,onFailure].some(value=>typeof value!=='function')||
  !memoryBudget||typeof memoryBudget.reserveBytes!=='function'||typeof memoryBudget.releaseBytes!=='function'||
  !Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||
  (requestTimeoutMs!==undefined&&(!Number.isSafeInteger(requestTimeoutMs)||requestTimeoutMs<1||requestTimeoutMs>3600000)))throw denied();
 const bearer=randomBytes(32).toString('base64url'),expected=Buffer.from(`Bearer ${bearer}`);
 const active=new Set(),pending=new Map(),used=new Set(),sessions=new Map();
 let closed=false,registered=false,registrationId=null,config=null,port=0,heldBytes=0,registrationTimer;
 const runtime=()=>{try{return !closed&&verifyRuntimeSync()===true;}catch{return false;}};
 const scoped=()=>{try{return runtime()&&verifyScopeSync()===true;}catch{return false;}};
 const authorized=record=>{
  try{return scoped()&&(!record.sessionId||sessions.get(record.sessionId)===record.session)&&
   (!record.threadId||verifyThreadSync(record.threadId,record.rpc)===true);}catch{return false;}
 };
 const frame=(type,requestId,extra={})=>({v:1,type,profileId,generation,streamId,requestId,...extra});
 function reserve(record,bytes){
  if(!Number.isSafeInteger(bytes)||bytes<0||heldBytes+bytes>MAX_BYTES||memoryBudget.reserveBytes(bytes)!==true)throw denied();
  heldBytes+=bytes;record.held+=bytes;
 }
 function release(record){
  const bytes=record.held;record.held=0;heldBytes-=bytes;
  if(bytes)try{memoryBudget.releaseBytes(bytes);}catch{fail();}
 }
 function send(value,guard=runtime){
  const finalVerifySync=()=>{try{return guard()===true;}catch{return false;}};
  if(!finalVerifySync()||!isSharedMcpFrame(value,{side:'host',profileId,generation})||value.streamId!==streamId||!finalVerifySync())throw denied();
  // The owning transport must repeat this exact captured guard after any
  // async identity work and immediately before its real IPC write.
  const receipt=sendFrame(Object.freeze(value),finalVerifySync);
  if(receipt===false)throw denied();
  return Promise.resolve(receipt);
 }
 function cleanup(record,cancel=false){
  if(record.done)return;record.done=true;clearTimeout(record.timer);
  active.delete(record);pending.delete(record.requestId);record.parts.length=0;
  if(cancel&&record.forwarded&&runtime()){
   const id=record.requestId;record.cancelled=true;
   const cancelCurrent=()=>runtime()&&record.cancelled===true&&record.requestId===id&&used.has(id);
   try{send(frame('shared-mcp-cancel',id),cancelCurrent).catch(fail);}catch{/* Identity loss cannot authorize another write. */}
  }
  record.rpc=null;release(record);
 }
 function errorResponse(record,status,cancel=true){
  if(record.done)return;
  cleanup(record,cancel);
  if(!record.res.destroyed){try{if(record.res.headersSent)record.res.destroy();else record.res.writeHead(status).end();}catch{record.res.destroy();}}
 }
 function close(){
  if(closed)return;
  // Cancel only requests created by this proxy while the original runtime is
  // still current. The native relay owns the corresponding HTTP requests.
  for(const record of [...active])errorResponse(record,503,true);
  closed=true;registered=false;config=null;clearTimeout(registrationTimer);sessions.clear();expected.fill(0);
  server.closeAllConnections();server.close();
 }
 function fail(){if(closed)return;try{onFailure(denied());}catch{}close();}
 const server=createServer({maxHeaderSize:8192},(req,res)=>{void handle(req,res).catch(()=>{if(!res.destroyed)res.destroy();});});
 server.maxHeadersCount=16;server.headersTimeout=10000;server.requestTimeout=30000;server.keepAliveTimeout=1000;
 server.on('clientError',(_error,socket)=>socket.destroy());
 async function handle(req,res){
  const supplied=Buffer.from(typeof req.headers.authorization==='string'?req.headers.authorization:'');
  const count=name=>req.rawHeaders.filter((_,index)=>index%2===0&&req.rawHeaders[index].toLowerCase()===name).length;
  if(!runtime()||count('authorization')!==1||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){req.resume();res.writeHead(401).end();return;}
  if(req.url!=='/mcp'||req.headers.origin!==undefined||count('host')!==1||req.headers.host!==`127.0.0.1:${port}`){req.resume();res.writeHead(403).end();return;}
  if(!registered||!scoped()){req.resume();res.writeHead(403).end();return;}
  if(!['POST','GET','DELETE'].includes(req.method)){req.resume();res.writeHead(405).end();return;}
  if(active.size>=8||used.size>=8192){req.resume();res.writeHead(503).end();return;}
  const sessionId=req.headers['mcp-session-id'],session=typeof sessionId==='string'?sessions.get(sessionId):null;
  if((sessionId!==undefined&&(!UUID.test(sessionId)||!session))||(req.method!=='POST'&&!session)){req.resume();res.writeHead(404).end();return;}
  if(requestHeaders.some(name=>count(name)>1)||req.headers['content-encoding']!==undefined){req.resume();res.writeHead(400).end();return;}
  const record={req,res,sessionId:sessionId??null,session,requestId:randomUUID(),rpc:null,threadId:null,parts:[],bytes:0,held:0,forwarded:false,done:false,timer:null,replyStarted:false};
  active.add(record);
  req.on('aborted',()=>errorResponse(record,499));res.on('close',()=>{if(!record.done)cleanup(record,true)});res.on('error',()=>cleanup(record,true));
  record.timer=setTimeout(()=>errorResponse(record,504),requestTimeoutMs??30000);record.timer.unref?.();
  try{
   if(req.headers['content-length']!==undefined&&(!/^\d+$/.test(req.headers['content-length'])||Number(req.headers['content-length'])>MAX_REQUEST))return errorResponse(record,413,false);
   for await(const part of req){
    if(record.done)return;
    if(!authorized(record))return errorResponse(record,403,false);
    if(!Buffer.isBuffer(part)||record.bytes+part.length>MAX_REQUEST)return errorResponse(record,413,false);
    try{reserve(record,part.length);}catch{return errorResponse(record,503,false);}
    record.parts.push(part);record.bytes+=part.length;
   }
   if(record.done)return;
   if(!authorized(record))return errorResponse(record,403,false);
   const body=Buffer.concat(record.parts,record.bytes);record.parts.length=0;
   if(req.method==='POST'){
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))return errorResponse(record,415,false);
    let rpc;try{rpc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{return errorResponse(record,400,false);}
    if(!object(rpc)||rpc.jsonrpc!=='2.0'||!methods.has(rpc.method)||
       Object.keys(rpc).some(name=>!['jsonrpc','id','method','params'].includes(name))||
       (rpc.params!==undefined&&!object(rpc.params)))return errorResponse(record,400,false);
    const notification=rpc.method.startsWith('notifications/');
    if(notification?Object.hasOwn(rpc,'id'):!rpcId(rpc.id))return errorResponse(record,400,false);
    record.rpc=rpc;
    if(rpc.method==='initialize'){
     if(session||sessions.size>=256)return errorResponse(record,403,false);
    }else{
     if(!session)return errorResponse(record,404,false);
     if(rpc.method==='notifications/initialized'){
      if(session.initialized)return errorResponse(record,409,false);
     }else if(!session.initialized)return errorResponse(record,403,false);
    }
    if(rpc.method==='tools/call'){
     if(typeof rpc.params?.name!=='string'||!rpc.params.name||rpc.params.name.length>256)return errorResponse(record,400,false);
     record.threadId=threadOf(rpc);if(!record.threadId||!authorized(record))return errorResponse(record,403,false);
     clearTimeout(record.timer);record.timer=setTimeout(()=>errorResponse(record,504),requestTimeoutMs??3600000);record.timer.unref?.();
    }
    if(rpc.method==='notifications/cancelled'){
     const target=[...pending.values()].find(value=>value.session===session&&value.rpc&&rpcId(rpc.params?.requestId)&&key(value.rpc.id)===key(rpc.params.requestId));
     if(!target||!authorized(target))return errorResponse(record,403,false);
    }
    if(session&&!notification&&[...pending.values()].some(value=>value.session===session&&value.rpc&&key(value.rpc.id)===key(rpc.id)))return errorResponse(record,409,false);
   }else if(body.length||!session.initialized)return errorResponse(record,400,false);
   const headers={};for(const name of requestHeaders){const value=req.headers[name];if(typeof value==='string')headers[name]=value;}
   const request=frame('shared-mcp-request',record.requestId,{method:req.method,headers:Object.freeze(headers),body:body.toString('base64')});
   if(!authorized(record))return errorResponse(record,403,false);
   pending.set(record.requestId,record);used.add(record.requestId);record.forwarded=true;
   send(request,()=>!record.done&&pending.get(record.requestId)===record&&authorized(record)).catch(()=>{if(!record.done)errorResponse(record,502)});
  }catch{if(!record.done)errorResponse(record,503);}
 }
 function receive(value){
  try{
   if(!runtime()||!isSharedMcpFrame(value,{side:'native',profileId,generation})||value.streamId!==streamId)throw denied();
   if(value.type==='shared-mcp-register'){
    if(registrationId)throw denied();registrationId=value.requestId;
    config=Object.freeze({...structuredClone(value.config),enabled_tools:Object.freeze([]),omit_tools_from:Object.freeze(['deferred']),
     url:`http://127.0.0.1:${port}/mcp`,http_headers:Object.freeze({Authorization:`Bearer ${bearer}`})});
    registered=true;
    const registeredConfig=config,registeredId=value.requestId;
    const registrationCurrent=()=>runtime()&&registered&&registrationId===registeredId&&config===registeredConfig;
    send(frame('shared-mcp-config',registeredId,{config}),registrationCurrent).then(()=>{clearTimeout(registrationTimer);if(!runtime())fail();},fail);
    return true;
   }
   if(!registered||value.type!=='shared-mcp-response')throw denied();
   const record=pending.get(value.requestId);if(!record||record.replyStarted)throw denied();
   if(!authorized(record))return errorResponse(record,403),true;
   const bytes=Buffer.from(value.body,'base64');
   if(bytes.length>MAX_RESPONSE||bytes.toString('base64')!==value.body||value.status<200)throw denied();
   try{reserve(record,bytes.length);}catch{return errorResponse(record,503),true;}
   const headers={...value.headers};
   if(record.rpc?.method==='initialize'&&value.status>=200&&value.status<300){
    let reply;try{reply=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{}
    const id=headers['mcp-session-id'];
    if(object(reply)&&reply.jsonrpc==='2.0'&&key(reply.id)===key(record.rpc.id)&&object(reply.result)&&!Object.hasOwn(reply,'error')&&
       typeof reply.result.protocolVersion==='string'&&UUID.test(id??'')&&!sessions.has(id)){
     record.newSession={id,initialized:false};
    }
   }
   if(!authorized(record))return errorResponse(record,403),true;
   record.replyStarted=true;
   if(!authorized(record))return errorResponse(record,403),true;
   record.res.writeHead(value.status,headers);
   // No await separates the final scope/thread check from the actual body write.
   if(!authorized(record)){record.res.destroy();cleanup(record,true);return true;}
   if(record.newSession)sessions.set(record.newSession.id,record.newSession);
   if(record.rpc?.method==='notifications/initialized'&&value.status>=200&&value.status<300)record.session.initialized=true;
   if(record.req.method==='DELETE'&&value.status>=200&&value.status<300)sessions.delete(record.sessionId);
   record.res.end(bytes,()=>cleanup(record));return true;
  }catch(error){fail();throw error?.code==='SHARED_MCP_PROXY_UNAVAILABLE'?error:denied();}
 }
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();if(!address||typeof address==='string'||address.address!=='127.0.0.1'||!runtime())throw denied();port=address.port;
  server.on('error',fail);registrationTimer=setTimeout(fail,timeoutMs);registrationTimer.unref?.();
  return Object.freeze({receive,close,get config(){return config;}});
 }catch(error){close();throw error?.code==='SHARED_MCP_PROXY_UNAVAILABLE'?error:denied();}
}
