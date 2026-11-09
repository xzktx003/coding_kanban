import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,chmodSync} from 'node:fs';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from 'ws';
import {startOwnedSharedDesktopSource} from '../src/owned-shared-desktop-source.mjs';
import {decodeWireValue} from '../src/wire-value.mjs';
const require=createRequire(import.meta.url);
const {createNativeSharedDesktopTransport}=require('../src/native-shared-desktop-transport.cjs');
const {createSharedThreadAuthorityWire}=require('../src/shared-thread-authority-wire.cjs');
const {createSharedThreadAuthorityClient}=require('../src/shared-thread-authority-channel.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=value=>createHash('sha256').update(value).digest('hex');
const ownThread='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',nextCursor='owned/+opaque==';
const inputs=()=>[{type:'text',text:'owned original\n队列',text_elements:[{byteRange:{start:0,end:4},placeholder:null}]},{type:'image',fileId:'owned-file',detail:'original'},{type:'image',url:'https://fixture.invalid/image',detail:null},{type:'localImage',path:'owned/image',detail:'low'},{type:'audio',url:'https://fixture.invalid/audio'},{type:'localAudio',path:'owned/audio'},{type:'skill',name:'owned-skill',path:'owned/skill'},{type:'mention',name:'owned-mention',path:'owned/mention'}];
const queuePage=cursor=>({data:[{id:cursor===nextCursor?'owned-queue-second':'owned-queue-first',clientUserMessageId:'owned-message',input:inputs()}],nextCursor:cursor===nextCursor?null:nextCursor});
// This exact error comes from this isolated protocol peer, not a real model or
// official CLI run. The separately recorded anonymous native contract supplies
// the official -32603/-32600 evidence; the transport must preserve either error.
const peerError=()=>({code:-32603,message:'original owned peer queue error\nsecond line',data:{owned:'unaltered',nested:[null,true]}});
async function until(predicate){const end=Date.now()+3000;while(!predicate()){if(Date.now()>end)throw Error('owned queue scope deadline');await delay(5);}}
if(process.argv[2]==='app-server'){
 const [socketPath,codexHome,cwd]=process.argv.slice(3),server=createServer(),wss=new WebSocketServer({noServer:true});
 const claims={exp:Math.floor(Date.now()/1000)+3600,'https://api.openai.com/auth':{chatgpt_account_id:'fixture-account',user_id:'fixture-user'}};
 const token=[{alg:'none'},claims,'fixture'].map(value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url')).join('.');
 server.on('upgrade',(req,socket,head)=>wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws)));
 wss.on('connection',ws=>{ws.on('error',()=>{});ws.on('message',data=>{
  const frame=JSON.parse(data.toString());process.send?.({method:frame.method,params:frame.params,id:frame.id});
  const reply=result=>ws.send(JSON.stringify({id:frame.id,result}));
  if(frame.method==='initialize'){reply({userAgent:'codex-cli/0.166.0',codexHome});ws.send(JSON.stringify({method:'account/updated',params:{},emittedAtMs:Date.now()}));return;}
  if(frame.method==='initialized')return;
  if(frame.method==='account/read')return reply({requiresOpenaiAuth:true,account:{type:'chatgpt'},workspaceRouting:{chatgptAccountId:'fixture-account',backendOrigin:'https://fixture.invalid',accountRoutingOverride:'NO_CONSTRAINT'}});
  if(frame.method==='getAuthStatus')return reply({authMethod:'chatgpt',authToken:token});
  if(frame.method==='config/read'){
   const file=join(codexHome,'config.toml'),version=hash(readFileSync(file)),name={type:'user',file,profile:null};
   return reply({config:{mcp_servers:{},fixtureVersion:version},origins:{fixtureVersion:{name,version}},layers:[{name,version,config:{fixtureVersion:version}}]});
  }
  if(frame.method==='configRequirements/read')return reply({requirements:null});
  if(frame.method==='thread/list')return reply({data:[{id:ownThread,cwd,turns:[]}],nextCursor:null});
  if(frame.method==='thread/read')return reply({thread:{id:frame.params.threadId,cwd,turns:[]}});
  if(frame.method==='thread/resume')return reply({thread:{id:frame.params.threadId,historyMode:'paginated',turns:[],cwd},turnsBackwardsCursor:null,itemsBackwardsCursor:null,cwd,model:'fixture-model',modelProvider:'fixture-provider',approvalPolicy:'never',approvalsReviewer:'user',sandbox:{type:'readOnly'}});
  if(frame.method==='thread/queue/list')return frame.params.cursor==='owned-error'?ws.send(JSON.stringify({id:frame.id,error:peerError()})):reply(queuePage(frame.params.cursor));
  ws.send(JSON.stringify({id:frame.id,error:{code:-32601,message:'unsupported owned fixture method'}}));
 });});
 process.on('message',message=>{if(message?.type==='revoke')for(const ws of wss.clients)ws.send(JSON.stringify({method:'account/updated',params:{}}));});
 server.listen(socketPath,()=>{chmodSync(socketPath,0o600);process.send?.({ready:true});});
 process.on('SIGTERM',()=>{for(const ws of wss.clients)ws.terminate();server.close(()=>process.exit(0));});
}else{
 test('fixed official queue read schema describes optional native pagination and complete queued submissions',{skip:!process.env.CHATGPT_DESKTOP_QUEUE_SCHEMA_DIR},()=>{
  const params=readFileSync(join(process.env.CHATGPT_DESKTOP_QUEUE_SCHEMA_DIR,'ThreadQueueListParams.json'),'utf8');
  const response=readFileSync(join(process.env.CHATGPT_DESKTOP_QUEUE_SCHEMA_DIR,'ThreadQueueListResponse.json'),'utf8');
  assert.equal(hash(params),'b4c889089eee8a0f785ff85e0128a4d3f347353870fa848221096a472223773b');
  assert.equal(hash(response),'be4e0bfa6fc776101f96582543605d2eff6186309a08903203512b99c5005926');
  const p=JSON.parse(params),r=JSON.parse(response);assert.deepEqual(p.required,['threadId']);assert.deepEqual(p.properties.cursor.type,['string','null']);
  assert.equal(p.properties.limit.format,'uint32');assert.equal(p.properties.limit.minimum,0);assert.deepEqual(p.properties.limit.type,['integer','null']);
  assert.deepEqual(r.required,['data']);assert.deepEqual(r.definitions.QueuedSubmission.required,['clientUserMessageId','id','input']);assert.deepEqual(r.properties.nextCursor.type,['string','null']);
 });
 async function fixture(t,{bind=true}={}){
  const root=await mkdtemp(join(tmpdir(),'owned-queue-scope-')),codexHome=join(root,'home'),cwd=join(root,'project');await mkdir(codexHome,{mode:0o700});await mkdir(cwd,{mode:0o775});await writeFile(join(codexHome,'config.toml'),'model = "source-a"\n',{mode:0o600});
  const socketPath=join(root,'daemon.sock'),seen=[],stderr=[],child=spawn(process.execPath,[fileURLToPath(import.meta.url),'app-server',socketPath,codexHome,cwd],{stdio:['ignore','ignore','pipe','ipc']});child.on('message',frame=>seen.push(frame));child.stderr.on('data',bytes=>stderr.push(bytes.toString()));
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}await rm(root,{recursive:true,force:true});});await until(()=>seen.some(frame=>frame.ready));
  const stat=readFileSync(`/proc/${child.pid}/stat`,'utf8'),daemon={pid:child.pid,startTicks:stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)[19],socketPath,daemonGeneration:randomUUID(),exeSha256:hash(readFileSync(process.execPath))};
  const profileId=randomUUID(),generation=randomUUID(),viewId=randomUUID(),view={viewId},messages=[],failures=[],sent=[];let source,closed=false,currentView=view;
  const later=fn=>queueMicrotask(()=>{if(!closed){try{fn();}catch{/* Source records and retires denied native writes. */}}});
  const native=createNativeSharedDesktopTransport({profileId,generation,verifyRuntimeSync:()=>!closed,timeoutMs:1000,sendFrame:frame=>{sent.push(frame);later(()=>source.receiveNative(frame));}});
  const wire=createSharedThreadAuthorityWire({side:'native',sendFrame:frame=>later(()=>source.receiveNative(frame))});
  const client=createSharedThreadAuthorityClient({socket:wire.stream,profileId,generation});
  source=await startOwnedSharedDesktopSource({profileId,generation,daemon,codexHome,daemonVersion:'0.166.0',projects:[{projectId:'owned-project',cwd}],timeoutMs:1000,executionDomainPolicy:'preserve-native-cli',
   getOwnedView:id=>id===viewId?currentView:null,verifyOwnedViewSync:id=>!closed&&id===viewId,verifyContainerSync:()=>!closed,
   privateSource:{generation,verifySync:()=>!closed,list:async()=>({data:[],nextCursor:null}),read:async()=>null},
   writeNative:(encoded,guard)=>new Promise((resolve,reject)=>queueMicrotask(()=>{try{if(closed||(guard&&guard()!==true))throw Error('owned final write guard');const frame=decodeWireValue(encoded);if(frame.type.startsWith('shared-desktop-'))native.receive(frame);else{wire.receive(frame);if(frame.type==='shared-reply')source.receiveNative({v:1,type:'shared-reply-ack',profileId,generation,requestId:frame.requestId});}resolve();}catch(error){reject(error);}})),onFailure:error=>failures.push(error.code)});
  t.after(()=>{closed=true;client.close();wire.close();native.close();source.close();});
  const opening=native.connect();await until(()=>seen.some(frame=>frame.method==='initialize'));
  source.receiveNative({v:1,type:'shared-account-observation',profileId,generation,revision:1,observationId:randomUUID(),fingerprint:hash(JSON.stringify(['shared-account-principal-v1','fixture-account','fixture-user'])),expiresAtMs:Date.now()+60000});
  const connection=await opening;connection.onmessage=event=>messages.push(JSON.parse(event.data));
  const initialize=JSON.parse(readFileSync(new URL('./fixtures/pinned-desktop-sdk-initialize.json',import.meta.url)));initialize.params.capabilities.explicitGatewayOauth=false;connection.send(JSON.stringify(initialize));await until(()=>messages.some(frame=>frame.id===initialize.id)&&messages.some(frame=>frame.method==='account/updated'));
  if(bind){
   const directory=await source.listDaemon(viewId,{limit:50,useStateDbOnly:true});assert.equal(directory.page.data[0].id,ownThread);
   const binding=await client.resolveBinding({viewId,hostId:'kanban-shared-cli',threadId:ownThread,sourceToken:directory.tokens[0].token});
   const frame={id:'owned-queue-explicit-bind',method:'thread/resume',params:{threadId:ownThread,excludeTurns:true}},control={attemptId:randomUUID(),signal:new AbortController().signal,deadline:performance.now()+1000};
   assert.equal(await client.authorizeRequest(binding,frame,control),true);assert.equal(JSON.parse(await client.exchangeRequest(frame)).result.thread.id,ownThread);
  }
  const direct=(id,params)=>{const last=sent.findLast(frame=>frame.type==='shared-desktop-write');return source.receiveNative({...last,sequence:last.sequence+1,text:JSON.stringify({id,method:'thread/queue/list',params})});};
  const read=async(id,params)=>{connection.send(JSON.stringify({id,method:'thread/queue/list',params}));await until(()=>messages.some(frame=>frame.id===id)||source.signal.aborted);assert.equal(source.signal.aborted,false,JSON.stringify(failures));return messages.find(frame=>frame.id===id);};
  return{root,codexHome,cwd,child,source,seen,failures,stderr,read,direct,replaceView:()=>{currentView={viewId};}};
 }
 test('queue read uses null first cursor, native next cursor and limit one wake without altering data or native errors',async t=>{
  const f=await fixture(t),first={threadId:ownThread,cursor:null};
  assert.deepEqual(await f.read('owned-first',first),{id:'owned-first',result:queuePage(null)});
  await writeFile(join(f.codexHome,'config.toml'),'model = "changed-preference-after-binding"\n');
  const second={threadId:ownThread,cursor:nextCursor};assert.deepEqual(await f.read('owned-next',second),{id:'owned-next',result:queuePage(nextCursor)});
  const wake={threadId:ownThread,cursor:null,limit:1};assert.deepEqual(await f.read('owned-wake',wake),{id:'owned-wake',result:queuePage(null)});
  const error={threadId:ownThread,cursor:'owned-error'};const reply=await f.read('owned-error',error);assert.deepEqual(reply,{id:'owned-error',error:peerError()});assert.equal(Object.hasOwn(reply,'result'),false);
  assert.deepEqual(f.seen.filter(frame=>frame.method==='thread/queue/list').map(frame=>frame.params),[first,second,wake,error]);assert.deepEqual(f.failures,[]);assert.deepEqual(f.stderr,[]);
  assert.equal(f.seen.filter(frame=>frame.method==='thread/resume').length,1);assert.equal(f.seen.some(frame=>['thread/start','turn/start','thread/queue/add','thread/queue/start'].includes(frame.method)),false);
 });
 for(const mode of ['unbound','foreign-thread','replaced-view','account-revoked'])test('queue read refuses '+mode+' before any native queue dispatch',async t=>{
  const f=await fixture(t,{bind:mode!=='unbound'});
  if(mode==='replaced-view')f.replaceView();
  if(mode==='account-revoked'){f.child.send({type:'revoke'});await until(()=>f.source.signal.aborted);}
  assert.throws(()=>f.direct('owned-denied-'+mode,{threadId:mode==='foreign-thread'?randomUUID():ownThread,cursor:null}));
  await delay(10);assert.equal(f.seen.some(frame=>frame.method==='thread/queue/list'),false);assert.equal(f.source.signal.aborted,true);
  assert.equal(f.seen.some(frame=>['thread/start','turn/start'].includes(frame.method)),false);
 });
}
