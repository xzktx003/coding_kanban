import test from 'node:test';
import assert from 'node:assert/strict';
import * as selection from '../src/browser-shared-project-selection.mjs';
import {createBrowserSharedProjectSelection,resolveSharedProjectHost,useSharedProjectSelection,SharedProjectExecutionItem} from '../src/browser-shared-project-selection.mjs';
const CLIENT='client-new-thread:11111111-1111-7111-8111-111111111111';
function fixture(){
 let token={},ready=true,project={projectKind:'local',projectId:'native-project-id',cwd:'/owned/project'},scopeListeners=new Set(),sourceListeners=new Set();
 const lease={getSnapshot:()=>token,isCurrent:t=>t===token&&token!==null,subscribe:fn=>{scopeListeners.add(fn);return()=>scopeListeners.delete(fn)}};
 const scope={node:{},value:{kind:'new',entrypoint:'home',browserTabMentionConversationId:CLIENT}};
 const controller=createBrowserSharedProjectSelection({window:{},scopeLease:lease,isSourceReady:()=>ready,subscribeSource:fn=>{sourceListeners.add(fn);return()=>sourceListeners.delete(fn)}});
 const record=controller.observe(scope,()=>project),React={useSyncExternalStore:(_s,g)=>g()};
 return {scope,controller,record,React,getProject:()=>project,setProject:value=>{project=value},setReady:v=>{ready=v;for(const fn of sourceListeners)fn()},setActive:v=>{token=v?{}:null;for(const fn of scopeListeners)fn()},dispose:()=>controller.dispose()};
}
const click={isTrusted:true,type:'click'};
test('only a trusted selection of the original scoped native project chooses the registered shared host',()=>{
 const f=fixture();try{
  assert.equal(resolveSharedProjectHost(f.scope,'local',null),'local');
  assert.equal(f.record.select({isTrusted:false,type:'click'}),false);
  assert.equal(f.record.select(click),true);
  assert.equal(resolveSharedProjectHost(f.scope,'local',null),'kanban-shared-cli');
  assert.equal(resolveSharedProjectHost(f.scope,'some-existing-manager','real-thread'),'some-existing-manager');
  assert.deepEqual(f.getProject(),{projectKind:'local',projectId:'native-project-id',cwd:'/owned/project'});
  assert.equal(f.record.clear({isTrusted:false,type:'click'}),false);
  assert.equal(f.record.clear(click),true);
  assert.equal(resolveSharedProjectHost(f.scope,'local',null),'local');
 }finally{f.dispose()}
});
test('unavailable, hidden, changed target or changed client never falls back to the private local host',()=>{
 const f=fixture();try{
  f.record.select(click);f.setReady(false);
  assert.throws(()=>resolveSharedProjectHost(f.scope,'local',null),{code:'SHARED_PROJECT_SELECTION_UNAVAILABLE'});
  f.setReady(true);assert.throws(()=>resolveSharedProjectHost(f.scope,'local',null),{code:'SHARED_PROJECT_SELECTION_UNAVAILABLE'});
  f.record.select(click);f.setActive(false);assert.equal(f.record.select(click),false);
  f.setActive(true);assert.throws(()=>resolveSharedProjectHost(f.scope,'local',null),{code:'SHARED_PROJECT_SELECTION_UNAVAILABLE'});
  f.record.select(click);f.setProject({...f.getProject(),cwd:'/owned/other'});
  assert.throws(()=>resolveSharedProjectHost(f.scope,'local',null),{code:'SHARED_PROJECT_SELECTION_UNAVAILABLE'});
  f.record.select(click);f.scope.value={...f.scope.value,browserTabMentionConversationId:'client-new-thread:22222222-2222-7222-8222-222222222222'};
  assert.throws(()=>resolveSharedProjectHost(f.scope,'local',null),{code:'SHARED_PROJECT_SELECTION_UNAVAILABLE'});
  f.scope.value={kind:'new',entrypoint:'home',browserTabMentionConversationId:null};
  assert.throws(()=>resolveSharedProjectHost(f.scope,'local',null),{code:'SHARED_PROJECT_SELECTION_UNAVAILABLE'});
 }finally{f.dispose()}
});
test('per-composer separation and actual source readiness are required, with no native RPC or fabricated project',()=>{
 const f=fixture();try{
  const other={node:{},value:{...f.scope.value,browserTabMentionConversationId:'client-new-thread:33333333-3333-7333-8333-333333333333'}};
  const second=f.controller.observe(other,()=>f.getProject());f.record.select(click);
  assert.equal(resolveSharedProjectHost(other,'local',null),'local');
  f.setReady(false);assert.equal(second.select(click),false);f.setReady(true);
  f.setProject({projectKind:'remote',projectId:'native-remote',cwd:'/owned/project'});assert.equal(second.select(click),false);
  f.setProject({projectKind:'local',projectId:'native-project-id',cwd:'~'});assert.equal(second.select(click),false);
 }finally{f.dispose()}
 assert.throws(()=>resolveSharedProjectHost(f.scope,'local',null),{code:'SHARED_PROJECT_SELECTION_UNAVAILABLE'});
});
test('actual menu/wr/content wrappers share one record and publish by their identical original node',()=>{
 const f=fixture(),wr={node:f.scope.node,value:{...f.scope.value}},content={node:f.scope.node,value:{...f.scope.value}};
 try{
  assert.notEqual(wr,f.scope);assert.notEqual(content,f.scope);assert.equal(wr.node,f.scope.node);
  const wrRecord=f.controller.observe(wr),contentRecord=f.controller.observe(content);let wrUpdates=0,contentUpdates=0;
  const stopWr=wrRecord.subscribe(()=>wrUpdates++),stopContent=contentRecord.subscribe(()=>contentUpdates++);
  assert.equal(wrRecord,f.record);assert.equal(contentRecord,f.record);
  assert.equal(f.record.select(click),true);assert.equal(wrUpdates,1);assert.equal(contentUpdates,1);
  for(const scope of [f.scope,wr,content]){
   assert.equal(selection.resolveSharedProjectRenderHost(scope,'local',null),'kanban-shared-cli');
   assert.equal(resolveSharedProjectHost(scope,'local',null),'kanban-shared-cli');
   assert.equal(useSharedProjectSelection(scope,f.React).selected,true);
  }
  f.setActive(false);assert.equal(useSharedProjectSelection(wr,f.React).available,false);
  f.setActive(true);assert.throws(()=>resolveSharedProjectHost(content,'local',null),{code:'SHARED_PROJECT_SELECTION_UNAVAILABLE'});
  f.record.select(click);assert.equal(resolveSharedProjectHost(wr,'local',null),'kanban-shared-cli');
  stopWr();stopContent();
 }finally{f.dispose()}
});
test('different nodes remain isolated even with the same client and missing or malformed nodes cannot select',()=>{
 const f=fixture();try{
  f.record.select(click);
  const other={node:{},value:{...f.scope.value}},otherRecord=f.controller.observe(other,()=>f.getProject());
  assert.notEqual(otherRecord,f.record);assert.equal(otherRecord.getSnapshot().selected,false);
  assert.equal(resolveSharedProjectHost(other,'local',null),'local');
  for(const node of [undefined,null,'node',1,[],()=>{}]){
   const scope={node,value:{...f.scope.value}},record=f.controller.observe(scope,()=>f.getProject());
   assert.equal(record.getSnapshot().enabled,false);assert.equal(record.select(click),false);
   assert.throws(()=>resolveSharedProjectHost(scope,'local',null),{code:'SHARED_PROJECT_SELECTION_UNAVAILABLE'});
  }
 }finally{f.dispose()}
});
test('same-node records follow the current wrapper and cannot revive an approval after client or project returns',()=>{
 const f=fixture(),next={node:f.scope.node,value:{...f.scope.value,browserTabMentionConversationId:'client-new-thread:22222222-2222-7222-8222-222222222222'}};
 try{
  f.record.select(click);const record=f.controller.observe(next,()=>f.getProject());
  assert.equal(record.getSnapshot().available,false);
  f.controller.observe(f.scope,()=>f.getProject());assert.equal(f.record.getSnapshot().available,false);
  assert.throws(()=>resolveSharedProjectHost(f.scope,'local',null),{code:'SHARED_PROJECT_SELECTION_UNAVAILABLE'});
  f.record.select(click);f.setProject({...f.getProject(),cwd:'/owned/changed'});assert.equal(f.record.getSnapshot().available,false);
  f.setProject({...f.getProject(),cwd:'/owned/project'});assert.equal(f.record.getSnapshot().available,false);
  f.record.select(click);assert.equal(resolveSharedProjectHost(f.scope,'local',null),'kanban-shared-cli');
 }finally{f.dispose()}
});
test('the exact original pending local main composer contract supports project new chats without broadening entrypoints',()=>{
 const f=fixture();try{
  // ABt(client-local-thread) calls kBt(null, main, null, original client ID).
  f.scope.value={kind:'local',placement:'main',conversationId:null,routeConversationId:null,clientThreadId:CLIENT,browserTabMentionConversationId:CLIENT};
  assert.equal(f.record.getSnapshot().canSelect,true);
  assert.equal(f.record.select(click),true);assert.equal(resolveSharedProjectHost(f.scope,'local',null),'kanban-shared-cli');
  const valid=f.scope.value;
  for(const value of [
   {...valid,placement:'side'}, {...valid,conversationId:'already-created'}, {...valid,routeConversationId:'already-created'},
   {...valid,browserTabMentionConversationId:'client-new-thread:22222222-2222-7222-8222-222222222222'},
   {...valid,clientThreadId:'11111111-1111-7111-8111-111111111111',browserTabMentionConversationId:'11111111-1111-7111-8111-111111111111'},
   {...valid,persistentWorkspace:{allowExecutionSelection:false,session:{conversationId:null}}},
   {kind:'new',entrypoint:'panel',browserTabMentionConversationId:CLIENT},
   {kind:'new',entrypoint:'library-preview',browserTabMentionConversationId:CLIENT},
   {kind:'new',entrypoint:'home',browserTabMentionConversationId:CLIENT+'-extra'},
  ]){f.scope.value=value;assert.equal(f.record.select(click),false);assert.equal(f.record.getSnapshot().enabled,false)}
 }finally{f.dispose()}
});
test('the original menu item handlers accept real click and keyboard gestures and preserve stable hook snapshots',()=>{
 const f=fixture();try{
  const jsx=(type,props)=>({type,props}),Item=()=>{},output=SharedProjectExecutionItem({scope:f.scope,React:f.React,jsx,MenuItem:Item});
  assert.equal(output.type,Item);assert.equal(output.props.disabled,false);
  output.props.onClick({isTrusted:false,type:'click'});assert.equal(f.record.getSnapshot().selected,false);
  output.props.onKeyDown({isTrusted:true,type:'keydown',key:'Enter'});assert.equal(f.record.getSnapshot().selected,true);
  const one=useSharedProjectSelection(f.scope,f.React),two=useSharedProjectSelection(f.scope,f.React);assert.equal(one,two);
  output.props.onClick(click);assert.equal(resolveSharedProjectHost(f.scope,'local',null),'kanban-shared-cli');
 }finally{f.dispose()}
});

test('render keeps the shared intent through hide/show and a project change, while submit needs a new trusted selection',()=>{
 const f=fixture(),renderHost=selection.resolveSharedProjectRenderHost??resolveSharedProjectHost;
 const render=()=>({hostId:renderHost(f.scope,'local',null),state:useSharedProjectSelection(f.scope,f.React)});
 const menu=()=>SharedProjectExecutionItem({scope:f.scope,React:f.React,jsx:(type,props)=>({type,props}),MenuItem:()=>{}});
 let sends=0;
 try{
  assert.equal(render().hostId,'local');f.record.select(click);
  assert.equal(render().hostId,'kanban-shared-cli');
  f.setActive(false);
  assert.doesNotThrow(render,'render must not enter an error boundary on hide');
  assert.equal(render().hostId,'kanban-shared-cli');assert.equal(render().state.available,false);
  assert.equal(menu().props.disabled,true);
  assert.throws(()=>{resolveSharedProjectHost(f.scope,'local',null);sends++},{code:'SHARED_PROJECT_SELECTION_UNAVAILABLE'});
  f.setActive(true);assert.equal(render().hostId,'kanban-shared-cli');assert.equal(render().state.available,false);assert.equal(menu().props.disabled,false);
  assert.equal(sends,0,'show must not send or re-authorize');
  menu().props.onClick({isTrusted:false,type:'click'});assert.equal(render().state.available,false);
  menu().props.onClick(click);assert.equal(render().state.available,true);assert.equal(resolveSharedProjectHost(f.scope,'local',null),'kanban-shared-cli');
  f.setProject({...f.getProject(),projectId:'new-native-id',cwd:'/owned/new-project'});
  assert.doesNotThrow(render);assert.equal(render().hostId,'kanban-shared-cli');assert.equal(render().state.available,false);
  assert.throws(()=>{resolveSharedProjectHost(f.scope,'local',null);sends++},{code:'SHARED_PROJECT_SELECTION_UNAVAILABLE'});
  menu().props.onKeyDown({isTrusted:true,type:'keydown',key:'Enter'});assert.equal(render().state.available,true);
  assert.equal(sends,0,'reselection only changes local intent');
  f.record.clear(click);assert.equal(render().hostId,'local');
 }finally{f.dispose()}
});
test('source retirement does not throw in rendering or revive a revoked submit after ready returns',()=>{
 const f=fixture(),renderHost=selection.resolveSharedProjectRenderHost??resolveSharedProjectHost;
 try{
  f.record.select(click);f.setReady(false);assert.equal(renderHost(f.scope,'local',null),'kanban-shared-cli');
  assert.equal(f.record.getSnapshot().available,false);assert.equal(f.record.getSnapshot().canSelect,false);
  f.setReady(true);assert.equal(renderHost(f.scope,'local',null),'kanban-shared-cli');
  assert.throws(()=>resolveSharedProjectHost(f.scope,'local',null),{code:'SHARED_PROJECT_SELECTION_UNAVAILABLE'});
  f.record.select(click);assert.equal(resolveSharedProjectHost(f.scope,'local',null),'kanban-shared-cli');
  assert.equal(renderHost(f.scope,'existing-manager','existing-thread'),'existing-manager');
 }finally{f.dispose()}
 assert.equal(renderHost(f.scope,'local',null),'kanban-shared-cli');
 assert.throws(()=>resolveSharedProjectHost(f.scope,'local',null),{code:'SHARED_PROJECT_SELECTION_UNAVAILABLE'});
});
test('the pinned original ABt/kBt and nCt functions produce supported home and pending-project scope identities',{skip:!process.env.CHATGPT_DESKTOP_SHARED_SCOPE_ASSET_DIR},async()=>{
 const {readFile}=await import('node:fs/promises'),{join}=await import('node:path'),{createHash}=await import('node:crypto');
 const directory=process.env.CHATGPT_DESKTOP_SHARED_SCOPE_ASSET_DIR;
 const [initial,shared]=await Promise.all(['app-initial-18b189e867e7.js','app-shared-601019a330d7.js'].map(name=>readFile(join(directory,name))));
 const sha=value=>createHash('sha256').update(value).digest('hex');
 assert.equal(sha(initial),'244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032');
 assert.equal(sha(shared),'02dd01d1e7c076ec44f10bb8446976f07be9eb007d1c32445adf5cda13221116');
 const first=initial.toString(),second=shared.toString(),predicateSource=second.slice(second.indexOf('function K7e(e)'),second.indexOf('function q7e(e)'));
 assert.match(second,/\$7e=`client-new-thread:`/);
 const predicate=new Function('$7e',`return (${predicateSource})`)('client-new-thread:');
 assert.equal(predicate(CLIENT),true);assert.equal(predicate(CLIENT.slice('client-new-thread:'.length)),false);
 const generatorSource=first.slice(first.indexOf('function kBt('),first.indexOf('function jBt('));
 const generate=new Function('Fx','Cs','Sx','BFt',generatorSource+';return ABt;')(()=>null,predicate,value=>'local:'+value,()=>null);
 const home=generate({routeKind:'home',pathname:'/projects'},undefined,CLIENT);
 const pending=generate({routeKind:'client-local-thread',clientThreadId:CLIENT});
 assert.deepEqual(pending,{kind:'local',placement:'main',conversationId:null,routeConversationId:null,clientThreadId:CLIENT,browserTabMentionConversationId:CLIENT});
 const f=fixture();try{
  for(const value of [home,pending]){f.scope.value=value;assert.equal(f.record.getSnapshot().canSelect,true);assert.equal(f.record.select(click),true);assert.equal(resolveSharedProjectHost(f.scope,'local',null),'kanban-shared-cli')}
  f.scope.value=generate({routeKind:'new-thread-panel'},undefined,CLIENT);assert.equal(f.record.getSnapshot().enabled,false);
  f.scope.value=generate({routeKind:'local-thread',conversationId:'44444444-4444-7444-8444-444444444444'},undefined,CLIENT);assert.equal(f.record.getSnapshot().enabled,false);
 }finally{f.dispose()}
});
