import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,rmSync,readdirSync,readlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {captureSharedExecutionProject,createPreservedNativeExecutionDomain} from '../src/shared-execution-domain-proof.mjs';
import {createSharedThreadCreationAuthority} from '../src/shared-thread-creation.mjs';

function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'shared-execution-'));chmodSync(root,0o700);
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const cwd=join(root,'project');mkdirSync(cwd,0o775);
 const file=join(root,'config.toml');writeFileSync(file,'approval_policy = "never"\n',{mode:0o600});
 const config={config:{approval_policy:'never',mcp_servers:{},unknown_native_field:{enabled:true}},origins:{approval_policy:{name:{type:'user',file,profile:null},version:'own-fixture-v1'}},layers:[{name:{type:'user',file,profile:null},version:'own-fixture-v1',config:{approval_policy:'never'}}]};
 let live=true;const source={configurationProtocolVersion:'0.166.0',assertCurrent(){assert.equal(live,true);},async readProjectConfig(p){assert.equal(p,cwd);return structuredClone(config);},async readRequirements(){return{requirements:null,supportsIndependentSpeedModes:true};}};
 return{root,cwd,file,config,source,stop(){live=false;}};
}
test('full native configuration including unknown keys is captured; file mutation revokes synchronously',async t=>{
 const f=fixture(t);const proof=await captureSharedExecutionProject({source:f.source,cwd:f.cwd});t.after(()=>proof.close());
 assert.equal(proof.verifyCurrentSync(),true);assert.match(proof.summary().configurationDigest,/^[a-f0-9]{64}$/);
 writeFileSync(f.file,'approval_policy = "on-request"\n');assert.equal(proof.verifyCurrentSync(),false);
});
test('ancestor candidates absent from native layers are metadata-only and need no content read permission',async t=>{
 const f=fixture(t);mkdirSync(join(f.root,'.codex'));const unrelated=join(f.root,'.codex','config.toml');writeFileSync(unrelated,'private unrelated config\n',{mode:0o000});
 const proof=await captureSharedExecutionProject({source:f.source,cwd:f.cwd});t.after(()=>proof.close());assert.equal(proof.verifyCurrentSync(),true);
 chmodSync(unrelated,0o600);assert.equal(proof.verifyCurrentSync(),false);
});
test('a changed unknown native field between real reads cannot produce a certificate',async t=>{
 const f=fixture(t);let reads=0;const original=f.source.readProjectConfig;f.source.readProjectConfig=async p=>{const value=await original(p);if(++reads===2)value.config.unknown_native_field.enabled=false;return value;};
 await assert.rejects(captureSharedExecutionProject({source:f.source,cwd:f.cwd}),{code:'SHARED_EXECUTION_DOMAIN_UNPROVEN'});
});
test('non-file managed layer remains explicitly unproven',async t=>{
 const f=fixture(t);f.config.layers.push({name:{type:'enterpriseManaged',id:'own',name:'own'},version:'v1',config:{}});
 await assert.rejects(captureSharedExecutionProject({source:f.source,cwd:f.cwd}),{code:'SHARED_EXECUTION_DOMAIN_UNPROVEN'});
});
test('new project config, changed declared MCP, and revoked native source cannot retain proof',async t=>{
 const f=fixture(t);const proof=await captureSharedExecutionProject({source:f.source,cwd:f.cwd});t.after(()=>proof.close());
 mkdirSync(join(f.cwd,'.codex'));writeFileSync(join(f.cwd,'.codex','config.toml'),'model = "own"\n');
 assert.equal(proof.verifyCurrentSync(),false);
 await assert.rejects(captureSharedExecutionProject({source:f.source,cwd:f.cwd,declaredMcp:{mcp_servers:{injected:{enabled:true}}}}),{code:'SHARED_EXECUTION_DOMAIN_UNPROVEN'});
 f.stop();assert.equal(proof.verifyCurrentSync(),false);
});
test('minimal resume is single use; only actual matching native reply attests policy',async t=>{
 const f=fixture(t),runtimeGeneration=randomUUID(),daemonGeneration=randomUUID(),threadId=randomUUID();let revision=7;
 const domain=await createPreservedNativeExecutionDomain({source:f.source,projects:[{projectId:'own',cwd:f.cwd}],runtimeGeneration,daemonGeneration,getAccountRevision:()=>revision});t.after(()=>domain.close());
 const binding={hostId:'kanban-shared-cli',runtimeGeneration,daemonGeneration,accountRevision:7,projectId:'own',threadId,viewId:randomUUID(),clientId:randomUUID()};
 const request={id:'own-resume',method:'thread/resume',params:{threadId,excludeTurns:true}};
 assert.equal(await domain.bindThread(binding,{thread:{id:threadId,cwd:f.cwd,turns:[]}}),true);
 assert.equal(domain.executionDomain.beforeResumeWriteSync(binding,{...request,params:{...request.params,config:{}}}),false);
 assert.equal(domain.executionDomain.beforeResumeWriteSync(binding,request),true);
 assert.equal(domain.executionDomain.beforeResumeWriteSync(binding,request),false);
 assert.equal(domain.getAttestationSync(binding),null);
 const reply={id:request.id,result:{thread:{id:threadId,cwd:f.cwd,turns:[]},cwd:f.cwd,model:'own-model',modelProvider:'own-provider',approvalPolicy:'never',approvalsReviewer:'user',sandbox:{type:'readOnly'}}};
 assert.equal(domain.executionDomain.observeResumeReplySync(binding,request,reply),true);
 const attested=domain.getAttestationSync(binding);assert.equal(attested.policyOrigin,'native-resume-response');assert.equal(attested.loadedThreadMcpConfigurationProven,false);
 revision++;assert.equal(domain.getAttestationSync(binding),null);
});
test('native error is preserved but cannot attest a policy; cwd mismatch is rejected',async t=>{
 const f=fixture(t),runtimeGeneration=randomUUID(),daemonGeneration=randomUUID(),threadId=randomUUID();
 const domain=await createPreservedNativeExecutionDomain({source:f.source,projects:[{projectId:'own',cwd:f.cwd}],runtimeGeneration,daemonGeneration,getAccountRevision:()=>1});t.after(()=>domain.close());
 const binding={hostId:'kanban-shared-cli',runtimeGeneration,daemonGeneration,accountRevision:1,projectId:'own',threadId,viewId:randomUUID(),clientId:randomUUID()},request={id:1,method:'thread/resume',params:{threadId,excludeTurns:true}};
 assert.equal(await domain.bindThread(binding,{thread:{id:threadId,cwd:f.cwd,turns:[]}}),true);assert.equal(domain.executionDomain.beforeResumeWriteSync(binding,request),true);
 assert.equal(domain.executionDomain.observeResumeReplySync(binding,request,{id:1,error:{code:-32600,message:'own-native-error'}}),true);assert.equal(domain.getAttestationSync(binding),null);
 const second={...binding,clientId:randomUUID()},secondRequest={...request,id:2};assert.equal(await domain.bindThread(second,{thread:{id:threadId,cwd:f.cwd,turns:[]}}),true);
 assert.equal(domain.executionDomain.beforeResumeWriteSync(second,secondRequest),true);
 assert.equal(domain.executionDomain.observeResumeReplySync(second,secondRequest,{id:2,result:{thread:{id:threadId,cwd:f.root,turns:[]},cwd:f.root,model:'own',modelProvider:'own',approvalPolicy:'never',approvalsReviewer:'user',sandbox:{type:'readOnly'}}}),false);assert.equal(domain.getAttestationSync(second),null);
});
test('created thread requires a live branded actual-start receipt and never fabricates resume pagination',async t=>{
 const f=fixture(t),runtimeGeneration=randomUUID(),daemonGeneration=randomUUID(),threadId=randomUUID(),viewId=randomUUID();let view={viewId};
 const metadata={thread:{id:threadId,cwd:f.cwd,turns:[]}};f.source.readThreadMetadata=async id=>id===threadId?structuredClone(metadata):null;
 const domain=await createPreservedNativeExecutionDomain({source:f.source,projects:[{projectId:'own',cwd:f.cwd}],runtimeGeneration,daemonGeneration,getAccountRevision:()=>1});t.after(()=>domain.close());
 const scope={hostId:'kanban-shared-cli',runtimeGeneration,daemonGeneration,accountRevision:1,projectId:'own',cwd:f.cwd,viewId,creationNonce:randomUUID()};
 const binding={hostId:scope.hostId,runtimeGeneration,daemonGeneration,accountRevision:1,projectId:'own',threadId,viewId,clientId:randomUUID()};
 const authority=createSharedThreadCreationAuthority({verifyProjectSync:s=>domain.verifyProjectSync(s),getOwnedView:()=>view,verifyOwnedViewSync:()=>view!==null,verifyExplicitIntentSync:()=>true});t.after(()=>authority.close());
 const frame={id:'own-create',method:'thread/start',params:{cwd:f.cwd}},reply={id:frame.id,result:{...metadata,cwd:f.cwd,model:'own-model',modelProvider:'own-provider',approvalPolicy:'never',approvalsReviewer:'user',sandbox:{type:'readOnly'}}};
 authority.registerCreate(scope,frame,{signal:new AbortController().signal,deadline:performance.now()+10000});authority.beforeWriteSync(frame);const receipt=authority.observeReplySync(frame,reply);
 assert.equal(await domain.bindCreatedThread({...binding,clientId:randomUUID()},JSON.parse(JSON.stringify(receipt))),false);
 assert.equal(await domain.bindCreatedThread(binding,receipt),true);
 const attestation=domain.getAttestationSync(binding);assert.equal(attestation.policyOrigin,'native-start-response');assert.equal(attestation.loadedThreadMcpConfigurationProven,false);assert.match(attestation.nativeReplyDigest,/^[a-f0-9]{64}$/);
 assert.equal(domain.executionDomain.beforeResumeWriteSync(binding,{id:2,method:'thread/resume',params:{threadId,excludeTurns:true}}),false);
 assert.equal(await domain.bindCreatedThread({...binding,clientId:randomUUID()},receipt),false);
});
test('creation intent revoked during config reads cannot establish post-start authority',async t=>{
 const f=fixture(t),runtimeGeneration=randomUUID(),daemonGeneration=randomUUID(),threadId=randomUUID(),viewId=randomUUID();let view={viewId};
 const metadata={thread:{id:threadId,cwd:f.cwd,turns:[]}};f.source.readThreadMetadata=async()=>structuredClone(metadata);
 const domain=await createPreservedNativeExecutionDomain({source:f.source,projects:[{projectId:'own',cwd:f.cwd}],runtimeGeneration,daemonGeneration,getAccountRevision:()=>1});t.after(()=>domain.close());
 const scope={hostId:'kanban-shared-cli',runtimeGeneration,daemonGeneration,accountRevision:1,projectId:'own',cwd:f.cwd,viewId,creationNonce:randomUUID()},binding={hostId:scope.hostId,runtimeGeneration,daemonGeneration,accountRevision:1,projectId:'own',threadId,viewId,clientId:randomUUID()};
 const authority=createSharedThreadCreationAuthority({verifyProjectSync:s=>domain.verifyProjectSync(s),getOwnedView:()=>view,verifyOwnedViewSync:()=>view!==null,verifyExplicitIntentSync:()=>true});t.after(()=>authority.close());
 const frame={id:'own-create',method:'thread/start',params:{cwd:f.cwd}},reply={id:frame.id,result:{...metadata,cwd:f.cwd,model:'own',modelProvider:'own',approvalPolicy:'never',approvalsReviewer:'user',sandbox:{type:'readOnly'}}};
 authority.registerCreate(scope,frame,{signal:new AbortController().signal,deadline:performance.now()+10000});authority.beforeWriteSync(frame);const receipt=authority.observeReplySync(frame,reply),original=f.source.readProjectConfig;
 f.source.readProjectConfig=async p=>{view=null;return original(p);};
 assert.equal(await domain.bindCreatedThread(binding,receipt),false);assert.equal(domain.getAttestationSync(binding),null);
});

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve};};
function heldFileCount(file){return readdirSync('/proc/self/fd').filter(name=>{try{return readlinkSync('/proc/self/fd/'+name)===file;}catch{return false;}}).length;}
async function revisionFixture(t){
 const f=fixture(t),runtimeGeneration=randomUUID(),daemonGeneration=randomUUID(),viewId=randomUUID();let accountRevision=7;
 const reads={config:0,requirements:0};const readConfig=f.source.readProjectConfig,readRequirements=f.source.readRequirements;
 f.source.readProjectConfig=async cwd=>{reads.config++;return readConfig(cwd);};f.source.readRequirements=async()=>{reads.requirements++;return readRequirements();};
 const domain=await createPreservedNativeExecutionDomain({source:f.source,projects:[{projectId:'own',cwd:f.cwd}],runtimeGeneration,daemonGeneration,getAccountRevision:()=>accountRevision});t.after(()=>domain.close());
 const scope={hostId:'kanban-shared-cli',runtimeGeneration,daemonGeneration,accountRevision,projectId:'own',cwd:f.cwd,viewId};
 const binding=(clientId=randomUUID())=>({hostId:scope.hostId,runtimeGeneration,daemonGeneration,accountRevision:scope.accountRevision,projectId:'own',threadId:randomUUID(),viewId,clientId});
 const control=(extra={})=>({signal:new AbortController().signal,deadline:performance.now()+10000,verifyCurrentSync:actual=>JSON.stringify(actual)===JSON.stringify(scope),expectedRevision:domain.getRevisionSync(),...extra});
 return{...f,domain,scope,binding,control,reads,setAccount:value=>{accountRevision=value;}};
}
test('explicit revalidation replaces changed closure once and permanently retires old dispatched bindings',async t=>{
 const f=await revisionFixture(t),old=f.domain.getRevisionSync();assert.equal(Object.isFrozen(old),true);assert.deepEqual(Object.keys(old),[]);
 const binding=f.binding(),metadata={thread:{id:binding.threadId,cwd:f.cwd,turns:[]}},request={id:'old',method:'thread/resume',params:{threadId:binding.threadId,excludeTurns:true}};
 assert.equal(await f.domain.bindThread(binding,metadata),true);assert.equal(f.domain.executionDomain.beforeResumeWriteSync(binding,request),true);
 const reads={...f.reads};writeFileSync(f.file,'approval_policy = "on-request"\n');f.config.config.approval_policy='on-request';
 assert.equal(f.domain.verifyProjectSync(f.scope),false);for(let i=0;i<3;i++){f.domain.getRevisionSync();f.domain.verifyCurrentSync(f.scope);}
 assert.deepEqual(f.reads,reads);assert.equal(await f.domain.revalidateProject(f.scope,f.control({expectedRevision:{}})),null);assert.equal(f.domain.getRevisionSync(),old);
 const next=await f.domain.revalidateProject(f.scope,f.control());assert.notEqual(next,old);assert.equal(next,f.domain.getRevisionSync());assert.equal(f.domain.verifyProjectSync(f.scope),true);
 assert.deepEqual(f.reads,{config:reads.config+2,requirements:reads.requirements+2});assert.equal(heldFileCount(f.file),1);
 assert.equal(f.domain.executionDomain.observeResumeReplySync(binding,request,{id:request.id,result:{...metadata,cwd:f.cwd,model:'own',modelProvider:'own',approvalPolicy:'never',approvalsReviewer:'user',sandbox:{type:'readOnly'}}}),false);
 assert.equal(f.domain.getAttestationSync(binding),null);assert.equal(await f.domain.bindThread(binding,metadata),false);
 const fresh=f.binding();assert.equal(await f.domain.bindThread(fresh,{thread:{id:fresh.threadId,cwd:f.cwd,turns:[]}}),true);
 f.domain.retireView(fresh.viewId);assert.equal(await f.domain.bindThread(fresh,{thread:{id:fresh.threadId,cwd:f.cwd,turns:[]}}),false);
});
test('in-flight bind cannot cross proof revision and its client ID cannot be reused',async t=>{
 const f=await revisionFixture(t),entered=deferred(),release=deferred(),original=f.source.readProjectConfig;let hold=true;
 f.source.readProjectConfig=async cwd=>{if(hold){hold=false;entered.resolve();await release.promise;}return original(cwd);};
 const binding=f.binding(),metadata={thread:{id:binding.threadId,cwd:f.cwd,turns:[]}},pending=f.domain.bindThread(binding,metadata);await entered.promise;
 assert.notEqual(await f.domain.revalidateProject(f.scope,f.control()),null);release.resolve();assert.equal(await pending,false);
 assert.equal(await f.domain.bindThread(binding,metadata),false);assert.equal(heldFileCount(f.file),1);
});
test('in-flight created receipt cannot cross revision, even when same files remain current',async t=>{
 const f=await revisionFixture(t),entered=deferred(),release=deferred(),binding=f.binding(),metadata={thread:{id:binding.threadId,cwd:f.cwd,turns:[]}},issuedRevision=f.domain.getRevisionSync();
 const view={viewId:f.scope.viewId},authority=createSharedThreadCreationAuthority({verifyProjectSync:s=>f.domain.getRevisionSync()===issuedRevision&&f.domain.verifyProjectSync(s),getOwnedView:()=>view,verifyOwnedViewSync:()=>true,verifyExplicitIntentSync:()=>true});t.after(()=>authority.close());
 const frame={id:'create-before-refresh',method:'thread/start',params:{cwd:f.cwd}},reply={id:frame.id,result:{...metadata,cwd:f.cwd,model:'own',modelProvider:'own',approvalPolicy:'never',approvalsReviewer:'user',sandbox:{type:'readOnly'}}};
 authority.registerCreate({...f.scope,creationNonce:randomUUID()},frame,{signal:new AbortController().signal,deadline:performance.now()+10000});authority.beforeWriteSync(frame);const receipt=authority.observeReplySync(frame,reply);
 f.source.readThreadMetadata=async()=>{entered.resolve();await release.promise;return metadata;};const pending=f.domain.bindCreatedThread(binding,receipt);await entered.promise;
 assert.notEqual(await f.domain.revalidateProject(f.scope,f.control()),null);release.resolve();assert.equal(await pending,false);assert.equal(f.domain.getAttestationSync(binding),null);
 assert.equal(await f.domain.bindCreatedThread(binding,receipt),false);
});
test('revalidation scope and server control are exact and invalid attempts do not rotate or read',async t=>{
 const f=await revisionFixture(t),revision=f.domain.getRevisionSync(),reads={...f.reads};let getterCalls=0;
 const controller=new AbortController();controller.abort();
 const cases=[
  [f.scope,f.control({signal:controller.signal})],[f.scope,f.control({deadline:performance.now()-1})],[f.scope,f.control({deadline:performance.now()+31000})],
  [f.scope,f.control({verifyCurrentSync:()=>false})],[f.scope,{...f.control(),extra:true}],[{...f.scope,accountRevision:8},f.control({verifyCurrentSync:()=>true})],
  [{...f.scope,cwd:f.root},f.control({verifyCurrentSync:()=>true})],[{...f.scope,hostId:'local'},f.control({verifyCurrentSync:()=>true})],
  [{...f.scope,viewId:'unknown'},f.control({verifyCurrentSync:()=>true})],[{...f.scope,creationNonce:randomUUID()},f.control({verifyCurrentSync:()=>true})],
  [f.scope,Object.defineProperty({...f.control()},'expectedRevision',{get(){getterCalls++;return revision;}})],
  [Object.defineProperty({...f.scope},'cwd',{get(){getterCalls++;return f.cwd;}}),f.control({verifyCurrentSync:()=>true})],
 ];
 for(const[scope,control]of cases){assert.equal(await f.domain.revalidateProject(scope,control),null);assert.equal(f.domain.getRevisionSync(),revision);}
 assert.deepEqual(f.reads,reads);assert.equal(getterCalls,0);assert.equal(f.domain.verifyProjectSync(f.scope),true);
});
test('cancellation during native read closes candidates and never restores prior proof',async t=>{
 const f=await revisionFixture(t),entered=deferred(),release=deferred(),original=f.source.readProjectConfig,controller=new AbortController();let hold=true;
 f.source.readProjectConfig=async cwd=>{if(hold){hold=false;entered.resolve();await release.promise;}return original(cwd);};
 const old=f.domain.getRevisionSync(),pending=f.domain.revalidateProject(f.scope,f.control({signal:controller.signal}));await entered.promise;controller.abort();
 const result=await Promise.race([pending,new Promise((_,reject)=>setTimeout(()=>reject(Error('cancellation did not settle')),1000))]);
 assert.equal(result,null);assert.notEqual(f.domain.getRevisionSync(),old);assert.equal(f.domain.verifyProjectSync(f.scope),false);assert.equal(heldFileCount(f.file),0);
 release.resolve();await new Promise(done=>setImmediate(done));assert.equal(f.domain.verifyProjectSync(f.scope),false);
 assert.notEqual(await f.domain.revalidateProject(f.scope,f.control()),null);assert.equal(f.domain.verifyProjectSync(f.scope),true);
});
test('deadline while read is pending is bounded, revokes old proof and does not retry',async t=>{
 const f=await revisionFixture(t),entered=deferred(),release=deferred(),original=f.source.readProjectConfig;let reads=0;
 f.source.readProjectConfig=async cwd=>{reads++;entered.resolve();await release.promise;return original(cwd);};
 const pending=f.domain.revalidateProject(f.scope,f.control({deadline:performance.now()+100}));await entered.promise;
 assert.equal(await Promise.race([pending,new Promise((_,reject)=>setTimeout(()=>reject(Error('deadline did not settle')),1000))]),null);
 assert.equal(f.domain.verifyProjectSync(f.scope),false);assert.equal(reads,1);release.resolve();assert.equal(heldFileCount(f.file),0);
});
test('account or server-owned view change after a native read fails closed',async t=>{
 for(const reason of ['account','view'])await t.test(reason,async t=>{
  const f=await revisionFixture(t),original=f.source.readProjectConfig;let viewCurrent=true;
  f.source.readProjectConfig=async cwd=>{const value=await original(cwd);if(reason==='account')f.setAccount(8);else viewCurrent=false;return value;};
  const requirements=f.reads.requirements;
  assert.equal(await f.domain.revalidateProject(f.scope,f.control({verifyCurrentSync:()=>viewCurrent})),null);
  assert.equal(f.domain.verifyProjectSync(f.scope),false);assert.equal(f.reads.requirements,requirements);assert.equal(heldFileCount(f.file),0);
 });
});
test('unstable configuration between refreshed reads closes all proofs and stays denied',async t=>{
 const f=await revisionFixture(t),original=f.source.readProjectConfig;let reads=0;
 f.source.readProjectConfig=async cwd=>{const value=await original(cwd);if(++reads===2)value.config.unknown_native_field.enabled=false;return value;};
 assert.equal(await f.domain.revalidateProject(f.scope,f.control()),null);assert.equal(f.domain.verifyProjectSync(f.scope),false);assert.equal(heldFileCount(f.file),0);
 f.source.readProjectConfig=original;assert.equal(f.domain.verifyProjectSync(f.scope),false);
});
test('explicit refresh recaptures every fixed root and closes old file descriptors',async t=>{
 const f=fixture(t),second=join(f.root,'second-project');mkdirSync(second,0o775);let reads=0,requirements=0;
 f.source.readProjectConfig=async cwd=>{assert.ok([f.cwd,second].includes(cwd));reads++;return structuredClone(f.config);};f.source.readRequirements=async()=>{requirements++;return{requirements:null};};
 const runtimeGeneration=randomUUID(),daemonGeneration=randomUUID(),domain=await createPreservedNativeExecutionDomain({source:f.source,projects:[{projectId:'one',cwd:f.cwd},{projectId:'two',cwd:second}],runtimeGeneration,daemonGeneration,getAccountRevision:()=>0});t.after(()=>domain.close());
 const scope={hostId:'kanban-shared-cli',runtimeGeneration,daemonGeneration,accountRevision:0,projectId:'one',cwd:f.cwd,viewId:randomUUID()},before={reads,requirements};
 writeFileSync(f.file,'approval_policy = "on-request"\n');assert.equal(domain.verifyCurrentSync(scope),false);
 assert.notEqual(await domain.revalidateProject(scope,{signal:new AbortController().signal,deadline:performance.now()+10000,verifyCurrentSync:()=>true,expectedRevision:domain.getRevisionSync()}),null);
 assert.deepEqual({reads,requirements},{reads:before.reads+4,requirements:before.requirements+4});assert.equal(heldFileCount(f.file),2);assert.equal(domain.verifyProjectSync({...scope,projectId:'two',cwd:second}),true);
});
test('close during pending explicit revalidation cannot publish a later proof',async t=>{
 const f=await revisionFixture(t),entered=deferred(),release=deferred(),original=f.source.readProjectConfig;
 f.source.readProjectConfig=async cwd=>{entered.resolve();await release.promise;return original(cwd);};
 const pending=f.domain.revalidateProject(f.scope,f.control());await entered.promise;f.domain.close();
 assert.equal(await Promise.race([pending,new Promise((_,reject)=>setTimeout(()=>reject(Error('close did not settle')),1000))]),null);release.resolve();assert.equal(f.domain.verifyProjectSync(f.scope),false);assert.equal(heldFileCount(f.file),0);
});

test('domain captures configuration before account revision publication and binds only the later exact account scope',async t=>{
 const f=fixture(t),runtimeGeneration=randomUUID(),daemonGeneration=randomUUID();let accountRevision=null;
 const domain=await createPreservedNativeExecutionDomain({source:f.source,projects:[{projectId:'own',cwd:f.cwd}],runtimeGeneration,daemonGeneration,getAccountRevision:()=>accountRevision});t.after(()=>domain.close());
 assert.equal(domain.verifyCurrentSync(),true);const binding={hostId:'kanban-shared-cli',runtimeGeneration,daemonGeneration,accountRevision:1,projectId:'own',threadId:randomUUID(),viewId:randomUUID(),clientId:randomUUID()},metadata={thread:{id:binding.threadId,cwd:f.cwd,turns:[]}};
 assert.equal(await domain.bindThread(binding,metadata),false);accountRevision=1;assert.equal(await domain.bindThread(binding,metadata),true);
 accountRevision=2;assert.equal(domain.verifyCurrentSync(),true);assert.equal(domain.executionDomain.beforeResumeWriteSync(binding,{id:'wrong-old-account',method:'thread/resume',params:{threadId:binding.threadId,excludeTurns:true}}),false);
 assert.equal(domain.verifyProjectSync({...binding,cwd:f.cwd}),false);
});

test('native selected policy is attested for the created thread while CLI defaults and current proof remain unchanged',async t=>{
 const f=fixture(t),runtimeGeneration=randomUUID(),daemonGeneration=randomUUID(),viewId=randomUUID(),threadId=randomUUID(),view={viewId};
 const metadata={thread:{id:threadId,cwd:f.cwd,turns:[]}};f.source.readThreadMetadata=async()=>structuredClone(metadata);
 const domain=await createPreservedNativeExecutionDomain({source:f.source,projects:[{projectId:'own',cwd:f.cwd}],runtimeGeneration,daemonGeneration,getAccountRevision:()=>1});t.after(()=>domain.close());
 const scope={hostId:'kanban-shared-cli',runtimeGeneration,daemonGeneration,accountRevision:1,projectId:'own',cwd:f.cwd,viewId,creationNonce:randomUUID()},params={cwd:f.cwd,permissions:':read-only',approvalPolicy:'on-request',approvalsReviewer:'user',runtimeWorkspaceRoots:[f.cwd]},frame={id:'selected-create',method:'thread/start',params};
 assert.equal(domain.verifyPermissionSelectionSync(scope,params),true);assert.equal(domain.verifyPermissionSelectionSync(scope,{cwd:f.cwd,permissions:'unknown-profile'}),false);
 const authority=createSharedThreadCreationAuthority({verifyProjectSync:s=>domain.verifyProjectSync(s),verifyPermissionSelectionSync:(s,p)=>domain.verifyPermissionSelectionSync(s,p),getOwnedView:()=>view,verifyOwnedViewSync:()=>true,verifyExplicitIntentSync:()=>true});t.after(()=>authority.close());
 authority.registerCreate(scope,frame,{signal:new AbortController().signal,deadline:performance.now()+10000});authority.beforeWriteSync(frame);
 const receipt=authority.observeReplySync(frame,{id:frame.id,result:{...metadata,cwd:f.cwd,model:'own',modelProvider:'own',approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:{type:'readOnly',networkAccess:false},activePermissionProfile:{id:':read-only',extends:null},runtimeWorkspaceRoots:[f.cwd]}}),binding={hostId:scope.hostId,runtimeGeneration,daemonGeneration,accountRevision:1,projectId:'own',threadId,viewId,clientId:randomUUID()};
 assert.equal(await domain.bindCreatedThread(binding,receipt),true);const attested=domain.getAttestationSync(binding);assert.equal(attested.policyOrigin,'native-start-response');assert.equal(attested.permissionSelectionOrigin,'native-start-request');assert.match(attested.nativePermissionRequestDigest,/^[a-f0-9]{64}$/);
 assert.equal(f.config.config.approval_policy,'never');assert.equal(readFileSync(f.file,'utf8'),'approval_policy = "never"\n');
 writeFileSync(f.file,'approval_policy = "on-request"\n');assert.equal(domain.verifyPermissionSelectionSync(scope,params),false);assert.equal(domain.getAttestationSync(binding),null);
});
