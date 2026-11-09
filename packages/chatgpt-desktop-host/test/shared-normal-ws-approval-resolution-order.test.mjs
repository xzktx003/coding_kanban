import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,chmodSync} from 'node:fs';
import {mkdtemp,chmod,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from 'ws';
import {createSharedDesktopDaemonSession} from '../src/shared-desktop-daemon-session.mjs';
const require=createRequire(import.meta.url);
const {createNativeSharedDesktopTransport}=require('../src/native-shared-desktop-transport.cjs');
const {createSharedApprovalGate}=require('../src/shared-thread-approval.cjs');
const isPeer=process.argv[2]==='app-server';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){const end=Date.now()+3000;while(!predicate()){if(Date.now()>end)throw Error('owned resolution peer deadline');await delay(5);}}

if(isPeer){
 const socketPath=process.argv[3],cwd=process.argv[4],server=createServer(),wss=new WebSocketServer({noServer:true});
 server.on('upgrade',(request,socket,head)=>wss.handleUpgrade(request,socket,head,ws=>wss.emit('connection',ws)));
 wss.on('connection',ws=>{
  ws.on('error',()=>{});
  ws.on('message',data=>{
   const frame=JSON.parse(data.toString());process.send?.({received:frame});
   if(frame.method==='initialize'){
    ws.send(JSON.stringify({id:frame.id,result:{userAgent:'codex-cli/0.166.0',codexHome:cwd}}));
    ws.send(JSON.stringify({method:'account/updated',params:{},emittedAtMs:Date.now()}));
   }else if(frame.method==='thread/read'){
    ws.send(JSON.stringify({id:frame.id,result:{thread:{id:frame.params.threadId,cwd,turns:[]}}}));
   }
  });
 });
 process.on('message',message=>{
  if(message?.op!=='frames')return;
  for(const ws of wss.clients){ws._socket.cork();for(const frame of message.frames)ws.send(JSON.stringify(frame));ws._socket.uncork();}
 });
 server.listen(socketPath,()=>{chmodSync(socketPath,0o600);process.send?.({ready:true});});
 process.on('SIGTERM',()=>{for(const ws of wss.clients)ws.terminate();server.close(()=>process.exit(0));});
}else{
 for(const requestId of ['owned-server-request',17])test(`received approval resolution blocks queued reply before normal FIFO dispatch (${typeof requestId})`,async t=>{
  const dir=await mkdtemp(join(tmpdir(),'shared-resolution-order-'));await chmod(dir,0o700);
  const socketPath=join(dir,'daemon.sock'),seen=[];
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'app-server',socketPath,dir],{stdio:['ignore','ignore','pipe','ipc']});
  child.stderr.on('data',()=>{});child.on('message',message=>seen.push(message));
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}await rm(dir,{recursive:true,force:true});});
  await until(()=>seen.some(message=>message.ready));
  const stat=readFileSync(`/proc/${child.pid}/stat`,'utf8');
  const daemon={pid:child.pid,startTicks:stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)[19],socketPath,daemonGeneration:randomUUID(),exeSha256:createHash('sha256').update(readFileSync(process.execPath)).digest('hex')};
  const profileId=randomUUID(),generation=randomUUID(),threadId=randomUUID(),attemptId=randomUUID();
  const binding={hostId:'kanban-shared-cli',runtimeGeneration:randomUUID(),daemonGeneration:daemon.daemonGeneration,accountRevision:1,projectId:'owned-resolution-project',threadId,viewId:randomUUID(),clientId:randomUUID()};
  const request={id:requestId,method:'item/commandExecution/requestApproval',params:{threadId,turnId:'owned-turn',itemId:'owned-item',command:'owned protocol fixture; never executed',cwd:dir}};
  const failures=[],messages=[];let session,native,approval,requestObserved=false,resolvedObserved=false,attemptBeforeResolution=false,replyResult,replyPending;
  const action=()=>({binding,attemptId,actionId:randomUUID(),requestId,turnId:'owned-turn',itemId:'owned-item',method:request.method,decision:'decline',signal:new AbortController().signal,deadline:performance.now()+2000});
  native=createNativeSharedDesktopTransport({profileId,generation,verifyRuntimeSync:()=>true,timeoutMs:2000,sendFrame:frame=>session.receiveNative(frame)});
  approval=createSharedApprovalGate({verifyBindingSync:value=>value.threadId===threadId,verifyHistorySync:value=>value.threadId===threadId,write:encoded=>session.authorityGate.write(encoded)});
  session=createSharedDesktopDaemonSession({profileId,generation,daemon,daemonVersion:'0.166.0',timeoutMs:2000,
   verifyContainerSync:()=>true,verifySessionSync:()=>true,verifyReadSync:()=>true,verifyBindingSync:value=>value.threadId===threadId,verifyHistorySync:value=>value.threadId===threadId,
   verifyInitializeSync:result=>result.codexHome===dir,verifyInitialAccountNotificationSync:()=>true,verifyServerEventSync:()=>true,
   authorizeServerReplySync:(incoming,response)=>incoming.id===requestId&&incoming.params.threadId===threadId&&response.id===requestId&&response.result?.decision==='decline',
   sendFrame:frame=>native.receive(frame),onFailure:error=>failures.push(error.code),
   receiveAuthority:encoded=>{
    const frame=JSON.parse(encoded);
    if(frame.method===request.method){assert.equal(approval.observe(binding,attemptId,frame),true);requestObserved=true;}
    if(frame.method==='serverRequest/resolved'){assert.equal(approval.observeResolved(frame),true);resolvedObserved=true;}
    if(frame.method==='mcpServer/startupStatus/updated'&&!replyPending){
     // Native continuations run between queued WS dispatches. The resolution
     // has arrived in this same corked WS batch but has not reached its observer.
     queueMicrotask(()=>{
      attemptBeforeResolution=!resolvedObserved;
      replyPending=approval.reply(action()).then(value=>{replyResult={value};},error=>{replyResult={code:error.code};});
      // Server and client RPC ids are separate namespaces. A normal read with
      // the same typed id must not be mistaken for an approval response.
      connection.send(JSON.stringify({id:requestId,method:'thread/read',params:{threadId,includeTurns:false}}));
     });
    }
    return true;
   },
  });
  t.after(()=>{approval.close();session.close();native.close();});
  const connection=await native.connect();connection.onmessage=event=>messages.push(JSON.parse(event.data));
  connection.send(JSON.stringify({id:'initialize-owned-resolution',method:'initialize',params:{clientInfo:{name:'codex_desktop',title:'Codex Desktop',version:'26.1027.51404'},capabilities:{experimentalApi:true,requestAttestation:false}}}));
  await until(()=>messages.some(frame=>frame.method==='account/updated'));
  child.send({op:'frames',frames:[request]});await until(()=>requestObserved);
  const frames=Array.from({length:5},(_,index)=>({method:'mcpServer/startupStatus/updated',params:{threadId,name:`owned-server-${index}`,status:'ready',error:null,failureReason:null},emittedAtMs:Date.now()}));
  frames.push({method:'serverRequest/resolved',params:{threadId,requestId},emittedAtMs:Date.now()});
  child.send({op:'frames',frames});
  await until(()=>resolvedObserved&&replyResult!==undefined&&messages.some(frame=>frame.id===requestId&&frame.result?.thread));
  await replyPending;
  assert.equal(attemptBeforeResolution,true,'the test must exercise an action between the earlier metadata and resolution dispatch');
  assert.equal(seen.filter(message=>message.received?.id===requestId&&!Object.hasOwn(message.received,'method')).length,0,'a resolution already received by this writer must prevent an obsolete approval response reaching the socket');
  assert.equal(replyResult.code,'SHARED_APPROVAL_OUTCOME_UNKNOWN');
  assert.equal(seen.filter(message=>message.received?.id===requestId&&message.received.method==='thread/read').length,1,'client ids remain independent');
  await assert.rejects(approval.reply(action()),error=>error.code==='SHARED_APPROVAL_DENIED');
  assert.deepEqual(failures,[]);assert.equal(session.signal.aborted,false);
 });
}
