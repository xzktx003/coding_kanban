'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>require('../src/shared-permissions-schema.cjs');
const cwd='/owned/repo';
const workspace=()=>({activePermissionProfile:{id:':workspace',extends:null},runtimeWorkspaceRoots:[cwd],sandboxPolicy:{type:'workspaceWrite',writableRoots:[cwd],excludeSlashTmp:false,excludeTmpdirEnvVar:false,networkAccess:false},approvalPolicy:'on-request',approvalsReviewer:'user'});
test('exact desktop auto/readOnly/fullAccess settings survive immutable copying and preserve native profile identity',()=>{
 const {copySharedDesktopPermissionConfig}=load();
 for(const value of [workspace(),{activePermissionProfile:{id:':read-only',extends:null},runtimeWorkspaceRoots:[cwd],sandboxPolicy:{type:'readOnly',networkAccess:false},approvalPolicy:'on-request',approvalsReviewer:'user'},{activePermissionProfile:{id:':danger-full-access',extends:null},runtimeWorkspaceRoots:[cwd],sandboxPolicy:{type:'dangerFullAccess'},approvalPolicy:'never',approvalsReviewer:'user'}]){
  const result=copySharedDesktopPermissionConfig(value,{cwd});assert.deepEqual(result,value);assert.notEqual(result,value);assert.equal(Object.isFrozen(result),true);assert.equal(Object.isFrozen(result.sandboxPolicy),true);
 }
 const outside=workspace();outside.sandboxPolicy.writableRoots=['/other/repo'];assert.throws(()=>copySharedDesktopPermissionConfig(outside,{cwd}));
 const getter=workspace();let called=0;Object.defineProperty(getter,'approvalsReviewer',{get(){called++;return 'user';}});assert.throws(()=>copySharedDesktopPermissionConfig(getter,{cwd}));assert.equal(called,0);
});
test('native permission projection accepts a complete SDK frame and forwards only exact schema fields',()=>{
 const {copySharedNativePermissionFields}=load();
 const raw={cwd,model:'model-from-native-catalog',permissions:':workspace',approvalPolicy:'on-request',approvalsReviewer:'user',runtimeWorkspaceRoots:[cwd],config:{model_reasoning_effort:'high','features.some_desktop_feature':true,'sandbox_workspace_write.network_access':false}};
 assert.deepEqual(copySharedNativePermissionFields(raw,{cwd,kind:'start'}),{approvalPolicy:'on-request',approvalsReviewer:'user',permissions:':workspace',runtimeWorkspaceRoots:[cwd],config:{'sandbox_workspace_write.network_access':false}});
 assert.deepEqual(copySharedNativePermissionFields({threadId:'not-read-here',sandboxPolicy:{type:'readOnly',networkAccess:false}},{cwd,kind:'turn'}),{sandboxPolicy:{type:'readOnly',networkAccess:false}});
 assert.throws(()=>copySharedNativePermissionFields({permissions:':workspace',sandbox:'read-only'},{cwd,kind:'start'}));
 assert.throws(()=>copySharedNativePermissionFields({sandboxPolicy:{type:'workspaceWrite',writableRoots:['/other/repo']}},{cwd,kind:'turn'}));
});
test('a real reply must attest the requested profile, reviewer, approval, roots and sandbox choice',()=>{
 const {verifySharedNativePermissionReply}=load();
 const params={cwd,permissions:':workspace',approvalsReviewer:'user',approvalPolicy:'on-request',runtimeWorkspaceRoots:[cwd]};
 const result={cwd,activePermissionProfile:{id:':workspace',extends:null},approvalsReviewer:'user',approvalPolicy:'on-request',sandbox:{type:'workspaceWrite',writableRoots:[cwd],networkAccess:false},runtimeWorkspaceRoots:[cwd]};
 assert.equal(verifySharedNativePermissionReply(params,result),true);
 for(const change of [{activePermissionProfile:{id:':danger-full-access'}},{approvalsReviewer:'auto_review'},{approvalPolicy:'never'},{runtimeWorkspaceRoots:['/other/repo']}])assert.equal(verifySharedNativePermissionReply(params,{...result,...change}),false);
 assert.equal(verifySharedNativePermissionReply({cwd,sandbox:'read-only'},{...result,sandbox:{type:'readOnly',networkAccess:false}}),true);
 assert.equal(verifySharedNativePermissionReply({cwd,sandbox:'read-only'},result),false);
});
test('a matching builtin profile name cannot conceal a different sandbox, network or runtime root',()=>{
 const {verifySharedNativePermissionReply}=load(),params={cwd,permissions:':workspace',runtimeWorkspaceRoots:[cwd]},reply={cwd,approvalPolicy:'on-request',approvalsReviewer:'user',activePermissionProfile:{id:':workspace'},runtimeWorkspaceRoots:[cwd],sandbox:{type:'workspaceWrite',writableRoots:[cwd],networkAccess:false,excludeSlashTmp:false,excludeTmpdirEnvVar:false}};
 assert.equal(verifySharedNativePermissionReply(params,reply),true);
 for(const sandbox of [{type:'dangerFullAccess'},{type:'readOnly',networkAccess:false},{...reply.sandbox,networkAccess:true},{...reply.sandbox,writableRoots:['/another-project']},{...reply.sandbox,excludeSlashTmp:true}])assert.equal(verifySharedNativePermissionReply(params,{...reply,sandbox}),false);
 for(const [id,wrong] of [[':read-only','workspaceWrite'],[':danger-full-access','readOnly']])assert.equal(verifySharedNativePermissionReply({cwd,permissions:id},{...reply,activePermissionProfile:{id},sandbox:{type:wrong}}),false);
});

test('turn wire shape may omit cwd while the server repeats root containment with its owned cwd',()=>{
 const {copySharedNativePermissionFields}=load(),params={threadId:'not-a-cwd',sandboxPolicy:{type:'workspaceWrite',writableRoots:['/another-project'],networkAccess:false}};
 assert.deepEqual(copySharedNativePermissionFields(params,{kind:'turn'}),{sandboxPolicy:params.sandboxPolicy});assert.throws(()=>copySharedNativePermissionFields(params,{kind:'turn',cwd}));assert.throws(()=>copySharedNativePermissionFields(params,{kind:'start'}));
});

const threadId='01a838d4-5800-7000-8000-000000000001';
const threadDate=(()=>{const date=new Date(Number.parseInt(threadId.slice(0,8)+threadId.slice(9,13),16));return[date.getUTCFullYear(),String(date.getUTCMonth()+1).padStart(2,'0'),String(date.getUTCDate()).padStart(2,'0')].join('/')})();
const artifactRoot=`/private/codex/visualizations/${threadDate}/${threadId}`;
function artifactContext(){return load().createSharedPermissionArtifactContext({cwd,threadId,artifactRoot});}
function artifactRequest(){return{threadId,approvalPolicy:'on-request',approvalsReviewer:'user',runtimeWorkspaceRoots:[cwd,artifactRoot],sandboxPolicy:{type:'workspaceWrite',writableRoots:[cwd,artifactRoot],networkAccess:false,excludeSlashTmp:false,excludeTmpdirEnvVar:false}};}

test('an owned cwd still rejects the actual out-of-project artifact root without a context',()=>{
 assert.throws(()=>load().copySharedNativePermissionFields(artifactRequest(),{cwd,kind:'turn'}),{code:'SHARED_PERMISSION_SELECTION_UNSUPPORTED'});
});
test('one opaque exact-thread context admits the artifact root through all permission projections',()=>{
 const {copySharedDesktopPermissionConfig,copySharedNativePermissionFields}=load(),context=artifactContext();assert.equal(Object.isFrozen(context),true);assert.deepEqual(Object.keys(context),[]);
 const params=artifactRequest(),native=copySharedNativePermissionFields(params,{cwd,kind:'turn',artifactContext:context});
 assert.deepEqual(native.runtimeWorkspaceRoots,[cwd,artifactRoot]);assert.deepEqual(native.sandboxPolicy,params.sandboxPolicy);assert.equal(Object.isFrozen(native.sandboxPolicy.writableRoots),true);
 const desktop=workspace();desktop.runtimeWorkspaceRoots.push(artifactRoot);desktop.sandboxPolicy.writableRoots.push(artifactRoot);
 assert.deepEqual(copySharedDesktopPermissionConfig(desktop,{cwd,artifactContext:context}),desktop);
 const flat={threadId,config:{'sandbox_workspace_write.writable_roots':[artifactRoot]}};
 assert.deepEqual(copySharedNativePermissionFields(flat,{cwd,kind:'turn',artifactContext:context}).config,flat.config);
 const nested={threadId,config:{sandbox_workspace_write:{writable_roots:[artifactRoot],network_access:false}}};
 assert.deepEqual(copySharedNativePermissionFields(nested,{cwd,kind:'turn',artifactContext:context}).config,nested.config);
});
test('raw paths, cloned contexts, another cwd or another thread do not authorize an artifact root',()=>{
 const {copySharedNativePermissionFields}=load(),context=artifactContext(),params=artifactRequest();
 for(const options of [{cwd,kind:'turn',artifactRoot},{cwd,kind:'turn',artifactContext:{}},{cwd,kind:'turn',artifactContext:JSON.parse(JSON.stringify(context))},{cwd:'/different/project',kind:'turn',artifactContext:context},{kind:'turn',artifactContext:context}])assert.throws(()=>copySharedNativePermissionFields(params,options));
 assert.throws(()=>copySharedNativePermissionFields({...params,threadId:'01a838d4-5800-7000-8000-000000000002'},{cwd,kind:'turn',artifactContext:context}));
 assert.deepEqual(copySharedNativePermissionFields(params,{kind:'turn'}).runtimeWorkspaceRoots,[cwd,artifactRoot],'the existing wire-only parser still grants no owned cwd/context authority');
});
test('an artifact context never expands to HOME, parent, sibling thread or arbitrary descendants',()=>{
 const {copySharedNativePermissionFields}=load(),context=artifactContext();
 for(const root of ['/private/codex','/private/codex/visualizations',artifactRoot.slice(0,artifactRoot.lastIndexOf('/')),artifactRoot.replace(/000000000001$/,'000000000002'),artifactRoot+'/nested',cwd+'-other','/private/codex/visualizations/2099/01/01/'+threadId]){
  const params={threadId,runtimeWorkspaceRoots:[root]};assert.throws(()=>copySharedNativePermissionFields(params,{cwd,kind:'turn',artifactContext:context}));
 }
});
test('artifact metadata requires the original UUID date/root shape and refuses getters',()=>{
 const {createSharedPermissionArtifactContext:create}=load();assert.equal(typeof create,'function');
 for(const value of [{cwd,threadId,artifactRoot:'/private/codex'},{cwd,threadId,artifactRoot:artifactRoot.replace('/'+threadDate+'/','/2099/01/01/')},{cwd,threadId:'01a838d4-5800-7000-8000-000000000002',artifactRoot},{cwd,threadId,artifactRoot,extra:true}])assert.throws(()=>create(value));
 let getters=0;const value={cwd,threadId};Object.defineProperty(value,'artifactRoot',{get(){getters++;return artifactRoot}});assert.throws(()=>create(value));assert.equal(getters,0);
});
test('real permission replies still attest the same thread, roots, reviewer, approval and native policy',()=>{
 const {verifySharedNativePermissionReply:verify}=load(),context=artifactContext(),params=artifactRequest(),result={cwd,thread:{id:threadId},approvalPolicy:'on-request',approvalsReviewer:'user',activePermissionProfile:{id:':workspace'},runtimeWorkspaceRoots:[cwd,artifactRoot],sandbox:params.sandboxPolicy};
 assert.equal(verify(params,result),false);assert.equal(verify(params,result,{artifactContext:context}),true);
 for(const change of [{thread:{id:'01a838d4-5800-7000-8000-000000000002'}},{runtimeWorkspaceRoots:[cwd,artifactRoot+'/nested']},{sandbox:{...result.sandbox,networkAccess:true}},{sandbox:{type:'dangerFullAccess'}},{approvalPolicy:'never'},{approvalsReviewer:'auto_review'}])assert.equal(verify(params,{...result,...change},{artifactContext:context}),false);
 assert.equal(verify({...params,threadId:'01a838d4-5800-7000-8000-000000000002'},result,{artifactContext:context}),false);
});

test('artifact context follows both original native UUID date encodings without using wall time',()=>{
 const {createSharedPermissionArtifactContext:create,copySharedNativePermissionFields:copy}=load(),threadId='12345678-0000-8000-8000-000000000001',artifactRoot=`/private/codex/visualizations/1979/09/05/${threadId}`;
 const artifactContext=create({cwd,threadId,artifactRoot});assert.deepEqual(copy({threadId,runtimeWorkspaceRoots:[artifactRoot]},{cwd,kind:'turn',artifactContext}),{runtimeWorkspaceRoots:[artifactRoot]});
 assert.throws(()=>create({cwd,threadId:'12345678-0000-4000-8000-000000000001',artifactRoot}));
});

test('native artifact context cannot be borrowed for a new start or a turn without its exact thread ID',()=>{
 const {copySharedNativePermissionFields:copy,verifySharedNativePermissionReply:verify}=load(),context=artifactContext();
 for(const [params,kind]of [[{cwd,runtimeWorkspaceRoots:[cwd,artifactRoot]},'start'],[{cwd,threadId,runtimeWorkspaceRoots:[cwd,artifactRoot]},'start'],[{runtimeWorkspaceRoots:[cwd,artifactRoot]},'turn']])assert.throws(()=>copy(params,{cwd,kind,artifactContext:context}));
 const result={cwd,thread:{id:threadId},approvalPolicy:'on-request',approvalsReviewer:'user',activePermissionProfile:{id:':workspace'},runtimeWorkspaceRoots:[cwd,artifactRoot],sandbox:{type:'workspaceWrite',writableRoots:[cwd,artifactRoot],networkAccess:false}};
 assert.equal(verify({cwd,permissions:':workspace',runtimeWorkspaceRoots:[cwd,artifactRoot]},result,{artifactContext:context}),false);
 assert.deepEqual(copy(artifactRequest(),{cwd,kind:'turn',artifactContext:context}).runtimeWorkspaceRoots,[cwd,artifactRoot]);
});
