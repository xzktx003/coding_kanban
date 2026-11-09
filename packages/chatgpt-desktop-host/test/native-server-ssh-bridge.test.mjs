import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {createNativeServerSshBridge,installNativeServerSshBridge}=require('../src/native-server-ssh-bridge.cjs');
const {adaptNativeServerSshChunk}=require('../src/native-server-ssh-policy.cjs');
const {adaptNativeAppChunk}=require('../src/native-app-policy.cjs');

const sha=value=>createHash('sha256').update(value).digest('hex');
const profileId=randomUUID(),generation=randomUUID();
const originalPath=process.env.CHATGPT_DESKTOP_SSH_ORIGINAL_CHUNK,sdkPath=process.env.CHATGPT_DESKTOP_SSH_ORIGINAL_SDK,serverRoot=process.env.CHATGPT_SSH_SERVER_TEST_ROOT;
const enabled=originalPath&&sdkPath&&serverRoot;
const skip=!enabled&&'Set exact original native/SDK members and owned server fixture source root; no real SSH is used';
const row={hostId:'ssh-fixture',displayName:'Owned fixture',source:'discovered',alias:'fixture',hostname:null,sshPort:null,identity:null};
function method(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return source.slice(a,b);}

async function fixture(t,versionOutput="codex-cli 0.166.0\n",versionExit=0){
 const base=await mkdtemp(join(tmpdir(),'native-server-ssh-')),root=join(base,'runtime'),socketPath=join(base,'bridge.sock'),configPath=join(base,'config'),binary=join(base,'fake-ssh');
 await chmod(base,0o700);await mkdir(root,{mode:0o700});await writeFile(configPath,'# Owned fake alias; never read real SSH config\n',{mode:0o600});
 await writeFile(binary,`#!${process.execPath}\nconst fs=require('node:fs'),readline=require('node:readline');\nif(process.argv.at(-1)==='codex --version'){fs.appendFileSync(${JSON.stringify(join(base,'version-probes.txt'))},'codex --version\\n');process.stdout.write(${JSON.stringify(versionOutput)});process.exit(${versionExit});}\nreadline.createInterface({input:process.stdin}).on('line',text=>{const frame=JSON.parse(text);fs.appendFileSync(${JSON.stringify(join(base,'rpc.jsonl'))},JSON.stringify(frame)+'\\n');if(frame.method==='initialize')process.stdout.write(JSON.stringify({id:frame.id,result:{userAgent:'codex/0.166.0 linux',codexHome:'/fixture/.codex',platformFamily:'unix',platformOs:'linux'}})+'\\n');else if(frame.method==='getAuthStatus')process.stdout.write(JSON.stringify({id:frame.id,result:{authMethod:null,requiresOpenaiAuth:false}})+'\\n');else if(frame.method==='thread/list')process.stdout.write(JSON.stringify({id:frame.id,result:{data:[],nextCursor:null}})+'\\n');else if(frame.id!==undefined)process.stdout.write(JSON.stringify({id:frame.id,error:{code:-32601,message:'Owned fixture unsupported'}})+'\\n');});\n`,{mode:0o700});
 const serverRequire=createRequire(new URL('../../../apps/server/package.json',import.meta.url));
 const {tsImport}=await import(pathToFileURL(serverRequire.resolve('tsx/esm/api')).href);
 const {createChatGptSshConnections}=await tsImport(pathToFileURL(join(serverRoot,'chatgpt-desktop-ssh-connections.ts')).href,import.meta.url);
 const {startChatGptSshConnectionIpc}=await tsImport(pathToFileURL(join(serverRoot,'chatgpt-desktop-ssh-ipc.ts')).href,import.meta.url);
 let current=true;
 const manager=createChatGptSshConnections({configPath,runtimeRoot:root,sshBinary:binary,discovery:{discover:()=>({configState:'ready',sshAliases:['fixture']})},readScope:async()=>current?{id:profileId,generation,identity:'owned-fixed-profile'}:null});
 const broker=await startChatGptSshConnectionIpc({socketPath,connections:manager});
 const bridge=createNativeServerSshBridge({profileId,generation,socketPath,verifyRuntimeSync:()=>current,timeoutMs:1500});
 t.after(async()=>{bridge.close();await broker.close();manager.close();await rm(base,{recursive:true,force:true});});
 return{bridge,base,manager,socketPath,revoke(){current=false;}};
}

test('native server SSH bridge requires constructor-owned fixed scope and socket',()=>{
 for(const options of [{},{profileId,generation,socketPath:'relative',verifyRuntimeSync:()=>true},{profileId,generation,socketPath:'/owned/../socket',verifyRuntimeSync:()=>true}])assert.throws(()=>createNativeServerSshBridge(options));
});

test('fixed original native registration and initialize/list producers cross the real private broker and fake SSH',{skip,timeout:15000},async t=>{
 const f=await fixture(t),original=await readFile(originalPath),sdk=await readFile(sdkPath,'utf8');
 assert.equal(sha(original),'c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333');
 assert.equal(sha(sdk),'f717cf6c18dd50ef4adce39ccf532f4e3e740211ce8c276363175b6a5e883c22');
 const base=adaptNativeAppChunk({body:original}).body;
 const adapted=process.env.CHATGPT_SERVER_SSH_TEST_UNADAPTED==='1'?base:adaptNativeServerSshChunk({original,base}).body;
 const source=adapted.toString(),classSource=method(source,'class eTi{','function eTs(');
 const warnings=[];let legacyProbes=0;const parserInputs=[];const logger={info(){},warning(...args){warnings.push(args[0]);},debug(){},trace(){},error(){}};
 const Transport=vm.runInNewContext(classSource+';eTi',{globalThis:{__kanbanServerSshBridge:f.bridge},em:{$Cz:()=>logger,sZG:()=>{legacyProbes++;throw Error('Legacy container SSH must not execute');}},tb:{randomBytes},MS:{e2:()=> 'codex',x2:command=>command},Mv:{hD:value=>value},el:{jZe:value=>{parserInputs.push(value);return /^codex-cli (\S+)/.exec(value)?.[1]??null;},dlm:value=>value==='0.166.0',qck:'incompatible-cli:'},eTe:new Map(),eTt:()=>[],eTn:()=>[]});
 const load=method(source,'async loadRemoteConnections(){','restoreSavedAliasConnectionsForExistingRemoteProjects(e){');
 const save=method(source,'async saveCodexManagedRemoteSshConnections(e){','async setRemoteConnectionAutoConnect(');
 const NativeRemote=vm.runInNewContext(`(class{${save}${load}})`,{globalThis:{__kanbanServerSshBridge:f.bridge},egZ:async()=>null,efi:()=>'/owned/empty-ssh-config',eft:()=>logger});
 const state=new Map(),remote=new NativeRemote();
 Object.assign(remote,{catalog:{read:()=>({ssh:[]})},appState:{set:(_key,value)=>state.set('rows',value)},loadSavedRemoteConnections:()=>state.get('rows')??[],addConnectionAnalyticsIds:rows=>rows,getAutoConnectForRemoteConnection:()=>true,clearRemoteConnectionAutoConnect(){},restoreSavedAliasConnectionsForExistingRemoteProjects:rows=>rows,async refreshRemoteConnections(){this.rows=await this.loadRemoteConnections();}});
 // Use exact original methods; only their unrelated global-state key is a fixture.
 const nativeContext={globalThis:{__kanbanServerSshBridge:f.bridge},el:{Q2Y:{CODEX_MANAGED_REMOTE_CONNECTIONS:'rows'}}};
 const Save=vm.runInNewContext(`({${save}})`,nativeContext);remote.saveCodexManagedRemoteSshConnections=Save.saveCodexManagedRemoteSshConnections;
 await remote.saveCodexManagedRemoteSshConnections([row]);
 assert.equal(remote.rows.length,1);assert.equal(remote.rows[0].hostId,row.hostId);
 const transport=new Transport({sshConnection:{alias:'fixture',host:'fixture',port:null,identity:null}});
 let resolveReply;const pending=new Map(),sent=[];
 const owner={options:{hostId:row.hostId,hostConfig:{id:row.hostId,kind:'ssh'},ensureAuth:true,transport,clientInfo:{name:'codex-desktop',version:'owned-fixture'},isMcpAppsDilEnabled:()=>false,supportsOpenAIFormElicitation:false,supportsAttestationRequests:()=>false},initializationGeneration:1,logger,
  clearInitializedHost(){},stopReconnectTimer(){},resetIncomingLineQueue(){},getConfiguredRemoteConnectionMaxRetryAttempts:()=>0,getRetryDisplayState:()=> 'disconnected',waitForConnectionOpen(connection){return Producers.waitForConnectionOpen.call(this,connection);},setConnectionState(){},setConnectionProgress(){},scheduleInitializeTimeout(){},getInitializeDurationMs:()=>0,clearInitializeTimeoutTimer(){},initialized:false,
  async connectAndWaitForOpen(){await Producers.connectAndWaitForOpen.call(this);},sharedThreadIds:new Set(),sessions:{resetUnsupportedProcessSpawn(){}},
  incomingLineProcessor:{handleIncomingData(data){const reply=JSON.parse(data);if(reply.id==='__codex_initialize__'){owner.resolveInitialize();}else{const waiting=pending.get(reply.id);pending.delete(reply.id);waiting?.(reply);}}},
  handleTransportClosed(_event,connection){assert.equal(connection,this.connection);this.closed=true;},failConnection(){},
  async completeInitialization(){const state=await Producers.getPostInitializeConnectionState.call(this);assert.equal(state.state,'connected');assert.equal(state.error,null);this.initialized=true;},requestAuthStatus(...args){return Producers.requestAuthStatus.apply(this,args);},getAuthStatusTimeoutMs:()=>1500,sendInternalRequest(frame){return this.sendCatalogRequest(frame);},messageDelivery:{clearConfigNotices(){},sendMessage(frame){sent.push(frame);owner.connection.send(JSON.stringify(frame));}},
  sendCatalogRequest(frame){sent.push(frame);return new Promise(resolve=>{pending.set(frame.id,resolve);owner.connection.send(JSON.stringify(frame));});},
 };
 const start=method(sdk,'async startAppServerProcess(e){','clearInitializedHost(){');
 const list=method(sdk,'async listThreads(e,t,n){','getLocalProcessId(){');
 const connect=method(sdk,'async connectAndWaitForOpen(){','waitForConnectionOpen(e){');
 const wait=method(sdk,'waitForConnectionOpen(e){','stopProcess(){');
 const postInit=method(sdk,'async getPostInitializeConnectionState(){','async refreshAuthenticatedConnectionState(){');
 const authStatus=method(sdk,'async requestAuthStatus(e,t=!0){','async listSkills(e){');
 const Producers=vm.runInNewContext(`({${start},${list},${connect},${wait},${postInit},${authStatus}})`,{q:{PpM:()=>undefined,JXP:'owned-extension',ESg:()=>({}),gCo:[],e47:()=>({})},nc:{K7:()=> 'owned-connection',vj:{Open:1},Wp:class extends Error{}},r5:{safeParse:()=>({data:{failureReason:'owned-closed'}})},nC:{ts:'owned-form'},nO:'__codex_initialize__',nM(){},eu:{randomUUID},Date,Promise,Error,rs:class extends Error{}});
 await Producers.startAppServerProcess.call(owner,1);
 assert.equal((await readFile(join(f.base,'version-probes.txt'),'utf8')).trim(),'codex --version');
 assert.equal(legacyProbes,0,'full original SDK connect must not run native/container SSH version probes');
 assert.equal(owner.installedCodexVersion,'0.166.0');
 assert.deepEqual(parserInputs,['codex-cli 0.166.0\n'],'the complete original version method must receive exact remote CLI stdout, never userAgent');
 assert.equal(owner.initialized,true);
 const result=await Producers.listThreads.call(owner,{limit:20},undefined,undefined);
 assert.deepEqual(result,{data:[],nextCursor:null});
 const originalRegister=method(original.toString(),'createAndRegisterRemoteConnection(e){','disposeRemoteConnection(e){');
 const register=vm.runInNewContext(`({${originalRegister}})`,{eff:value=>({id:value.hostId,kind:'ssh'}),ew2:(hostId,kind,connection)=>({hostId,kind,connection})}).createAndRegisterRemoteConnection;
 const hosts=new Map(),catalog=[];let windows=0;
 const nativeHost={createAppServerConnection:(id,config,ensureAuth)=>{assert.equal(id,row.hostId);assert.equal(config.kind,'ssh');assert.equal(ensureAuth,true);return owner;},getLocalAppServerClient:()=>({}),executionHostRegistry:{add:(id,value)=>hosts.set(id,value)},threadCatalogSyncManager:{attachSource:entry=>catalog.push(entry)},registeredWindows:new Map([['owned-window',{}]])};
 owner.registerWebviewWindow=()=>windows++;
 assert.equal(register.call(nativeHost,remote.rows[0]),owner);assert.equal(hosts.get(row.hostId),owner);assert.equal(catalog[0].connection,owner);assert.equal(windows,1);
 const raw=(await readFile(join(f.base,'rpc.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 assert.deepEqual(raw.map(frame=>frame.method),['initialize','getAuthStatus','thread/list']);
 assert.deepEqual(raw[1].params,{includeToken:false,refreshToken:false});
 assert.equal(raw[0].id,'__codex_initialize__');assert.deepEqual(raw,JSON.parse(JSON.stringify(sent)));
 assert.equal(typeof owner.connection.onopen,'function');assert.equal(typeof owner.connection.onmessage,'function');assert.equal(owner.connection.readyState,1);
 transport.dispose();
 assert.equal(owner.closed,true);
 for(let n=0;n<50;n++){if((await f.manager.refresh({id:profileId,generation})).connections[0].state!=='connected')break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.notEqual((await f.manager.refresh({id:profileId,generation})).connections[0].state,'connected');
 f.revoke();assert.throws(()=>owner.connection.send(JSON.stringify({id:'late',method:'thread/list',params:{}})));
});


test('explicit native client closes owned streams on profile revocation without closing the server broker',{skip,timeout:6000},async t=>{
 const f=await fixture(t),target={};
 const owner=installNativeServerSshBridge({settings:{version:1},profileId,generation,target,socketPath:f.socketPath,verifyRuntimeSync:()=>live});
 let live=true;t.after(()=>owner.close());
 const client=target.__kanbanServerSshBridge;await client.save([row]);await client.catalog([row]);
 const connection=await client.connect({alias:'fixture',host:'fixture',port:null,identity:null});
 assert.equal(connection.readyState,1);
 const closed=new Promise(resolve=>{connection.onclose=resolve;});
 live=false;let timer;try{await Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned client did not retire')),1800);})]);}finally{clearTimeout(timer);}
 assert.equal(connection.readyState,3);assert.equal(target.__kanbanServerSshBridge,client);
 await assert.rejects(client.save([row]));
 // Native shutdown/revocation owns its clients only; the candidate owns UDS.
 const {access}=await import('node:fs/promises');await access(f.socketPath);
});

test('empty, failed and incompatible real CLI probes cannot start a remote app-server',{skip,timeout:10000},async t=>{
 const original=await readFile(originalPath),source=adaptNativeServerSshChunk({original,base:adaptNativeAppChunk({body:original}).body}).body.toString();
 for(const sample of [
  {output:'',exit:0,code:'SSH_NATIVE_VERSION_UNAVAILABLE'},
  {output:'codex-cli 0.166.0\n',exit:7,code:'SSH_VERSION_PROBE_FAILED'},
  {output:'codex-cli 0.1.0\n',exit:0,message:'incompatible-cli:0.1.0'},
 ]){
  const f=await fixture(t,sample.output,sample.exit);await f.bridge.save([row]);await f.bridge.catalog([row]);let legacy=0;
  const Transport=vm.runInNewContext(method(source,'class eTi{','function eTs(')+';eTi',{
   globalThis:{__kanbanServerSshBridge:f.bridge},em:{$Cz:()=>({info(){},warning(){}}),sZG:()=>{legacy++;throw Error('Forbidden legacy SSH')}},tb:{randomBytes},MS:{e2:()=> 'codex'},Mv:{hD:value=>value},el:{jZe:value=>/^codex-cli (\S+)/.exec(value)?.[1]??null,dlm:value=>value==='0.166.0',qck:'incompatible-cli:'}
  });
  const transport=new Transport({sshConnection:{alias:'fixture',host:'fixture',port:null,identity:null}});
  await assert.rejects(transport.connect(),error=>sample.code?error.code===sample.code:error.message===sample.message);
  assert.equal(legacy,0);await assert.rejects(readFile(join(f.base,'rpc.jsonl')),{code:'ENOENT'});
  assert.equal((await readFile(join(f.base,'version-probes.txt'),'utf8')).trim(),'codex --version');
  await assert.rejects(transport.runRemoteLoginShellCommand({command:'codex --version; arbitrary',operation:'codex_version_probe'}),{code:'SSH_NATIVE_REMOTE_COMMAND_UNAVAILABLE'});
  await assert.rejects(transport.runRemoteLoginShellCommandWithoutGate({command:'codex --version',operation:'app_server_bootstrap'}),{code:'SSH_NATIVE_REMOTE_COMMAND_UNAVAILABLE'});
  transport.dispose();
 }
});
test('server SSH policy retains exact original/default/shared digest gates',{skip:!originalPath&&'Requires fixed original native member'},async()=>{
 const original=await readFile(originalPath),{adaptNativeSharedHostChunk}=require('../src/native-shared-host-policy.cjs');
 const outputs=[['28eaec923cb08b65bafc90f72cdb75a8de83b6319066e6a94e59dd86f592b200',adaptNativeAppChunk({body:original}).body],['85f0b4062f4425dfdaab44f322708131d4d1b3b8aa0c6d46a4376af49d4ade53',adaptNativeSharedHostChunk({body:original}).body]];
 for(const [expected,base]of outputs){const result=adaptNativeServerSshChunk({original,base});assert.equal(result.adaptedSha256,expected);new vm.Script(result.body.toString());}
 assert.throws(()=>adaptNativeServerSshChunk({original:Buffer.from('unknown'),base:outputs[0][1]}),{code:'SSH_NATIVE_POLICY_MISMATCH'});
 assert.throws(()=>adaptNativeServerSshChunk({original,base:Buffer.concat([outputs[0][1],Buffer.from('changed')])}),{code:'SSH_NATIVE_POLICY_MISMATCH'});
});
