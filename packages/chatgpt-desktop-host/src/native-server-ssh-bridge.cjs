'use strict';
const net=require('node:net');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_FRAME=2*1024*1024,MAX_LINE=4*1024*1024+1024,MAX_HELD=8*1024*1024,MAX_ENTRIES=64;
const denied=(code='SSH_NATIVE_BRIDGE_UNAVAILABLE')=>Object.assign(new Error('Server SSH bridge unavailable'),{code});
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const exact=(v,keys)=>plain(v)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(v,k)??{},'value'));
const text=(v,n=1024)=>typeof v==='string'&&v.length>0&&Buffer.byteLength(v)<=n&&!/[\x00-\x1f\x7f]/.test(v);
const same=(a,b)=>['dev','ino','uid','mode'].every(k=>a[k]===b[k]);

/** Constructor-only fixed private UDS; no URL, key, command or public target. */
function createNativeServerSshBridge({profileId,generation,socketPath,verifyRuntimeSync,timeoutMs=10000}={}){
 if(!UUID.test(profileId??'')||!UUID.test(generation??'')||!text(socketPath,107)||!path.isAbsolute(socketPath)||path.resolve(socketPath)!==socketPath||typeof verifyRuntimeSync!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw denied();
 const parent=path.dirname(socketPath),sockets=new Set();let closed=false,published=new Map(),controlCount=0,authorized=false;
 const current=()=>{try{if(!closed&&verifyRuntimeSync()===true){authorized=true;return true;}}catch{}if(authorized)close();return false;};
 const lifetime=setInterval(()=>{if(authorized&&!current())close();},500);lifetime.unref?.();
 function identity(){
  if(!current())throw denied();
  const dir=fs.lstatSync(parent,{bigint:true}),sock=fs.lstatSync(socketPath,{bigint:true}),uid=BigInt(process.getuid());
  if(!dir.isDirectory()||dir.uid!==uid||(dir.mode&0o7777n)!==0o700n||fs.realpathSync(parent)!==parent||!sock.isSocket()||sock.uid!==uid||(sock.mode&0o7777n)!==0o600n)throw denied();
  return {dir,sock};
 }
 function fixed(before){const now=identity();if(!same(before.dir,now.dir)||!same(before.sock,now.sock))throw denied();}
 function connect(onFrame,onFailure){
  const before=identity(),socket=net.createConnection({path:socketPath});sockets.add(socket);let held=Buffer.alloc(0),failed=false;
  const fail=error=>{if(failed)return;failed=true;held.fill(0);held=Buffer.alloc(0);socket.destroy();onFailure(error?.code?.startsWith('SSH_')?error:denied());};
  socket.on('error',fail);socket.on('close',()=>{sockets.delete(socket);held.fill(0);held=Buffer.alloc(0);if(!failed)fail(denied());});
  socket.on('data',chunk=>{try{
   fixed(before);if(held.length+chunk.length>MAX_HELD)throw denied('SSH_NATIVE_BRIDGE_BUDGET');
   held=held.length?Buffer.concat([held,chunk]):chunk;
   for(;;){const end=held.indexOf(10);if(end<0){if(held.length>MAX_LINE)throw denied('SSH_NATIVE_BRIDGE_BUDGET');break;}
    if(end>MAX_LINE)throw denied('SSH_NATIVE_BRIDGE_BUDGET');
    const line=held.subarray(0,end);held=held.subarray(end+1);const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(line));fixed(before);onFrame(value);
   }
  }catch(error){fail(error);}});
  const ready=new Promise((resolve,reject)=>{socket.once('connect',()=>{try{fixed(before);resolve();}catch(error){reject(error);fail(error);}});socket.once('error',reject);});
  return {socket,ready,write(value){fixed(before);const line=JSON.stringify(value)+'\n';if(Buffer.byteLength(line)>MAX_LINE+1)throw denied('SSH_NATIVE_BRIDGE_BUDGET');return line;}};
 }
 async function request(method,params){
  if(!current()||controlCount>=MAX_ENTRIES)throw denied();controlCount++;
  const id=randomUUID();let channel,timer;
  try{return await new Promise((resolve,reject)=>{
   const finish=(error,result)=>{clearTimeout(timer);channel?.socket.destroy();error?reject(error):resolve(result);};
   channel=connect(value=>{if(!exact(value,['v','type','id','result'])&&!exact(value,['v','type','id','error']))return finish(denied());
    if(value.v!==1||value.type!=='reply'||value.id!==id||!current())return finish(denied());
    if(Object.hasOwn(value,'error')){if(!exact(value.error,['code'])||!/^SSH_[A-Z_]{1,80}$/.test(value.error.code))return finish(denied());return finish(denied(value.error.code));}
    finish(null,value.result);
   },error=>finish(error));
   timer=setTimeout(()=>finish(denied('SSH_NATIVE_BRIDGE_TIMEOUT')),timeoutMs);timer.unref?.();
   channel.ready.then(()=>{try{channel.socket.write(channel.write({v:1,type:'request',id,profileId,generation,method,params}));}catch(error){finish(error);}},error=>finish(error));
  });}finally{controlCount--;if(!current())close();}
 }
 function savedRows(rows){
  if(!Array.isArray(rows)||rows.length>512)throw denied();const aliases=new Set(),ids=new Set();
  return rows.map(row=>{if(!plain(row)||Reflect.ownKeys(row).some(k=>!['hostId','connectionAnalyticsId','displayName','source','alias','hostname','sshPort','identity'].includes(k))||!text(row.hostId,256)||!text(row.displayName,512)||!text(row.alias)||row.hostname!==null||row.sshPort!==null||row.identity!==null||aliases.has(row.alias)||ids.has(row.hostId))throw denied();
   aliases.add(row.alias);ids.add(row.hostId);return {hostId:row.hostId,displayName:row.displayName,alias:row.alias,...(row.connectionAnalyticsId===undefined?{}:{connectionAnalyticsId:row.connectionAnalyticsId})};});
 }
 async function save(rows){const fixed=savedRows(rows);await request('save',{aliases:fixed.map(row=>row.alias)});if(!current())throw denied();}
 async function catalog(rows){
  const fixedRows=savedRows(rows),result=await request('refresh',{});
  if(!exact(result,['connections'])||!Array.isArray(result.connections)||result.connections.length>512)throw denied();
  const available=new Set();for(const row of result.connections){if(!plain(row)||!text(row.alias)||available.has(row.alias)||!['disconnected','connecting','connected','failed'].includes(row.state)||Object.keys(row).some(k=>!['alias','state','connectionId','reasonCode'].includes(k)))throw denied();available.add(row.alias);}
  const next=new Map(),resultRows=[];
  for(const row of fixedRows){if(!available.has(row.alias))continue;next.set(row.alias,row);resultRows.push({hostId:row.hostId,...(row.connectionAnalyticsId===undefined?{}:{connectionAnalyticsId:row.connectionAnalyticsId}),displayName:row.displayName,source:'discovered',sshAlias:row.alias,sshHost:row.alias,sshPort:null,identity:null,autoConnect:false});}
  if(!current())throw denied();published=next;return resultRows;
 }
 async function probeVersion(ssh){
  if(!exact(ssh,['alias','host','port','identity'])||!text(ssh.alias)||ssh.host!==ssh.alias||ssh.port!==null||ssh.identity!==null||!published.has(ssh.alias))throw denied();
  const selected=published.get(ssh.alias),result=await request('version',{alias:ssh.alias});
  if(!exact(result,['code','stdout','stderr'])||result.code!==0||typeof result.stdout!=='string'||typeof result.stderr!=='string'||Buffer.byteLength(result.stdout)>4096||Buffer.byteLength(result.stderr)>4096||published.get(ssh.alias)!==selected||!current())throw denied('SSH_NATIVE_VERSION_UNAVAILABLE');
  return result;
 }
 async function open(ssh){
  if(!exact(ssh,['alias','host','port','identity'])||!text(ssh.alias)||ssh.host!==ssh.alias||ssh.port!==null||ssh.identity!==null||!published.has(ssh.alias))throw denied();
  const selected=published.get(ssh.alias),result=await request('connect',{alias:ssh.alias});
  if(!exact(result,['alias','connectionId','state'])||result.alias!==ssh.alias||!UUID.test(result.connectionId??'')||result.state!=='connecting'||published.get(ssh.alias)!==selected||!current())throw denied();
  let channel,timer,settled=false,writes=0,bytes=0;const connection={readyState:0,processId:null,onopen:null,onmessage:null,onerror:null,onclose:null,send,close:()=>stop()};
  let resolveOpen,rejectOpen;const ready=new Promise((resolve,reject)=>{resolveOpen=resolve;rejectOpen=reject;});
  function stop(error=denied()){
   if(connection.readyState===3)return;connection.readyState=3;clearTimeout(timer);channel?.socket.destroy();if(!settled){settled=true;rejectOpen(error);}try{connection.onclose?.({type:'close',code:1006,reason:'Server SSH transport closed',wasClean:false});}catch{}
  }
  function send(value){
   try{if(!current()||connection.readyState!==1||typeof value!=='string'||!value.length||Buffer.byteLength(value)>MAX_FRAME||writes>=MAX_ENTRIES)throw denied();
    const line=channel.write({v:1,type:'rpc',text:value}),size=Buffer.byteLength(line);if(bytes+size>MAX_HELD)throw denied('SSH_NATIVE_BRIDGE_BUDGET');writes++;bytes+=size;
    channel.socket.write(line,error=>{writes--;bytes-=size;if(error)stop(error);});
   }catch(error){stop(error);throw error;}
  }
  channel=connect(value=>{try{
   if(connection.readyState===0){if(!exact(value,['v','type','connectionId'])||value.v!==1||value.type!=='opened'||value.connectionId!==result.connectionId)throw denied();connection.readyState=1;clearTimeout(timer);settled=true;resolveOpen(connection);queueMicrotask(()=>{if(current()&&connection.readyState===1)try{connection.onopen?.({type:'open'});}catch(error){stop(error);}});return;}
   if(connection.readyState!==1||!exact(value,['v','type','text'])||value.v!==1||value.type!=='rpc'||typeof value.text!=='string'||!value.text.length||Buffer.byteLength(value.text)>MAX_FRAME||typeof connection.onmessage!=='function')throw denied();
   connection.onmessage({type:'message',data:value.text,receivedAtMs:performance.now()});
  }catch(error){stop(error);}},error=>stop(error));
  timer=setTimeout(()=>stop(denied('SSH_NATIVE_BRIDGE_TIMEOUT')),timeoutMs);timer.unref?.();
  channel.ready.then(()=>{try{channel.socket.write(channel.write({v:1,type:'open',profileId,generation,connectionId:result.connectionId}));}catch(error){stop(error);}},error=>stop(error));
  return ready;
 }
 function close(){if(closed)return;closed=true;clearInterval(lifetime);published.clear();for(const socket of sockets)socket.destroy();sockets.clear();}
 return Object.freeze({save,catalog,connect:open,probeVersion,close});
}
/** Only immutable new-host settings install a bridge; retirement never falls back. */
function installNativeServerSshBridge({settings,profileId,generation,verifyRuntimeSync,target=globalThis,socketPath='/bridge/server-ssh.sock'}={}){
 if(settings===undefined)return Object.freeze({close(){}});
 if(!exact(settings,['version'])||settings.version!==1||!target||Object.hasOwn(target,'__kanbanServerSshBridge'))throw denied();
 const bridge=createNativeServerSshBridge({profileId,generation,socketPath,verifyRuntimeSync});
 Object.defineProperty(target,'__kanbanServerSshBridge',{value:bridge,writable:false,configurable:false});
 return Object.freeze({close:bridge.close});
}
module.exports={createNativeServerSshBridge,installNativeServerSshBridge};
