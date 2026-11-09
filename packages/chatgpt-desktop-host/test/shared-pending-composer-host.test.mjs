import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openWebviewArchive} from '../src/assets.mjs';
import {createComposerCapabilityAssetAdapter,COMPOSER_CAPABILITY_REFERENCE as REF} from '../src/composer-capability-asset-adapter.mjs';
import {createBrowserSharedProjectSelection,resolveSharedProjectRenderHost,resolveSharedProjectHost,SHARED_PROJECT_HOST_ID as SHARED} from '../src/browser-shared-project-selection.mjs';

const archivePath=process.env.CHATGPT_DESKTOP_TEST_MAC_ASAR;
async function resources(){
 const archive=await openWebviewArchive({asarPath:archivePath,sha256:REF.archiveSha256});
 try{
  const adapter=createComposerCapabilityAssetAdapter({archiveSha256:REF.archiveSha256,sharedSubmission:true}),out={};
  for(const [key,member] of [['composer',REF.composerMember],['content','webview/assets/composer-content-b926d24ef280.js']]){
   const asset=await archive.acquireAsset(member);try{out[key]=adapter.adapt({member,body:asset.body}).body.toString('utf8')}finally{asset.release()}
  }return out;
 }finally{await archive.close()}
}
function selection(){
 const clientThreadId='client-new-thread:'+randomUUID();
 const scope={node:{},value:{kind:'local',placement:'main',conversationId:null,routeConversationId:null,clientThreadId,browserTabMentionConversationId:clientThreadId}};
 let token={};const controller=createBrowserSharedProjectSelection({window:{},scopeLease:{getSnapshot:()=>token,isCurrent:x=>x===token&&x!==null,subscribe:()=>()=>{}},isSourceReady:()=>true,subscribeSource:()=>()=>{}});
 const store=controller.observe(scope,()=>({projectKind:'local',projectId:'own-original-project',cwd:'/owned/project'}));
 // A unit trusted-event stand-in, not real browser gesture evidence.
 assert.equal(store.select({isTrusted:true,type:'click'}),true);
 return {scope,clientThreadId,controller,hide:()=>{token=null}};
}
function fragment(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b)}

test('actual adapted pending worktree Wi, committed Registrar and creation host retain the same explicit shared target',{skip:!archivePath&&'Requires pinned original Mac archive'},async()=>{
 const {content,composer}=await resources(),f=selection();try{
  const Ri=resolveSharedProjectRenderHost(f.scope,'local',null);
  const source=fragment(content,'let Hi=pq(Vi),Ui=',',Gi=cs(Wi)').slice('let Hi=pq(Vi),'.length);
  const Wi=new Function('G','K','Ri','Dt','an','yt','Zt','__kanbanResolveSharedProjectRenderHost','let '+source+';return Wi;')(f.scope,null,Ri,[],false,{hostId:'local'},'worktree',resolveSharedProjectRenderHost);
  assert.equal(Wi,SHARED,'worktree yt.hostId must not silently replace the selected host');
  const W=resolveSharedProjectRenderHost(f.scope,'local',null),original={hostId:'local',conversationId:null,clientThreadId:f.clientThreadId,isMain:true};
  const scopeExpression=fragment(composer,'scope:e.__chatgptDesktopComposerScope',',homeScope:').slice('scope:'.length);
  const committed=new Function('e','W','return ('+scopeExpression+');')({__chatgptDesktopComposerScope:original},W);
  assert.deepEqual(committed,{...original,hostId:SHARED});assert.equal(original.hostId,'local');
  assert.ok(composer.includes('t[264]!==W'),'compiler cache must update the pending Registrar when selected W changes');
  assert.ok(composer.includes('t[264]=W'));
  const expr=fragment(content,'P=__kanbanResolveSharedProjectHost(',',{context:I').slice(2);
  const P=new Function('e','a','O','c','__kanbanResolveSharedProjectHost','return '+expr+';')(f.scope,{hostId:'local'},'local',null,resolveSharedProjectHost);
  const aRStart=content.indexOf('function aR(e,t,n=!1){'),aREnd=content.indexOf('}function ',aRStart)+1;assert.ok(aRStart>=0&&aREnd>aRStart);const aRSource=content.slice(aRStart,aREnd);
  const creationHost=new Function(aRSource+';return aR;')()({},P).threadCreationHostId;
  assert.equal(creationHost,SHARED);assert.equal(committed.hostId,Wi);
 }finally{f.controller.dispose()}
});

test('actual adapted submit model refuses invalid shared choice even when an old host calculation says local',{skip:!archivePath&&'Requires pinned original Mac archive'},async()=>{
 const {content}=await resources(),f=selection();try{
  const callback=fragment(content,'wrapComposerSubmit(x(yf),',',fd);').slice('wrapComposerSubmit(x(yf),'.length);
  const read=new Function('G','Wi','K','__kanbanResolveSharedProjectHost','return ('+callback+')();');
  assert.deepEqual(read(f.scope,'local',null,resolveSharedProjectHost),{hostId:SHARED,conversationId:null});
  f.hide();assert.throws(()=>read(f.scope,'local',null,resolveSharedProjectHost),{code:'SHARED_PROJECT_SELECTION_UNAVAILABLE'});
  const existing=randomUUID();assert.deepEqual(read(f.scope,'local',existing,resolveSharedProjectHost),{hostId:'local',conversationId:existing});
 }finally{f.controller.dispose()}
});


test('actual pending worktree host also drives original config, requirements and HG target; existing threads keep their host',{skip:!archivePath&&'Requires pinned original Mac archive'},async()=>{
 const {content}=await resources(),f=selection();try{
  const hostSource=fragment(content,'let Hi=pq(Vi),Ui=',',Gi=cs(Wi)').slice('let Hi=pq(Vi),'.length);
  const read=new Function('G','K','Ri','Dt','an','yt','Zt','__kanbanResolveSharedProjectRenderHost','let '+hostSource+';return {Ui,Wi};');
  const {Ui,Wi}=read(f.scope,null,SHARED,[],false,{hostId:'local'},'worktree',resolveSharedProjectRenderHost);
  assert.equal(Ui,SHARED,'original worktree target must agree before config/permission loading');assert.equal(Wi,SHARED);
  const yu=fragment(content,'function YU(','function XU(');
  const config=new Function(yu+';return YU;')()({composerMode:'worktree',worktreeExecutionHostId:Ui,worktreeExecutionCwd:'/owned/project',mcpManagerHostId:'local'});
  assert.deepEqual(config,{hostId:SHARED,requirementsHostId:SHARED,cwdOverride:'/owned/project'});
  const originalPermissions={original:'unchanged'},roots=['/owned/project'];
  const ldSource=fragment(content,'ld={cwd:Cc,environmentConfigPath:Hc,executionHostId:Ui',',t[425]=Ui').slice(3);
  const ld=new Function('Cc','Hc','Ui','Ac','cd','_o','se','return '+ldSource+';')('/owned/project',null,Ui,roots,originalPermissions,{kind:'local',projectId:'original-id'},()=>{});
  const optionsSource=fragment(content,'e={hostId:l.executionHostId,permissions:l.permissions,workspaceRoots:l.executionRootPaths}',',t[24]=l.executionHostId').slice(2);
  const options=new Function('l','return '+optionsSource+';')(ld);
  assert.equal(options.hostId,SHARED);assert.equal(options.permissions,originalPermissions);assert.equal(options.workspaceRoots,roots);
  assert.equal(read(f.scope,randomUUID(),'original-existing',[],false,{hostId:'original-existing'},'worktree',resolveSharedProjectRenderHost).Ui,'original-existing');
  const unselected={node:{},value:f.scope.value};assert.equal(read(unselected,null,'local',[],false,{hostId:'local'},'worktree',resolveSharedProjectRenderHost).Ui,'local');
 }finally{f.controller.dispose()}
});


test('fixed original HG config/attachment defer reports exact identity after its original onDeferred callback',{skip:!archivePath&&'Requires pinned original Mac archive'},async()=>{
 const {content}=await resources();
 const branch=fragment(content,'if((d||a.submitBlockReason===`loading-local-config`)&&b({type:`composer`,options:u})','s.set(Zo,!0);');
 const run=new Function('d','a','b','y','u','s','wl','globalThis',branch+'return false;');
 for(const kind of ['local','new']){
  const clientThreadId='client-new-thread:'+randomUUID(),events=[],scope={value:kind==='local'?{kind,clientThreadId}:{kind,browserTabMentionConversationId:clientThreadId}},options={onDeferred:()=>events.push('original')};
  assert.equal(run(true,{submitBlockReason:null},()=>true,()=>false,options,scope,()=>null,{__kanbanSharedThreadNavigation:{markComposerDeferred:target=>events.push(target)}}),undefined);
  assert.deepEqual(events,['original',{conversationId:null,clientThreadId}]);
 }
});
