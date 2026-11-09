import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createSharedDaemonRpcGate} from '../src/shared-daemon-rpc-gate.mjs';

const originalDirectory=process.env.CHATGPT_SHARED_BACKGROUND_ORIGINAL_DIR;
const nativeContractDirectory=process.env.CHATGPT_SHARED_THREAD_NAME_NATIVE_CONTRACT;
const pins={"title-Dvo.js": "8ed2fae9b0cd4fc2dc7d09dfab22698603773513b9d7d3b8faac05885626f239", "title-Ovo.js": "e6ab802ccc7b2ae0c9fef7ea06dc152a2e556df93ae0589fe445f32fbb0ea581", "title-Tvo.js": "c460651b767e1c3c467154e49559e947a01886e11211cd90738a1290e6fe799d", "title-Evo.js": "90cba49137fdcc6062efd69f97c90ca0ecbfeefa971cf1cd7303d5aaaa62de5b", "title-QT.js": "ae47ce9c628496d117375790ba9fd0c946311caf52d8e454d83ff2d4afd151c1", "title-uS.js": "bbcbadead50fc46dc58d370120a3437dacca5599ab4bedcb88baea4b7ba6b9e3", "title-QBt.js": "a7b5d60e5ab6fe35efbc57453bd9371677a37541e3cc82a820661a3abc97102e", "title-dollarBt.js": "920de18aa28d2bec4f2b1078ceab4b59733f792d75fa84eeddde200c3976cb7d", "title-UBt.js": "8339383cc3278912e0d92215090aac677e9857d7ee883c251f3fd9430acb69b0", "title-J_o.js": "b86948edacec6c7a4131867cd19bf7c229100759925b2ed4ab0dc2d485409d59", "history-setThreadTitle.js": "28a6fae0f887b3514f13e3bcf0de478f287ce5fe50214166ec5835fb02194b41", "history-persistThreadTitle.js": "d06092b1f83fda4430a5ee39245487968609ed86280a51ffab751a110f9b4a93", "history-wY.js": "dbf5ceba10c4caafca89acb7b58f768d61583429d3f905cb9387f28af53bb2c1", "r7-setThreadName.js": "6151a7c26ae43e4458ccae04d01c8b66dc2e3ad30fa994dfd45eb24b7213b1c7", "module-16109.js": "913c95c449f9c3ac3ad8efb4f35b1ab4b083a4168391e2a7954e1a84880bd5b6", "r7-startThread.js": "343ba44f16418fd281a2a83931c6c7c14fe4dfbaf6f646845c2633668bdf6172", "background-pK.js": "08dc5631e6fdfac8a0e9f99fdb0e37d12a5d30d25c1d9e1f17dc2161ee66e135", "background-pX.js": "96b88250f5b1e6d2fbfc0c7e1c2890c0980dff5ef7977c1024039b7eb88c2761", "background-pJ.js": "992a6c8457c8b9ffe2bcc98f12c9b171096cc04cc5042402f3a17bccaca8f3f4", "background-oJ.js": "e4675f2fff4f614576d19fe887d9c5463d1caeb79df9d3dec5d921fd1649930d", "native-generateTitle.js": "6db03b7151dfb39c5edd4a3ae194712926718bd0cc8a454fc94a544d8e462e11"};
const missing=!originalDirectory||!nativeContractDirectory;
function load(name){const value=readFileSync(join(originalDirectory,name),'utf8');assert.equal(createHash('sha256').update(value).digest('hex'),pins[name],name);return value;}
const unused=()=>{throw Error('Unselected original title boundary invoked');};

function originalBackground(){
 const schema=new Proxy({}, {get:(_target,key)=>key==='safeParse'?unused:()=>schema});
 const moduleRequire=id=>id===35553?{object:()=>schema,string:()=>schema,record:()=>schema,json:()=>schema,array:()=>schema}:id===71415?{JF:unused}:id===84698?{D:unused,r:unused}:unused;
 moduleRequire.n=value=>()=>value;moduleRequire.d=(target,exports,values)=>{for(const[key,get]of Object.entries(exports))Object.defineProperty(target,key,{get,enumerable:true});Object.assign(target,values);};
 const dto={};new Function(`return ({${load('module-16109.js')}})[16109]`)()({exports:dto},dto,moduleRequire);
 const startThread=new Function('rF','q','eu',`return ({${load('r7-startThread.js')}}).startThread`)(async()=>null,{nrG:dto.nr,hR3:dto.hR},{randomUUID});
 const functions=['pK','pX','pJ','oJ'].map(name=>load('background-'+name+'.js')).join('\n');
 const d={object:value=>value,string:()=>({min(){return this;},max(){return this;}})};
 const {pK}=new Function('d','q','pB','pY','eL','oX','eO','eC','pQ',functions+'\nreturn {pK};')(d,{ToG:60},{},{safeParse:value=>({success:true,data:value})},()=>({}),async(_client,model)=>model,unused,()=>{},unused);
 const generateTitle=new Function('ro','em','ey',`return ({${load('native-generateTitle.js')}}).generateTitle`)({JF:unused},{yKS:pK},async()=>({ephemeralGenerationModel:'owned-metadata-model'}));
 return{startThread,generateTitle};
}
function originalTitleStore(client,threadId,warnings){
 const wY=new Function(load('history-wY.js')+';return wY;')();
 const methods=new Function('wY','yl',`return ({${load('history-setThreadTitle.js')},${load('history-persistThreadTitle.js')}});`)(wY,{R:error=>String(error?.message??error)});
 const conversation={id:threadId,title:null};
 return Object.assign({pendingThreadTitleWrites:new Map(),getConversation:id=>id===threadId?conversation:null,
  updateConversationState(id,update){assert.equal(id,threadId);update(conversation);},
  applyThreadTitleUpdate(id,title){assert.equal(id,threadId);conversation.title=title;},
  // The transport boundary delegates the exact native history params to the
  // original SDK setter; both native methods and SDK serialization are intact.
  params:{persistThreadTitle:({threadId,name})=>client.setThreadName(threadId,name),logger:{warning:(...args)=>warnings.push(args)}}},methods);
}
function originalRenderer(service){
 const functions=['title-QT.js','title-uS.js','title-QBt.js','title-dollarBt.js','title-UBt.js','title-J_o.js','title-Tvo.js','title-Evo.js','title-Dvo.js','title-Ovo.js'].map(load).join('\n');
 // This case selects the original plain-text uS branch. No markdown parser,
 // pasted text, delegation envelope, app inventory or title-refresh is needed.
 return new Function('Yi','Svo','evo','hg','nDe','Yc','Jre','zs','Fvo','X_o','WBt','Sr','Avo','m2a','qBt','h','tVt','lVt','Cje','Fxe','CAe',functions+'\nreturn {Tvo};')(
  {threadMetadataGeneration:service},async()=>[],()=>null,null,()=>null,()=>null,unused,value=>value,'<codex_delegation>',20000,/^[\p{L}\p{M}\p{N} .,!?'"’()-]+$/u,{warning:unused},unused,unused,unused,unused,unused,unused,unused,unused,unused);
}
function fixture(t){
 const receipt=JSON.parse(readFileSync(join(nativeContractDirectory,'contract.json'),'utf8'));
 const nativeFrames=JSON.parse(readFileSync(join(nativeContractDirectory,'raw.json'),'utf8'));
 assert.equal(receipt.binarySha256,'b8a11fedf24b2dfb59a70c9e52b030f9a508dcd49cd2dd0d41956f4c785156b8');assert.equal(receipt.binaryUnchanged,true);assert.equal(receipt.exitCode,0);assert.equal(receipt.turnStarts,0);assert.equal(receipt.defaultDaemonConnections,0);
 const threadId=receipt.cases['own-empty-thread'].reply.result.thread.id;
 const binding=Object.freeze({hostId:'kanban-shared-cli',runtimeGeneration:randomUUID(),daemonGeneration:randomUUID(),accountRevision:1,projectId:'owned-project',threadId,viewId:randomUUID(),clientId:randomUUID()});
 const state={live:true,owner:binding};const writes=[],unsupported=[],notifications=[],initializeReceipts=[];
 const exact=value=>state.live&&Object.keys(binding).every(key=>value?.[key]===binding[key]);
 const gate=createSharedDaemonRpcGate({verifyReadSync:()=>state.live,verifyBindingSync:exact,verifyHistorySync:exact,write:text=>writes.push(JSON.parse(text)),desktop:{daemonVersion:'0.166.0',verifyInitializeSync:()=>state.live,
  registerInitializeConsumptionSync:receipt=>initializeReceipts.push(receipt),verifyServerEventSync:frame=>state.live&&frame.params?.threadId===threadId,
  resolveThreadNameBindingSync:id=>state.live&&id===threadId?state.owner:null,deliverUnsupportedCapabilitySync:reply=>unsupported.push(reply)}});
 t.after(()=>gate.close());
 gate.write(JSON.stringify({id:'own-init',method:'initialize',params:{clientInfo:{name:'codex_desktop',version:'26.1027.51404'}}}));
 gate.receive(JSON.stringify({id:'own-init',result:{userAgent:'codex_app_server/0.166.0',codexHome:'/owned/daemon/.codex'}}));
 assert.equal(initializeReceipts[0].consumeSync(),true);
 const original=originalBackground();let turns=0,marks=0;
 const client={options:{defaultServiceName:'owned-native-service'},initializedAppServerVersion:'0.166.0',authTokenGeneration:0,appServerVersion:'0.166.0',ensureReady:async()=>{},captureRequestLifetime:()=>()=>assert.equal(state.live,true),
  async sendInternalRequest(frame){
   gate.write(JSON.stringify(frame));
   if(frame.method==='thread/start')return unsupported.find(reply=>reply.id===frame.id);
   assert.equal(frame.method,'thread/name/set');assert.equal(frame.params.threadId,threadId);
   const nativeCase=frame.params.name===''?'empty':'fallback';
   // Replay the independently observed native response payload and same-thread
   // notification, replacing only the fresh transport correlation ID.
   const reply={...receipt.cases[nativeCase].reply,id:frame.id};
   const decoded=JSON.parse(gate.receive(JSON.stringify(reply)));
   if(nativeCase==='fallback'){
    const event=nativeFrames.find(value=>value.method==='thread/name/updated'&&value.params.threadId===threadId&&value.params.threadName===frame.params.name);
    assert.ok(event,'the exact original fallback name has a real native notification');notifications.push(JSON.parse(gate.receive(JSON.stringify(event))));
   }
   return decoded;
  },
  getUserSavedConfiguration:async()=>({mcp_servers:{}}),markEphemeralThread(){marks++;},startTurn(){turns++;throw Error('No model turn in this producer fixture');},unsubscribeThread:unused};
 client.startThread=original.startThread;
 client.setThreadName=new Function('eu',`return ({${load('r7-setThreadName.js')}}).setThreadName`)({randomUUID});
 const warnings=[];
 const service={appServerConnectionRegistry:{getConnection:host=>{assert.equal(host,binding.hostId);return client;}},statsig:{},logger:{warning:(...args)=>warnings.push(args)}};
 service.generateTitle=original.generateTitle;
 const store=originalTitleStore(client,threadId,warnings);
 const manager={getHostId:()=>binding.hostId,getCachedConversationMetadata:()=>store.getConversation(threadId),getPastedTextExcerpts:async()=>[],setThreadTitle:store.setThreadTitle.bind(store)};
 return{gate,threadId,binding,state,writes,unsupported,notifications,client,store,manager,renderer:originalRenderer(service),warnings,counts:()=>({turns,marks})};
}

test('original title failure persists its unchanged fallback through native history and original SDK, then accepts the actual name notification',{skip:missing?'Requires fixed original producer and owned no-login native rename receipts':false},async t=>{
 const f=fixture(t);
 await f.renderer.Tvo(null,f.manager,{input:[{type:'text',text:'Owned fallback title',text_elements:[]}]},{conversationId:f.threadId,cwd:'/owned/project'});
 assert.equal(f.store.getConversation(f.threadId).title,'Owned fallback title');
 assert.equal(f.unsupported.length,1);assert.equal(f.unsupported[0].error.code,-32601);
 assert.deepEqual(f.writes.filter(frame=>frame.method!=='initialize').map(frame=>({method:frame.method,params:frame.params})),[{method:'thread/name/set',params:{threadId:f.threadId,name:'Owned fallback title'}}]);
 assert.equal(f.notifications.length,1);assert.equal(f.notifications[0].params.threadName,'Owned fallback title');
 assert.deepEqual(f.counts(),{turns:0,marks:0});assert.equal(f.warnings.length,1);
 const next={id:'own-read-after-title',method:'account/read',params:{refreshToken:false}};f.gate.write(JSON.stringify(next));assert.deepEqual(f.writes.at(-1),next);
});

test('original SDK preserves the real empty-name native error while the current-thread channel remains readable',{skip:missing?'Requires fixed original producer and owned no-login native rename receipts':false},async t=>{
 const f=fixture(t);
 await assert.rejects(f.client.setThreadName(f.threadId,''),error=>error instanceof Error);
 assert.equal(f.writes.at(-1).params.name,'');
 const next={id:'own-read-after-name-error',method:'account/read',params:{refreshToken:false}};f.gate.write(JSON.stringify(next));assert.deepEqual(f.writes.at(-1),next);
 assert.deepEqual(f.counts(),{turns:0,marks:0});
});
