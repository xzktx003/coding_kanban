import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createBrowserSharedProjectSelectionAssetAdapter as create,SHARED_PROJECT_SELECTION_REFERENCE as ref} from '../src/browser-shared-project-selection-assets.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const require=createRequire(new URL('../../../apps/web/package.json',import.meta.url));

// Retain the entire shipped function, including declarations after the
// checkpoint. Extracting the prefix alone would hide lexical TDZ shadowing.
function replayOriginalHead(source,name,environment){
 const ts=require('typescript'),ast=ts.createSourceFile('original-menu.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const node=ast.statements.find(value=>ts.isFunctionDeclaration(value)&&value.name?.text===name);
 assert.ok(node,`missing original component ${name}`);
 const fn=node.getText(ast),checkpoint=fn.indexOf(name==='_n'?'let t=(0,bn.c)':'let t=(0,sr.c)');
 assert.ok(checkpoint>0,'missing original compiler cache checkpoint');
 const code=fn.slice(0,checkpoint)+'return {scope:__kanbanSharedScope,project:__kanbanSharedProject,roots:__kanbanSharedRoots,state:__kanbanSharedState};'+fn.slice(checkpoint);
 const keys=Object.keys(environment),run=new Function(...keys,`return (${code})({})`);
 return run(...keys.map(key=>environment[key]));
}
test('only the exact fixed shared location menu is adapted under the original resource byte budget',()=>{
 assert.throws(()=>create({archiveSha256:'other'}),{code:'SHARED_PROJECT_MENU_UNSUPPORTED_ARCHIVE'});
 assert.throws(()=>create({archiveSha256:ref.archiveSha256,http:true}),{code:'SHARED_PROJECT_MENU_UNSUPPORTED_ARCHIVE'});
 const adapter=create({archiveSha256:ref.archiveSha256});assert.deepEqual(adapter.members,[ref.member]);
 assert.equal(adapter.adapt({member:'other',body:Buffer.alloc(0)}),null);
 assert.throws(()=>adapter.adapt({member:ref.member,body:Buffer.from('other')}),{code:'SHARED_PROJECT_MENU_DIGEST_MISMATCH'});
 assert.throws(()=>adapter.adapt({member:ref.member,body:Buffer.alloc(65537)}),{code:'SHARED_PROJECT_MENU_RESOURCE_LIMIT'});
});
test('the actual original menu reads original composer/project/root state and renders the shared choice through original Menu.Item',{skip:!process.env.CHATGPT_DESKTOP_SHARED_SELECTION_ASSET_DIR},async()=>{
 const body=await readFile(join(process.env.CHATGPT_DESKTOP_SHARED_SELECTION_ASSET_DIR,ref.member.split('/').at(-1))),adapter=create({archiveSha256:ref.archiveSha256});
 assert.equal(sha(body),ref.originalSha256);const out=adapter.adapt({member:ref.member,body}),s=out.body.toString('utf8');assert.equal(sha(out.body),ref.adaptedSha256);
 assert.match(s,/w6n as __kanbanSharedComposerScope,_Vn as __kanbanSharedProjectRoots/);
 assert.equal(s.split('scope:__kanbanSharedScope,React:').length-1,2,'both original menu layouts have the item');
 assert.match(s,/get\(__kanbanSharedProjectAtom\),t=__kanbanSharedScope.get\(__kanbanSharedProjectRoots,e\)/);
 assert.match(s,/pWt as __kanbanSharedReactFactory/);
 assert.match(s,/MenuItem:b.Item/);assert.match(s,/useSharedProjectSelection/);assert.doesNotMatch(s,/setFeature|3296668107|coding-kanban-real|\/data01/);
 assert.throws(()=>adapter.adapt({member:ref.member,body:out.body}),{code:'SHARED_PROJECT_MENU_DIGEST_MISMATCH'});
});
test('both actual original component scopes avoid TDZ and pass the original React namespace to the selection hook',{skip:!process.env.CHATGPT_DESKTOP_SHARED_SELECTION_ASSET_DIR},async()=>{
 const body=await readFile(join(process.env.CHATGPT_DESKTOP_SHARED_SELECTION_ASSET_DIR,ref.member.split('/').at(-1)));
 const source=create({archiveSha256:ref.archiveSha256}).adapt({member:ref.member,body}).body.toString();
 const composerType={},projectAtom={},rootAtom={},nativeProject={type:'local',projectId:'real-apphost-id'},nativeRoots=['/owned/actual-root'];
 const React=Object.freeze({useSyncExternalStore(){}}),scope={get(key,value){if(key===projectAtom)return nativeProject;assert.equal(key,rootAtom);assert.equal(value,nativeProject);return nativeRoots}};
 let calls=0,factoryCalls=0;
 const useScope=type=>{assert.equal(type,composerType);return scope},useAtom=atom=>scope.get(atom),useFamily=(atom,value)=>scope.get(atom,value);
 const hook=(actualScope,actualReact,reader)=>{calls++;assert.equal(actualScope,scope);assert.equal(actualReact,React);assert.deepEqual(reader(),{projectKind:'local',projectId:'real-apphost-id',cwd:'/owned/actual-root'});return {canSelect:true}};
 const poisoned=()=>{throw Error('INJECTED_HOOK_USED_SHADOWABLE_ORIGINAL_ALIAS')};
 const environment={fe:poisoned,M:poisoned,B:poisoned,lt:projectAtom,xn:null,cr:null,__kanbanSharedComposerScope:composerType,__kanbanSharedProjectRoots:rootAtom,__kanbanUseSharedProjectSelection:hook,
  __kanbanSharedUseScope:useScope,__kanbanSharedUseAtom:useAtom,__kanbanSharedUseFamily:useFamily,__kanbanSharedReactFactory:()=>{factoryCalls++;return React},__kanbanSharedProjectAtom:projectAtom};
 for(const name of ['_n','$n']){
  const result=replayOriginalHead(source,name,environment);
  assert.equal(result.scope,scope);assert.equal(result.project,nativeProject);assert.equal(result.roots,nativeRoots);assert.equal(result.state.canSelect,true);
 }
 assert.equal(calls,2);
 assert.equal(factoryCalls,2,'read original React only during each component call');
});
test('the adapted original scope reader feeds the unchanged native local project identity and current root to the selection model',{skip:!process.env.CHATGPT_DESKTOP_SHARED_SELECTION_ASSET_DIR},async()=>{
 const {createBrowserSharedProjectSelection,useSharedProjectSelection,resolveSharedProjectHost}=await import('../src/browser-shared-project-selection.mjs');
 const body=await readFile(join(process.env.CHATGPT_DESKTOP_SHARED_SELECTION_ASSET_DIR,ref.member.split('/').at(-1)));
 const output=create({archiveSha256:ref.archiveSha256}).adapt({member:ref.member,body}).body.toString();
 const projectAtom={},rootAtom={},scopeType={};let selectedProject={type:'local',projectId:'real-apphost-project-id'},root='/owned/actual-project';
 const scope={node:{},value:{kind:'new',entrypoint:'home',browserTabMentionConversationId:'client-new-thread:11111111-1111-7111-8111-111111111111'},get(atom,value){if(atom===projectAtom)return selectedProject;assert.equal(atom,rootAtom);assert.equal(value,selectedProject);return[root]}};
 const token={},controller=createBrowserSharedProjectSelection({window:{},scopeLease:{getSnapshot:()=>token,isCurrent:t=>t===token,subscribe:()=>()=>{}},isSourceReady:()=>true,subscribeSource:()=>()=>{}});
 try{
  const React={useSyncExternalStore:(_s,g)=>g()};
  const result=replayOriginalHead(output,'$n',{
   __kanbanSharedUseScope:type=>{assert.equal(type,scopeType);return scope},__kanbanSharedUseAtom:atom=>scope.get(atom),__kanbanSharedUseFamily:(atom,arg)=>scope.get(atom,arg),
   __kanbanSharedProjectAtom:projectAtom,__kanbanSharedComposerScope:scopeType,__kanbanSharedProjectRoots:rootAtom,__kanbanUseSharedProjectSelection:useSharedProjectSelection,__kanbanSharedReactFactory:()=>React,
  });
  assert.equal(result.state.canSelect,true);
  assert.equal(controller.observe(scope).select({isTrusted:true,type:'click'}),true);assert.equal(resolveSharedProjectHost(scope,'local',null),'kanban-shared-cli');
  root='/owned/different-project';assert.throws(()=>resolveSharedProjectHost(scope,'local',null),{code:'SHARED_PROJECT_SELECTION_UNAVAILABLE'});
  assert.deepEqual(selectedProject,{type:'local',projectId:'real-apphost-project-id'});
 }finally{controller.dispose()}
});
