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
import {classifySharedServerNotification} from '../src/shared-server-notification-policy.mjs';
const require=createRequire(import.meta.url);
const {createNativeSharedDesktopTransport}=require('../src/native-shared-desktop-transport.cjs');
const {createSharedThreadAuthorityWire}=require('../src/shared-thread-authority-wire.cjs');
const {createSharedThreadAuthorityServer,createSharedThreadAuthorityClient}=require('../src/shared-thread-authority-channel.cjs');
const peer=process.argv[2]==='app-server',delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){const end=Date.now()+3000;while(!predicate()){if(Date.now()>end)throw Error('owned hook peer deadline');await delay(5);}}
const makeRun=()=>({id:'owned-hook',eventName:'sessionStart',handlerType:'command',executionMode:'sync',scope:'thread',sourcePath:'relative/hooks.json',displayOrder:-1,startedAt:-1,status:'running',entries:[]});
const hook=(method,threadId,run=makeRun(),turnId=null)=>({method,params:{threadId,turnId,run},emittedAtMs:123});
const hash=text=>createHash('sha256').update(text).digest('hex');
const schemaDir=process.env.CHATGPT_DESKTOP_HOOK_SCHEMA_DIR;

if(peer){
 const socketPath=process.argv[3],cwd=process.argv[4],server=createServer(),wss=new WebSocketServer({noServer:true});
 server.on('upgrade',(request,socket,head)=>wss.handleUpgrade(request,socket,head,ws=>wss.emit('connection',ws)));
 wss.on('connection',ws=>{
  ws.on('error',()=>{});
  ws.on('message',data=>{
   const frame=JSON.parse(data.toString());process.send?.({received:frame});
   if(frame.method==='initialize'){
    ws.send(JSON.stringify({id:frame.id,result:{userAgent:'codex-cli/0.166.0',codexHome:cwd}}));
    ws.send(JSON.stringify({method:'account/updated',params:{},emittedAtMs:123}));
   }else if(frame.method==='thread/resume')ws.send(JSON.stringify({id:frame.id,result:{thread:{id:frame.params.threadId,historyMode:'paginated',turns:[]},turnsBackwardsCursor:null,itemsBackwardsCursor:null}}));
   else if(frame.method==='account/read')ws.send(JSON.stringify({id:frame.id,result:{account:null,requiresOpenaiAuth:false}}));
  });
 });
 process.on('message',message=>{if(message?.op==='frames')for(const ws of wss.clients){ws._socket.cork();for(const frame of message.frames)ws.send(JSON.stringify(frame));ws._socket.uncork();}});
 server.listen(socketPath,()=>{chmodSync(socketPath,0o600);process.send?.({ready:true});});
 process.on('SIGTERM',()=>{for(const ws of wss.clients)ws.terminate();server.close(()=>process.exit(0));});
}else{
 test('fixed official 0.166 hook schemas define the complete finite run contract without invented status coupling',{skip:!schemaDir},()=>{
  const hashes=['79f69e20fcad493d17118a2c1d700ce606ae97341fed46a3155d048d24eb4146','7051ae75b558032ca6c13a4aae91ee0734ef8384890575af9821f87206989179'];
  for(const [index,name]of ['HookStartedNotification','HookCompletedNotification'].entries()){
   const text=readFileSync(join(schemaDir,name+'.json'),'utf8');assert.equal(hash(text),hashes[index]);const schema=JSON.parse(text);
   assert.deepEqual(schema.required,['run','threadId']);assert.deepEqual(schema.properties.turnId.type,['string','null']);
   const runSchema=schema.definitions.HookRunSummary;
   assert.deepEqual(runSchema.required,['displayOrder','entries','eventName','executionMode','handlerType','id','scope','sourcePath','startedAt','status']);
   const method=index===0?'hook/started':'hook/completed',threadId=randomUUID();
   for(const key of ['eventName','executionMode','handlerType','status','scope','source']){
    const property=runSchema.properties[key],ref=property.$ref??property.allOf[0].$ref;
    for(const value of schema.definitions[ref.split('/').at(-1)].enum){
     const frame=hook(method,threadId,{...makeRun(),[key]:value});assert.ok(classifySharedServerNotification(frame),`${method}:${key}:${value}`);
    }
   }
   for(const field of ['completedAt','durationMs','statusMessage'])for(const value of [undefined,null,field==='statusMessage'?'原始 hook 状态\n正文':-1]){
    const run=makeRun();if(value!==undefined)run[field]=value;assert.ok(classifySharedServerNotification(hook(method,threadId,run)));
   }
   for(const turnId of [undefined,null,'native-turn']){
    const frame=hook(method,threadId);if(turnId===undefined)delete frame.params.turnId;else frame.params.turnId=turnId;assert.ok(classifySharedServerNotification(frame));
   }
   for(const kind of schema.definitions.HookOutputEntryKind.enum){
    const frame=hook(method,threadId,{...makeRun(),entries:[{kind,text:'原文\n'+kind}]});assert.ok(classifySharedServerNotification(frame));
   }
   for(const required of runSchema.required){const run=makeRun();delete run[required];assert.equal(classifySharedServerNotification(hook(method,threadId,run)),null,required);}
   for(const run of [{...makeRun(),extra:true},{...makeRun(),status:'invented'},{...makeRun(),entries:{}},{...makeRun(),entries:[{kind:'context',text:0}]},{...makeRun(),source:null},{...makeRun(),displayOrder:1.5},{...makeRun(),startedAt:Number.MAX_SAFE_INTEGER+1}])assert.equal(classifySharedServerNotification(hook(method,threadId,run)),null);
  }
 });

 async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'shared-hook-peer-'));await chmod(dir,0o700);const socketPath=join(dir,'daemon.sock'),seen=[];
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'app-server',socketPath,dir],{stdio:['ignore','ignore','pipe','ipc']});child.stderr.on('data',()=>{});child.on('message',message=>seen.push(message));
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}await rm(dir,{recursive:true,force:true});});await until(()=>seen.some(message=>message.ready));
  const stat=readFileSync(`/proc/${child.pid}/stat`,'utf8'),daemon={pid:child.pid,startTicks:stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)[19],socketPath,daemonGeneration:randomUUID(),exeSha256:hash(readFileSync(process.execPath))};
  const profileId=randomUUID(),generation=randomUUID(),binding={hostId:'kanban-shared-cli',runtimeGeneration:generation,daemonGeneration:daemon.daemonGeneration,accountRevision:1,projectId:'owned-hook-project',threadId:randomUUID(),viewId:randomUUID(),clientId:randomUUID()};
  const messages=[],events=[],failures=[],flags={live:true,bound:false};let session,native,authority,hostWire,clientWire;
  const valid=value=>flags.live&&value&&Object.keys(binding).every(key=>value[key]===binding[key]);
  hostWire=createSharedThreadAuthorityWire({side:'host',sendFrame:value=>clientWire.receive(value)});
  clientWire=createSharedThreadAuthorityWire({side:'native',sendFrame:value=>hostWire.receive(value)});
  const client=createSharedThreadAuthorityClient({socket:clientWire.stream,profileId,generation,onEvent:(scope,attemptId,frame)=>events.push({scope,attemptId,frame})});
  native=createNativeSharedDesktopTransport({profileId,generation,verifyRuntimeSync:()=>flags.live,timeoutMs:2000,sendFrame:frame=>session.receiveNative(frame)});
  session=createSharedDesktopDaemonSession({profileId,generation,daemon,daemonVersion:'0.166.0',timeoutMs:2000,
   verifyContainerSync:()=>true,verifySessionSync:()=>flags.live,verifyReadSync:()=>flags.live,verifyBindingSync:valid,verifyHistorySync:valid,
   verifyInitializeSync:result=>result.codexHome===dir,verifyInitialAccountNotificationSync:()=>true,verifyServerEventSync:()=>flags.live,authorizeServerReplySync:()=>false,
   verifyThreadMetadataSync:id=>flags.live&&flags.bound&&id===binding.threadId,
   sendFrame:frame=>native.receive(frame),receiveAuthority:encoded=>authority.receiveDaemon(encoded),onFailure:error=>failures.push(error.code)});
  authority=createSharedThreadAuthorityServer({socket:hostWire.stream,profileId,generation,gate:session.authorityGate,
   resolveBinding:async request=>{assert.equal(request.threadId,binding.threadId);return binding;},verifyViewSync:request=>flags.live&&request.viewId===binding.viewId&&request.hostId===binding.hostId&&request.threadId===binding.threadId,
   verifyBindingSync:valid,verifyHistorySync:valid,verifyReadSync:()=>flags.live});
  t.after(()=>{client.close();authority.close();session.close();native.close();hostWire.close();clientWire.close();});
  const connection=await native.connect();connection.onmessage=event=>messages.push(JSON.parse(event.data));
  connection.send(JSON.stringify({id:'owned-hook-initialize',method:'initialize',params:{clientInfo:{name:'codex_desktop',version:'26.1027.51404'},capabilities:{experimentalApi:true,requestAttestation:false}}}));await until(()=>messages.some(frame=>frame.method==='account/updated'));
  const resolved=await client.resolveBinding({hostId:binding.hostId,threadId:binding.threadId,viewId:binding.viewId});const control={attemptId:randomUUID(),signal:new AbortController().signal,deadline:performance.now()+3000};
  const request={id:'owned-hook-bind',method:'thread/resume',params:{threadId:binding.threadId,excludeTurns:true}};assert.equal(await client.authorizeRequest(resolved,request,control),true);await client.exchangeRequest(request);assert.equal(await client.follow(resolved,control),true);flags.bound=true;
  return{child,seen,session,connection,binding,messages,events,failures,flags};
 }
 test('real owned Unix WS hook lifecycle preserves bound follower payload and ignores unrelated thread hooks',async t=>{
  const f=await fixture(t),foreign=randomUUID();
  const run={...makeRun(),entries:[{kind:'warning',text:'原始 hook 输出\nsecond line'},{kind:'context',text:'owned context'}]};
  const started=hook('hook/started',f.binding.threadId,run),completed=hook('hook/completed',f.binding.threadId,{...run,status:'blocked',completedAt:2,durationMs:3,statusMessage:null,source:'unknown'},'native-turn');
  f.child.send({op:'frames',frames:[hook('hook/started',foreign,run),started,hook('hook/completed',foreign,run),completed]});await until(()=>f.events.length===2);
  assert.deepEqual(f.events.map(value=>value.frame),[started,completed]);assert.ok(f.events.every(value=>value.scope.threadId===f.binding.threadId));
  assert.deepEqual(f.failures,[]);assert.equal(f.session.signal.aborted,false);assert.equal(f.seen.filter(message=>message.received?.method==='thread/resume').length,1);
  f.connection.send(JSON.stringify({id:'after-original-hook-lifecycle',method:'account/read',params:{refreshToken:false}}));await until(()=>f.messages.some(frame=>frame.id==='after-original-hook-lifecycle'));
  assert.equal(f.seen.filter(message=>message.received?.id==='after-original-hook-lifecycle').length,1);
 });
 test('hook notification never revives a revoked exact thread binding',async t=>{
  const f=await fixture(t);f.flags.live=false;f.session.authorizationChanged();
  f.child.send({op:'frames',frames:[hook('hook/started',f.binding.threadId),hook('hook/completed',f.binding.threadId)]});await until(()=>f.session.signal.aborted);await delay(20);
  assert.equal(f.events.length,0);assert.throws(()=>f.session.authorityGate.write(JSON.stringify({id:'after-revoked-hook',method:'account/read',params:{refreshToken:false}})));
  assert.equal(f.seen.some(message=>message.received?.id==='after-revoked-hook'),false);
 });

 const moderation=(threadId,metadata,turnId='owned-turn')=>({method:'turn/moderationMetadata',params:{threadId,turnId,metadata},emittedAtMs:123});
 const moderationValues=()=>[null,false,0,'',[1,null,'原文\n"quoted"'],{nested:{'原键':[true,-3.25,null]},arbitraryUnknownKey:'原始 metadata\nsecond line'}];
 test('fixed official 0.166 moderation schema preserves every JSON value and rejects unknown envelope fields',{skip:!process.env.CHATGPT_DESKTOP_MODERATION_SCHEMA_DIR},()=>{
  const text=readFileSync(join(process.env.CHATGPT_DESKTOP_MODERATION_SCHEMA_DIR,'TurnModerationMetadataNotification.json'),'utf8');
  assert.equal(hash(text),'90fe9ade83c46fd42af9d023737a9990595dac71e059158744950f538e802876');
  const schema=JSON.parse(text);assert.equal(schema.properties.metadata,true);
  assert.deepEqual(schema.required,['metadata','threadId','turnId']);assert.equal(schema.properties.turnId.type,'string');
  const threadId=randomUUID();
  for(const metadata of moderationValues())for(const turnId of ['', 'owned-turn']){
   const frame=moderation(threadId,metadata,turnId),before=JSON.stringify(frame);
   assert.deepEqual(classifySharedServerNotification(frame),{kind:'thread-stream',threadId});assert.equal(JSON.stringify(frame),before);
  }
  for(const key of schema.required){const frame=moderation(threadId,null);delete frame.params[key];assert.equal(classifySharedServerNotification(frame),null,key);}
  const malformed=[moderation(threadId,null,null),moderation(threadId,null,0),moderation('not-a-thread',null),{...moderation(threadId,null),method:'turn/moderationMetadata/unknown'}];
  const extra=moderation(threadId,null);extra.params.unknown=true;malformed.push(extra);
  for(const frame of malformed)assert.equal(classifySharedServerNotification(frame),null);
 });
 test('real owned Unix WS moderation metadata preserves complete JSON payload only for its bound follower',async t=>{
  const f=await fixture(t),foreign=randomUUID(),metadata=moderationValues();
  const own=metadata.map((value,index)=>moderation(f.binding.threadId,value,index===0?'':'owned-turn'));
  const frames=own.flatMap((frame,index)=>[moderation(foreign,metadata[index]),frame]);
  f.child.send({op:'frames',frames});await until(()=>f.events.length===own.length);
  assert.deepEqual(f.events.map(value=>value.frame),own);
  assert.deepEqual(f.events.map(value=>JSON.stringify(value.frame)),own.map(value=>JSON.stringify(value)));
  assert.ok(f.events.every(value=>value.scope.threadId===f.binding.threadId));assert.deepEqual(f.failures,[]);assert.equal(f.session.signal.aborted,false);
  f.connection.send(JSON.stringify({id:'after-moderation-metadata',method:'account/read',params:{refreshToken:false}}));await until(()=>f.messages.some(frame=>frame.id==='after-moderation-metadata'));
  assert.equal(f.seen.filter(message=>message.received?.id==='after-moderation-metadata').length,1);
 });
 test('unknown moderation method remains fail closed on the real owned Unix WS without a follower event',async t=>{
  const f=await fixture(t),frame=moderation(f.binding.threadId,{original:'owned'});frame.method='turn/moderationMetadata/unknown';
  f.child.send({op:'frames',frames:[frame]});await until(()=>f.session.signal.aborted);
  assert.equal(f.events.length,0);assert.equal(f.failures.length,1);
  assert.throws(()=>f.session.authorityGate.write(JSON.stringify({id:'after-unknown-moderation',method:'account/read',params:{refreshToken:false}})));
  assert.equal(f.seen.some(message=>message.received?.id==='after-unknown-moderation'),false);
 });
 test('moderation metadata never revives a revoked exact thread binding on the real owned Unix WS',async t=>{
  const f=await fixture(t);f.flags.live=false;f.session.authorizationChanged();
  f.child.send({op:'frames',frames:moderationValues().map(value=>moderation(f.binding.threadId,value))});await until(()=>f.session.signal.aborted);await delay(20);
  assert.equal(f.events.length,0);assert.throws(()=>f.session.authorityGate.write(JSON.stringify({id:'after-revoked-moderation',method:'account/read',params:{refreshToken:false}})));
  assert.equal(f.seen.some(message=>message.received?.id==='after-revoked-moderation'),false);
 });
}
