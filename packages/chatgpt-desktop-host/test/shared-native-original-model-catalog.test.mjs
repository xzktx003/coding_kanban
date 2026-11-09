import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createPreservedNativeExecutionDomain} from '../src/shared-execution-domain-proof.mjs';
import {createSharedThreadCreationAuthority} from '../src/shared-thread-creation.mjs';
import {createSharedNativeModelSelection,ensureSharedNativeModelSelection} from '../src/shared-native-model-selection.mjs';
const {createNativeSharedThreadCreationRouter}=createRequire(import.meta.url)('../src/native-shared-thread-creation-routing.cjs');
const directory=process.env.CHATGPT_DESKTOP_NATIVE_OPTIONS_MODULE_DIR;
const pins=new Map([[11249,'0661c51d8de1757c221e573ea54e52470f2c10c3c24f45e9987d070e828c7c67'],[61082,'22f5d84f9638f71bf8cdb2cd9edff2be13db7c9c015c7530e7d43b0379dcfb73']]);
function originalModules(){const factories=new Map(),cache=new Map(),unused=()=>{throw Error('Unused native dependency')};for(const[id,pin]of pins){const body=readFileSync(join(directory,`module-${id}.js`));assert.equal(createHash('sha256').update(body).digest('hex'),pin);factories.set(id,new Function(`return ${body}`)()[id]);}function load(id){if(cache.has(id))return cache.get(id);if([44814,8857].includes(id))return unused;if(id===86439)return{y:unused};const f=factories.get(id);assert.ok(f);const value={};cache.set(id,value);f({exports:value},value,load);return value;}load.n=value=>()=>value;load.d=(target,exports)=>{for(const[key,get]of Object.entries(exports))Object.defineProperty(target,key,{get,enumerable:true})};return load;}

test('fixed original Sl defaults plus the actual router need the shared catalog even when project permission proof is current',{skip:!directory&&'Requires pinned native SDK modules; does not execute a native daemon'},async t=>{
 const root=mkdtempSync(join(tmpdir(),'shared-original-catalog-'));t.after(()=>rmSync(root,{force:true,recursive:true}));const cwd=join(root,'project');mkdirSync(cwd,0o700);
 const native=originalModules(),permissions=native(61082).zO([cwd]);
 const original=await native(11249).Sl('gpt-6.1-sol',null,async()=>null,cwd,permissions,async()=>null,null,permissions.approvalsReviewer,{permissionSelection:null});
 assert.equal(original.model,'gpt-6.1-sol');assert.equal(original.permissions,':workspace');assert.equal(original.mockExperimentalField,null);
 const runtimeGeneration=randomUUID(),daemonGeneration=randomUUID(),profileId=randomUUID(),viewId=randomUUID(),view={viewId},sender={isDestroyed:()=>false};
 let readCount=0,registration=null,permissionChecks=0,intentChecks=0;
 const source={configurationProtocolVersion:'0.166.0',assertCurrent(){},async readProjectConfig(p){assert.equal(p,cwd);return{config:{approval_policy:'never',mcp_servers:{}},origins:{},layers:[]};},async readRequirements(){return{requirements:null};},async readModelPage(cursor){readCount++;assert.equal(cursor,null);return{data:[{id:'gpt-6.1-sol',model:'gpt-6.1-sol',supportedReasoningEfforts:[{reasoningEffort:'low',description:'Low'}]}],nextCursor:null};}};
 const domain=await createPreservedNativeExecutionDomain({source,projects:[{projectId:'owned',cwd}],runtimeGeneration,daemonGeneration,getAccountRevision:()=>1});t.after(()=>domain.close());
 const scope={hostId:'kanban-shared-cli',runtimeGeneration,daemonGeneration,accountRevision:1,projectId:'owned',cwd,viewId,creationNonce:randomUUID()};
 const catalog=createSharedNativeModelSelection({getAccountRevision:()=>1,verifyCurrentSync:()=>domain.verifyProjectSync(scope)});t.after(()=>catalog.close());
 const authority=createSharedThreadCreationAuthority({modelSelection:catalog,getOwnedView:()=>view,verifyOwnedViewSync:()=>true,verifyProjectSync:s=>domain.verifyProjectSync(s),verifyPermissionSelectionSync:(s,p)=>{permissionChecks++;return domain.verifyPermissionSelectionSync(s,p);},verifyExplicitIntentSync:(_s,frame,control)=>{intentChecks++;return registration!==null&&JSON.stringify(frame)===JSON.stringify(registration.frame)&&control.signal===registration.signal;}});t.after(()=>authority.close());
 const record={senderId:1,viewId,window:{webContents:sender,isDestroyed:()=>false}};
 const router=createNativeSharedThreadCreationRouter({profileId,generation:runtimeGeneration,getRecord:()=>record,getOwnedRecord:s=>s===sender?record:null,verifyRuntimeSync:()=>true,sendToView(){},resolveCreateScope:async()=>scope,resolveCreatedBinding:async()=>{throw Error('No thread exists in this test')},onBound:async()=>{throw Error('No thread exists in this test')},authorizeCreate:async(s,frame,control)=>{
  assert.equal(domain.verifyPermissionSelectionSync(s,{cwd,...frame.params}),true);
  assert.throws(()=>authority.registerCreate(s,frame,control),{code:'SHARED_CREATE_DENIED'});
  assert.equal(permissionChecks,1);assert.equal(intentChecks,0);
  assert.equal(await ensureSharedNativeModelSelection(catalog,s,{model:frame.params.model,reasoningEffort:frame.params.config.model_reasoning_effort},{source,signal:control.signal,deadline:control.deadline,verifyCurrentSync:()=>domain.verifyProjectSync(s)}),true);
  assert.equal(registration,null);registration={frame,signal:control.signal};try{return authority.registerCreate(s,frame,control);}finally{registration=null;}
 }});t.after(()=>router.dispose());
 const life={type:'kanban-shared-connect-lifecycle',sequence:1,epoch:randomUUID()},attemptId=randomUUID(),clientThreadId=`client-new-thread:${randomUUID()}`;
 router.lifecycle(sender,life);assert.equal(await router.intent(sender,{type:'kanban-shared-create-intent',v:1,action:'create',profileId,generation:runtimeGeneration,viewId,hostId:scope.hostId,projectId:'owned',cwd,clientThreadId,attemptId,sequence:life.sequence,epoch:life.epoch}),true);
 await router.withStart(sender,scope.hostId,{cwd,workspaceRoots:[cwd],model:'gpt-6.1-sol',reasoningEffort:'low',permissionsConfig:permissions,approvalsReviewer:'user',multiAgentMode:'explicitRequestOnly',input:[{type:'text',text:'private inert test'}],__kanbanSharedCreateAttempt:attemptId,__kanbanSharedCreateClient:clientThreadId},async()=>{
  const prepared=await router.prepareRequest(scope.hostId,{id:'actual-Sl-catalog',method:'thread/start',params:original});
  assert.equal(prepared.frame.params.model,'gpt-6.1-sol');assert.equal(prepared.frame.params.config.model_reasoning_effort,'low');assert.equal(prepared.frame.params.permissions,':workspace');assert.equal(authority.beforeWriteSync(prepared.frame),true);
 });
 assert.equal(readCount,1);assert.equal(intentChecks,1);
});
