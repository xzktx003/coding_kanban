import { lstat, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

/** Only a directly observed later receipt for this exact retired view is proof. */
export function coreViewCloseEvidence({brokerClosed,expectedScope,destroyObservedSequence,receipt}={}) {
 const keys=['profileId','generation','viewId'];
 const validScope=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>typeof value[k]==='string'&&UUID.test(value[k]));
 const confirmed=validScope(expectedScope)&&validScope(receipt?.scope)&&keys.every(k=>expectedScope[k]===receipt.scope[k])&&receipt?.type==='viewClosed'&&Number.isSafeInteger(destroyObservedSequence)&&destroyObservedSequence>=0&&Number.isSafeInteger(receipt.observedSequence)&&receipt.observedSequence>destroyObservedSequence;
 return {brokerCloseConfirmed:brokerClosed===true,viewClosedConfirmed:confirmed?true:null};
}

const CORE_BRIDGE_FAILURES=new Set(['BRIDGE_CLOSED','BRIDGE_INVALID_CONFIG','BRIDGE_INVALID_MESSAGE','BRIDGE_MENU_UNAVAILABLE','BRIDGE_NATIVE_ERROR','BRIDGE_OUTCOME_UNKNOWN','BRIDGE_PENDING_LIMIT','BRIDGE_PORT_LIMIT','BRIDGE_QUEUE_FULL','BRIDGE_SCOPE_CHANGED','BRIDGE_UNSUPPORTED_OPERATION','BRIDGE_UNSUPPORTED_VALUE']);
export function coreBridgeFailureFromAttributes(entryCode,bridgeCode){
 return entryCode==='ENTRY_BRIDGE_FAILED'&&CORE_BRIDGE_FAILURES.has(bridgeCode)?bridgeCode:'unknown';
}

// Passed as an evaluated function to the fixture's own renderer. Diagnostics
// are retained only in the bounded private journal, never the public result.
export async function evaluateCoreProjectCreate(_element,projectPath){
 let phase='module';try{const m=await import(new URL('./assets/app-shared-601019a330d7.js',location.href).href);phase='rpc';const project=await m.Vct.projects.createLocal({appearance:null,initializeDefaultWorkspaceGitRepository:false,name:'Fixture project',sources:[projectPath]});if(project===null)return {outcome:'declined'};if(typeof project?.projectId!=='string'||project.projectId.length>256)return {outcome:'unknown'};return {outcome:'created',id:project.projectId,rootMatches:Array.isArray(project.rootPaths)&&project.rootPaths.length===1&&project.rootPaths[0]===projectPath}}
 catch(error){let name='',message='',stack='',code='';try{name=String(error?.name??'').slice(0,128)}catch{}try{message=String(error?.message??error).slice(0,4096)}catch{}try{stack=String(error?.stack??'').slice(0,4096)}catch{}try{code=typeof error?.code==='string'?error.code.slice(0,64):''}catch{}return {outcome:'error',phase,diagnostic:{name,message,stack,code}}}
}

export async function evaluateCoreProjectSelection(_element,{projectPath,id}){
 let phase='module';try{const m=await import(new URL('./assets/app-shared-601019a330d7.js',location.href).href),s=m.Vct;phase='rpc';const selection=await m.Fst(s.projectCatalog.readSelection()),projects=await m.Fst(s.projectCatalog.readLocalProjects()),roots=await m.Fst(s.workspaceRoots.read(crypto.randomUUID(),{hostId:'local'})),p=projects?.[id];return {outcome:'ok',value:{selectedLocal:selection?.type==='local',selectedCreated:selection?.projectId===id,projectRootOnly:Array.isArray(p?.rootPaths)&&p.rootPaths.length===1&&p.rootPaths[0]===projectPath,workspaceRootOnly:Array.isArray(roots?.roots)&&roots.roots.length===1&&roots.roots[0]===projectPath,onlyProject:Object.keys(projects??{}).length===1}}}catch(error){let name='',message='',stack='';try{name=String(error?.name??'').slice(0,128)}catch{}try{message=String(error?.message??error).slice(0,4096)}catch{}try{stack=String(error?.stack??'').slice(0,4096)}catch{}return {outcome:'error',phase,diagnostic:{name,message,stack}}}
}

export function coreProjectReceiptAccepted(value){return value?.receipt==='created'&&value.rootMatches===true&&(value.trustDialogObserved===true?value.trustConfirmed===true:value.trustDialogObserved===false&&value.trustConfirmed===false)}
export function coreProjectNavigationDecision({composers,projects,clicked}={}){return composers===0&&projects===1&&clicked===false?'click':'wait'}

export const coreSurfaceSelectors=Object.freeze({composer:'[data-codex-composer][contenteditable="true"]',modelTrigger:'[data-codex-intelligence-trigger]'});
const CORE_WELCOME_PREFIXES=Object.freeze(['What should we build','How can I help','Good to see you','Hey,']);

function coreElementShown(element){
 try{
  if(!element?.isConnected)return false;
  const rect=element.getBoundingClientRect?.();
  if(!rect||rect.width<=0||rect.height<=0)return false;
  const view=element.ownerDocument?.defaultView;
  if(!view)return false;
  const style=view.getComputedStyle(element);
  if(style.display==='none'||style.visibility==='hidden'||element.disabled===true||element.readOnly===true)return false;
  for(let node=element,depth=0;node&&depth<128;node=node.parentElement,depth++){
   if(node.hidden===true||node.getAttribute?.('aria-hidden')==='true'||node.hasAttribute?.('inert'))return false;
   const ancestor=view.getComputedStyle(node);
   if(ancestor.display==='none'||ancestor.visibility==='hidden'||ancestor.visibility==='collapse')return false;
  }
  return true;
 }catch{return false}
}

/** Random original welcome copy is not a readiness signal. */
export function coreWelcomeReady(text){
 if(typeof text!=='string'||text.length===0||text.length>4000)return false;
 const line=text.split('\n',1)[0].trim();
 return CORE_WELCOME_PREFIXES.some(prefix=>line===prefix||line.startsWith(prefix+' ')||line.startsWith(prefix+',')||line.startsWith(prefix+'?')||line.startsWith(prefix+'.'));
}

/** The original composer is identified by its attributes, not a fixed tag. */
export function coreComposerElements(root){
 try{return [...(root?.querySelectorAll?.(coreSurfaceSelectors.composer)??[])].filter(coreElementShown)}catch{return []}
}

/** A document swap invalidates locators captured before the new document loads. */
export function coreFrameNavigationDecision({readyState,documentChanged,capturedBeforeLoad}={}){
 if(documentChanged!==true)return 'current';
 if(capturedBeforeLoad===true||readyState!=='complete')return 'wait-for-load';
 return 'rebind';
}

/** The original model control is the intelligence trigger, not a button tag. */
export function coreModelTriggerElements(root){
 try{return [...(root?.querySelectorAll?.(coreSurfaceSelectors.modelTrigger)??[])].filter(coreElementShown)}catch{return []}
}

// These functions are serialized by Playwright and cannot close over Node
// state. Their diagnostic payload is consumed only by the private journal.
export async function evaluateCoreFixtureState(){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);let phase='rpc';
 try{const response=await fetch('/fixture-project-state',{cache:'no-store',signal:controller.signal});if(!response.ok)return {outcome:'unavailable'};phase='json';const value=await response.json();return value&&Object.keys(value).sort().join(',')==='empty,owned,profile'&&Object.values(value).every(x=>typeof x==='boolean')?{outcome:'ok',value}:{outcome:'invalid'}}
 catch(error){let name='',message='',stack='';try{name=String(error?.name??'').slice(0,128)}catch{}try{message=String(error?.message??error).slice(0,4096)}catch{}try{stack=String(error?.stack??'').slice(0,4096)}catch{}return {outcome:'error',phase,diagnostic:{name,message,stack}}}finally{clearTimeout(timer)}
}

export async function evaluateCoreAccountVerifier(_element){
 const info=error=>{let name='',message='',stack='';try{name=String(error?.name??'').slice(0,128)}catch{}try{message=String(error?.message??error).slice(0,4096)}catch{}try{stack=String(error?.stack??'').slice(0,4096)}catch{}return {name,message,stack}};
 try{const module=await import(new URL('./assets/app-shared-601019a330d7.js',location.href).href),services=module.Vct;
  const measure=async factory=>{let timer;try{const timeout=Symbol('timeout'),value=await Promise.race([Promise.resolve().then(factory),new Promise(resolve=>{timer=setTimeout(()=>resolve(timeout),5000)})]);return value===timeout?{status:'timeout'}:{status:'ok',value}}catch(error){return {status:'error',diagnostic:info(error)}}finally{clearTimeout(timer)}};
  const [work,setting]=await Promise.all([measure(()=>services.tppLocalExecutor.getState()),measure(()=>services.settings.read('conversationDetailMode'))]);const norm=x=>['STEPS_PROSE','STEPS_COMMANDS','STEPS_EXECUTION'].includes(x)?x:x===undefined?'undefined':x===null?'null':'other';
  return {work:work.status==='ok'?{enabled:typeof work.value?.enabled==='boolean'?work.value.enabled:null,ready:typeof work.value?.ready==='boolean'?work.value.ready:null,environmentPresent:work.value?.environmentId!=null}:null,workStatus:work.status,settings:setting.status==='ok'?{configured:norm(setting.value?.configured),effective:norm(setting.value?.effective)}:null,settingsStatus:setting.status,diagnostics:[work.diagnostic,setting.diagnostic].filter(Boolean)};
 }catch(error){return {work:null,workStatus:'module-unavailable',settings:null,settingsStatus:'module-unavailable',diagnostics:[info(error)]}}
}

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function validateCoreSurfaceOptions(options){
 const members=options?.assetAdapter?.members;
 if(typeof options?.entryAdapter!=='function'||typeof options?.assetAdapter?.adapt!=='function'||!Array.isArray(members)||members.length!==4||new Set(members).size!==4||members.some(x=>typeof x!=='string'||!/^webview\/assets\/[a-z0-9-]+\.js$/.test(x)))throw Error('invalid product surface options');
 return options;
}
export function readCoreSurfaceManifest(body,{profileId,generation}={}){
 if(!(body instanceof Uint8Array)||!UUID.test(profileId??'')||!UUID.test(generation??''))throw Error('invalid surface manifest');
 const html=new TextDecoder('utf-8',{fatal:true}).decode(body),items=[...html.matchAll(/<script id="chatgpt-host-manifest" type="application\/json">([^<]*)<\/script>/g)];
 if(items.length!==1)throw Error('invalid surface manifest');const value=JSON.parse(items[0][1]);
 if(value.version!==2||value.profileId!==profileId||value.generation!==generation)throw Error('invalid surface manifest');
 return {version:2,scopeMatches:true};
}
export function createCoreSurfaceParent({profileId,generation}={}){
 if(!UUID.test(profileId??'')||!UUID.test(generation??''))throw Error('invalid surface scope');
 const base=`/chatgpt-desktop/${profileId}/${generation}/webview/`;
 return `<!doctype html><html><body style="margin:0"><iframe id="desktop" src="${base}index.html" style="border:0;width:100vw;height:100vh" allow="clipboard-read; clipboard-write; microphone; fullscreen"></iframe><script type="module">import {installDesktopSurfaceHost} from '${base}__host/surface-host-bridge.mjs';const frame=document.getElementById('desktop');const owner=installDesktopSurfaceHost({window,frame,profileId:'${profileId}',generation:'${generation}'});frame.addEventListener('load',()=>owner.checkDocument());owner.confirmActive(true);document.documentElement.dataset.fixtureSurfaceConfirmed='true';owner.checkDocument();window.addEventListener('pagehide',()=>owner.close(),{once:true});</script></body></html>`;
}
export function verifyCoreSurfaceAsset({body,status,originalHeader,etag,expected}={}){
 if(!(body instanceof Uint8Array)||body.byteLength>512*1024||status!==200||!expected||!/^[a-f0-9]{64}$/.test(expected.original??'')||!/^[a-f0-9]{64}$/.test(expected.adapted??''))return false;
 return originalHeader===expected.original&&typeof etag==='string'&&etag.replace(/^W\//,'').replace(/^"|"$/g,'')===expected.adapted&&createHash('sha256').update(body).digest('hex')===expected.adapted;
}

/** Only an independently pinned, normalized list may define source coverage. */
export function parseFrozenSourceManifest(bytes,expectedSha,count) {
 if(!Buffer.isBuffer(bytes)||bytes.length>65536||!/^[a-f0-9]{64}$/.test(expectedSha??'')||!Number.isSafeInteger(count)||count<1||count>1000||createHash('sha256').update(bytes).digest('hex')!==expectedSha)throw Error('invalid manifest');
 const source=bytes.toString('utf8');if(!source.endsWith('\n'))throw Error('invalid manifest');const seen=new Set(),result=[];
 for(const line of source.slice(0,-1).split('\n')){const match=/^([a-f0-9]{64})  ([A-Za-z0-9._/-]+)$/.exec(line);if(!match||match[2].startsWith('/')||match[2].split('/').some(x=>!x||x==='.'||x==='..')||seen.has(match[2]))throw Error('invalid manifest');seen.add(match[2]);result.push({path:match[2],sha256:match[1]});}
 if(result.length!==count)throw Error('invalid manifest');return result;
}

/** Fixed server-only fixture: returns booleans only, never an arbitrary path. */
export async function readCoreFixtureState({home,project,homeIdentity,projectIdentity,uid,profileId,generation,profileService}={}) {
 const result={owned:false,empty:false,profile:false};
 const same=(a,b)=>!!a&&!!b&&['dev','ino','uid','gid','mode'].every(k=>a[k]===b[k]);
 try {
  if(typeof home!=='string'||!isAbsolute(home)||resolve(home)!==home||project!==join(home,'fixture-project')||!Number.isSafeInteger(uid)||uid<0)return result;
  const h=await lstat(home,{bigint:true}),p=await lstat(project,{bigint:true});
  if(!h.isDirectory()||!p.isDirectory()||h.uid!==BigInt(uid)||p.uid!==BigInt(uid)||(h.mode&0o7777n)!==0o700n||(p.mode&0o7777n)!==0o700n||!same(h,homeIdentity)||!same(p,projectIdentity)||await realpath(home)!==home||await realpath(project)!==project)return result;
  const entries=await readdir(project),h2=await lstat(home,{bigint:true}),p2=await lstat(project,{bigint:true});
  result.owned=same(h,h2)&&same(p,p2);result.empty=result.owned&&entries.length===0;
  const current=await profileService?.readValidated();
  result.profile=current?.status?.state==='ready'&&current.profile?.id===profileId&&current.profile?.generation===generation;
 }catch{}
 return result;
}
