// Fixture-only response copies and synchronous, bounded local observation.
// They provide no native RPC and are never installed in the production server.
import {createHash} from 'node:crypto';
const records={composer:'cf56f37714e14488239f4eb715b845067e75f8c2e98851c768c4110d3eb6fd08',capability:'6a4e326e5ebd71be0b1a6c345abc6225607d45b42ff2c24b6b12ce249b5d082c',entry:'a0ff8877ea32b3beff469a9bef5cdecc6580049cd99957d4d23f4cca9d19dd1a',afterCreated:'244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032'};
const outputs={composer:'1ad62bac754cc030fbb0b08ed681fd8941d6d50c9e027dcca6a6687c7f402fd6',capability:'f447819870a28251845f764d1f2bd1c04cadc8d332a706fc0687eb04545197ce',entry:'0839f634886b99d23653f6f6f94747dc27777ec9caaabe7cacb109962f703f23',afterCreated:'6f91401bab442aa97f642b19ef2cff1ff71111af25a14924faeeba620c25b134'};
const digest=body=>createHash('sha256').update(body).digest('hex');
function once(source,original,replacement){const i=source.indexOf(original);if(i<0||source.indexOf(original,i+1)!==-1)throw Error('LOCAL_CONFIG_OBSERVER_MARKER_MISMATCH');return source.slice(0,i)+replacement+source.slice(i+original.length)}
export function adaptCoreLocalConfigAsset(kind,body){
 if(!Object.hasOwn(records,kind)||!Buffer.isBuffer(body)||digest(body)!==records[kind])throw Error('LOCAL_CONFIG_OBSERVER_SOURCE_MISMATCH');
 let source=body.toString('utf8');
 if(kind==='composer'){
  source=once(source,'d=o.type!==`cloud`&&u.isLoading,f=JSON.stringify([a.submitTargetKey','d=o.type!==`cloud`&&u.isLoading,__kanbanFixtureConfigObserved=globalThis.__fixtureObserveLocalConfig?.(wl(s),s.value.kind,d,a.submitBlockContext,PT(a.submitBlockContext),s.get(__fixtureOriginalThreadAtom)),f=JSON.stringify([a.submitTargetKey');
  source='import{T6n as __fixtureOriginalThreadAtom}from"./app-initial-18b189e867e7.js";\n'+source;
 }else if(kind==='capability'){
  const before='  return Object.freeze({\n    Registrar,';
  const after=`  function fixtureObserveTarget() {
    try {
      if (disposed || owners.size !== 1) return null;
      const record = owners.values().next().value;
      if (!usable(record) || record.target.hostId !== "local") return null;
      const visible = [...win.document.querySelectorAll('[data-codex-composer][contenteditable="true"]')].filter(el => { const rect=el.getBoundingClientRect(), style=win.getComputedStyle(el); return rect.width>0 && rect.height>0 && style.visibility!=="hidden" && style.display!=="none"; });
      return visible.length === 1 && visible[0] === record.view.dom ? record.target : null;
    } catch { return null; }
  }
  function fixtureObserveClient() { const target=fixtureObserveTarget();return target?.conversationId===null&&typeof target.clientThreadId==="string"?target.clientThreadId:null; }
  function fixtureObserveConversation() { const target=fixtureObserveTarget();return typeof target?.conversationId==="string"?target.conversationId:null; }
  return Object.freeze({
    fixtureObserveClient,
    fixtureObserveConversation,
    Registrar,`;
  source=once(source,before,after);
 }else if(kind==='entry'){
  source=once(source,'    current = { React, capability, PaneScopedRegistrar };',`    current = { React, capability, PaneScopedRegistrar };
    try { Object.defineProperty(globalThis, Symbol.for('cg.fixture.composer-client.v1'), { value: () => capability.fixtureObserveClient(), configurable: true }); Object.defineProperty(globalThis, Symbol.for('cg.fixture.composer-conversation.v1'), { value: () => capability.fixtureObserveConversation(), configurable: true }); } catch {}`);
 }else{
  source=once(source,'o!=null&&RLt(e,{hostId:t,clientThreadId:o,conversationId:n}),await r?.(n)','o!=null&&RLt(e,{hostId:t,clientThreadId:o,conversationId:n}),(()=>{try{globalThis.__fixtureObserveAfterCreated?.(t,o,n)}catch{}})(),await r?.(n)');
 }
 const output=Buffer.from(source),adaptedSha256=digest(output);if(adaptedSha256!==outputs[kind])throw Error('LOCAL_CONFIG_OBSERVER_OUTPUT_MISMATCH');return {body:output,originalSha256:records[kind],adaptedSha256};
}

export function coreLocalConfigReady(value){return value?.targetMatches===true&&value.pending===false&&value.permissionsReady===true&&value.composerMode==='local'&&value.workspaceRootsLoading===false&&value.sameProject===true}
export function selectCoreLocalConfigAsset(url,origin,iframePath){
 try{const u=new URL(url);if(u.origin!==origin||u.search||u.hash||typeof iframePath!=='string'||!iframePath.endsWith('/index.html'))return null;const base=iframePath.slice(0,-'index.html'.length);return u.pathname===base+'assets/composer-content-b926d24ef280.js'?'composer':u.pathname===base+'__host/browser-composer-capability.mjs'?'capability':u.pathname===base+'__host/browser-composer-capability-entry.mjs'?'entry':u.pathname===base+'assets/app-initial-18b189e867e7.js'?'afterCreated':null}catch{return null}
}

export function installCoreLocalConfigObserver({projectPath}={}){
 const observed=new Map(),boolean=value=>typeof value==='boolean'?value:null;
 try{
  Object.defineProperty(globalThis,'__fixtureObserveLocalConfig',{value:(_id,kind,modelLoading,ctx,contextPending,client)=>{
   try{
    if(kind!=='new'||typeof client!=='string'||client.length===0||client.length>4096||!ctx||typeof ctx!=='object')return;
    const model=boolean(modelLoading),context=boolean(contextPending),agent=boolean(ctx.isAgentModeLoading),winRequirement=boolean(ctx.isWindowsSandboxRequirementPending),winSetup=boolean(ctx.isWindowsSandboxSetupPending),rootsLoading=boolean(ctx.workspaceRootsLoading),modes=['read-only','default','full-access','custom'],agentMode=modes.includes(ctx.agentMode)?ctx.agentMode:'unknown';
    const value={targetMatches:true,modelLoading:model,contextPending:context,pending:model===true||context===true?true:model===false&&context===false?false:null,agentModeLoading:agent,agentMode,windowsRequirementPending:winRequirement,windowsSetupPending:winSetup,permissionsReady:agent===false&&agentMode!=='unknown'&&winRequirement===false&&winSetup===false,composerMode:ctx.composerMode==='local'?'local':'other',workspaceRootsLoading:rootsLoading,sameProject:Array.isArray(ctx.workspaceRootsForSubmit)&&ctx.workspaceRootsForSubmit.length===1&&ctx.workspaceRootsForSubmit[0]===projectPath};
    observed.set(client,value);while(observed.size>8)observed.delete(observed.keys().next().value);
   }catch{}
  },configurable:false});
  Object.defineProperty(globalThis,Symbol.for('cg.fixture.config-read.v1'),{value:()=>{try{const client=globalThis[Symbol.for('cg.fixture.composer-client.v1')]?.();return typeof client==='string'?observed.get(client)??null:null}catch{return null}},configurable:false});
 }catch{}
}

// Invoked synchronously by the original afterCreated branch. Hashing is
// scheduled without a binding or await and never blocks the original callback.
export function installCoreAfterCreatedObserver(){
 let client=null,count=0,state='unarmed',threadHash=null,otherCalls=0;
 const current=()=>{try{return globalThis[Symbol.for('cg.fixture.composer-client.v1')]?.()??null}catch{return null}};
 try{
  Object.defineProperty(globalThis,Symbol.for('cg.fixture.after-created-arm.v1'),{value:()=>{const next=current();if(typeof next!=='string'||!next||client!==null)return false;client=next;state='armed';return true},configurable:false});
  Object.defineProperty(globalThis,Symbol.for('cg.fixture.after-created-current.v1'),{value:()=>client!==null&&current()===client,configurable:false});
  Object.defineProperty(globalThis,Symbol.for('cg.fixture.after-created-read.v1'),{value:()=>({state,count,clientMatches:count>0,threadHash,otherCalls}),configurable:false});
  Object.defineProperty(globalThis,Symbol.for('cg.fixture.after-created-same-target.v1'),{value:async()=>{try{if(state!=='hashed'||count!==1||!threadHash)return false;const get=globalThis[Symbol.for('cg.fixture.composer-conversation.v1')];if(typeof get!=='function')return false;const id=get();if(typeof id!=='string'||!id||id.length>256)return false;const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id)),hash=Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');return state==='hashed'&&count===1&&get()===id&&hash===threadHash}catch{return false}},configurable:false});
  Object.defineProperty(globalThis,'__fixtureObserveAfterCreated',{value:(hostId,clientId,threadId)=>{try{
   if(client===null||hostId!=='local'||clientId!==client){otherCalls++;return}
   count++;if(count!==1){state='ambiguous';threadHash=null;return}
   if(typeof threadId!=='string'||threadId.length<1||threadId.length>256){state='invalid';return}
   state='hashing';void crypto.subtle.digest('SHA-256',new TextEncoder().encode(threadId)).then(bytes=>{if(count!==1)return;threadHash=Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');state='hashed'},()=>{state='error'});
  }catch{state='error'}},configurable:false});
 }catch{}
}
