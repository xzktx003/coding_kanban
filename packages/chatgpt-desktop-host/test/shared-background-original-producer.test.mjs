import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createSharedDaemonRpcGate} from '../src/shared-daemon-rpc-gate.mjs';
const originalDirectory=process.env.CHATGPT_SHARED_BACKGROUND_ORIGINAL_DIR;
const pins=Object.freeze({"background-pK.js":"08dc5631e6fdfac8a0e9f99fdb0e37d12a5d30d25c1d9e1f17dc2161ee66e135","background-pX.js":"96b88250f5b1e6d2fbfc0c7e1c2890c0980dff5ef7977c1024039b7eb88c2761","background-pJ.js":"992a6c8457c8b9ffe2bcc98f12c9b171096cc04cc5042402f3a17bccaca8f3f4","background-oJ.js":"e4675f2fff4f614576d19fe887d9c5463d1caeb79df9d3dec5d921fd1649930d","r7-startThread.js":"343ba44f16418fd281a2a83931c6c7c14fe4dfbaf6f646845c2633668bdf6172","native-generateTitle.js":"6db03b7151dfb39c5edd4a3ae194712926718bd0cc8a454fc94a544d8e462e11","module-16109.js":"913c95c449f9c3ac3ad8efb4f35b1ab4b083a4168391e2a7954e1a84880bd5b6"});
function originalProducer(){
 const load=name=>{const text=readFileSync(join(originalDirectory,name),'utf8');assert.equal(createHash('sha256').update(text).digest('hex'),pins[name]);return text;};
 const unused=()=>{throw Error('Unselected original generation boundary invoked');};
 // The original module's schema registration is inert here. Its actual hR/nr
 // projection functions execute unchanged with no optional feature-rule data.
 const schema=new Proxy({}, {get:(_target,key)=>key==='safeParse'?unused:()=>schema});
 const moduleRequire=id=>id===35553?{object:()=>schema,string:()=>schema,record:()=>schema,json:()=>schema,array:()=>schema}:id===71415?{JF:unused}:id===84698?{D:unused,r:unused}:unused;
 moduleRequire.n=value=>()=>value;moduleRequire.d=(target,exports,values)=>{for(const[key,get]of Object.entries(exports))Object.defineProperty(target,key,{get,enumerable:true});Object.assign(target,values);};
 const dto={};new Function(`return ({${load('module-16109.js')}})[16109]`)()({exports:dto},dto,moduleRequire);
 const startThread=new Function('rF','q','eu',`return ({${load('r7-startThread.js')}}).startThread`)(async()=>null,{nrG:dto.nr,hR3:dto.hR},{randomUUID});
 const descriptionSchema={};const d={object:value=>value,string:()=>({min(){return this;},max(){return this;}})};
 const events=[];
 const functions=['pK','pX','pJ','oJ'].map(name=>load('background-'+name+'.js')).join('\n');
 const titles=new Function('d','q','pB','pY','eL','oX','eO','eC','pQ',functions+'\nreturn {pK,pX};')(d,{ToG:60},descriptionSchema,{safeParse:value=>({success:true,data:value})},()=>({}),async(_client,model)=>model,unused,value=>events.push(value),unused);
 const generateTitle=new Function('ro','em','ey',`return ({${load('native-generateTitle.js')}}).generateTitle`)({JF:unused},{yKS:titles.pK},async()=>({ephemeralGenerationModel:'owned-metadata-model'}));
 return{startThread,generateTitle,pX:titles.pX,events};
}
function fixture(t){
 const writes=[],responses=[],receipts=[],requests=[],state={live:true};
 const gate=createSharedDaemonRpcGate({verifyReadSync:()=>state.live,verifyBindingSync:()=>false,verifyHistorySync:()=>false,write:text=>writes.push(JSON.parse(text)),desktop:{daemonVersion:'0.166.0',verifyInitializeSync:()=>state.live,registerInitializeConsumptionSync:receipt=>receipts.push(receipt),deliverUnsupportedCapabilitySync:reply=>responses.push(reply)}});
 t.after(()=>gate.close());
 gate.write(JSON.stringify({id:'owned-init',method:'initialize',params:{clientInfo:{name:'codex_desktop',version:'26.1027.51404'}}}));
 gate.receive(JSON.stringify({id:'owned-init',result:{userAgent:'codex_app_server/0.166.0',codexHome:'/owned/daemon/.codex'}}));assert.equal(receipts[0].consumeSync(),true);
 const original=originalProducer();let marks=0,turns=0,unsubscribes=0;
 const client={options:{defaultServiceName:'owned-native-service'},initializedAppServerVersion:'0.166.0',authTokenGeneration:0,appServerVersion:'0.166.0',ensureReady:async()=>{},captureRequestLifetime:()=>()=>assert.equal(state.live,true),
  async sendInternalRequest(frame){requests.push(frame);gate.write(JSON.stringify(frame));const reply=responses.find(value=>value.id===frame.id);assert.ok(reply,'background must receive an actual capability error');return reply;},
  getUserSavedConfiguration:async()=>({mcp_servers:{owned_fixture_mcp:{}}}),markEphemeralThread(){marks++;},startTurn(){turns++;throw Error('No background turn may start');},unsubscribeThread(){unsubscribes++;throw Error('No background thread exists');}};
 client.startThread=original.startThread;
 return{gate,writes,responses,requests,state,original,client,counts:()=>({marks,turns,unsubscribes})};
}

test('fixed original title producer through original r7 DTO receives a real gate capability error and consumer recovers without a task',{skip:!originalDirectory?'Requires supplied pinned background producer functions':false},async t=>{
 const f=fixture(t),warnings=[];
 const service={appServerConnectionRegistry:{getConnection:host=>{assert.equal(host,'kanban-shared-cli');return f.client;}},statsig:{},logger:{warning:(message,fields)=>warnings.push({message,error:fields.sensitive.error})}};
 const value=await f.original.generateTitle.call(service,{hostId:'kanban-shared-cli',prompt:'owned title contract',cwd:'/owned/project',maxTitleChars:40});
 assert.equal(value,null);assert.equal(warnings.length,1);assert.equal(warnings[0].message,'Failed to generate thread title');
 assert.equal(f.responses.length,1);assert.equal(f.responses[0].error.code,-32601);assert.equal(f.responses[0].error.data.code,'SHARED_CAPABILITY_NOT_SUPPORTED');assert.equal(Object.hasOwn(f.responses[0],'result'),false);
 const frame=f.requests[0],p=frame.params;
 assert.equal(frame.method,'thread/start');assert.equal(p.threadSource,'thread_title');assert.equal(p.serviceName,'owned-native-service');assert.equal(p.ephemeral,true);assert.equal(p.approvalPolicy,'never');assert.equal(p.permissions,':read-only');assert.deepEqual(p.runtimeWorkspaceRoots,[]);assert.equal(p.modelProvider,null);assert.equal(p.allowProviderModelFallback,true);assert.equal(p.personality,null);assert.equal(p.experimentalRawEvents,false);assert.equal(p.dynamicTools,null);
 assert.equal(p.config['features.hooks'],false);assert.equal(p.config['features.apps'],false);assert.equal(p.config.web_search,'disabled');assert.deepEqual(p.config['mcp_servers.codex_app'],{enabled:false,command:''});
 assert.deepEqual(f.counts(),{marks:0,turns:0,unsubscribes:0});assert.equal(f.writes.length,1);assert.equal(f.writes[0].method,'initialize');
 const next={id:'owned-next-read',method:'account/read',params:{refreshToken:false}};f.gate.write(JSON.stringify(next));assert.deepEqual(f.writes[1],next);
});

test('original metadata common producer preserves its three exact sources and explicit refusal cannot write a background start',{skip:!originalDirectory?'Requires supplied pinned background producer functions':false},async t=>{
 for(const feature of ['thread_title','thread_description','thread_summary']){
  const f=fixture(t);
  await assert.rejects(f.original.pX({appServerClient:f.client,model:'owned-metadata-model',cwd:'/owned/project',feature,prompt:'owned metadata contract',timeoutMs:1000}),/Shared desktop policy does not support background thread\/start/);
  assert.equal(f.requests[0].params.threadSource,feature);assert.equal(f.responses[0].error.code,-32601);assert.equal(f.writes.length,1);assert.deepEqual(f.counts(),{marks:0,turns:0,unsubscribes:0});
 }
});
