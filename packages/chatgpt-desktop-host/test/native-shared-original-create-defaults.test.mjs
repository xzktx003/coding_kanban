import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const {createNativeSharedThreadCreationRouter}=createRequire(import.meta.url)('../src/native-shared-thread-creation-routing.cjs');
const directory=process.env.CHATGPT_DESKTOP_SIDEBAR_ASSET_DIR;
const pinned={
 'app-shared-601019a330d7.js':'02dd01d1e7c076ec44f10bb8446976f07be9eb007d1c32445adf5cda13221116',
 'app-initial-18b189e867e7.js':'244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032',
 'build-start-conversation-params-90a879145ce0.js':'bdc2babda529849da191117898cb8e008715ca83bc597109a042ead2a48d071d',
};
async function originalBuilder(){
 const sources={};for(const [name,digest]of Object.entries(pinned)){const body=await readFile(join(directory,name));assert.equal(createHash('sha256').update(body).digest('hex'),digest);sources[name]=body.toString()}
 const shared=sources['app-shared-601019a330d7.js'],initial=sources['app-initial-18b189e867e7.js'];
 assert.match(shared,/JJ as fxt/);assert.match(initial,/Q_o as w2/);assert.match(initial,/Q_o=`explicitRequestOnly`/);
 const declaration=(source,name)=>{const start=source.indexOf(`function ${name}(`);assert.ok(start>=0);const end=source.indexOf('function ',start+9);assert.ok(end>start);return source.slice(start,end)};
 const readOnly=shared.match(/jtt=(\{type:`readOnly`,networkAccess:!1\})/);assert.ok(readOnly);
 const permissions=new Function(`const jtt=${readOnly[1]};${['qJ','vtt','KJ','ytt','btt','JJ'].map(name=>declaration(shared,name)).join('\n')}return JJ`)();
 const body=sources['build-start-conversation-params-90a879145ce0.js'],builder=declaration(body,'s');
 const build=new Function('n','a','t','o',`return (${builder})`)(permissions,files=>{assert.deepEqual(files,[]);return[]},()=>{throw Error('fixture has no file attachments')},'explicitRequestOnly');
 return (mode,{inherit=false}={})=>build({agentMode:mode,permissionProfileId:null,permissionSelection:null,shouldSendPermissionOverrides:!inherit,workspaceRoots:['/owned/project'],cwd:'/owned/project',config:{},input:[{type:'text',text:'original input'}],fileAttachments:[],addedFiles:[],threadSource:'user'});
}
function fixture(t){
 const profileId=randomUUID(),generation=randomUUID(),sender={id:1,isDestroyed:()=>false},viewId=randomUUID(),record={senderId:1,viewId,window:{webContents:sender,isDestroyed:()=>false}},scope={hostId:'kanban-shared-cli',runtimeGeneration:generation,daemonGeneration:randomUUID(),accountRevision:1,projectId:'owned-project',cwd:'/owned/project',viewId,creationNonce:randomUUID()};
 const router=createNativeSharedThreadCreationRouter({profileId,generation,getRecord:()=>record,getOwnedRecord:s=>s===sender?record:null,verifyRuntimeSync:()=>true,sendToView(){},resolveCreateScope:async()=>scope,authorizeCreate:async()=>{throw Error('this asset case must not dispatch')},resolveCreatedBinding:async()=>{throw Error('no native thread')},onBound:async()=>{throw Error('no native thread')}});t.after(()=>router.dispose());
 const life={type:'kanban-shared-connect-lifecycle',sequence:1,epoch:randomUUID()},intent={type:'kanban-shared-create-intent',v:1,action:'create',profileId,generation,viewId,hostId:scope.hostId,projectId:scope.projectId,cwd:scope.cwd,clientThreadId:randomUUID(),attemptId:randomUUID(),sequence:1,epoch:life.epoch};
 return{router,sender,intent,async ready(){assert.equal(router.lifecycle(sender,life),true);assert.equal(await router.intent(sender,intent),true)},params(value){return{...value,__kanbanSharedCreateAttempt:intent.attemptId,__kanbanSharedCreateClient:intent.clientThreadId}}};
}
test('actual shipped JJ and tD distinguish original auto/read-only/full-access from explicit inheritance',{skip:!directory},async()=>{
 const build=await originalBuilder();
 const cases=[['auto','workspaceWrite','on-request',':workspace'],['read-only','readOnly','on-request',':read-only'],['full-access','dangerFullAccess','never',':danger-full-access']];
 for(const [mode,type,approval,id]of cases){const params=build(mode);assert.equal(params.permissionsConfig.sandboxPolicy.type,type);assert.equal(params.permissionsConfig.approvalPolicy,approval);assert.equal(params.permissionsConfig.approvalsReviewer,'user');assert.equal(params.permissionsConfig.activePermissionProfile.id,id);assert.equal(params.approvalsReviewer,'user');assert.equal(params.multiAgentMode,'explicitRequestOnly');assert.notEqual(params.useAppServerPermissionDefault,true)}
 const inherited=build('auto',{inherit:true});assert.equal(inherited.permissionsConfig,undefined);assert.equal(inherited.approvalsReviewer,undefined);assert.equal(inherited.useAppServerPermissionDefault,true);assert.equal(inherited.multiAgentMode,'explicitRequestOnly');
});
for(const mode of ['auto','read-only','full-access','inherit'])test(`actual original ${mode} creation controls survive native invocation without a daemon write`,{skip:!directory},async t=>{
 const build=await originalBuilder(),f=fixture(t),params=f.params(build(mode==='inherit'?'auto':mode,{inherit:mode==='inherit'}));await f.ready();let invoked=0;
 const result=await f.router.withStart(f.sender,'kanban-shared-cli',params,async clean=>{invoked++;if(mode==='inherit'){assert.equal(clean.permissionsConfig==null,true);assert.equal(clean.approvalsReviewer==null,true);assert.equal(clean.useAppServerPermissionDefault,true)}else{assert.deepEqual(clean.permissionsConfig,params.permissionsConfig);assert.equal(clean.approvalsReviewer,params.approvalsReviewer);assert.notEqual(clean.useAppServerPermissionDefault,true)}assert.equal(clean.multiAgentMode,'explicitRequestOnly');assert.equal(clean.input,params.input);return 'original invocation'});
 assert.equal(result,'original invocation');assert.equal(invoked,1);
});
