import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCoreFixtureState, parseFrozenSourceManifest, coreViewCloseEvidence, coreBridgeFailureFromAttributes, coreWelcomeReady, coreComposerElements, coreFrameNavigationDecision, coreModelTriggerElements } from './chatgpt-desktop-account-core-fixture.mjs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

test('project creation preserves bounded exception details for the private diagnostic journal',async()=>{
 const {evaluateCoreProjectCreate}=await import('./chatgpt-desktop-account-core-fixture.mjs');
 const base=await mkdtemp(join(tmpdir(),'core-project-error-'));const previous=Object.getOwnPropertyDescriptor(globalThis,'location');
 try{await mkdir(join(base,'assets'));await writeFile(join(base,'package.json'),'{"type":"module"}');await writeFile(join(base,'assets/app-shared-601019a330d7.js'),`export const Vct={projects:{async createLocal(){const e=new Error('project fault '+ 'x'.repeat(6000));e.code='FIXTURE_RPC_ERROR';throw e}}}`);Object.defineProperty(globalThis,'location',{configurable:true,value:{href:pathToFileURL(join(base,'index.html')).href}});
  const result=await evaluateCoreProjectCreate(null,'/fixture');assert.equal(result.outcome,'error');assert.equal(result.phase,'rpc');assert.equal(result.diagnostic.name,'Error');assert.equal(result.diagnostic.code,'FIXTURE_RPC_ERROR');assert.match(result.diagnostic.message,/project fault/);assert.ok(result.diagnostic.message.length<=4096);assert.ok(result.diagnostic.stack.length<=4096);
 }finally{if(previous)Object.defineProperty(globalThis,'location',previous);else delete globalThis.location;await rm(base,{recursive:true,force:true})}
});

test('project creation and readback receive the supplied path rather than the locator element',async()=>{
 const {evaluateCoreProjectCreate,evaluateCoreProjectSelection}=await import('./chatgpt-desktop-account-core-fixture.mjs');
 const base=await mkdtemp(join(tmpdir(),'core-project-arguments-'));const previous=Object.getOwnPropertyDescriptor(globalThis,'location');
 try{await mkdir(join(base,'assets'));await writeFile(join(base,'package.json'),'{"type":"module"}');await writeFile(join(base,'assets/app-shared-601019a330d7.js'),`export const Fst=x=>x;export const Vct={projects:{async createLocal(p){return {projectId:'p',rootPaths:p.sources}}},projectCatalog:{readSelection(){return {type:'local',projectId:'p'}},readLocalProjects(){return {p:{rootPaths:['/fixture']}}}},workspaceRoots:{read(){return {roots:['/fixture']}}}}`);Object.defineProperty(globalThis,'location',{configurable:true,value:{href:pathToFileURL(join(base,'index.html')).href}});
  const element={body:true};assert.deepEqual(await evaluateCoreProjectCreate(element,'/fixture'),{outcome:'created',id:'p',rootMatches:true});assert.deepEqual(await evaluateCoreProjectSelection(element,{projectPath:'/fixture',id:'p'}),{outcome:'ok',value:{selectedLocal:true,selectedCreated:true,projectRootOnly:true,workspaceRootOnly:true,onlyProject:true}});
 }finally{if(previous)Object.defineProperty(globalThis,'location',previous);else delete globalThis.location;await rm(base,{recursive:true,force:true})}
});

test('project receipt accepts no prompt or a confirmed prompt, and fails closed on unanswered trust',async()=>{
 const {coreProjectReceiptAccepted}=await import('./chatgpt-desktop-account-core-fixture.mjs');
 const base={receipt:'created',rootMatches:true,trustDialogObserved:false,trustConfirmed:false};assert.equal(coreProjectReceiptAccepted(base),true);
 assert.equal(coreProjectReceiptAccepted({...base,trustDialogObserved:true}),false);assert.equal(coreProjectReceiptAccepted({...base,trustDialogObserved:true,trustConfirmed:true}),true);
 assert.equal(coreProjectReceiptAccepted({...base,trustConfirmed:true}),false);assert.equal(coreProjectReceiptAccepted({...base,receipt:'unknown'}),false);assert.equal(coreProjectReceiptAccepted({...base,rootMatches:false}),false);
});

test('project sidebar navigation is attempted once only when the original target is uniquely visible and no composer exists',async()=>{
 const {coreProjectNavigationDecision}=await import('./chatgpt-desktop-account-core-fixture.mjs');
 assert.equal(coreProjectNavigationDecision({composers:0,projects:1,clicked:false}),'click');
 assert.equal(coreProjectNavigationDecision({composers:1,projects:1,clicked:false}),'wait');
 for(const input of [{composers:0,projects:0,clicked:false},{composers:0,projects:2,clicked:false},{composers:0,projects:1,clicked:true},{composers:null,projects:1,clicked:false}])assert.equal(coreProjectNavigationDecision(input),'wait');
});

test('fixture JSON errors and read-only RPC errors retain private bounded original details',async()=>{
 const {evaluateCoreFixtureState,evaluateCoreAccountVerifier,evaluateCoreProjectSelection}=await import('./chatgpt-desktop-account-core-fixture.mjs');
 const base=await mkdtemp(join(tmpdir(),'core-rpc-error-'));const oldLocation=Object.getOwnPropertyDescriptor(globalThis,'location'),oldFetch=globalThis.fetch;
 try{await mkdir(join(base,'assets'));await writeFile(join(base,'package.json'),'{"type":"module"}');await writeFile(join(base,'assets/app-shared-601019a330d7.js'),`export const Fst=x=>x;export const Vct={tppLocalExecutor:{getState(){throw new TypeError('rpc fault')}},settings:{read(){return {configured:'STEPS_COMMANDS'}}},projectCatalog:{readSelection(){throw new RangeError('readback fault')}}}`);Object.defineProperty(globalThis,'location',{configurable:true,value:{href:pathToFileURL(join(base,'index.html')).href}});
  globalThis.fetch=async()=>({ok:true,json:async()=>{throw new SyntaxError('bad fixture json')}});
  const fixture=await evaluateCoreFixtureState();assert.equal(fixture.outcome,'error');assert.equal(fixture.phase,'json');assert.equal(fixture.diagnostic.name,'SyntaxError');assert.match(fixture.diagnostic.stack,/bad fixture json/);
  const verifier=await evaluateCoreAccountVerifier(null);assert.equal(verifier.workStatus,'error');assert.equal(verifier.settingsStatus,'ok');assert.equal(verifier.diagnostics[0].name,'TypeError');assert.match(verifier.diagnostics[0].message,/rpc fault/);
  const selection=await evaluateCoreProjectSelection(null,{projectPath:'/fixture',id:'p'});assert.equal(selection.outcome,'error');assert.equal(selection.phase,'rpc');assert.equal(selection.diagnostic.name,'RangeError');assert.match(selection.diagnostic.message,/readback fault/);
 }finally{globalThis.fetch=oldFetch;if(oldLocation)Object.defineProperty(globalThis,'location',oldLocation);else delete globalThis.location;await rm(base,{recursive:true,force:true})}
});

test('fixed fixture requires the same private HOME and empty owned project under the same profile', async () => {
 const base=await mkdtemp(join(tmpdir(),'core-fixture-test-'));await chmod(base,0o700);
 try {
  const home=join(base,'home'),project=join(home,'fixture-project');await mkdir(home,{mode:0o700});await mkdir(project,{mode:0o700});
  const options={home,project,homeIdentity:await lstat(home,{bigint:true}),projectIdentity:await lstat(project,{bigint:true}),uid:process.getuid(),profileId:'fixture-id',generation:'fixture-generation',profileService:{readValidated:async()=>({status:{state:'ready'},profile:{id:'fixture-id',generation:'fixture-generation'}})}};
  assert.deepEqual(await readCoreFixtureState(options),{owned:true,empty:true,profile:true});
  await writeFile(join(project,'unexpected'),'x');assert.deepEqual(await readCoreFixtureState(options),{owned:true,empty:false,profile:true});
  await rm(join(project,'unexpected'));await rename(project,join(home,'old'));await mkdir(project,{mode:0o700});assert.equal((await readCoreFixtureState(options)).owned,false);
  options.profileService={readValidated:async()=>({status:{state:'ready'},profile:{id:'other',generation:'fixture-generation'}})};
  assert.equal((await readCoreFixtureState(options)).profile,false);
 } finally {await rm(base,{recursive:true,force:true});}
});

test('frozen source manifest is digest-pinned and rejects traversal, duplicates and drift', () => {
 const good=Buffer.from(`${'a'.repeat(64)}  packages/example.mjs\n${'b'.repeat(64)}  apps/server/example.ts\n`);
 const digest=createHash('sha256').update(good).digest('hex');
 assert.equal(parseFrozenSourceManifest(good,digest,2).length,2);
 assert.throws(()=>parseFrozenSourceManifest(Buffer.concat([good,Buffer.from('x')]),digest,2));
 for(const lines of [`${'a'.repeat(64)}  ../escape\n`,`${'a'.repeat(64)}  a\n${'b'.repeat(64)}  a\n`]) {
  const body=Buffer.from(lines),sha=createHash('sha256').update(body).digest('hex');assert.throws(()=>parseFrozenSourceManifest(body,sha,lines.includes('../')?1:2));
 }
});

test('bootstrap and broker retirement are not misreported as an observed viewClosed event',()=>{
 assert.deepEqual(coreViewCloseEvidence({bootstrapCount:1,viewClosedCount:0,brokerClosed:true}),{brokerCloseConfirmed:true,viewClosedConfirmed:null});
 assert.deepEqual(coreViewCloseEvidence({bootstrapCount:1,viewClosedCount:1,brokerClosed:true}),{brokerCloseConfirmed:true,viewClosedConfirmed:null});
 assert.deepEqual(coreViewCloseEvidence({bootstrapCount:0,viewClosedCount:0,brokerClosed:true}),{brokerCloseConfirmed:true,viewClosedConfirmed:null});
});

test('only a later viewClosed receipt for the exact retired scope confirms closure',()=>{
 const scope={profileId:'11111111-1111-1111-1111-111111111111',generation:'22222222-2222-2222-2222-222222222222',viewId:'33333333-3333-3333-3333-333333333333'};
 const input={brokerClosed:true,expectedScope:scope,destroyObservedSequence:4,receipt:{type:'viewClosed',scope:{...scope},observedSequence:5}};
 assert.deepEqual(coreViewCloseEvidence(input),{brokerCloseConfirmed:true,viewClosedConfirmed:true});
 for(const receipt of [{...input.receipt,observedSequence:4},{...input.receipt,type:'return'},{...input.receipt,scope:{...scope,viewId:'44444444-4444-4444-4444-444444444444'}},{...input.receipt,scope:{...scope,generation:'44444444-4444-4444-4444-444444444444'}}])assert.equal(coreViewCloseEvidence({...input,receipt}).viewClosedConfirmed,null);
});

test('readiness records only the product bridge failure enum and otherwise unknown',()=>{
 assert.equal(coreBridgeFailureFromAttributes('ENTRY_BRIDGE_FAILED','BRIDGE_QUEUE_FULL'),'BRIDGE_QUEUE_FULL');
 assert.equal(coreBridgeFailureFromAttributes('ENTRY_BRIDGE_FAILED','BRIDGE_OUTCOME_UNKNOWN'),'BRIDGE_OUTCOME_UNKNOWN');
 for(const [entry,code] of [['ENTRY_BRIDGE_FAILED',null],['ENTRY_BRIDGE_FAILED','secret-path'],['ENTRY_OTHER','BRIDGE_QUEUE_FULL'],[null,'BRIDGE_QUEUE_FULL']])assert.equal(coreBridgeFailureFromAttributes(entry,code),'unknown');
});

function shownElement(tag,{text='',attributes={},disabled=false,readOnly=false,width=120,height=32,display='block',visibility='visible'}={}){
 const element={tag,textContent:text,isConnected:true,disabled,readOnly,attributes:{...attributes},style:{display,visibility},getAttribute(name){return Object.prototype.hasOwnProperty.call(this.attributes,name)?this.attributes[name]:null},matches(selector){return selector.split(',').every(part=>part.trim().split(/(?<=\])(?=\[)/).every(token=>{if(!token.startsWith('['))return this.tag===token;const body=token.slice(1,-1),eq=body.indexOf('=');if(eq<0)return this.getAttribute(body)!==null;return this.getAttribute(body.slice(0,eq))===body.slice(eq+2,-1)}))},getBoundingClientRect(){return {width,height}},ownerDocument:{defaultView:{getComputedStyle:target=>target.style}}};
 return element;
}
function fakeRoot(elements){return {querySelectorAll(selector){return elements.filter(element=>element.matches(selector))}}}

test('random original welcome copy is not required and a fixed heading tag is not the signal',()=>{
 for(const text of ['What should we build?','What should we build in kanban?','How can I help, Ada?','Good to see you, Ada.','Hey, Ada. Ready to dive in?'])assert.equal(coreWelcomeReady(text),true);
 assert.equal(coreWelcomeReady('What can I help you with today?'),false);
 assert.equal(coreWelcomeReady(''),false);
 assert.equal(coreWelcomeReady('Codex\nWhat should we build?'),false);
 assert.equal(coreWelcomeReady('What should we brainstorm?'),false);
 assert.equal(coreWelcomeReady('Codex is ready'),false);
});

test('the original composer is accepted on any visible tag and rejected when its attributes are missing',()=>{
 const composer=shownElement('section',{attributes:{'data-codex-composer':'','contenteditable':'true','role':'group'}});
 const wrong=shownElement('div',{attributes:{contenteditable:'true','role':'textbox'}});
 const hidden=shownElement('div',{attributes:{'data-codex-composer':'','contenteditable':'true'},display:'none'});
 const covered=shownElement('div',{attributes:{'data-codex-composer':'','contenteditable':'true'}});covered.parentElement={hidden:true,parentElement:null,getAttribute(){return null},hasAttribute(name){return name==='inert'}};
 assert.equal(coreComposerElements(fakeRoot([composer,wrong,hidden,covered])).length,1);
 assert.equal(coreComposerElements(fakeRoot([wrong])).length,0);
 assert.equal(coreComposerElements(null).length,0);
});

test('an iframe document swap waits for load before any captured locator is reused',()=>{
 assert.equal(coreFrameNavigationDecision({readyState:'loading',documentChanged:true,capturedBeforeLoad:true}),'wait-for-load');
 assert.equal(coreFrameNavigationDecision({readyState:'interactive',documentChanged:true,capturedBeforeLoad:false}),'wait-for-load');
 assert.equal(coreFrameNavigationDecision({readyState:'complete',documentChanged:true,capturedBeforeLoad:false}),'rebind');
 assert.equal(coreFrameNavigationDecision({readyState:'complete',documentChanged:false,capturedBeforeLoad:false}),'current');
 assert.equal(coreFrameNavigationDecision({readyState:'complete',documentChanged:false,capturedBeforeLoad:true}),'current');
 assert.equal(coreFrameNavigationDecision({}),'current');
});

test('the original model control is the intelligence trigger even when it is not a button',()=>{
 const trigger=shownElement('div',{attributes:{'data-codex-intelligence-trigger':'true','role':'button'}});
 const plain=shownElement('button',{text:'GPT-6.1 Sol'});
 const disabled=shownElement('div',{attributes:{'data-codex-intelligence-trigger':'true'},disabled:true});
 const concealed=shownElement('div',{attributes:{'data-codex-intelligence-trigger':'true'},width:0});
 assert.equal(coreModelTriggerElements(fakeRoot([trigger,plain,disabled,concealed])).length,1);
 assert.equal(coreModelTriggerElements(fakeRoot([plain])).length,0);
 assert.equal(coreModelTriggerElements(fakeRoot([])).length,0);
});
