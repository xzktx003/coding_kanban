'use strict';
const http=require('node:http');
const {randomUUID}=require('node:crypto');
const {isSharedMcpFrame,isMcpEndpoint,copyMcpMetadata}=require('./shared-mcp-wire.cjs');
const denied=()=>Object.assign(new Error('Shared native MCP relay unavailable'),{code:'SHARED_NATIVE_MCP_UNAVAILABLE'});
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const replyHeaders=['content-type','mcp-session-id','mcp-protocol-version','cache-control'];

/** Relay only to the exact session constructed by the pinned original ex5.
 * The endpoint and its bearer token never cross owner IPC. Only the separately
 * guarded host's proxy config is supplied to the original connection getter.
 */
function createNativeSharedMcpRelay({profileId,generation,streamId,verifyRuntimeSync,verifyRequestSync=verifyRuntimeSync,sendFrame,onFailure=()=>{},memoryBudget,timeoutMs=15000}={}){
 if(![profileId,generation,streamId].every(x=>UUID.test(x??''))||[verifyRuntimeSync,verifyRequestSync,sendFrame,onFailure].some(x=>typeof x!=='function')||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||
    (memoryBudget!==undefined&&(!memoryBudget||typeof memoryBudget.reserveBytes!=='function'||typeof memoryBudget.releaseBytes!=='function')))throw denied();
 const requests=new Map(),used=new Set(),allocations=new Set();
 let closed=false,original=null,endpoint=null,proxy=null,registrationId=null,resolveConfig,rejectConfig,timer,heldBytes=0;
 const prepared=new Promise((resolve,reject)=>{resolveConfig=resolve;rejectConfig=reject;});prepared.catch(()=>{});
 const current=()=>{try{return !closed&&verifyRuntimeSync()===true;}catch{return false;}};
 const authorized=()=>{try{return current()&&verifyRequestSync()===true;}catch{return false;}};
 const frame=(type,requestId,rest={})=>({v:1,type,profileId,generation,streamId,requestId,...rest});
 function reserve(bytes){if(heldBytes+bytes>8*1024*1024||(memoryBudget&&memoryBudget.reserveBytes(bytes)!==true))throw denied();heldBytes+=bytes;const token={bytes};allocations.add(token);return token;}
 function release(token){if(!allocations.delete(token))return;heldBytes-=token.bytes;memoryBudget?.releaseBytes(token.bytes);}
 function send(value){
  if(!current()||!isSharedMcpFrame(value,{side:'native',profileId,generation}))throw denied();
  const receipt=sendFrame(value);if(receipt&&typeof receipt.then==='function')Promise.resolve(receipt).catch(fail);
 }
 function fail(){try{onFailure(denied());}catch{}close();}
 function close(){
  if(closed)return;closed=true;clearTimeout(timer);rejectConfig(denied());
  for(const request of requests.values())request.request.destroy();requests.clear();for(const token of allocations)release(token);
  const session=original;original=null;proxy=null;endpoint=null;
  try{Promise.resolve(session?.dispose()).catch(()=>{});}catch{}
 }
 async function prepare(createOriginalSession,options){
  if(!current()||registrationId||typeof createOriginalSession!=='function'||options?.hostId!=='kanban-shared-cli'||
     typeof options.handlers?.callTool!=='function'||typeof options.handlers?.listTools!=='function')throw denied();
  registrationId=randomUUID();timer=setTimeout(fail,timeoutMs);timer.unref?.();
  try{
   const session=await createOriginalSession(options);
   if(!current()||!session||typeof session.dispose!=='function'||!isMcpEndpoint(session.mcpServerConfig)){
    try{await session?.dispose?.();}catch{}throw denied();
   }
   original=session;endpoint=structuredClone(session.mcpServerConfig);
   send(frame('shared-mcp-register',registrationId,{config:copyMcpMetadata(endpoint)}));return await prepared;
  }catch(error){fail();throw error;}
 }
 function receive(value){
  try{
   if(!current()||!isSharedMcpFrame(value,{side:'host',profileId,generation})||value.streamId!==streamId)throw denied();
   if(value.type==='shared-mcp-config'){
    if(!original||proxy||value.requestId!==registrationId)throw denied();
    proxy=Object.freeze({...structuredClone(value.config)});clearTimeout(timer);resolveConfig(proxy);return true;
   }
   if(!proxy||!endpoint||!authorized())throw denied();
   if(value.type==='shared-mcp-cancel'){
    const pending=requests.get(value.requestId);if(pending){requests.delete(value.requestId);pending.request.destroy();for(const token of pending.allocations)release(token);}
    else if(!used.has(value.requestId)){
     // Cancellation can overtake an owner write whose final guard rejected it.
     // A bounded tombstone starts no HTTP work and blocks any late request
     // carrying that same nonce; other owned requests remain independent.
     if(used.size>=8192)throw denied();used.add(value.requestId);
    }return true;
   }
   if(value.type!=='shared-mcp-request'||used.has(value.requestId)||used.size>=8192||requests.size>=8)throw denied();
   used.add(value.requestId);const body=Buffer.from(value.body,'base64'),bodyToken=reserve(body.length),url=new URL(endpoint.url);
   const request=http.request({hostname:'127.0.0.1',port:Number(url.port),path:'/mcp',method:value.method,
    headers:{...value.headers,Authorization:endpoint.http_headers.Authorization,'content-length':String(body.length)},agent:false},response=>{
     const pending=requests.get(value.requestId);if(!pending){response.destroy();return;}
     response.on('data',part=>{
      try{if(!authorized()||!Buffer.isBuffer(part)||pending.bytes+part.length>2*1024*1024)throw denied();
       const token=reserve(part.length);pending.allocations.push(token);pending.parts.push(part);pending.bytes+=part.length;
      }catch{response.destroy();fail();}
     });
     response.on('end',()=>{
      if(requests.get(value.requestId)!==pending)return;
      try{
       if(!authorized())throw denied();const headers={};for(const name of replyHeaders){const text=response.headers[name];if(typeof text==='string')headers[name]=text;}
       const bytes=Buffer.concat(pending.parts,pending.bytes);send(frame('shared-mcp-response',value.requestId,{status:response.statusCode,headers,body:bytes.toString('base64')}));
       requests.delete(value.requestId);for(const token of pending.allocations)release(token);pending.parts.length=0;
      }catch{fail();}
     });
     response.on('error',()=>{if(requests.has(value.requestId))fail();});
    });
   const pending={request,parts:[],bytes:0,allocations:[bodyToken]};requests.set(value.requestId,pending);
   request.on('error',()=>{if(requests.get(value.requestId)===pending)fail();});
   request.setTimeout(value.method==='POST'?3600*1000:30000,()=>{if(requests.get(value.requestId)===pending)fail();});
   // The only HTTP destination and Authorization came from the original
   // session. Recheck local account/runtime immediately before actual write.
   if(!authorized())throw denied();request.end(body);return true;
  }catch(error){fail();throw error;}
 }
 return Object.freeze({prepare,receive,close,get config(){return proxy;}});
}
module.exports={createNativeSharedMcpRelay};
