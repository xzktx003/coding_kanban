import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,rmSync,renameSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,posix} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {isDeepStrictEqual} from 'node:util';
import {createPreservedNativeExecutionDomain} from '../src/shared-execution-domain-proof.mjs';
import {createSharedThreadCreationAuthority} from '../src/shared-thread-creation.mjs';
import {createSharedThreadArtifactAuthority} from '../src/shared-thread-artifacts.mjs';
const require=createRequire(import.meta.url);
const {canonicalizeOriginalSharedTurn}=require('../src/native-shared-thread-submission.cjs');
const {copySharedThreadSendFrame}=require('../src/shared-thread-send-schema.cjs');

async function fixture(t,{sandbox={type:'workspaceWrite',writableRoots:[],networkAccess:false,excludeSlashTmp:false,excludeTmpdirEnvVar:false},activePermissionProfile=null}={}){
 const root=mkdtempSync(join(tmpdir(),'shared-artifact-proof-'));chmodSync(root,0o700);t.after(()=>rmSync(root,{recursive:true,force:true}));
 const cwd=join(root,'project'),codexHome=join(root,'codex');mkdirSync(cwd,0o775);mkdirSync(codexHome,0o700);
 const file=join(codexHome,'config.toml');writeFileSync(file,'approval_policy = "never"\n',{mode:0o600});
 const layer={name:{type:'user',file,profile:null},version:'owned-v1',config:{approval_policy:'never'}};
 const config={config:{approval_policy:'never',mcp_servers:{}},origins:{approval_policy:{name:layer.name,version:layer.version}},layers:[layer]};
 const runtimeGeneration=randomUUID(),daemonGeneration=randomUUID(),threadId='01a1b84c-e2fe-7b90-b41a-a2b20a13b3ad',viewId=randomUUID();let live=true,accountRevision=1;
 const metadata={thread:{id:threadId,cwd,turns:[]}};
 const source={configurationProtocolVersion:'0.166.0',assertCurrent(){assert.equal(live,true);},async readProjectConfig(path){assert.equal(path,cwd);return structuredClone(config);},async readRequirements(){return{requirements:null};},async readThreadMetadata(id){assert.equal(id,threadId);return structuredClone(metadata);}};
 const domain=await createPreservedNativeExecutionDomain({source,codexHome,projects:[{projectId:'owned',cwd}],runtimeGeneration,daemonGeneration,getAccountRevision:()=>accountRevision});t.after(()=>domain.close());
 const scope={hostId:'kanban-shared-cli',runtimeGeneration,daemonGeneration,accountRevision,projectId:'owned',cwd,viewId,creationNonce:randomUUID()};
 const binding={hostId:scope.hostId,runtimeGeneration,daemonGeneration,accountRevision,projectId:'owned',threadId,viewId,clientId:randomUUID()};
 const view={viewId};
 const creation=createSharedThreadCreationAuthority({verifyProjectSync:s=>domain.verifyProjectSync(s),getOwnedView:()=>view,verifyOwnedViewSync:()=>true,verifyExplicitIntentSync:()=>true});t.after(()=>creation.close());
 const request={id:'owned-start',method:'thread/start',params:{cwd}},reply={id:request.id,result:{...metadata,cwd,model:'owned-model',modelProvider:'owned-provider',approvalPolicy:'never',approvalsReviewer:'user',sandbox,runtimeWorkspaceRoots:[cwd],activePermissionProfile}};
 creation.registerCreate(scope,request,{signal:new AbortController().signal,deadline:performance.now()+10000});creation.beforeWriteSync(request);
 assert.equal(await domain.bindCreatedThread(binding,creation.observeReplySync(request,reply)),true);
 return{root,cwd,codexHome,file,domain,binding,source,reply,config,stop(){live=false;},changeAccount(){accountRevision++;}};
}

test('only a real created binding derives its exact UUID date directory',async t=>{
 const f=await fixture(t),path=join(f.codexHome,'visualizations','2026','11','07',f.binding.threadId);
 assert.equal(typeof f.domain.getCreatedArtifactRootSync,'function');
 assert.equal(f.domain.getCreatedArtifactRootSync(f.binding),path);
 assert.equal(f.domain.authorizeCreatedArtifactRootSync(f.binding,path),true);
 for(const wrong of [f.codexHome,join(f.codexHome,'visualizations'),path+'/child',path.replace(f.binding.threadId,randomUUID()),path.replace('/2026/11/07/','/2026/11/06/')])assert.equal(f.domain.authorizeCreatedArtifactRootSync(f.binding,wrong),false);
 assert.equal(f.domain.authorizeCreatedArtifactRootSync({...f.binding,viewId:randomUUID()},path),false);
 f.changeAccount();assert.equal(f.domain.authorizeCreatedArtifactRootSync(f.binding,path),false);
});

function directoryAuthority(t,f){
 const same=value=>JSON.stringify(value)===JSON.stringify(f.binding)&&f.domain.getAttestationSync(value)!==null;
 const authority=createSharedThreadArtifactAuthority({codexHome:f.codexHome,projects:[{cwd:f.cwd}],verifyCurrentSync:()=>f.domain.verifyCurrentSync(f.binding),verifyReadSync:()=>f.domain.verifyCurrentSync(f.binding),verifyBindingSync:same,verifyHistorySync:same,
  authorizeDirectorySync:(binding,path)=>f.domain.authorizeCreatedArtifactRootSync(binding,path),onReceipt:(binding,receipt)=>f.domain.applyArtifactReceiptSync(binding,receipt)});
 t.after(()=>authority.close());authority.registerBinding(f.binding);return authority;
}
function turn(f,path){return{threadId:f.binding.threadId,approvalPolicy:'never',approvalsReviewer:'user',sandboxPolicy:{...f.reply.result.sandbox,writableRoots:[...f.reply.result.sandbox.writableRoots,path]},runtimeWorkspaceRoots:[f.cwd,path]};}
function materialize(authority,f,path,id='owned-directory'){
 const request={id,method:'fs/createDirectory',params:{path,recursive:true}};
 assert.equal(authority.beforeWriteSync(request),true);
 // This is the filesystem boundary of this unit fixture. Real CLI success
 // and OS errors are retained separately in native/contract.json, not claimed
 // as model acceptance by this test.
 mkdirSync(path,{recursive:true,mode:0o700});
 assert.equal(authority.observeReplySync(request,{id,result:{}}).status,'directory');
}

test('only a branded real-directory reply permits the exact original turn extension and repeated conversation',async t=>{
 const f=await fixture(t),path=f.domain.getCreatedArtifactRootSync(f.binding),params=turn(f,path);
 assert.equal(f.domain.verifyBoundPermissionSelectionSync(f.binding,params),false);
 assert.equal(f.domain.applyArtifactReceiptSync(f.binding,{}),false);
 const authority=directoryAuthority(t,f);materialize(authority,f,path);
 assert.equal(f.domain.verifyBoundPermissionSelectionSync(f.binding,params),true);
 assert.equal(f.domain.verifyBoundPermissionSelectionSync(f.binding,structuredClone(params)),true);
 assert.equal(f.domain.getAttestationSync(f.binding).policyOrigin,'native-start-response');
 assert.equal(f.domain.getAttestationSync(f.binding).artifactDirectoryOrigin,'native-fs-create-directory-response');
 // A same-thread follow-up still has the original send nonce/authority path;
 // the directory proof itself must neither consume nor manufacture that nonce.
 materialize(authority,f,path,'owned-follow-up-directory');
 assert.equal(f.domain.verifyBoundPermissionSelectionSync(f.binding,params),true);
 for(const changed of [
  {...params,approvalsReviewer:'auto_review'},
  {...params,approvalPolicy:'on-request'},
  {...params,sandboxPolicy:{...params.sandboxPolicy,networkAccess:true}},
  {...params,sandboxPolicy:{...params.sandboxPolicy,excludeSlashTmp:true}},
  {...params,sandboxPolicy:{...params.sandboxPolicy,writableRoots:[path+'/child']}},
  {...params,runtimeWorkspaceRoots:[path]},
  {...params,runtimeWorkspaceRoots:[f.cwd,path.replace(f.binding.threadId,randomUUID())]},
 ])assert.equal(f.domain.verifyBoundPermissionSelectionSync(f.binding,changed),false);
 assert.equal(f.domain.verifyBoundPermissionSelectionSync({...f.binding,clientId:randomUUID()},params),false);
});

test('directory replacement, config drift and view/account retirement cannot retain artifact permissions',async t=>{
 const f=await fixture(t),path=f.domain.getCreatedArtifactRootSync(f.binding),params=turn(f,path),authority=directoryAuthority(t,f);
 materialize(authority,f,path);assert.equal(f.domain.verifyBoundPermissionSelectionSync(f.binding,params),true);
 renameSync(path,path+'-old');mkdirSync(path,{mode:0o700});
 assert.equal(f.domain.verifyBoundPermissionSelectionSync(f.binding,params),false);
 f.domain.retireView(f.binding.viewId);assert.equal(f.domain.authorizeCreatedArtifactRootSync(f.binding,path),false);
 const other=await fixture(t),otherPath=other.domain.getCreatedArtifactRootSync(other.binding),otherAuthority=directoryAuthority(t,other);materialize(otherAuthority,other,otherPath);
 writeFileSync(other.file,'approval_policy = "on-request"\n');assert.equal(other.domain.verifyBoundPermissionSelectionSync(other.binding,turn(other,otherPath)),false);
 const account=await fixture(t),accountPath=account.domain.getCreatedArtifactRootSync(account.binding),accountAuthority=directoryAuthority(t,account);materialize(accountAuthority,account,accountPath);
 account.changeAccount();assert.equal(account.domain.verifyBoundPermissionSelectionSync(account.binding,turn(account,accountPath)),false);
});

test('read-only and external native policies never authorize artifact writes',async t=>{
 for(const sandbox of [{type:'readOnly',networkAccess:false},{type:'externalSandbox',networkAccess:'restricted'}]){
  const f=await fixture(t,{sandbox});assert.equal(f.domain.getCreatedArtifactRootSync(f.binding),null);
  assert.equal(f.domain.authorizeCreatedArtifactRootSync(f.binding,join(f.codexHome,'visualizations','2026','11','07',f.binding.threadId)),false);
 }
});

test('actual built-in workspace and full-access selections retain their profile and exact runtime roots',async t=>{
 for(const setup of [{activePermissionProfile:{id:':workspace',extends:null}},{sandbox:{type:'dangerFullAccess'},activePermissionProfile:{id:':danger-full-access',extends:null}}]){
  const f=await fixture(t,setup),path=f.domain.getCreatedArtifactRootSync(f.binding),authority=directoryAuthority(t,f);
  const params={threadId:f.binding.threadId,approvalPolicy:'never',approvalsReviewer:'user',permissions:setup.activePermissionProfile.id,runtimeWorkspaceRoots:[f.cwd,path]};
  assert.equal(f.domain.verifyBoundPermissionSelectionSync(f.binding,params),false);
  materialize(authority,f,path);assert.equal(f.domain.verifyBoundPermissionSelectionSync(f.binding,params),true);
  assert.equal(f.domain.verifyBoundPermissionSelectionSync(f.binding,{...params,permissions:':read-only'}),false);
  f.stop();assert.equal(f.domain.verifyBoundPermissionSelectionSync(f.binding,params),false);
 }
});

const originalDirectory=process.env.CHATGPT_SHARED_I2_ORIGINAL_DIR;
const nativeModuleDirectory=process.env.CHATGPT_DESKTOP_NATIVE_OPTIONS_MODULE_DIR;
const originalPins=Object.freeze({"helper-CC.js":"0abd1449f67d22212e5e27db4ad9a80a04121f76d6b633367b7adbc9a3f6619e","helper-IY.js":"df71512ab54ebde02973a335db914053ec4f63052ffb4ccc3c8de662aa4b9c20","helper-I4.js":"64eabc86eb00ac0c63da7306eeefb9da519b0fca1d490daf21c1b006b3ba489a","helper-kQ.js":"592970f531dc15c8625781d70096273ee93e819ecbbb66ee59f1ce090d4661e5","helper-CS.js":"6c13939da73a64ecced829723c0709aaa44790d0f16cee2e3b54beb1bbc0ad06","helper-IN.js":"70845504e3858f71e3eee4b0d2a16cf0655e578f064848dfe2c3f2cfa26843dd","helper-Cb.js":"1edba617ed87c4c4469a98e28fe45430ff6dac164968f3d3252cb5abc1f1a18c","helper-kZ.js":"127de0a27c1d54d956f326deac717bc24c0eadb64810148fc52fd710e9d31c60","helper-I0.js":"c80ec29b8a655faba31200a973781102d4cd017461c2a7b162b563553c3eaea5","helper-CI.js":"eda12f9010a3b9ad1c30f863d7b45cee51925dbcf198963f02b6028b8ec6e280","helper-IK.js":"c771a7ccc4e0c81f5efc9f99108a27a75242cbc1bd1b1e9cf34793a13f49f1f0","helper-Ck.js":"0fac41106fa7a44a364a2e9ec0993c9237fb91ab57874e9436dfc46038f0a6f9","helper-I3.js":"56dd558e876de3e60bda28fe9745f26df1c41f2a1397a8e471074e15ce84ddae","helper-kN.js":"c28e490e14d6a36bfadca5b3a37f529af24df52ac1998bca8830e564115b83ae","helper-Cv.js":"922477c927f849681467be66386662a1de8b5d0777c4938d0b6b71b2ac03aef8","helper-I2.js":"8d25777e6dae55b732b0390ba04fffd6a95c2efcf5f69a5ac236a77323097318","helper-Cy.js":"3b8b67af9b2878e088c69aadd8772209efa0ba519d302a2153c724a32eb31e28","helper-kY.js":"281c4ea0d0272526ec29aab76c92dfff57834c90309c773414c75e109ed9efbc","module-38591.js":"c910e3547b9d8989511f44505d778eb1e14f79c8286650bd6b06e6ad699266ae","getVisualizationRoot.js":"67d15db99f62f733fda636be6eed64e4631045ad618d6a3bc3af8b48ce6a0420","getOptionalWritableRoots.js":"f96e3de6c451b022a404c60103fd5ae103045067c81f76e26e8227c06b00a723","rt-sendMessage.js":"04d0ab608dd0b94567b439f7405c14af40e8e47a2119d8896ebd9935e1df98aa","rG.js":"8507f7540048bfe9a7477a849c735b208816db41efbf31ab9c81cd29050554b9"});
function originalNativeHelpers(){
 const load=name=>{const source=readFileSync(join(originalDirectory,name),'utf8');assert.equal(createHash('sha256').update(source).digest('hex'),originalPins[name]);return source;};
 const unused=()=>{throw Error('Unselected original service boundary was invoked');};
 const source=readFileSync(join(nativeModuleDirectory,'module-61082.js'),'utf8');
 assert.equal(createHash('sha256').update(source).digest('hex'),'22f5d84f9638f71bf8cdb2cd9edff2be13db7c9c015c7530e7d43b0379dcfb73');
 const permissionExports={},factory=new Function(`return ${source}`)()[61082];
 const moduleRequire=id=>id===86439?{y:unused}:[44814,8857].includes(id)?unused:unused();
 moduleRequire.n=value=>()=>value;moduleRequire.d=(target,exports)=>{for(const[key,get]of Object.entries(exports))Object.defineProperty(target,key,{get,enumerable:true});};
 factory({exports:permissionExports},permissionExports,moduleRequire);
 const dateExports={},dateFactory=new Function(`return ({${load('module-38591.js')}})[38591]`)(),dateRequire=id=>id===44663?posix:{};
 dateRequire.n=moduleRequire.n;dateRequire.d=moduleRequire.d;dateFactory({},dateExports,dateRequire);
 const v4={xE:posix.join,tI:()=>false,zj:()=>false,JH:value=>value,Pw:(a,b)=>a===b};
 const builder=new Function('to','vP','v4',`return (${load('getVisualizationRoot.js')})`)(()=>({workspaceDir:false}),dateExports,v4);
 const names=['I2','I3','I4','IY','CI','Cv','Cb','Cy','CS','Ck','CC','kQ','kY','kZ','IN','I0','IK','kN'];
 // Empty native history, unchanged workspace observation and null requirements
 // are service boundaries. The original permission/root/input functions remain
 // byte-for-byte fixed. No model or native account connection is created.
 const boundaries={yA:permissionExports,v4,kH:{m2:'/'},wT:()=>null,IB:async()=>null,Ij:{W:'auto'},I1:'explicitRequestOnly',ro:{JF:()=>true},Cn:unused,k8:async tier=>tier??null,kO:{parse:value=>value},IV:new Set(),I5:unused,I6:unused,IX:unused,IZ:unused};
 const prepare=new Function(...Object.keys(boundaries),names.map(name=>load('helper-'+name+'.js')).join('\n')+'\nreturn I2;')(...Object.values(boundaries));
 const optional=(threadId)=>new Function('a',`return ({${load('getOptionalWritableRoots.js')}}).getOptionalWritableRoots`)({hasDesktopRuntime:true,getVisualizationRoot:(workspaces,codex)=>builder(workspaces,threadId,codex)});
 const sendMessage=new Function('nc','q','n9','nQ','Buffer',`return ({${load('rt-sendMessage.js')}}).sendMessage`)({}, {iwv:'local',V57:'local'},()=>({}),()=>false,Buffer);
 const Prewarm=new Function(`${load('rG.js')};return rG;`)();
 function wire(frame,binding){let encoded;const prewarm=new Prewarm();
  const runtime={options:{hostId:'kanban-shared-cli',hostKind:'remote',getConnection:()=>({send:text=>{assert.equal(encoded,undefined);encoded=text;}}),transformOutgoingMessage:value=>prewarm.prepare(canonicalizeOriginalSharedTurn(value,binding)),logger:{debug(){},trace(){}}},outgoingMessageSizeTracker:{track:()=>[]},rememberSharedThread(){}};
  sendMessage.call(runtime,frame);assert.equal(typeof encoded,'string');return JSON.parse(encoded);
 }
 return{prepare,optional,wire};
}

test('fixed complete original I2 and SDK serializer preserve first and continued turns, while read-only/external skip artifact IO',{skip:!originalDirectory||!nativeModuleDirectory?'Requires explicitly supplied pinned original native functions and permission module':false},async t=>{
 const original=originalNativeHelpers();
 for(const setup of [
  {sandbox:{type:'readOnly',networkAccess:false},activePermissionProfile:{id:':read-only',extends:null}},
  {sandbox:{type:'externalSandbox',networkAccess:'restricted'}},
  {sandbox:{type:'workspaceWrite',writableRoots:[],networkAccess:false,excludeSlashTmp:false,excludeTmpdirEnvVar:false},activePermissionProfile:{id:':workspace',extends:null}},
  {sandbox:{type:'dangerFullAccess'},activePermissionProfile:{id:':danger-full-access',extends:null}},
 ]){
  const f=await fixture(t,setup),path=f.domain.getCreatedArtifactRootSync(f.binding),authority=path?directoryAuthority(t,f):null,calls=[];
  let state={cwd:f.cwd,mode:'normal',workspaceKind:'project',turns:[],currentPermissions:{approvalPolicy:'never',approvalsReviewer:'user',sandboxPolicy:setup.sandbox,activePermissionProfile:setup.activePermissionProfile??null,runtimeWorkspaceRoots:[f.cwd]}};
  const capabilities={canUseProjectlessWorkspace:false,canMaterializeHostRoots:true,latestUseAppServerPermissionDefault:false,preserveWorkspaceSandboxPolicyWithDefault:false,getOptionalWritableRoots:original.optional(f.binding.threadId),getRequiredWritableRoots:()=>[],getRequestCollaborationMode:value=>value,getRequestModel:value=>value,isSamePath:(a,b)=>a===b,shouldShowModelChange:()=>false};
  const manager={isCloudHost:false,getThreadWorkspaceState:()=>null,async getThreadWritableRoots(){return[f.cwd];},async getCodexHome(){calls.push('codex-home');return f.codexHome;},async getWorkspacesRoot(){calls.push('workspaces-root');return join(f.root,'workspaces');},async ensureDirectory(requested){assert.ok(authority);assert.equal(requested,path);materialize(authority,f,path,'owned-original-I2-directory-'+calls.length);calls.push('mkdir');},requestClient:{getAppServerVersion:()=> '0.166.0'},logger:{info(){},warning(){}}};
  for(let round=0;round<2;round++){
   const config=state.currentPermissions;
   const request={input:[{type:'text',text:'owned original I2 message '+round}],model:'owned-model',approvalPolicy:config.approvalPolicy,approvalsReviewer:config.approvalsReviewer,summary:'auto',personality:'none',...(config.activePermissionProfile?.id?{permissions:config.activePermissionProfile.id,runtimeWorkspaceRoots:config.runtimeWorkspaceRoots}:{sandboxPolicy:config.sandboxPolicy})};
   const result=await original.prepare(manager,f.binding.threadId,{request,context:{useAppServerPermissionDefault:false,inheritThreadSettings:false}},randomUUID(),null,state,capabilities);
   const frame=original.wire({id:'owned-original-I2-turn-'+round,method:'turn/start',params:result.request},f.binding);
   const validated=copySharedThreadSendFrame(frame,f.binding);
   assert.equal(f.domain.verifyBoundPermissionSelectionSync(f.binding,validated.params),true);
   assert.deepEqual(validated.params.responsesapiClientMetadata,{workspace_kind:'project'});assert.equal(validated.params.summary,'auto');assert.equal(validated.params.personality,'none');
   assert.deepEqual(validated.params.input,request.input);assert.equal(validated.params.permissions,result.request.permissions);
   assert.deepEqual(validated.params.runtimeWorkspaceRoots,result.request.runtimeWorkspaceRoots);
   assert.deepEqual(validated.params.sandboxPolicy,result.request.sandboxPolicy);
   state={...state,currentPermissions:result.permissions};
  }
  if(path)assert.equal(calls.filter(value=>value==='mkdir').length,2);else{assert.deepEqual(calls,[]);assert.equal(state.currentPermissions.sandboxPolicy.type,setup.sandbox.type);}
 }
});

test('generated metadata is snapshotted and constrained without losing native search restrictions',()=>{
 const binding={threadId:randomUUID()},context={mode:'cached',is_web_access_restricted:true,session_persistent:true,allowed_domains:['example.invalid']};
 const metadata={workspace_kind:'project',mcp_request_meta:JSON.stringify({'openai/search_context':JSON.stringify(context)})};
 const frame={id:'owned-metadata',method:'turn/start',params:{threadId:binding.threadId,input:[{type:'text',text:'owned metadata contract'}],summary:'none',personality:'pragmatic',responsesapiClientMetadata:metadata}};
 const copied=copySharedThreadSendFrame(frame,binding);assert.deepEqual(copied.params.responsesapiClientMetadata,metadata);metadata.workspace_kind='projectless';assert.equal(copied.params.responsesapiClientMetadata.workspace_kind,'project');assert.equal(Object.isFrozen(copied.params.responsesapiClientMetadata),true);
 for(const bad of [{workspace_kind:'other'},{workspace_kind:'project',unknown:'not silently dropped'},{workspace_kind:'project',mcp_request_meta:'{}'},{workspace_kind:'project',mcp_request_meta:JSON.stringify({'openai/search_context':JSON.stringify({...context,extra:true})})}])assert.throws(()=>copySharedThreadSendFrame({...frame,params:{...frame.params,responsesapiClientMetadata:bad}},binding));
 assert.throws(()=>canonicalizeOriginalSharedTurn({...frame,params:{...frame.params,outputSchema:{}}},binding));
 assert.throws(()=>canonicalizeOriginalSharedTurn({...frame,params:{...frame.params,cwd:'/different-cwd'}},binding));
});

const runtimeOriginalDirectory=process.env.CHATGPT_SHARED_RUNTIME_ORIGINAL_DIR;
function originalComposerMetadata(value){
 const source=readFileSync(join(runtimeOriginalDirectory,'OTs.js'),'utf8');assert.equal(createHash('sha256').update(source).digest('hex'),'19e9d98e08e04a2d9b8baf42c8cae99435e604340653b5b791f8ec6d27121287');
 return new Function(source+';return OTs;')()(value);
}
async function originalNativeInstallationId(){
 const read=(name,pin)=>{const source=readFileSync(join(runtimeOriginalDirectory,name),'utf8');assert.equal(createHash('sha256').update(source).digest('hex'),pin);return source;};
 const current=read('getCurrentOwner.js','49c4969d748ed67738b43012f7a761ec7092b8888e0bc2da8d93f0b6bfe32ede'),check=read('checkOwner.js','0c8a3214ac5c87e0778c3fd0cf4390cb8580acd4532c411b03932b23404b12e8');
 const key=Symbol('owned-installation-state'),store=new Map(),principal={accountId:'owned-account',userId:'owned-user'};let flushes=0;
 const methods=new Function('at','tb',`return ({${current},${check}});`)({K6:key},{randomUUID});
 const service={...methods,globalState:{get:name=>store.get(name),set:(name,value)=>store.set(name,value),flushOrThrow:async()=>{flushes++;}},appServerClient:{getAuthenticatedPrincipal:async()=>principal},isRolloutEnabled:()=>true};
 const first=await service.getCurrentOwner(principal),second=await service.getCurrentOwner(principal);assert.equal(first.installationId,second.installationId);assert.equal(flushes,1);assert.match(first.installationId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 return first.installationId;
}
const runtimePins={"rk.js": "496f212ab32054b13df7ef646b1f9399a14de5ccac9cf6d02e1d0f01d5110c3e", "Rq.js": "316e08abddf55dea8415d713e981fe96799c24b1ff63cbedc62ff4f3af2e44db", "xZ.js": "43145d7d0c35135dae730656a0286ede8313ca1b716ae1afb2e2acf7ad0ac8e6", "x9.js": "65e19295e723d38278328b9605e751eda6c50586e9746b7c93593132b856961e", "runtime-prepareTurnRequest.js": "1422cdb723c5858745e8cf5099940740e8a046f8aeab2215c60296f2bbe3b08a", "r7-startTurn.js": "cc3a6945578f121250b66002531f4669d9e17adf4ab8b77e210e007915e4781b", "nw.js": "63b660190add9656014094647a7e55b51307c855281ca5ff04dec3e753b5ec33", "module-12213.js": "46c2caf3816f8a14036eb2ae688be038f8bd883f850f9a1ffc5fe464f8cc8409", "x8.js": "cf644f743831f52ab19ba2acce0a7289ef96f1522127f14c113eadb891a77713", "rC.js": "b589ac322b5a5e23ef219c723c762131bc336cbde77798e66ff3cff3d28eab52", "rx.js": "327dabab7ca4ad85804a57fe205260a8f7505123524855b5c3377144dda210a1", "module-82242.js": "06df1ffcd5717cf91cd8c885dbc86bf88f510885e03d5e4e460d2a7bbb38085d", "RL.js": "c8f28e42a5c53208e1effb956852b58472f3d36685489f79bd24726160365c18", "automation-startTurn.js": "248b1f5bea803396ca883dc15e5ba7250cc2ceb32d18971f9550663fa1b6732d", "Rj.js": "a5c3551de15f2637eba64d388d16a64bb1135a5a06e9e3422d41753ae6882815", "outer-prepareTurnRequest.js": "1818b1951cff645a64ca2b4c5ff33432611a526441e5605c1b5acf1d0e737915"};
function originalEmptyPageContext(){
 const read=(name,pin)=>{const source=readFileSync(join(runtimeOriginalDirectory,name),'utf8');assert.equal(createHash('sha256').update(source).digest('hex'),pin);return source;};
 const recognizer=read('module-72837.js','7cf85ea4d0ee55498cc9df30762394076016b3a6b493a7e05d77a227e406ddd4');
 const literal=JSON.parse(/&&("The codex_apps_open_page context records[^"]+")===t\.value/.exec(recognizer)[1]);
 const exports={},requireModule={d:(target,properties)=>{for(const[key,get]of Object.entries(properties))Object.defineProperty(target,key,{get});}};
 new Function(`return ({${recognizer}})[72837]`)()({},exports,requireModule);
 const context=read('context-9d08e6ee1d48.js','bfac92086ceb49237a3c710ec567f10b0d44d37e6fab6035230b6953297d67b9');
 const skillGate=Symbol('owned-page-skills-enabled'),skillExperiment=Symbol('owned-page-skills-experiment');
 const pageSkills=new Function('t','n',context.slice(context.indexOf('function s(e)'),context.indexOf('function c()'))+';return s;')(skillGate,skillExperiment);
 const source=read('open-page-context-e2c011af9d74.js','d7da86a1df72f76e9a5eafe6a268f4c2f1bfd014ded6da469188f484d066814b');
 const atoms=Object.fromEntries(['o','d','s','c','x','l','C','v'].map(name=>[name,Symbol(name)]));
 const unavailable=()=>{throw Error('A page data service must not run for the original empty-page branch');};
 const visiblePane=(_state,visibility)=>{assert.deepEqual(visibility,{right:false,bottom:false});return null;};
 const constructor=new Function('t','E','o','d','s','T','c','h','a','u','b','x','l','C','v','_',source.slice(source.indexOf('function O(e,t)'),source.indexOf('function A()'))+';return k;')
  (literal,pageSkills,atoms.o,atoms.d,atoms.s,visiblePane,atoms.c,unavailable,{safeParse:unavailable},unavailable,unavailable,atoms.x,atoms.l,atoms.C,atoms.v,unavailable);
 // Scope/account/visible-pane readers are owned service boundaries. Both actual
 // k/O and the actual E dependency execute unchanged; no Page exists here.
 const navigation={pathname:'/owned',routeKind:'home'},values=new Map([[atoms.l,'owned-account'],[atoms.C,false],[atoms.v,navigation],[atoms.o,false],[atoms.d,false],[skillGate,false]]);
 const scope={value:{kind:'new',entrypoint:'home'},getOwnValue(atom){assert.equal(atom,atoms.x);return navigation;},get(atom){return values.get(atom);}};
 const result=constructor(scope,{navigation:'foreground',literalPrompt:false});assert.equal(exports.OQ(result),true);
 assert.equal(createHash('sha256').update(Object.keys(result).sort().join('\0')).digest('hex'),'e66ca9ed3ec3ff0693efbff739eae4befc93f9c5eecd1915389ddfe362da3f18');
 return result;
}
function originalRuntimeAndTurn(){
 const load=name=>{const source=readFileSync(join(runtimeOriginalDirectory,name),'utf8');assert.equal(createHash('sha256').update(source).digest('hex'),runtimePins[name]);return source;};
 const Rq=new Function(load('Rq.js')+';return Rq;')();
 const prepare=(u)=>new Function('u','RN','Rq',`return ({${load('runtime-prepareTurnRequest.js')}}).prepareTurnRequest`)(u,'Etc/UTC',Rq);
 const dto={},moduleRequire=id=>{assert.equal(id,71415);return{JF:()=>true};};
 moduleRequire.d=(target,exports,values)=>{for(const[key,get]of Object.entries(exports))Object.defineProperty(target,key,{get,enumerable:true});Object.assign(target,values);};
 new Function(`return ({${load('module-12213.js')}})[12213]`)()({exports:dto},dto,moduleRequire);
 // nv is the SDK's record(string, unknown) library boundary. Keep its object
 // check active: an absent dependency would be swallowed by original nw's
 // deliberate best-effort catch and silently skip the non-null ID branch.
 const nw=new Function('nv',load('nw.js')+';return nw;')({parse(value){assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value;}});
 const startTurn=new Function('nR','nw','t5',`return ({${load('r7-startTurn.js')}}).startTurn`)(dto,nw,value=>value);
 const automationStartTurn=new Function('eu',`return ({${load('automation-startTurn.js')}}).startTurn`)({randomUUID});
 const rk=new Function(load('rk.js')+';return rk;')();
 const rC=new Function(load('rC.js')+';return rC;')();
 const rx=new Function('rC',load('rx.js')+';return rx;')(rC);
 const x9=new Function('rx','rC',load('x9.js')+';return x9;')(rx,rC);
 const x8=new Function('x3','ro','ra','rk','x4','x9',load('x8.js')+';return x8;')('local',{JF:()=>true},()=>isDeepStrictEqual,rk,Symbol('owned-retry'),x9);
 const xZ=new Function('wx','w6','ra',load('xZ.js')+';return xZ;')(value=>value.turns?.at(-1)??null,()=>false,()=>isDeepStrictEqual);
 const escapeExports={};new Function(`return ({${load('module-82242.js')}})[82242]`)()(escapeExports,{},id=>id===94834?(value=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value])):id===33265?(value=>String(value)):(()=>{throw Error('Unknown original escape dependency');})());
 const Rj=new Function('RF',load('Rj.js')+';return Rj;')(()=>escapeExports.exports);
 const RL=new Function('el','xZ','RM','Rj','m2','Ri',load('RL.js')+';return RL;')({ZJQ:()=>false,DIv:value=>value,NCC:()=>({version:'26.1027.51404'})},xZ,{q:async()=>({status:'complete',capturedAt:new Date().toISOString(),worktreeId:'1'.repeat(40),headCommitSha:'2'.repeat(40),branch:'feature/owned&git',detached:false,upstream:null,remotes:[{name:'origin',fetchUrl:'https://example.invalid/owned/repository.git'}],remotesOmitted:0})},Rj,()=>((array,predicate)=>array.findIndex(predicate)),{y:()=> 'owned-version'});
 return{startTurn,automationStartTurn,applyInstallationMetadata:nw,async prepareOuter(manager,threadId,request,assertCurrent){
  let authListeners=0;const identity={accountId:'owned-account',userId:'owned-user'};
  const daybreakManager={...manager,getHostId:()=> 'kanban-shared-cli',getConversation:()=>({mode:'default',threadSource:'user',latestModel:'owned-model'}),getAuthMethod:async()=> 'chatgpt',addAuthStatusCallback(){authListeners++;},removeAuthStatusCallback(){authListeners--;}};
  const daybreak={isDesktop:true,appServerVersion:'0.166.0',readIdentity:()=>identity,featureEnabled:()=>true,modelAccessEnabled:()=>true,readModels:async()=>({data:[{model:'owned-model',hidden:false,availableAccessPrograms:{cyber:['standard']}}]})};
  const inner=prepare(async(_thread,params)=>{const program=await x8(daybreak,daybreakManager,threadId,params,{releaseEnabled:true,bestEffort:false,isChild:false});assert.equal(program,'standard','original x8/x9/rC select the catalog-declared normal program with feature gates on');assert.equal(authListeners,0);return{...params,cyberAccessProgram:program};});
  const settings={hostId:'kanban-shared-cli',executionHost:{owned:true},connection:{appServerVersion:'0.166.0'},assertCurrent,evaluations:{readExecutionAssignments:async()=>({values:{gitContext:true}}),readReadyExecutionAssignments:()=>({values:{gitContext:true}})}};
  const outer=new Function('x','RL','T','e','g',`return ({${load('outer-prepareTurnRequest.js')}}).prepareTurnRequest`)({prepareTurnRequest:inner},RL,manager,settings,{signal:new AbortController().signal});
  return outer(threadId,request,{});
 }};
}

test('fixed original composer metadata Page constructor I2 outer runtime cyber git and r7 DTO serialization survive staged first and continued sends',{skip:!originalDirectory||!nativeModuleDirectory||!runtimeOriginalDirectory?'Requires supplied pinned native input, permission, and runtime/SDK functions':false},async t=>{
 const original=originalNativeHelpers(),runtime=originalRuntimeAndTurn(),pageContext=originalEmptyPageContext(),installationId=await originalNativeInstallationId(),role={role:'owner'};
 const sandbox={type:'workspaceWrite',writableRoots:[],networkAccess:false,excludeSlashTmp:false,excludeTmpdirEnvVar:false};
 const f=await fixture(t,{sandbox,activePermissionProfile:{id:':workspace',extends:null}}),path=f.domain.getCreatedArtifactRootSync(f.binding),authority=directoryAuthority(t,f);
 let state={cwd:f.cwd,mode:'normal',workspaceKind:'project',turns:[],searchMcpContext:{mode:'cached',is_web_access_restricted:true,session_persistent:false,allowed_domains:['owned.example.invalid']},currentPermissions:{approvalPolicy:'never',approvalsReviewer:'user',sandboxPolicy:sandbox,activePermissionProfile:{id:':workspace',extends:null},runtimeWorkspaceRoots:[f.cwd]}};
 const capabilities={canUseProjectlessWorkspace:false,canMaterializeHostRoots:true,latestUseAppServerPermissionDefault:false,preserveWorkspaceSandboxPolicyWithDefault:false,getOptionalWritableRoots:original.optional(f.binding.threadId),getRequiredWritableRoots:()=>[],getRequestCollaborationMode:value=>value,getRequestModel:value=>value,isSamePath:(a,b)=>a===b,shouldShowModelChange:()=>false};
 const manager={isCloudHost:false,getThreadWorkspaceState:()=>null,async getThreadWritableRoots(){return[f.cwd];},async getCodexHome(){return f.codexHome;},async getWorkspacesRoot(){return join(f.root,'workspaces');},async ensureDirectory(requested){assert.equal(requested,path);materialize(authority,f,path,'owned-runtime-directory-'+randomUUID());},requestClient:{getAppServerVersion:()=> '0.166.0'},logger:{info(){},warning(){}}};
 const {createNativeSharedThreadCreationRouter,readNativeSharedFirstTurnControl}=require('../src/native-shared-thread-creation-routing.cjs');
 const {createNativeSharedThreadSendRouter}=require('../src/native-shared-thread-send-routing.cjs');
 let now=100;const profileId=randomUUID(),sender={isDestroyed:()=>false},record={senderId:1,viewId:f.binding.viewId,window:{webContents:sender,isDestroyed:()=>false}},hostId=f.binding.hostId,scope={...f.binding,cwd:f.cwd,creationNonce:randomUUID()};delete scope.threadId;delete scope.clientId;
 const common={profileId,generation:f.binding.runtimeGeneration,getRecord:()=>record,getOwnedRecord:value=>value===sender?record:null,verifyRuntimeSync:()=>true,sendToView(){},now:()=>now};
 const creation=createNativeSharedThreadCreationRouter({...common,resolveCreateScope:async()=>scope,authorizeCreate:async()=>true,resolveCreatedBinding:async()=>f.binding,onBound:async()=>true});
 const sent=[];
 const sending=createNativeSharedThreadSendRouter({...common,verifyBindingSync:value=>f.domain.getAttestationSync(value)!==null,resolveBinding:async()=>f.binding,getFirstTurnControlSync:readNativeSharedFirstTurnControl,canonicalizeFrame:canonicalizeOriginalSharedTurn,authorizeSend:async(binding,frame,control)=>{assert.equal(f.domain.verifyBoundPermissionSelectionSync(binding,frame.params),true);sent.push({frame,control});return true;}});
 t.after(()=>{creation.dispose();sending.dispose();});
 const life={type:'kanban-shared-connect-lifecycle',sequence:1,epoch:randomUUID()};creation.lifecycle(sender,life);sending.lifecycle(sender,life);
 const attemptId=randomUUID(),clientThreadId=randomUUID(),input=[{type:'text',text:'完整原版首轮\nPreserve the original LF',text_elements:[]}],clientUserMessageId=randomUUID();
 assert.equal(await creation.intent(sender,{type:'kanban-shared-create-intent',v:1,action:'create',profileId,generation:f.binding.runtimeGeneration,viewId:f.binding.viewId,hostId,projectId:f.binding.projectId,cwd:f.cwd,clientThreadId,attemptId,sequence:1,epoch:life.epoch}),true);
 async function completeNative(request,messageId){
  const prepared=await original.prepare(manager,f.binding.threadId,{request:{...request,responsesapiClientMetadata:originalComposerMetadata({message_submission_source:undefined})},context:{useAppServerPermissionDefault:false,inheritThreadSettings:false}},messageId,pageContext,state,capabilities);
  const afterRuntime=await runtime.prepareOuter({...manager,getConversation:()=>state,getStreamRole:()=>role,getConversationCwd:()=>f.cwd},f.binding.threadId,prepared.request,()=>assert.equal(f.domain.verifyCurrentSync(f.binding),true));
  for(const key of Object.keys(prepared.request).filter(key=>!['additionalContext','cyberAccessProgram'].includes(key)))assert.deepEqual(afterRuntime[key],prepared.request[key]);
  const client={automationTurns:{preventAutoArchive(){},startTurn:runtime.automationStartTurn},archive:{cancelAutomationArchive:()=>null},ensureReady:async()=>{},appServerVersion:'0.166.0',options:{getHostedAutomationInstallationId:()=>installationId},turnCwds:{trackStart:(_request,_id,send)=>send()},sendInternalRequest:async frame=>({result:{wire:original.wire(frame,f.binding)}})};
  const value=await runtime.startTurn.call(client,afterRuntime);
  assert.equal(value.wire.params.cyberAccessProgram,'standard');assert.deepEqual(value.wire.params.additionalContext,afterRuntime.additionalContext);assert.equal(value.wire.params.additionalContext.codex_git_state.kind,'untrusted');assert.equal(value.wire.params.input[0].text,request.input[0].text);
  for(const key of Object.keys(pageContext))assert.deepEqual(value.wire.params.additionalContext[key],pageContext[key]);
  assert.deepEqual(value.wire.params.responsesapiClientMetadata,JSON.parse(JSON.stringify(runtime.applyInstallationMetadata(afterRuntime,installationId).responsesapiClientMetadata)));
  assert.equal(value.wire.params.responsesapiClientMetadata.source,'codex');assert.equal(value.wire.params.responsesapiClientMetadata.client_type,'desktop_app');
  const metadata=JSON.parse(value.wire.params.responsesapiClientMetadata.mcp_request_meta),search=JSON.parse(metadata['openai/search_context']);assert.equal(metadata['openai/codex_installation_id'],installationId);assert.equal(search.is_web_access_restricted,true);assert.deepEqual(search.allowed_domains,['owned.example.invalid']);
  state={...state,currentPermissions:prepared.permissions};
  return value.wire;
 }
 await creation.withStart(sender,hostId,{cwd:f.cwd,input,model:'owned-model',reasoningEffort:'high',permissionsConfig:state.currentPermissions,approvalsReviewer:'user',multiAgentMode:'explicitRequestOnly',clientUserMessageId,__kanbanSharedCreateAttempt:attemptId,__kanbanSharedCreateClient:clientThreadId},async(_clean,created)=>{
  await creation.prepareRequest(hostId,{id:'native-runtime-start',method:'thread/start',params:{cwd:f.cwd,model:'owned-model',approvalPolicy:'never',approvalsReviewer:'user',permissions:':workspace',runtimeWorkspaceRoots:[f.cwd]}});await created(f.binding.threadId);now+=34000;
  const frame=await completeNative({input,model:'owned-model',effort:'high',approvalPolicy:'never',approvalsReviewer:'user',permissions:':workspace',runtimeWorkspaceRoots:[f.cwd],summary:'auto',personality:'none'},clientUserMessageId);
  const capability=creation.getFirstTurnContext(hostId,frame);assert.ok(capability);await sending.prepareFirstTurn(capability.binding,frame,capability.token);
 });
 const nextAttempt=randomUUID();assert.equal(await sending.intent(sender,{type:'kanban-shared-send-intent',v:1,action:'send',profileId,generation:f.binding.runtimeGeneration,viewId:f.binding.viewId,hostId,threadId:f.binding.threadId,attemptId:nextAttempt,sequence:1,epoch:life.epoch}),true);
 await sending.withSend(sender,hostId,{conversationId:f.binding.threadId,__kanbanSharedSendAttempt:nextAttempt},async()=>{
  const frame=await completeNative({input:[{type:'text',text:'继续原版对话'}],model:'owned-model',effort:'high',approvalPolicy:'never',approvalsReviewer:'user',permissions:':workspace',runtimeWorkspaceRoots:state.currentPermissions.runtimeWorkspaceRoots,summary:'auto',personality:'none'},randomUUID());
  await sending.prepareRequest(hostId,frame);
 });
 assert.equal(sent.length,2);for(const{frame}of sent){assert.equal(frame.params.additionalContext.codex_apps_client_time_context.kind,'application');assert.equal(Object.isFrozen(frame.params.additionalContext),true);}
});

test('only the fixed native application time context is copied, without opening arbitrary additional context',()=>{
 const binding={threadId:randomUUID()},time='<timezone>Asia/Shanghai</timezone>\n<current_date>2026-11-08</current_date>\nUse this client time context for user-facing dates, times, and schedules instead of the execution host\'s timezone and current date.';
 const frame={id:'native-time',method:'turn/start',params:{threadId:binding.threadId,input:[{type:'text',text:'owned'}],additionalContext:{codex_apps_client_time_context:{kind:'application',value:time}}}};
 assert.deepEqual(copySharedThreadSendFrame(frame,binding).params.additionalContext,frame.params.additionalContext);
 for(const value of [{other:{kind:'application',value:time}},{codex_apps_client_time_context:{kind:'developer',value:time}},{codex_apps_client_time_context:{kind:'application',value:time,extra:true}},{codex_apps_client_time_context:{kind:'application',value:time.replace('2026-11-08','2026-02-30')}},{codex_apps_client_time_context:{kind:'application',value:time+'\nextra'}}])assert.throws(()=>canonicalizeOriginalSharedTurn({...frame,params:{...frame.params,additionalContext:value}},binding));
});

test('fixed untrusted git context keeps native failures and rejects other threads, message IDs, templates and oversized payloads',()=>{
 const binding={threadId:randomUUID(),hostId:'kanban-shared-cli'},clientUserMessageId=randomUUID();
 const time='<timezone>Etc/UTC</timezone>\n<current_date>2026-11-08</current_date>\nUse this client time context for user-facing dates, times, and schedules instead of the execution host\'s timezone and current date.';
 const snapshot={schemaVersion:1,phase:'before_turn_request',hostId:binding.hostId,sessionId:null,threadId:binding.threadId,clientUserMessageId,appVersion:'26.1027.51404',appServerVersion:'0.166.0',status:'failed',capturedAt:'2026-11-08T01:30:00.000Z',worktreeId:null,headCommitSha:null,branch:null,detached:null,upstream:null,remotes:null,remotesOmitted:0,failureReason:'command_failed'};
 const encode=value=>'<environment_context>\n  <git source="app" trust="untrusted">'+JSON.stringify(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))+'</git>\n</environment_context>';
 const frame={id:'native-outer-context',method:'turn/start',params:{threadId:binding.threadId,clientUserMessageId,input:[{type:'text',text:'owned original input'}],additionalContext:{codex_apps_client_time_context:{kind:'application',value:time},codex_git_state:{kind:'untrusted',value:encode(snapshot)}}}};
 const copied=copySharedThreadSendFrame(frame,binding);assert.deepEqual(copied.params.additionalContext,frame.params.additionalContext);assert.equal(Object.isFrozen(copied.params.additionalContext.codex_git_state),true);
 const additional=git=>({...frame.params.additionalContext,codex_git_state:git});
 for(const value of [additional({kind:'application',value:encode(snapshot)}),additional({kind:'untrusted',value:encode({...snapshot,threadId:randomUUID()})}),additional({kind:'untrusted',value:encode({...snapshot,clientUserMessageId:randomUUID()})}),additional({kind:'untrusted',value:encode({...snapshot,hostId:'local'})}),additional({kind:'untrusted',value:encode({...snapshot,invented:true})}),additional({kind:'untrusted',value:encode({...snapshot,branch:'x'.repeat(4000)})}),additional({kind:'untrusted',value:encode({...snapshot,remotes:[{name:'origin',fetchUrl:'https://secret@example.invalid/repo.git'}]})}),additional({kind:'untrusted',value:encode(snapshot).replace('trust="untrusted"','trust="trusted"')}),{...frame.params.additionalContext,unknown:{kind:'untrusted',value:'unsupported'}}])assert.throws(()=>canonicalizeOriginalSharedTurn({...frame,params:{...frame.params,additionalContext:value}},binding));
});

test('native cyber program literals survive the one-shot frame without inventing program eligibility',()=>{
 const binding={threadId:randomUUID()},base={id:'owned-native-program',method:'turn/start',params:{threadId:binding.threadId,input:[{type:'text',text:'owned'}]}};
 for(const program of ['standard','daybreakBlue','daybreakRed'])assert.equal(canonicalizeOriginalSharedTurn({...base,params:{...base.params,cyberAccessProgram:program}},binding).params.cyberAccessProgram,program);
 for(const value of ['invented',true,{},[]])assert.throws(()=>canonicalizeOriginalSharedTurn({...base,params:{...base.params,cyberAccessProgram:value}},binding));
 assert.equal(Object.hasOwn(canonicalizeOriginalSharedTurn({...base,params:{...base.params,cyberAccessProgram:null}},binding).params,'cyberAccessProgram'),false);
});

test('original empty Page pair is preserved exactly and cannot carry another Page or arbitrary instructions',{skip:!runtimeOriginalDirectory?'Requires pinned original empty Page constructor':false},()=>{
 const binding={threadId:randomUUID()},pair=originalEmptyPageContext(),time='<timezone>Etc/UTC</timezone>\n<current_date>2026-11-08</current_date>\nUse this client time context for user-facing dates, times, and schedules instead of the execution host\'s timezone and current date.';
 const context={codex_apps_client_time_context:{kind:'application',value:time},...pair},frame={id:'original-empty-page',method:'turn/start',params:{threadId:binding.threadId,input:[{type:'text',text:'owned'}],additionalContext:context}};
 const copied=canonicalizeOriginalSharedTurn(frame,binding).params.additionalContext;
 assert.deepEqual(copied,context);for(const value of Object.values(copied))assert.equal(Object.isFrozen(value),true);
 const missingInstructions={...context};delete missingInstructions.codex_apps_open_page_instructions;
 const missingPage={...context};delete missingPage.codex_apps_open_page;
 const changed=(key,value)=>({...context,[key]:value});
 for(const invalid of [missingInstructions,missingPage,changed('codex_apps_open_page_instructions',{...pair.codex_apps_open_page_instructions,value:'other instructions'}),changed('codex_apps_open_page',{kind:'application',value:'{"page_id":null}'}),changed('codex_apps_open_page',{kind:'untrusted',value:'{"page_id":"other-page"}'}),changed('codex_apps_open_page',{kind:'untrusted',value:'{"page_id":null,"extra":true}'}),changed('codex_apps_open_page',{kind:'untrusted',value:'{ "page_id": null }'}),{...context,unknown:{kind:'application',value:'extra'}}])assert.throws(()=>canonicalizeOriginalSharedTurn({...frame,params:{...frame.params,additionalContext:invalid}},binding));
 pair.codex_apps_open_page.value='{"page_id":"mutated"}';assert.equal(copied.codex_apps_open_page.value,'{"page_id":null}');
});

test('fixed original composer telemetry is preserved without opening arbitrary metadata or weakening search restrictions',{skip:!runtimeOriginalDirectory?'Requires pinned original OTs constructor':false},async()=>{
 const binding={threadId:randomUUID()},installationId=await originalNativeInstallationId(),context={mode:'cached',is_web_access_restricted:true,session_persistent:false,allowed_domains:['owned.example.invalid']};
 const metadata={...originalComposerMetadata({message_submission_source:'shared_automation'}),workspace_kind:'project',mcp_request_meta:JSON.stringify({'openai/search_context':JSON.stringify(context),'openai/codex_installation_id':installationId})};
 const frame={id:'fixed-original-metadata',method:'turn/start',params:{threadId:binding.threadId,input:[{type:'text',text:'owned'}],responsesapiClientMetadata:metadata}},copy=canonicalizeOriginalSharedTurn(frame,binding);
 assert.deepEqual(copy.params.responsesapiClientMetadata,metadata);assert.equal(Object.isFrozen(copy.params.responsesapiClientMetadata),true);
 const absent={...metadata,message_submission_source:undefined};assert.equal(Object.hasOwn(canonicalizeOriginalSharedTurn({...frame,params:{...frame.params,responsesapiClientMetadata:absent}},binding).params.responsesapiClientMetadata,'message_submission_source'),false,'undefined original optional metadata follows the original JSON wire semantics');
 const installationOnly={...originalComposerMetadata(),workspace_kind:'project',mcp_request_meta:JSON.stringify({'openai/codex_installation_id':installationId})};assert.deepEqual(copySharedThreadSendFrame({...frame,params:{...frame.params,responsesapiClientMetadata:installationOnly}},binding).params.responsesapiClientMetadata,installationOnly);
 for(const bad of [{...metadata,source:'other'},{...metadata,client_type:'other'},{...metadata,message_submission_source:{}},{...metadata,unknown:'not dropped'},{...metadata,mcp_request_meta:JSON.stringify({'openai/search_context':JSON.stringify({...context,unknown:true})})},{...metadata,mcp_request_meta:JSON.stringify({'openai/search_context':JSON.stringify({...context,is_web_access_restricted:'false'})})},{...metadata,mcp_request_meta:JSON.stringify({'openai/codex_installation_id':{not:'a native string'}})},{...metadata,mcp_request_meta:JSON.stringify({'openai/unknown':'not accepted'})}])assert.throws(()=>canonicalizeOriginalSharedTurn({...frame,params:{...frame.params,responsesapiClientMetadata:bad}},binding));
});
