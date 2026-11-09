import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';

const snapshot=process.env.CORE_DIAGNOSTIC_SNAPSHOT;
const repo='/data01/home/xing.hu/vibe_codings/coding_kanban';
const member='webview/assets/composer-content-b926d24ef280.js';
test('private observer is source-pinned and changes only designated response copies',async()=>{
 const {adaptCoreLocalConfigAsset}=await import('./chatgpt-desktop-account-local-config-observer.mjs');
 const paths=[['composer',repo+'/.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/native-browser-capabilities/extracted/mac/'+member],['capability',snapshot+'/packages/chatgpt-desktop-host/src/browser-composer-capability.mjs'],['entry',snapshot+'/packages/chatgpt-desktop-host/src/browser-composer-capability-entry.mjs'],['afterCreated',repo+'/.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/native-browser-capabilities/extracted/mac/webview/assets/app-initial-18b189e867e7.js']];
 for(const [kind,path] of paths){const input=await readFile(path),output=adaptCoreLocalConfigAsset(kind,input);assert.equal(output.originalSha256,createHash('sha256').update(input).digest('hex'));assert.notEqual(output.originalSha256,output.adaptedSha256);assert.throws(()=>adaptCoreLocalConfigAsset(kind,Buffer.concat([input,Buffer.from('x')])))}
});
test('config observation is synchronously scoped to the unique committed composer client and exact project',async()=>{
 const {installCoreLocalConfigObserver}=await import('./chatgpt-desktop-account-local-config-observer.mjs');const context={Symbol,Map,Object,Array};context.globalThis=context;runInNewContext('('+installCoreLocalConfigObserver.toString()+')({projectPath:"/fixture"})',context);
 const read=context[Symbol.for('cg.fixture.config-read.v1')];assert.equal(read(),null);
 context[Symbol.for('cg.fixture.composer-client.v1')]=()=> 'one';const observe=context.__fixtureObserveLocalConfig;
 const state={isAgentModeLoading:false,agentMode:'custom',isWindowsSandboxRequirementPending:false,isWindowsSandboxSetupPending:false,composerMode:'local',workspaceRootsLoading:false,workspaceRootsForSubmit:['/fixture']};
 observe(null,'new',false,state,false,'other');assert.equal(read(),null);observe(null,'new',false,state,false,'one');const x=read();assert.equal(x.pending,false);assert.equal(x.sameProject,true);assert.equal(x.permissionsReady,true);assert.equal(x.targetMatches,true);
 observe(null,'new',true,state,false,'one');assert.equal(read().pending,true);observe(null,'new',false,{...state,workspaceRootsForSubmit:['/elsewhere']},false,'one');assert.equal(read().sameProject,false);
 assert.equal(JSON.stringify(read()).includes('/fixture'),false);assert.equal(JSON.stringify(read()).includes('one'),false);
});
test('readiness requires the observed same project, settled config, local mode and permission state',async()=>{
 const {coreLocalConfigReady}=await import('./chatgpt-desktop-account-local-config-observer.mjs');const state={targetMatches:true,pending:false,permissionsReady:true,composerMode:'local',workspaceRootsLoading:false,sameProject:true};assert.equal(coreLocalConfigReady(state),true);
 for(const change of [{pending:null},{pending:true},{permissionsReady:false},{composerMode:'cloud'},{workspaceRootsLoading:true},{sameProject:false},{targetMatches:false}])assert.equal(coreLocalConfigReady({...state,...change}),false);
 assert.equal(coreLocalConfigReady(null),false);
});
test('observer assets are selected only for the exact owned HTTPS view paths',async()=>{
 const {selectCoreLocalConfigAsset}=await import('./chatgpt-desktop-account-local-config-observer.mjs');const origin='https://10.2.3.4:8443',view='/chatgpt-desktop/p/g/webview/index.html',base=origin+view.slice(0,-'index.html'.length);
 assert.equal(selectCoreLocalConfigAsset(base+'assets/composer-content-b926d24ef280.js',origin,view),'composer');assert.equal(selectCoreLocalConfigAsset(base+'__host/browser-composer-capability.mjs',origin,view),'capability');assert.equal(selectCoreLocalConfigAsset(base+'__host/browser-composer-capability-entry.mjs',origin,view),'entry');
 assert.equal(selectCoreLocalConfigAsset(base+'assets/app-initial-18b189e867e7.js',origin,view),'afterCreated');
 assert.equal(selectCoreLocalConfigAsset(base+'__host/browser-composer-capability.mjs?extra=1',origin,view),null);assert.equal(selectCoreLocalConfigAsset('https://other.invalid'+view,origin,view),null);
});
test('afterCreated observation is synchronous, client-bound, and reports only the target thread hash',async()=>{
 const {installCoreAfterCreatedObserver}=await import('./chatgpt-desktop-account-local-config-observer.mjs');const {webcrypto}=await import('node:crypto');const context={Symbol,Object,crypto:webcrypto,TextEncoder};context.globalThis=context;runInNewContext('('+installCoreAfterCreatedObserver.toString()+')()',context);
 const arm=context[Symbol.for('cg.fixture.after-created-arm.v1')],read=context[Symbol.for('cg.fixture.after-created-read.v1')];assert.equal(arm(),false);context[Symbol.for('cg.fixture.composer-client.v1')]=()=> 'client-a';assert.equal(arm(),true);
 const observe=context.__fixtureObserveAfterCreated;assert.equal(observe('local','client-a','thread-x'),undefined);let state;for(let i=0;i<100;i++){state=read();if(state?.state==='hashed')break;await new Promise(resolve=>setTimeout(resolve,1))}
 assert.equal(state.count,1);assert.equal(state.clientMatches,true);assert.equal(state.threadHash,createHash('sha256').update('thread-x').digest('hex'));assert.doesNotMatch(JSON.stringify(state),/client-a|thread-x/);
 const sameTarget=context[Symbol.for('cg.fixture.after-created-same-target.v1')];context[Symbol.for('cg.fixture.composer-conversation.v1')]=()=> 'thread-x';assert.equal(await sameTarget(),true);context[Symbol.for('cg.fixture.composer-conversation.v1')]=()=> 'thread-y';assert.equal(await sameTarget(),false);
 observe('local','client-a','thread-y');assert.equal(read().state,'ambiguous');
});
test('capability observation checks the unique active composer without rotating its issued scope',async()=>{
 const {adaptCoreLocalConfigAsset}=await import('./chatgpt-desktop-account-local-config-observer.mjs');const path=snapshot+'/packages/chatgpt-desktop-host/src/browser-composer-capability.mjs';const source=adaptCoreLocalConfigAsset('capability',await readFile(path)).body.toString().replace('export function createBrowserComposerCapability','function createBrowserComposerCapability');const create=new Function(source+'\nreturn createBrowserComposerCapability;')();
 const token={},lease={getSnapshot:()=>token,isCurrent:value=>value===token,subscribe:()=>()=>{}};const React={useCallback:f=>f,useLayoutEffect:f=>{f()},useRef:()=>({current:null}),useSyncExternalStore:(_subscribe,get)=>get()};const document={querySelectorAll:()=>[dom]},dom={ownerDocument:document,isConnected:true,getBoundingClientRect:()=>({width:20,height:10})};let visible=true;const win={document,getComputedStyle:()=>({display:visible?'block':'none',visibility:'visible'})},view={dom,editable:true,isDestroyed:false},controller={view,isInputActive:true};
 const cap=create({window:win,React,useComposerController:()=>controller,modeActivation:lease,documentScope:{profileId:'11111111-1111-4111-8111-111111111111',generation:'22222222-2222-4222-8222-222222222222',viewId:'33333333-3333-4333-8333-333333333333'}});
 cap.Registrar({scope:{hostId:'local',conversationId:null,clientThreadId:'client-a',isMain:true},paneLease:lease});const issued=cap.captureScope();assert.equal(cap.fixtureObserveClient(),'client-a');assert.equal(cap.isScopeCurrent(issued),true);visible=false;assert.equal(cap.fixtureObserveClient(),null);visible=true;assert.equal(cap.isScopeCurrent(issued),true);
 assert.equal(cap.fixtureObserveConversation(),null);
});
