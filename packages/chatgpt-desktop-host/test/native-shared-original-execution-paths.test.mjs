import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,posix} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createNativeSharedHostFactory}=require('../src/native-shared-host-factory.cjs');
const {adaptNativeSharedHostChunk}=require('../src/native-shared-host-policy.cjs');
const originalChunk=process.env.CHATGPT_PICKER_NATIVE_CHUNK;
const originalDirectory=process.env.CHATGPT_SHARED_I2_ORIGINAL_DIR;
const HOST='kanban-shared-cli',CONTAINER_HOME='/owned/container/home/.codex',DAEMON_HOME='/owned/daemon/.codex';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function shipped(){
 const original=readFileSync(originalChunk);assert.equal(hash(original),'c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333');
 const result=adaptNativeSharedHostChunk({body:original}),source=result.body.toString('utf8');
 const begin=source.indexOf('class jY extends eo.TF{'),end=source.indexOf('function jZ(',begin);assert.ok(begin>=0&&end>begin);
 const getter=readFileSync(join(originalDirectory,'connection-codexHome.js'),'utf8');assert.equal(hash(getter),'73356faaa308836f31532e47ff62c6ed7179bd2930d6e5b93cf60f4ea4cce1ba');
 const codexHome=new Function(`return ({${getter}}).codexHome`)();
 let localReads=0;
 const Service=new Function('eo','em','eI','jQ','ar','el','to','eg',`return (${source.slice(begin,end)})`)({TF:class{}},{$Cz:()=>({info(){}}),DnS:()=>{localReads++;return CONTAINER_HOME;},cPM:()=>false},value=>value,false,{n:'local',a:{}},{rsL:config=>config.kind==='ssh',Tzy:value=>value??{},Ugj:{worktreeRoot:{key:'owned-worktree-root'}}},()=>({workspaceDir:false}),{homedir:()=>'/owned/container/home'});
 return{Service,codexHome,get localReads(){return localReads;}};
}

function fixture(t,original){
 const sent=[],connections=new Map(),hosts=new Map(),managers=new Map(),listeners=new Set(),state={live:true,hold:null,getterCalls:0};
 const local={id:'local',isLocal:true,hostConfig:{id:'local',kind:'local'},workspacesRoot:async()=>'/owned/container/workspaces',platformPath:async()=>posix};
 hosts.set('local',local);connections.set('local',local);
 const remote={id:'owned-remote',isLocal:false,hostConfig:{id:'owned-remote',kind:'remote'},initializedCodexHome:'/owned/other-daemon/.codex',ensureReady:async()=>{},codexHome:original.codexHome,workspacesRoot:async()=>'/owned/other-workspaces',platformPath:async()=>posix};
 hosts.set(remote.id,remote);connections.set(remote.id,remote);
 const factory=createNativeSharedHostFactory({profileId:randomUUID(),generation:randomUUID(),verifyRuntimeSync:()=>state.live,sendFrame:frame=>sent.push(frame)});
 const owner={
  appServerConnectionRegistry:{getMaybeConnection:id=>connections.get(id),addConnection(id,value){assert.equal(hosts.get(id),value);connections.set(id,value);managers.set(id,{connection:value,resource:{manager:{}}});for(const fn of listeners)fn();},removeConnection:id=>connections.delete(id)},
  executionHostRegistry:{getMaybe:id=>hosts.get(id),add:(id,value)=>hosts.set(id,value),remove:id=>hosts.delete(id)},
  hostAppServerManagers:{getCurrent:id=>managers.get(id),subscribe(id,fn){assert.equal(id,HOST);listeners.add(fn);return()=>listeners.delete(fn);}},
  disposables:{add(){}},registeredWindows:new Map(),getLocalAppServerClient:()=>local,
  createAppServerConnection(id,config){
   const transport=factory.selectTransport(id,config),events=new Set();let connected=false;
   return{id,hostId:id,hostConfig:config,isLocal:true,initializedCodexHome:DAEMON_HOME,appServerVersion:'0.166.0',
    async connect(){await transport.connect();connected=true;},getConnectionState:()=>connected?'connected':'disconnected',
    async ensureReady(){state.getterCalls++;if(state.hold)await state.hold;assert.equal(connected,true);},codexHome:original.codexHome,
    workspacesRoot:async()=>'/owned/registered-connection/workspaces',platformPath:async()=>posix,
    registerInternalConnectionStateHandler:fn=>{events.add(fn);return()=>events.delete(fn);},registerInternalNotificationHandler:()=>()=>{},registerHostEventHandler:()=>()=>{},handleHostRequest(){},getThreadPrewarmPolicy(){},getPendingRequestCount:()=>0,registerWebviewWindow(){},dispose(){connected=false;transport.close();}};
  },
 };
 owner.executionPaths=new original.Service(owner.appServerConnectionRegistry,id=>{const value=hosts.get(id);if(!value)throw Error('Unknown owned host');return value;},{getEffective:()=>undefined});
 const prior=Object.getOwnPropertyDescriptor(globalThis,'__kanbanReadSharedCodexHome');Object.defineProperty(globalThis,'__kanbanReadSharedCodexHome',{value:host=>factory.readCodexHome(host),configurable:true});
 t.after(()=>{factory.close();if(prior)Object.defineProperty(globalThis,'__kanbanReadSharedCodexHome',prior);else delete globalThis.__kanbanReadSharedCodexHome;});
 async function ready(){factory.registerOwner(owner);factory.activate();await tick();const frame=sent.find(item=>item.type==='shared-desktop-open');assert.ok(frame);factory.receive({...frame,type:'shared-desktop-ready'});await tick();assert.ok(connections.get(HOST));}
 return{factory,owner,hosts,connections,state,ready};
}

test('shipped ExecutionPathsService uses the exact shared connection initialize home while ordinary hosts retain original behavior',{skip:!originalChunk||!originalDirectory?'Requires fixed original native chunk and SDK getter':false},async t=>{
 const original=shipped(),f=fixture(t,original);await f.ready();
 assert.equal(await f.owner.executionPaths.readCodexHome(HOST),DAEMON_HOME);
 assert.equal(f.state.getterCalls,1);assert.equal(original.localReads,0);
 const paths=await f.owner.executionPaths.readHomePaths(HOST);assert.equal(paths.codexHome,DAEMON_HOME);assert.equal(paths.workspacesRoot,'/owned/registered-connection/workspaces');assert.equal(paths.worktreesSegment,posix.join(DAEMON_HOME,'worktrees'));
 assert.equal(await f.owner.executionPaths.readCodexHome('local'),CONTAINER_HOME);assert.equal(original.localReads,1);
 assert.equal(await f.owner.executionPaths.readCodexHome('owned-remote'),'/owned/other-daemon/.codex');
 await assert.rejects(f.owner.executionPaths.readCodexHome('unknown-host'));
});

test('shared directory lookup cannot fall back to local HOME after account/runtime retirement or during a stale getter await',{skip:!originalChunk||!originalDirectory?'Requires fixed original native chunk and SDK getter':false},async t=>{
 const original=shipped(),f=fixture(t,original);await f.ready();
 let release;f.state.hold=new Promise(resolve=>{release=resolve;});const pending=f.owner.executionPaths.readCodexHome(HOST);pending.catch(()=>{});await tick();
 try{assert.equal(f.state.getterCalls,1);f.state.live=false;release();await assert.rejects(pending);assert.equal(original.localReads,0);await assert.rejects(f.owner.executionPaths.readCodexHome(HOST));}
 finally{release();}
});
