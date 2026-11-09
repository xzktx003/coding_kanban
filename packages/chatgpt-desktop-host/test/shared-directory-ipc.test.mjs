import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {createServer,createConnection} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {createHostDirectoryIpc,createNativeDirectoryIpc,isDirectoryFrame}=createRequire(import.meta.url)('../src/shared-directory-ipc.cjs');

async function until(predicate){const end=Date.now()+2000;while(!predicate()){if(Date.now()>end)throw Error('fixture timed out');await new Promise(r=>setTimeout(r,5));}}
async function fixture(t,{execute,interceptHost,verifyHost=()=>true,verifyNative=()=>true,hostBudget,nativeBudget}={}){
 const dir=await mkdtemp(join(tmpdir(),'directory-ipc-')),server=createServer(),path=join(dir,'ipc');
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(path,resolve);});
 const accepted=new Promise(resolve=>server.once('connection',resolve)),hostSocket=createConnection(path);
 await new Promise((resolve,reject)=>{hostSocket.once('connect',resolve);hostSocket.once('error',reject);});
 const nativeSocket=await accepted,profileId=randomUUID(),generation=randomUUID(),sent=[],calls=[];
 function wire(socket,onFrame){let buffer='';socket.on('error',()=>{});socket.on('data',chunk=>{buffer+=chunk.toString();for(;;){const pos=buffer.indexOf('\n');if(pos<0)break;const line=buffer.slice(0,pos);buffer=buffer.slice(pos+1);onFrame(JSON.parse(line));}});}
 const send=(socket,side)=>(frame)=>{
  const payload=JSON.stringify(frame)+'\n';assert.ok(Buffer.byteLength(payload)<=65536);sent.push({side,frame});
  const write=()=>new Promise((resolve,reject)=>socket.write(payload,error=>error?reject(error):resolve()));
  return side==='host'&&interceptHost?interceptHost(frame,write):write();
 };
 let host,native;
 host=createHostDirectoryIpc({profileId,generation,sendFrame:send(hostSocket,'host'),verifyCurrentSync:verifyHost,timeoutMs:1000,...hostBudget});
 native=createNativeDirectoryIpc({profileId,generation,sendFrame:send(nativeSocket,'native'),verifyCurrentSync:verifyNative,timeoutMs:1000,...nativeBudget,execute:(...args)=>{calls.push(args);return execute(...args);}});
 wire(hostSocket,frame=>host.receive(frame));wire(nativeSocket,frame=>native.receive(frame));
 t.after(async()=>{host.close();native.close();hostSocket.destroy();nativeSocket.destroy();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 return {host,native,sent,calls,profileId,generation};
}
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function budget(){
 let used=0;const max=16*1024*1024;
 return {reserveBytes(n){if(used+n>max)return false;used+=n;return true;},releaseBytes(n){assert.ok(n>0&&n<=used);used-=n;},get used(){return used;}};
}
test('real Unix IPC preserves native fields/cursor and waits for a real ACK between 32 KiB chunks',async t=>{
 let releaseAck,held=false;
 const f=await fixture(t,{
  interceptHost(frame,write){if(frame.type==='shared-directory-ack'&&!held){held=true;return new Promise((resolve,reject)=>{releaseAck=()=>write().then(resolve,reject);});}return write();},
  async execute(method,params){
   if(method==='thread/list')return {data:[{id,cwd:'/fixture/project',preview:'a'.repeat(85000),arbitrary:{n:42}}],nextCursor:'native-cursor',unknownField:{preserved:true}};
   return {thread:{id:params.threadId,cwd:'/fixture/project',turns:[],unknown:'preserved'},other:'kept'};
  }
 });
 const result=f.host.fetch('thread/list',{limit:2,useStateDbOnly:true,cursor:'prior-cursor'});
 await until(()=>typeof releaseAck==='function');
 assert.equal(f.sent.filter(x=>x.frame.type==='shared-directory-chunk').length,1);
 releaseAck();const page=await result;
 assert.equal(page.nextCursor,'native-cursor');assert.deepEqual(page.unknownField,{preserved:true});assert.equal(page.data[0].preview.length,85000);
 const metadata=await f.host.fetch('thread/read',{threadId:id,includeTurns:false});assert.equal(metadata.thread.unknown,'preserved');assert.equal(metadata.other,'kept');
 assert.deepEqual(f.calls.map(x=>[x[0],x[1]]),[['thread/list',{limit:2,useStateDbOnly:true,cursor:'prior-cursor'}],['thread/read',{threadId:id,includeTurns:false}]]);
 assert.ok(f.sent.filter(x=>x.frame.type==='shared-directory-chunk').length>=4);
});
test('invalid method, untrusted fields and a stale account never reach native execution',async t=>{
 let live=true;const f=await fixture(t,{verifyHost:()=>live,execute:async()=>({data:[],nextCursor:null})});
 for(const [method,params] of [['thread/resume',{threadId:id,excludeTurns:true}],['thread/list',{limit:1,useStateDbOnly:true,origin:'attacker'}],['thread/read',{threadId:id,includeTurns:true}]])await assert.rejects(f.host.fetch(method,params),{code:'SHARED_DIRECTORY_DENIED'});
 assert.equal(f.calls.length,0);live=false;
 await assert.rejects(f.host.fetch('thread/list',{limit:1,useStateDbOnly:true}),{code:'SHARED_DIRECTORY_REVOKED'});
 assert.equal(f.calls.length,0);
});
test('account revocation during a transfer rejects the caller without delivering the next chunk',async t=>{
 let releaseAck,live=true;
 const f=await fixture(t,{verifyNative:()=>live,interceptHost(frame,write){if(frame.type==='shared-directory-ack'&&!releaseAck)return new Promise((resolve,reject)=>{releaseAck=()=>write().then(resolve,reject);});return write();},execute:async()=>({data:[{id,cwd:'/fixture',preview:'b'.repeat(85000)}],nextCursor:null})});
 const result=f.host.fetch('thread/list',{limit:1,useStateDbOnly:true});result.catch(()=>{});
 await until(()=>typeof releaseAck==='function');live=false;releaseAck();
 await assert.rejects(result,{code:'SHARED_DIRECTORY_REVOKED'});
 assert.equal(f.sent.filter(x=>x.frame.type==='shared-directory-chunk').length,1);
});
test('16 pending requests and the 16 MiB response budget fail explicitly',async t=>{
 const releases=[];const f=await fixture(t,{execute:()=>new Promise(resolve=>releases.push(resolve))});
 const pending=Array.from({length:16},()=>f.host.fetch('thread/list',{limit:1,useStateDbOnly:true}));for(const p of pending)p.catch(()=>{});
 await until(()=>releases.length===16);
 await assert.rejects(f.host.fetch('thread/list',{limit:1,useStateDbOnly:true}),{code:'SHARED_DIRECTORY_LIMIT'});
 releases.shift()({data:[{id,cwd:'/fixture',preview:'x'.repeat(16*1024*1024)}],nextCursor:null});
 await assert.rejects(pending[0],{code:'SHARED_DIRECTORY_LIMIT'});
 f.host.close();await Promise.allSettled(pending);
});
test('wrong direction and an out-of-order ACK fail closed',async t=>{
 let releaseAck;
 const f=await fixture(t,{interceptHost(frame,write){if(frame.type==='shared-directory-ack'&&!releaseAck)return new Promise((resolve,reject)=>{releaseAck=()=>write().then(resolve,reject);});return write();},execute:async()=>({data:[{id,cwd:'/fixture',preview:'z'.repeat(40000)}],nextCursor:null})});
 const promise=f.host.fetch('thread/list',{limit:1,useStateDbOnly:true});promise.catch(()=>{});
 await until(()=>typeof releaseAck==='function');
 const chunk=f.sent.find(x=>x.frame.type==='shared-directory-chunk').frame;
 assert.equal(isDirectoryFrame(chunk,{side:'native',profileId:f.profileId,generation:f.generation}),true);
 assert.equal(isDirectoryFrame(chunk,{side:'host',profileId:f.profileId,generation:f.generation}),false);
 assert.equal(f.native.receive({v:1,type:'shared-directory-ack',profileId:f.profileId,generation:f.generation,requestId:chunk.requestId,sequence:2}),false);
 await assert.rejects(promise,{code:'SHARED_DIRECTORY_PROTOCOL'});
 assert.equal(f.sent.filter(x=>x.frame.type==='shared-directory-chunk').length,1);
});
test('a forged native request and wrong profile never execute a read',async t=>{
 for(const badProfile of [false,true]){
  const f=await fixture(t,{execute:async()=>({data:[],nextCursor:null})});
  const frame={v:1,type:'shared-directory-request',profileId:badProfile?randomUUID():f.profileId,generation:f.generation,requestId:randomUUID(),method:'thread/resume',params:{threadId:id,excludeTurns:true}};
  assert.equal(f.native.receive(frame),false);assert.equal(f.native.active,false);assert.equal(f.calls.length,0);
 }
});
test('native account revocation aborts a pending read and notifies the host',async t=>{
 let signal;const f=await fixture(t,{execute:(_method,_params,control)=>{signal=control.signal;return new Promise(()=>{});}});
 const promise=f.host.fetch('thread/list',{limit:1,useStateDbOnly:true});promise.catch(()=>{});
 await until(()=>signal!==undefined);f.native.revoke();
 await assert.rejects(promise,{code:'SHARED_DIRECTORY_REVOKED'});assert.equal(signal.aborted,true);
});
test('simultaneous responses share one 16 MiB retained budget',async t=>{
 let releaseAck;
 const f=await fixture(t,{interceptHost(frame,write){if(frame.type==='shared-directory-ack'&&!releaseAck)return new Promise((resolve,reject)=>{releaseAck=()=>write().then(resolve,reject);});return write();},execute:async()=>({data:[{id,cwd:'/fixture',preview:'x'.repeat(9*1024*1024)}],nextCursor:null})});
 const first=f.host.fetch('thread/list',{limit:1,useStateDbOnly:true});first.catch(()=>{});
 await until(()=>typeof releaseAck==='function');
 await assert.rejects(f.host.fetch('thread/list',{limit:1,useStateDbOnly:true}),{code:'SHARED_DIRECTORY_LIMIT'});
 f.host.close();await assert.rejects(first,{code:'SHARED_DIRECTORY_CLOSED'});
});
test('native response competes for the same-process budget and returns its reservation on success',async t=>{
 const shared=budget(),other=16*1024*1024-1024;assert.equal(shared.reserveBytes(other),true);
 const f=await fixture(t,{nativeBudget:shared,execute:async()=>({data:[{id,cwd:'/fixture',preview:'a'.repeat(2048)}],nextCursor:null})});
 await assert.rejects(f.host.fetch('thread/list',{limit:1,useStateDbOnly:true}),{code:'SHARED_DIRECTORY_LIMIT'});
 assert.equal(shared.used,other);assert.equal(f.host.active,true);assert.equal(f.native.active,true);
 shared.releaseBytes(other);
 assert.equal((await f.host.fetch('thread/list',{limit:1,useStateDbOnly:true})).data[0].preview.length,2048);
 await until(()=>shared.used===0);
});
test('host budget contention closes only the directory IPC and returns native and host reservations',async t=>{
 const hostBudget=budget(),nativeBudget=budget(),other=16*1024*1024-1024;hostBudget.reserveBytes(other);
 const f=await fixture(t,{hostBudget,nativeBudget,execute:async()=>({data:[{id,cwd:'/fixture',preview:'a'.repeat(2048)}],nextCursor:null})});
 await assert.rejects(f.host.fetch('thread/list',{limit:1,useStateDbOnly:true}),{code:'SHARED_DIRECTORY_LIMIT'});
 await until(()=>!f.native.active&&nativeBudget.used===0);
 assert.equal(hostBudget.used,other);hostBudget.releaseBytes(other);assert.equal(hostBudget.used,0);
});
test('closing a half-transferred response returns both same-process budget reservations',async t=>{
 const hostBudget=budget(),nativeBudget=budget();let releaseAck;
 const f=await fixture(t,{hostBudget,nativeBudget,interceptHost(frame,write){if(frame.type==='shared-directory-ack'&&!releaseAck)return new Promise((resolve,reject)=>{releaseAck=()=>write().then(resolve,reject);});return write();},execute:async()=>({data:[{id,cwd:'/fixture',preview:'a'.repeat(80000)}],nextCursor:null})});
 const result=f.host.fetch('thread/list',{limit:1,useStateDbOnly:true});result.catch(()=>{});await until(()=>typeof releaseAck==='function');
 assert.ok(hostBudget.used>0);assert.ok(nativeBudget.used>0);
 f.host.close();await assert.rejects(result,{code:'SHARED_DIRECTORY_CLOSED'});
 await until(()=>nativeBudget.used===0);assert.equal(hostBudget.used,0);
});
