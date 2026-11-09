import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createNativeSharedThreadCreationRouter}=require('../src/native-shared-thread-creation-routing.cjs');
const {verifySharedNativePermissionReply}=require('../src/shared-permissions-schema.cjs');
const directory=process.env.CHATGPT_DESKTOP_NATIVE_OPTIONS_MODULE_DIR;
const pins=new Map([[11249,'0661c51d8de1757c221e573ea54e52470f2c10c3c24f45e9987d070e828c7c67'],[61082,'22f5d84f9638f71bf8cdb2cd9edff2be13db7c9c015c7530e7d43b0379dcfb73']]);

test('fixed original Sl complete default product preserves permissions through canonical start and reply verification',{skip:!directory&&'Requires the explicitly supplied pinned native SDK module directory'},async()=>{
  const factories=new Map();
  for(const[id,pin]of pins){const source=await readFile(join(directory,`module-${id}.js`),'utf8');assert.equal(createHash('sha256').update(source).digest('hex'),pin);factories.set(id,new Function(`return ${source}`)()[id]);}
  const cache=new Map(),unused=()=>{throw new Error('Unused SDK dependency must not be called')};
  function nativeRequire(id){if(cache.has(id))return cache.get(id);if([44814,8857].includes(id))return unused;if(id===86439)return{y:unused};const factory=factories.get(id);if(!factory)throw new Error('Unknown native module dependency');const exports={};cache.set(id,exports);factory({exports},exports,nativeRequire);return exports;}
  nativeRequire.n=value=>()=>value;
  nativeRequire.d=(target,exports)=>{for(const[key,get]of Object.entries(exports))Object.defineProperty(target,key,{get,enumerable:true})};
  const profileId=randomUUID(),generation=randomUUID(),viewId=randomUUID(),sender={isDestroyed:()=>false},cwd='/private/original-sl-project';
  const record={senderId:1,viewId,window:{webContents:sender,isDestroyed:()=>false}},scope={hostId:'kanban-shared-cli',runtimeGeneration:generation,daemonGeneration:randomUUID(),accountRevision:1,projectId:'own-sl-project',cwd,viewId,creationNonce:randomUUID()},threadId=randomUUID();
  const permissions=nativeRequire(61082).zO([cwd]);
  const original=await nativeRequire(11249).Sl('selected-model',null,async()=>null,cwd,permissions,async()=>null,null,permissions.approvalsReviewer,{permissionSelection:null});
  assert.equal(original.mockExperimentalField,null);assert.equal(original.experimentalRawEvents,false);assert.equal(original.ephemeral,null);assert.equal(original.dynamicTools,null);assert.equal(original.permissions,':workspace');
  let writes=0;
  const router=createNativeSharedThreadCreationRouter({profileId,generation,getRecord:()=>record,getOwnedRecord:value=>value===sender?record:null,verifyRuntimeSync:()=>true,sendToView(){},resolveCreateScope:async()=>scope,authorizeCreate:async(_scope,frame)=>{writes++;assert.equal(frame.params.mockExperimentalField,undefined);return true},resolveCreatedBinding:async()=>({hostId:scope.hostId,runtimeGeneration:generation,daemonGeneration:scope.daemonGeneration,accountRevision:1,projectId:scope.projectId,threadId,viewId,clientId:randomUUID()}),onBound:()=>true});
  const life={type:'kanban-shared-connect-lifecycle',sequence:1,epoch:randomUUID()},attemptId=randomUUID(),clientThreadId=`client-new-thread:${randomUUID()}`;
  try{
    router.lifecycle(sender,life);assert.equal(await router.intent(sender,{type:'kanban-shared-create-intent',v:1,action:'create',profileId,generation,viewId,hostId:scope.hostId,projectId:scope.projectId,cwd,clientThreadId,attemptId,sequence:life.sequence,epoch:life.epoch}),true);
    await router.withStart(sender,scope.hostId,{cwd,workspaceRoots:[cwd],input:[{type:'text',text:'own unit input'}],model:'selected-model',permissionsConfig:permissions,approvalsReviewer:'user',multiAgentMode:'explicitRequestOnly',__kanbanSharedCreateAttempt:attemptId,__kanbanSharedCreateClient:clientThreadId},async(clean,created)=>{
      assert.equal(clean.permissionsConfig,permissions);assert.equal(clean.multiAgentMode,'explicitRequestOnly');
      const result=await router.prepareRequest(scope.hostId,{id:'complete-Sl',method:'thread/start',params:original});
      assert.deepEqual(result.frame.params,{cwd,approvalPolicy:'on-request',approvalsReviewer:'user',permissions:':workspace',runtimeWorkspaceRoots:[cwd],model:'selected-model'});
      const reply={cwd,approvalPolicy:'on-request',approvalsReviewer:'user',activePermissionProfile:{id:':workspace',extends:null},runtimeWorkspaceRoots:[cwd],sandbox:permissions.sandboxPolicy};
      assert.equal(verifySharedNativePermissionReply(result.frame.params,reply),true);
      assert.equal(verifySharedNativePermissionReply(result.frame.params,{...reply,activePermissionProfile:{id:':read-only',extends:null}}),false);
      await created(threadId);
    });
    assert.equal(writes,1);
  }finally{router.dispose()}
});
