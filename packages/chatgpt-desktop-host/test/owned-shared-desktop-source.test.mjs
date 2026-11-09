import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {createServer as createHttpServer,request as httpRequest} from 'node:http';
import {readFileSync} from 'node:fs';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeWireValue} from '../src/wire-value.mjs';
import {startOwnedSharedDesktopSource} from '../src/owned-shared-desktop-source.mjs';
const require=createRequire(import.meta.url);
const {createNativeSharedDesktopTransport}=require('../src/native-shared-desktop-transport.cjs');
const {createNativeSharedMcpRelay}=require('../src/native-shared-mcp-relay.cjs');
const {createSharedThreadAuthorityWire}=require('../src/shared-thread-authority-wire.cjs');
const {createSharedThreadAuthorityClient}=require('../src/shared-thread-authority-channel.cjs');
const {createNativeSharedThreadCreationClient}=require('../src/shared-thread-creation-ipc.cjs');
const sdkInitialize=JSON.parse(readFileSync(new URL('./fixtures/pinned-desktop-sdk-initialize.json',import.meta.url)));
const fixture=fileURLToPath(new URL('./owned-provider-ws-daemon.mjs',import.meta.url));
const sha=createHash('sha256').update(readFileSync(process.execPath)).digest('hex');
async function until(predicate){const end=Date.now()+2000;while(!predicate()){if(Date.now()>end)throw Error('owned source deadline');await new Promise(resolve=>setTimeout(resolve,5));}}

for(const mode of ['plain','mcp','initialize-denied','preserve-drift','preserve-follow-completion','preserve-mcp-status','preserve-attachment-read','preserve-queue-read','preserve-read-state-update','preserve-read-state-foreign'])test(mode==='preserve-read-state-foreign'?'owned read-state updates reject a foreign thread before native writes':mode==='preserve-read-state-update'?'owned read-state updates preserve native CAS and current history scope across preference drift':mode==='preserve-queue-read'?'owned queued inputs retain exact native pages and errors under the existing eight-field history binding':mode==='preserve-attachment-read'?'owned attachment pages retain exact native payloads and errors under the existing eight-field history binding':mode==='preserve-mcp-status'?'owned MCP startup metadata preserves failed status, nullable host scope and the exact followed thread':mode==='preserve-follow-completion'?'a followed running thread keeps final reply and approval notifications after config drift':mode==='preserve-drift'?'configuration drift keeps the desktop read stream and refreshes only on its next explicit gesture':mode==='initialize-denied'?'the first initialize refusal is reported before abort retires the owned source':mode==='mcp'?'controlled MCP owner assembly preserves actual HTTP denial over both IPC hops and the same guarded shared writer':'owned assembly waits for real account comparison and uses its actual desktop WS for an explicitly authorized source-bound resume',async t=>{
 const nativeAppTools=mode==='mcp',preserveMode=mode.startsWith('preserve-');
 const root=await mkdtemp(join(tmpdir(),'owned-shared-source-')),codexHome=join(root,'home'),cwd=join(root,'project');
 await mkdir(codexHome,{mode:0o700});await mkdir(cwd,{mode:0o775});
 if(preserveMode)await writeFile(join(codexHome,'config.toml'),'model = "source-a"\n',{mode:0o600});
 const socketPath=join(root,'daemon.sock'),seen=[],child=spawn(process.execPath,[fixture,'app-server',socketPath,codexHome,cwd,...(preserveMode?['preserve']:[])],{stdio:['ignore','ignore','pipe','ipc']});
 const stderr=[];child.stderr.on('data',bytes=>stderr.push(bytes.toString()));child.on('message',frame=>seen.push(frame));await until(()=>seen.some(frame=>frame.ready));
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}await rm(root,{recursive:true,force:true});});
 const stat=readFileSync(`/proc/${child.pid}/stat`,'utf8'),daemon={pid:child.pid,startTicks:stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)[19],socketPath,daemonGeneration:randomUUID(),exeSha256:sha};
 const profileId=randomUUID(),generation=randomUUID(),viewId=randomUUID(),view={viewId},failures=[],messages=[],events=[];
 let source,native,wire,client,createClient,mcpRelay,mcpConfig,originalHttp,closed=false,completed=false,phase='construct-source',currentView=view;
 const sentNative=[];
 let originalHttpRequests=0;const originalToken=randomBytes(32).toString('base64url');
 if(nativeAppTools){
  originalHttp=createHttpServer((req,res)=>{originalHttpRequests++;req.resume();res.writeHead(req.headers.authorization==='Bearer '+originalToken?403:401,{'content-type':'application/json'});res.end('{"error":"explicit-owned-http-fixture-denied"}');});
  await new Promise(resolve=>originalHttp.listen(0,'127.0.0.1',resolve));
  t.after(()=>{originalHttp.closeAllConnections();return new Promise(resolve=>originalHttp.close(resolve));});
 }
 t.after(()=>{if(!completed)process.stderr.write(JSON.stringify({phase,seen,failures,stderr,eventMethods:events.map(event=>event.frame.method)})+'\n');});
 const later=fn=>queueMicrotask(()=>{if(!closed)fn();});
 native=createNativeSharedDesktopTransport({profileId,generation,verifyRuntimeSync:()=>!closed,timeoutMs:1000,sendFrame:frame=>{sentNative.push(frame);later(()=>source.receiveNative(frame));},
  ...(nativeAppTools?{beforeConnect:()=>mcpRelay.prepare(async()=>({mcpServerConfig:{enabled:true,enabled_tools:[],omit_tools_from:['deferred'],default_tools_approval_mode:'prompt',startup_timeout_sec:10,tool_timeout_sec:3600,url:`http://127.0.0.1:${originalHttp.address().port}/mcp`,http_headers:{Authorization:'Bearer '+originalToken}},dispose(){}}),{hostId:'kanban-shared-cli',handlers:{callTool(){throw Error('not an original-tool acceptance')},listTools(){throw Error('not an original-tool acceptance')}}}),getDesktopMcpServerConfig:()=>mcpRelay.config}:{})});
 if(nativeAppTools)mcpRelay=createNativeSharedMcpRelay({profileId,generation,streamId:native.streamId,verifyRuntimeSync:()=>!closed,verifyRequestSync:()=>!closed&&source.accountRevision()!==null,sendFrame:frame=>later(()=>source.receiveNative(frame))});
 wire=createSharedThreadAuthorityWire({side:'native',sendFrame:frame=>later(()=>source.receiveNative(frame))});
 client=createSharedThreadAuthorityClient({socket:wire.stream,profileId,generation,onEvent:(binding,attemptId,frame)=>{events.push({binding,attemptId,frame});}});
 if(mode==='preserve-drift')createClient=createNativeSharedThreadCreationClient({profileId,generation,verifyCurrentSync:()=>!closed,sendFrame:frame=>later(()=>source.receiveNative(frame))});
 source=await startOwnedSharedDesktopSource({profileId,generation,daemon,codexHome,nativeAppTools,daemonVersion:'0.166.0',projects:[{projectId:'owned-project',cwd}],timeoutMs:1000,
  getOwnedView:id=>id===viewId?currentView:null,verifyOwnedViewSync:id=>!closed&&id===viewId,verifyContainerSync:()=>!closed,
  ...(preserveMode?{executionDomainPolicy:'preserve-native-cli'}:{verifyExecutionDomainSync:(scope,config)=>{if(scope.runtimeGeneration!==generation||scope.daemonGeneration!==daemon.daemonGeneration||scope.accountRevision!==1)return false;if(nativeAppTools){if(!config)return false;mcpConfig=config;}return true;}}),
  privateSource:{generation,verifySync:()=>!closed,list:async()=>({data:[],nextCursor:null}),read:async()=>null},
  writeNative:(encoded,finalVerifySync)=>new Promise((resolve,reject)=>queueMicrotask(()=>{try{if(closed||(finalVerifySync&&finalVerifySync()!==true))throw Error('final owned writer guard');const frame=decodeWireValue(encoded);if(frame.type.startsWith('shared-mcp-'))mcpRelay.receive(frame);else if(frame.type.startsWith('shared-desktop-'))native.receive(frame);else if(frame.type.startsWith('shared-create-'))createClient.receive(frame);else{wire.receive(frame);if(frame.type==='shared-reply')source.receiveNative({v:1,type:'shared-reply-ack',profileId,generation,requestId:frame.requestId});}resolve();}catch(error){reject(error);}})),
  onFailure:cause=>failures.push(mode==='initialize-denied'?{code:cause.code,causeCode:cause.causeCode}:cause.code),
 });
 t.after(()=>{closed=true;client.close();createClient?.close();wire.close();native.close();mcpRelay?.close();source.close();});
 phase='wait-native-account';assert.equal(source.accountRevision(),null);const opening=native.connect();
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(seen.filter(frame=>frame.method==='initialize').length,1);
 assert.equal(seen.some(frame=>frame.method==='thread/resume'),false);
 source.receiveNative({v:1,type:'shared-account-observation',profileId,generation,revision:1,observationId:randomUUID(),
  fingerprint:createHash('sha256').update(JSON.stringify(['shared-account-principal-v1','fixture-account','fixture-user'])).digest('hex'),expiresAtMs:Date.now()+60000});
 phase='open-original-transport';const connection=await opening;connection.onmessage=event=>messages.push(JSON.parse(event.data));
 const initialize=structuredClone(sdkInitialize);initialize.params.capabilities.explicitGatewayOauth=false;
 if(mode==='initialize-denied'){
  initialize.params.capabilities.unrecognizedFixtureFlag=true;
  assert.throws(()=>source.receiveNative({v:1,type:'shared-desktop-write',profileId,generation,streamId:native.streamId,sequence:1,text:JSON.stringify(initialize)}));
  await until(()=>source.signal.aborted);
  assert.deepEqual(failures,[{code:'SHARED_DESKTOP_DAEMON_REQUEST_DENIED',causeCode:'SHARED_DAEMON_DENIED'}]);
  assert.equal(seen.filter(frame=>frame.method==='initialize').length,1);completed=true;return;
 }
 connection.send(JSON.stringify(initialize));await until(()=>messages.some(frame=>frame.id===initialize.id));
 await until(()=>messages.some(frame=>frame.method==='account/updated'));
 if(mode==='preserve-drift'){
  const target={hostId:'kanban-shared-cli',projectId:'native-project',cwd,viewId};
  const control=()=>({attemptId:randomUUID(),signal:new AbortController().signal,deadline:performance.now()+1000});
  const oldScope=await createClient.resolveCreateScope(target,control());
  const before=seen.filter(frame=>frame.method==='config/read').length;
  await writeFile(join(codexHome,'config.toml'),'model = "source-b"\n');
  connection.send(JSON.stringify({id:'metadata-after-config-change',method:'config/read',params:{includeLayers:true,cwd}}));
  await until(()=>messages.some(frame=>frame.id==='metadata-after-config-change'));
  assert.equal(source.signal.aborted,false);assert.deepEqual(failures,[]);
  assert.equal(seen.filter(frame=>frame.method==='config/read').length,before+1);
  const freshScope=await createClient.resolveCreateScope(target,control());
  assert.notEqual(freshScope.creationNonce,oldScope.creationNonce);
  await assert.rejects(createClient.authorizeCreate(oldScope,{id:'old-proof-create',method:'thread/start',params:{cwd}},control()),{code:'SHARED_CREATE_HOST_AUTHORIZE_DENIED'});
  assert.equal(await createClient.authorizeCreate(freshScope,{id:'fresh-proof-create',method:'thread/start',params:{cwd}},control()),true);
  assert.equal(source.signal.aborted,false);assert.deepEqual(failures,[]);
  assert.equal(seen.some(frame=>frame.method==='thread/start'),false);
 }
 phase='source-list';const directory=await source.listDaemon(viewId,{limit:50,useStateDbOnly:true}),threadId=directory.page.data[0].id;
 phase='source-binding';
 const binding=await client.resolveBinding({viewId,hostId:'kanban-shared-cli',threadId,sourceToken:directory.tokens[0].token});
 const frame={id:'explicit-source-click',method:'thread/resume',params:{threadId,excludeTurns:true}},control={attemptId:randomUUID(),signal:new AbortController().signal,deadline:performance.now()+1000};
 phase='explicit-authorize';assert.equal(await client.authorizeRequest(binding,frame,control),true);
 phase='actual-resume';
 const response=JSON.parse(await client.exchangeRequest(frame));assert.equal(response.result.thread.id,threadId);
 assert.equal(response.result.thread.historyMode,'paginated');assert.deepEqual(response.result.thread.turns,[]);
 assert.equal(response.result.turnsBackwardsCursor,null);assert.equal(response.result.itemsBackwardsCursor,null);
 assert.deepEqual(seen.filter(value=>value.method==='thread/resume').map(value=>value.params),[{threadId,excludeTurns:true}]);
 if(mode==='preserve-attachment-read'){
  const params={threadId,cursor:null,limit:100};
  connection.send(JSON.stringify({id:'owned-attachments-first',method:'thread/attachment/list',params}));
  await until(()=>messages.some(frame=>frame.id==='owned-attachments-first'));
  const page=messages.find(frame=>frame.id==='owned-attachments-first');
  assert.deepEqual(page.result,{data:[{id:'owned-attachment',attachmentType:'owned-native-type',identityKey:'owned-identity',createdAt:0,payload:{text:'owned fixture attachment',nested:[null,true]}}],nextCursor:'native-opaque-next-page'});
  assert.deepEqual(seen.filter(frame=>frame.method==='thread/attachment/list').map(frame=>frame.params),[params]);
  // A configuration preference edit revokes writers, not this existing exact
  // thread/account/daemon/root/view history capability.
  await writeFile(join(codexHome,'config.toml'),'model = "changed-after-binding"\n');
  connection.send(JSON.stringify({id:'owned-attachments-error',method:'thread/attachment/list',params:{...params,cursor:'native-error-page'}}));
  await until(()=>messages.some(frame=>frame.id==='owned-attachments-error'));
  assert.deepEqual(messages.find(frame=>frame.id==='owned-attachments-error').error,{code:-32000,message:'original owned attachment error'});
  assert.equal(source.signal.aborted,false);assert.deepEqual(failures,[]);
  // The replacement has the same UUID but is not the captured owned record.
  // Exercise the actual host final dispatch, not a UI-supplied read capability.
  const last=sentNative.findLast(frame=>frame.type==='shared-desktop-write');
  currentView={viewId};
  assert.throws(()=>source.receiveNative({...last,sequence:last.sequence+1,text:JSON.stringify({id:'owned-attachment-after-view-replacement',method:'thread/attachment/list',params})}),{code:'SHARED_DAEMON_DENIED'});
  assert.equal(source.signal.aborted,true);
  assert.deepEqual(failures,['SHARED_DESKTOP_DAEMON_REQUEST_DENIED']);
  assert.equal(seen.filter(frame=>frame.method==='thread/attachment/list').length,2);
  assert.equal(seen.some(frame=>['thread/start','turn/start'].includes(frame.method)),false);
  completed=true;return;
 }
 if(mode==='preserve-read-state-foreign'){
  const last=sentNative.findLast(frame=>frame.type==='shared-desktop-write');
  assert.throws(()=>source.receiveNative({...last,sequence:last.sequence+1,text:JSON.stringify({id:'foreign-read-state',method:'thread/readState/update',params:{threadId:randomUUID(),expectedRevision:'not-owned',operation:{type:'read'}}})}),{code:'SHARED_DAEMON_DENIED'});
  assert.equal(source.signal.aborted,true);assert.equal(seen.filter(frame=>frame.method==='thread/readState/update').length,0);completed=true;return;
 }
 if(mode==='preserve-read-state-update'){
  const params={threadId,expectedRevision:'native-original-revision',operation:{type:'read'}};
  connection.send(JSON.stringify({id:'owned-read-state-success',method:'thread/readState/update',params}));
  await until(()=>messages.some(frame=>frame.id==='owned-read-state-success'));
  assert.deepEqual(messages.find(frame=>frame.id==='owned-read-state-success').result,{readState:{revision:'native-next-revision',firstUnread:null}});
  assert.deepEqual(seen.filter(frame=>frame.method==='thread/readState/update').map(frame=>frame.params),[params]);
  await writeFile(join(codexHome,'config.toml'),'model = "changed-after-binding"\n');
  connection.send(JSON.stringify({id:'owned-read-state-conflict',method:'thread/readState/update',params:{...params,expectedRevision:'native-conflict'}}));
  await until(()=>messages.some(frame=>frame.id==='owned-read-state-conflict'));
  assert.deepEqual(messages.find(frame=>frame.id==='owned-read-state-conflict').error,{code:-32009,message:'original owned read-state conflict',data:{readState:{revision:'native-current-revision',firstUnread:null}}});
  assert.equal(source.signal.aborted,false);assert.deepEqual(failures,[]);
  const last=sentNative.findLast(frame=>frame.type==='shared-desktop-write');currentView={viewId};
  assert.throws(()=>source.receiveNative({...last,sequence:last.sequence+1,text:JSON.stringify({id:'read-state-replaced-view',method:'thread/readState/update',params})}),{code:'SHARED_DAEMON_DENIED'});
  assert.equal(source.signal.aborted,true);assert.equal(seen.filter(frame=>frame.method==='thread/readState/update').length,2);assert.equal(seen.some(frame=>['thread/start','turn/start'].includes(frame.method)),false);completed=true;return;
 }
 if(mode==='preserve-queue-read'){
  const params={threadId,cursor:null,limit:100};
  connection.send(JSON.stringify({id:'owned-queue-first',method:'thread/queue/list',params}));
  await until(()=>messages.some(frame=>frame.id==='owned-queue-first'));
  const page=messages.find(frame=>frame.id==='owned-queue-first');
  assert.deepEqual(page.result,{data:[{id:'owned-queue',clientUserMessageId:'owned-message',input:[{type:'text',text:'owned fixture queue',text_elements:[]}]}],nextCursor:'native-opaque-next-page'});
  assert.deepEqual(seen.filter(frame=>frame.method==='thread/queue/list').map(frame=>frame.params),[params]);
  // A configuration preference edit revokes writers, not this existing exact
  // thread/account/daemon/root/view history capability.
  await writeFile(join(codexHome,'config.toml'),'model = "changed-after-binding"\n');
  connection.send(JSON.stringify({id:'owned-queue-error',method:'thread/queue/list',params:{...params,cursor:'native-error-page'}}));
  await until(()=>messages.some(frame=>frame.id==='owned-queue-error'));
  assert.deepEqual(messages.find(frame=>frame.id==='owned-queue-error').error,{code:-32000,message:'original owned queue error'});
  assert.equal(source.signal.aborted,false);assert.deepEqual(failures,[]);
  // The replacement has the same UUID but is not the captured owned record.
  // Exercise the actual host final dispatch, not a UI-supplied read capability.
  const last=sentNative.findLast(frame=>frame.type==='shared-desktop-write');
  currentView={viewId};
  assert.throws(()=>source.receiveNative({...last,sequence:last.sequence+1,text:JSON.stringify({id:'owned-queue-after-view-replacement',method:'thread/queue/list',params})}),{code:'SHARED_DAEMON_DENIED'});
  assert.equal(source.signal.aborted,true);
  assert.deepEqual(failures,['SHARED_DESKTOP_DAEMON_REQUEST_DENIED']);
  assert.equal(seen.filter(frame=>frame.method==='thread/queue/list').length,2);
  assert.equal(seen.some(frame=>['thread/start','turn/start'].includes(frame.method)),false);
  completed=true;return;
 }
 if(mode==='preserve-mcp-status'){
  phase='follow-mcp-status';assert.equal(await client.follow(binding,control),true);
  const global={method:'mcpServer/startupStatus/updated',params:{threadId:null,name:'global-owned-server',status:'starting',error:null,failureReason:null},emittedAtMs:Date.now()};
  const failed={method:'mcpServer/startupStatus/updated',params:{threadId,name:'owned-server',status:'failed',error:'original startup failure\nreauthentication required',failureReason:'reauthenticationRequired'},emittedAtMs:Date.now()};
  const unrelated={...failed,params:{...failed.params,threadId:randomUUID(),error:'unrelated error'}};
  child.send({type:'emit-events',frames:[unrelated,global,failed]});
  await until(()=>events.some(event=>event.frame.method===failed.method)&&messages.some(frame=>frame.method===global.method));
  assert.deepEqual(events.filter(event=>event.frame.method===failed.method).map(event=>event.frame),[failed]);
  assert.deepEqual(messages.filter(frame=>frame.method===global.method),[global]);
  assert.equal(source.signal.aborted,false);assert.deepEqual(failures,[]);
  assert.equal(seen.some(frame=>['thread/start','turn/start'].includes(frame.method)),false);
 }
 if(mode==='preserve-follow-completion'){
  phase='establish-real-follow';assert.equal(await client.follow(binding,control),true);
  const turnId='owned-running-turn',itemId='owned-reply',emit=frames=>child.send({type:'emit-events',frames});
  emit([{method:'turn/started',params:{threadId,turn:{id:turnId,status:'inProgress',items:[]}},emittedAtMs:Date.now()}]);
  await until(()=>events.some(event=>event.frame.method==='turn/started'));
  const readsBefore=seen.filter(frame=>frame.method==='config/read').length;
  await writeFile(join(codexHome,'config.toml'),'model = "source-during-task"\n');
  phase='completion-after-config-change';
  emit([
   {method:'item/agentMessage/delta',params:{threadId,turnId,itemId,delta:'owned final reply'},emittedAtMs:Date.now()},
   {method:'item/completed',params:{threadId,turnId,item:{type:'agentMessage',id:itemId,text:'owned final reply'},completedAtMs:Date.now()},emittedAtMs:Date.now()},
   {method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed',items:[]}},emittedAtMs:Date.now()},
  ]);
  await until(()=>events.some(event=>event.frame.method==='turn/completed'));
  emit([{id:'owned-approval-after-drift',method:'item/commandExecution/requestApproval',params:{threadId,turnId,itemId:'owned-command',command:'echo fixture-only'},emittedAtMs:Date.now()}]);
  await until(()=>events.some(event=>event.frame.id==='owned-approval-after-drift'));
  for(const event of events){assert.deepEqual(event.binding,binding);assert.equal(event.attemptId,control.attemptId);}
  assert.equal(events.filter(event=>event.frame.method==='item/agentMessage/delta').length,1);assert.equal(events.find(event=>event.frame.method==='item/completed').frame.params.item.text,'owned final reply');
  assert.equal(messages.some(frame=>frame.method==='turn/completed'),false);assert.equal(source.signal.aborted,false);assert.deepEqual(failures,[]);
  assert.equal(seen.filter(frame=>frame.method==='config/read').length,readsBefore);
  await assert.rejects(client.replyApproval({binding,attemptId:control.attemptId,actionId:randomUUID(),requestId:'owned-approval-after-drift',turnId,itemId:'owned-command',method:'item/commandExecution/requestApproval',decision:'accept',signal:new AbortController().signal,deadline:performance.now()+1000}));
  assert.equal(seen.some(frame=>frame.approvalReplyId==='owned-approval-after-drift'),false);
  assert.equal(source.signal.aborted,false);assert.deepEqual(failures,[]);
  assert.equal(seen.filter(frame=>frame.method==='thread/resume').length,1);assert.equal(seen.some(frame=>['turn/start','thread/start'].includes(frame.method)),false);
 }
 if(nativeAppTools){
  assert.ok(mcpConfig);assert.deepEqual(native.desktopMcpServerConfig,mcpConfig);const url=new URL(mcpConfig.url);
  const actual=await new Promise((resolve,reject)=>{const body=Buffer.from('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');const req=httpRequest({hostname:'127.0.0.1',port:Number(url.port),path:'/mcp',method:'POST',agent:false,headers:{Authorization:mcpConfig.http_headers.Authorization,'content-type':'application/json','content-length':String(body.length)}},res=>{const chunks=[];res.on('data',part=>chunks.push(part));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()}));res.on('error',reject);});req.on('error',reject);req.end(body);});
  assert.deepEqual(actual,{status:403,body:'{"error":"explicit-owned-http-fixture-denied"}'});assert.equal(originalHttpRequests,1);
 }
 assert.equal(seen.filter(value=>value.method==='initialize').length,2);
 assert.deepEqual(failures,[]);assert.deepEqual(stderr,[]);completed=true;
});
