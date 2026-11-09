import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createNativeSharedHostFactory}=require('../src/native-shared-host-factory.cjs');
const HOST='kanban-shared-cli';
const profileId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',generation='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// Structural owner fixture only: this verifies registration ordering and the
// original-factory call contract, not execution of the shipped native SDK.
function ownerFixture(factory,{withManager=true,codexHome=async function(){return '/owned/registered-daemon/.codex';},appTools={hostId:HOST,handlers:{callTool(){},listTools(){}}},createMcpSession=()=>{throw Error("unexpected MCP builder");}}={}){
 const connections=new Map([['local',{}]]),hosts=new Map([['local',{}]]),managers=new Map(),watchers=new Set(),disposables=[],calls=[];
 const emit=()=>{for(const fn of watchers)fn();};
 let connection;
 const owner={
  appServerConnectionRegistry:{getMaybeConnection:id=>connections.get(id),addConnection(id,value){calls.push(['addConnection',id]);assert.equal(hosts.get(id),value);connections.set(id,value);if(withManager)managers.set(id,{connection:value,resource:{manager:{}}});emit();},removeConnection:id=>connections.delete(id)},
  executionHostRegistry:{getMaybe:id=>hosts.get(id),add:(id,value)=>hosts.set(id,value),remove:id=>hosts.delete(id)},
  hostAppServerManagers:{getCurrent:id=>managers.get(id),subscribe(id,fn){assert.equal(id,HOST);watchers.add(fn);return()=>watchers.delete(fn);}},
  disposables:{add:fn=>disposables.push(fn)},registeredWindows:new Map([['owned-window',{}]]),getLocalAppServerClient:()=>({owned:true}),
  createAppServerConnection(id,hostConfig,ensureAuth,authClient){
   calls.push(['createOriginalConnection',id,hostConfig,ensureAuth,authClient]);
   const transport=factory.selectTransport(id,hostConfig,appTools,createMcpSession),listeners=new Set();let connected=false;
   connection={id,hostId:id,hostConfig,codexHome,get desktopMcpServerConfig(){return transport.desktopMcpServerConfig;},appServerVersion:'0.166.0',
    async connect(){await transport.connect();connected=true;},getConnectionState:()=>connected?'connected':'disconnected',
    registerInternalConnectionStateHandler:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
    registerInternalNotificationHandler:()=>()=>{},registerHostEventHandler:()=>()=>{},handleHostRequest(){},getThreadPrewarmPolicy(){},getPendingRequestCount(){return 0;},
    registerWebviewWindow:()=>calls.push(['registerWindow']),dispose(){calls.push(['disposeConnection']);transport.close();connected=false;},
   };return connection;
  },
 };
 return{owner,connections,hosts,managers,calls,disposables,get connection(){return connection;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('constructs through original factory and registers the exact original connection as both host and client',async()=>{
 const sent=[],states=[];
 const factory=createNativeSharedHostFactory({profileId,generation,verifyRuntimeSync:()=>true,sendFrame:frame=>sent.push(frame),onState:state=>states.push(state)});
 const f=ownerFixture(factory);
 try{
  factory.registerOwner(f.owner);assert.equal(f.calls.length,0);factory.activate();await tick();
  assert.equal(f.calls[0][0],'createOriginalConnection');assert.equal(f.calls[0][1],HOST);
  assert.deepEqual(f.calls[0][2],{id:HOST,kind:'local'});assert.equal(f.calls[0][3],false);
  assert.equal(f.connections.has(HOST),false);
  const open=sent.find(frame=>frame.type==='shared-desktop-open');assert.ok(open);
  factory.receive({...open,type:'shared-desktop-ready'});await tick();
  assert.equal(f.connections.get(HOST),f.connection);assert.equal(f.hosts.get(HOST),f.connection);
  assert.equal(f.calls.filter(call=>call[0]==='registerWindow').length,1);
  assert.equal(states.at(-1),'ready');
  assert.throws(()=>factory.selectTransport(HOST,{id:HOST,kind:'local'}));
  assert.throws(()=>factory.selectTransport('local',f.connection.hostConfig));
  assert.throws(()=>factory.registerOwner(f.owner));
 }finally{factory.close();}
 assert.equal(f.connections.has(HOST),false);assert.equal(f.hosts.has(HOST),false);
 assert.equal(f.connections.has('local'),true);assert.equal(f.hosts.has('local'),true);
 assert.equal(f.calls.filter(call=>call[0]==='disposeConnection').length,1);
 assert.equal(states.at(-1),'unavailable');
});

test('owner retirement before transport opening cannot publish a late host or start another connection',async()=>{
 const sent=[],states=[],state={live:true};
 const factory=createNativeSharedHostFactory({profileId,generation,verifyRuntimeSync:()=>state.live,sendFrame:frame=>sent.push(frame),onState:value=>states.push(value)});
 const f=ownerFixture(factory);
 factory.registerOwner(f.owner);factory.activate();await tick();state.live=false;factory.close();
 const open=sent.find(frame=>frame.type==='shared-desktop-open');
 assert.throws(()=>factory.receive({...open,type:'shared-desktop-ready'}));await tick();
 assert.equal(f.connections.has(HOST),false);assert.equal(f.calls.filter(call=>call[0]==='createOriginalConnection').length,1);
 assert.equal(states.includes('ready'),false);
});

test('constructor capture precedes native ready and cannot start a transport until explicit activation',async()=>{
 const state={ready:false},sent=[];
 const factory=createNativeSharedHostFactory({profileId,generation,verifyRuntimeSync:()=>state.ready,sendFrame:frame=>sent.push(frame)});
 const f=ownerFixture(factory);
 try{
  factory.registerOwner(f.owner);await tick();assert.equal(f.calls.length,0);assert.equal(sent.length,0);
  assert.throws(()=>factory.activate());assert.equal(f.calls.length,0);
  state.ready=true;factory.activate();await tick();assert.equal(f.calls[0][0],'createOriginalConnection');
  assert.equal(sent[0].type,'shared-desktop-open');
 }finally{factory.close();}
});


test('explicit App Tools keeps original handler closure and builder before connecting the shared transport',async()=>{
 const sent=[],state={live:true},metadata={enabled:true,enabled_tools:[],omit_tools_from:['deferred'],default_tools_approval_mode:'prompt',startup_timeout_sec:10,tool_timeout_sec:3600};
 const options={hostId:HOST,handlers:{callTool(){},listTools(){}}};let builds=0,disposed=0;
 const factory=createNativeSharedHostFactory({profileId,generation,enableAppTools:true,verifyRuntimeSync:()=>state.live,verifyAppToolsSync:()=>state.live,sendFrame:frame=>sent.push(frame)});
 const f=ownerFixture(factory,{appTools:options,createMcpSession:async value=>{
  assert.equal(value,options);builds++;
  return{mcpServerConfig:{...metadata,url:'http://127.0.0.1:12345/mcp',http_headers:{Authorization:'Bearer '+'A'.repeat(43)}},dispose(){disposed++;}};
 }});
 try{
  factory.registerOwner(f.owner);factory.activate();await tick();await tick();
  assert.equal(builds,1);const register=sent.find(frame=>frame.type==='shared-mcp-register');assert.ok(register);
  assert.equal(sent.some(frame=>frame.type==='shared-desktop-open'),false);
  const config={...metadata,url:'http://127.0.0.1:12346/mcp',http_headers:{Authorization:'Bearer '+'B'.repeat(43)}};
  factory.receive({...register,type:'shared-mcp-config',config});await tick();
  const open=sent.find(frame=>frame.type==='shared-desktop-open');assert.ok(open);
  factory.receive({...open,type:'shared-desktop-ready'});await tick();
  assert.deepEqual(f.connection.desktopMcpServerConfig,config);assert.equal(f.connections.get(HOST),f.connection);
 }finally{factory.close();}
 assert.equal(disposed,1);assert.equal(f.calls.filter(x=>x[0]==='disposeConnection').length,1);
});

test('App Tools permission must be literal and cannot be enabled without a synchronous account verifier',()=>{
 for(const enableAppTools of [1,'true',{},null])assert.throws(()=>createNativeSharedHostFactory({profileId,generation,enableAppTools,verifyRuntimeSync:()=>true,sendFrame(){}}));
 assert.throws(()=>createNativeSharedHostFactory({profileId,generation,enableAppTools:true,verifyRuntimeSync:()=>true,sendFrame(){}}));
});


test('successful transport initialization cannot publish ready without the actual original manager',async()=>{
 const sent=[],states=[];
 const factory=createNativeSharedHostFactory({profileId,generation,verifyRuntimeSync:()=>true,sendFrame:value=>sent.push(value),onState:value=>states.push(value)});
 const f=ownerFixture(factory,{withManager:false});
 try{
  factory.registerOwner(f.owner);factory.activate();await tick();
  const open=sent.find(frame=>frame.type==='shared-desktop-open');assert.ok(open);factory.receive({...open,type:'shared-desktop-ready'});await tick();
  assert.equal(f.connection.getConnectionState(),'connected');assert.equal(f.connections.get(HOST),f.connection);assert.equal(f.hosts.get(HOST),f.connection);
  assert.equal(f.managers.get(HOST),undefined);assert.equal(states.at(-1),'unavailable');assert.equal(states.includes('ready'),false);
 }finally{factory.close();}
});

test('shared home is read from the exact registered original initialized connection',async()=>{
 const sent=[];let homeCalls=0;
 const factory=createNativeSharedHostFactory({profileId,generation,verifyRuntimeSync:()=>true,sendFrame:value=>sent.push(value)});
 const f=ownerFixture(factory,{codexHome:async function(){assert.equal(this,f.connection);homeCalls++;return '/owned/registered-daemon/.codex';}});
 try{
  factory.registerOwner(f.owner);factory.activate();await tick();
  factory.receive({...sent.find(frame=>frame.type==='shared-desktop-open'),type:'shared-desktop-ready'});await tick();
  assert.equal(await factory.readCodexHome(f.connection),'/owned/registered-daemon/.codex');assert.equal(homeCalls,1);
  await assert.rejects(factory.readCodexHome({...f.connection}),{code:'SHARED_DESKTOP_HOST_UNAVAILABLE'});assert.equal(homeCalls,1);
  f.hosts.set(HOST,{...f.connection});
  await assert.rejects(factory.readCodexHome(f.connection),{code:'SHARED_DESKTOP_HOST_UNAVAILABLE'});assert.equal(homeCalls,1);
 }finally{factory.close();}
});

test('shared home cannot fall back after retirement or replacement during the original getter await',async()=>{
 for(const change of ['close','connection','host','runtime']){
  const sent=[],state={live:true};let finish;
  const factory=createNativeSharedHostFactory({profileId,generation,verifyRuntimeSync:()=>state.live,sendFrame:value=>sent.push(value)});
  const f=ownerFixture(factory,{codexHome:()=>new Promise(resolve=>{finish=resolve;})});
  try{
   factory.registerOwner(f.owner);factory.activate();await tick();
   factory.receive({...sent.find(frame=>frame.type==='shared-desktop-open'),type:'shared-desktop-ready'});await tick();
   const result=factory.readCodexHome(f.connection);
   const rejected=assert.rejects(result,{code:'SHARED_DESKTOP_HOST_UNAVAILABLE'});
   if(change==='close')factory.close();
   if(change==='connection')f.connections.set(HOST,{...f.connection});
   if(change==='host')f.hosts.set(HOST,{...f.connection});
   if(change==='runtime')state.live=false;
   finish('/owned/registered-daemon/.codex');await rejected;
  }finally{factory.close();}
 }
});

test('shared home keeps native errors and rejects invalid initialized paths',async()=>{
 for(const home of ['relative/.codex','/owned/../outside','/owned/.codex\u0000','/owned/'+ 'a'.repeat(4096),null]){
  const sent=[],factory=createNativeSharedHostFactory({profileId,generation,verifyRuntimeSync:()=>true,sendFrame:value=>sent.push(value)}),f=ownerFixture(factory,{codexHome:async()=>home});
  try{
   factory.registerOwner(f.owner);factory.activate();await tick();factory.receive({...sent.find(frame=>frame.type==='shared-desktop-open'),type:'shared-desktop-ready'});await tick();
   await assert.rejects(factory.readCodexHome(f.connection),{code:'SHARED_DESKTOP_HOST_UNAVAILABLE'});
  }finally{factory.close();}
 }
 const original=Object.assign(new Error('Native initialization unavailable'),{code:'OWNED_FIXTURE_NATIVE_ERROR'}),sent=[];
 const factory=createNativeSharedHostFactory({profileId,generation,verifyRuntimeSync:()=>true,sendFrame:value=>sent.push(value)}),f=ownerFixture(factory,{codexHome:async()=>{throw original;}});
 try{
  factory.registerOwner(f.owner);factory.activate();await tick();factory.receive({...sent.find(frame=>frame.type==='shared-desktop-open'),type:'shared-desktop-ready'});await tick();
  await assert.rejects(factory.readCodexHome(f.connection),error=>error===original);
 }finally{factory.close();}
});
