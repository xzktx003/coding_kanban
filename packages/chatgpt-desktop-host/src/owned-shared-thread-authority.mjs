import {constants,openSync,closeSync,fstatSync,lstatSync,realpathSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {startSharedDaemonObserver} from './shared-daemon-observer.mjs';
import {isNativeSharedAccountRevisionReader} from './container-shared-account-authority.mjs';
import {createPreservedNativeExecutionDomain} from './shared-execution-domain-proof.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HOST='kanban-shared-cli',MAX_BINDINGS=8192;
const denied=()=>Object.assign(new Error('Owned shared thread authority unavailable'),{code:'SHARED_OWNED_AUTHORITY_UNAVAILABLE'});
const pathOK=value=>typeof value==='string'&&value.length>1&&value.length<=4096&&isAbsolute(value)&&resolve(value)===value&&!/[\x00-\x1f\x7f]/.test(value);
const atom=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\x00-\x1f\x7f]/.test(value);
const overlaps=(a,b)=>a===b||a.startsWith(b+'/')||b.startsWith(a+'/');
const stamp=value=>({dev:value.dev,ino:value.ino,uid:value.uid,gid:value.gid,mode:value.mode});
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid&&a.gid===b.gid&&a.mode===b.mode;
const fields=['hostId','runtimeGeneration','daemonGeneration','accountRevision','projectId','threadId','viewId','clientId'];
const sameBinding=(a,b)=>a&&Object.keys(a).length===fields.length&&fields.every(k=>Object.hasOwn(a,k)&&a[k]===b[k]);
function dataRecord(value,names){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).length!==names.length)throw denied();
 const d=Object.getOwnPropertyDescriptors(value),out={};
 for(const name of names){if(!Object.hasOwn(d[name]??{},'value'))throw denied();out[name]=d[name].value;}
 return Object.freeze(out);
}
function ownDirectory(cwd){
 if(!pathOK(cwd))throw denied();
 const fd=openSync(cwd,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{const info=fstatSync(fd,{bigint:true}),path=lstatSync(cwd,{bigint:true});
  if(!info.isDirectory()||path.isSymbolicLink()||info.uid!==BigInt(process.getuid())||(Number(info.mode)&0o002)!==0||realpathSync.native(cwd)!==cwd||!same(stamp(info),stamp(path)))throw denied();
  return{cwd,fd,identity:stamp(info)};
 }catch(error){closeSync(fd);throw error;}
}
function ownProject(value,codexHome){
 const {projectId,cwd}=dataRecord(value,['projectId','cwd']);
 if(!atom(projectId)||!pathOK(cwd)||overlaps(cwd,codexHome))throw denied();
 return{projectId,...ownDirectory(cwd)};
}

/**
 * Explicit trusted-server assembly, never an HTTP/renderer-selected transport.
 * Opens exactly one identity/account-verified observer connection; does not start
 * a daemon, resume a thread, enable tools, refresh auth or grant user intent.
 * A built-in preservation policy uses actual native configuration/file proof
 * without adding Desktop tools or overwriting thread configuration. Otherwise
 * verifyExecutionDomainSync must independently establish full equivalence.
 */
export async function startOwnedSharedThreadAuthority({daemon:registration,codexHome,runtimeGeneration,profileId,getOwnedView,getAccountRevision,verifyExecutionDomainSync,executionDomainPolicy,projects,timeoutMs=15000}={}){
 const preserve=executionDomainPolicy==='preserve-native-cli';
 if(!UUID.test(runtimeGeneration??'')||(profileId!==undefined&&!UUID.test(profileId??''))||!pathOK(codexHome)||
    [getOwnedView,getAccountRevision].some(fn=>typeof fn!=='function')||
    (preserve?verifyExecutionDomainSync!==undefined:executionDomainPolicy!==undefined||typeof verifyExecutionDomainSync!=='function')||
    !Array.isArray(projects)||projects.length<1||projects.length>8)throw denied();
 const daemonRegistration=dataRecord(registration,['pid','startTicks','socketPath','daemonGeneration','exeSha256']);
 const daemonGeneration=daemonRegistration.daemonGeneration;
 if(!UUID.test(daemonGeneration??''))throw denied();
 const roots=[],bindings=new Map(),readBindings=new Map();let daemon,accountRoot,executionProof,closed=false,lastAccountRevision,nativeAccountRevisionReader;
 function close(){if(closed)return;closed=true;bindings.clear();readBindings.clear();executionProof?.close();daemon?.close();for(const root of roots)closeSync(root.fd);if(accountRoot)closeSync(accountRoot.fd);}
 try{
  accountRoot=ownDirectory(codexHome);
  for(const value of projects){const root=ownProject(value,codexHome);if(roots.some(x=>x.projectId===root.projectId||x.cwd===root.cwd)){closeSync(root.fd);throw denied();}roots.push(root);}
  daemon=await startSharedDaemonObserver({daemon:daemonRegistration,codexHome,timeoutMs});
  if(preserve)executionProof=await createPreservedNativeExecutionDomain({source:daemon,codexHome,projects,runtimeGeneration,daemonGeneration,getAccountRevision});
 }catch(error){close();throw error;}
 function rootCurrent(root){try{const path=lstatSync(root.cwd,{bigint:true});return!path.isSymbolicLink()&&same(root.identity,stamp(path))&&same(root.identity,stamp(fstatSync(root.fd,{bigint:true})))&&realpathSync.native(root.cwd)===root.cwd;}catch{return false;}}
 function forget(clientId){bindings.delete(clientId);readBindings.delete(clientId);}
 function current(requireExecution=true){
  let revision;
  try{if(closed||daemon.signal.aborted)throw denied();
   // This exact native getter includes the same observer assertion plus its
   // runtime/account checks. No result survives this call or an async boundary.
   if(nativeAccountRevisionReader)revision=nativeAccountRevisionReader();
   else{daemon.assertCurrent();revision=getAccountRevision();}
   if(!Number.isSafeInteger(revision)||revision<0||!rootCurrent(accountRoot)||roots.some(root=>!rootCurrent(root)))throw denied();
   if(lastAccountRevision!==undefined&&lastAccountRevision!==revision){bindings.clear();readBindings.clear();}lastAccountRevision=revision;
  }catch{bindings.clear();readBindings.clear();return null;}
  if(!preserve||requireExecution){
   const scope=Object.freeze({runtimeGeneration,daemonGeneration,accountRevision:revision});let valid=false;
   try{valid=(preserve?executionProof?.verifyCurrentSync(scope):verifyExecutionDomainSync(scope))===true;}catch{}
   if(!valid){
    // Configuration is execution authority, not permission to read the same
    // native thread. Recheck the independent account/daemon/held-root guard.
    bindings.clear();if(!preserve||current(false)===null)readBindings.clear();return null;
   }
  }
  return revision;
 }
 function owned(id){try{if(!UUID.test(id??''))return null;const record=getOwnedView(id);if(!record||Object.getOwnPropertyDescriptor(record,'viewId')?.value!==id){retireView(id);return null;}for(const[key,entry]of readBindings)if(entry.binding.viewId===id&&entry.view!==record)forget(key);return record;}catch{retireView(id);return null;}}
 function capacity(revision){
  // readBindings owns every entry, including the write map's shared references;
  // retained history does not add a second 8192-entry budget.
  if(readBindings.size<MAX_BINDINGS)return true;
  for(const[id,entry]of readBindings)if(entry.binding.accountRevision!==revision||owned(entry.binding.viewId)!==entry.view)forget(id);
  return readBindings.size<MAX_BINDINGS;
 }
 function retain(binding,view,project){
  // Metadata/proof reads await native replies. Check the common cap again at
  // the actual insertion so concurrent binds cannot exceed it.
  if(current()!==binding.accountRevision||owned(binding.viewId)!==view||!rootCurrent(project)||!capacity(binding.accountRevision))throw denied();
  const entry={binding,view,project};readBindings.set(binding.clientId,entry);bindings.set(binding.clientId,entry);
 }
 function registered(rawValue,history=false){
  const revision=current(!history);let value;
  if(revision===null)return null;try{value=dataRecord(rawValue,fields);}catch{return null;}
  const entry=(history?readBindings:bindings).get(value.clientId);if(!entry||!sameBinding(value,entry.binding))return null;
  if(value.accountRevision!==revision||owned(value.viewId)!==entry.view||!rootCurrent(entry.project)){forget(value.clientId);return null;}
  return entry;
 }
 const sharedThread=Object.freeze({
  async resolveBinding(request){
   let proofRevision=executionProof?.getRevisionSync();
   const revision=current(false),view=owned(request?.viewId);
   if(revision===null||!view||request.hostId!==HOST||!UUID.test(request.threadId??''))throw denied();
   if(!capacity(revision))throw denied();
   const metadata=await daemon.readThreadMetadata(request.threadId);
   if(current(false)!==revision||owned(request.viewId)!==view||(executionProof&&executionProof.getRevisionSync()!==proofRevision)||metadata?.thread?.id!==request.threadId||!pathOK(metadata.thread.cwd)||
      (metadata.thread.turns!==undefined&&(!Array.isArray(metadata.thread.turns)||metadata.thread.turns.length)))throw denied();
   const project=roots.find(root=>root.cwd===metadata.thread.cwd);if(!project||!rootCurrent(project))throw denied();
   if(executionProof){
    const scope=Object.freeze({hostId:HOST,runtimeGeneration,daemonGeneration,accountRevision:revision,projectId:project.projectId,cwd:project.cwd,viewId:request.viewId});
    if(executionProof.verifyCurrentSync(scope)!==true){
     // Only this explicit native bind path may refresh. A configuration edit
     // does not invalidate account/metadata reads or revive any old writer.
     proofRevision=await revalidateProjectForIntent(scope,{expectedRevision:proofRevision,signal:new AbortController().signal,
      deadline:performance.now()+Math.min(timeoutMs,30000),verifyCurrentSync:()=>current(false)===revision&&owned(request.viewId)===view&&rootCurrent(project)});
     if(!proofRevision)throw denied();
    }
    if(executionProof.getRevisionSync()!==proofRevision||current()!==revision||owned(request.viewId)!==view)throw denied();
   }
   const binding=Object.freeze({hostId:HOST,runtimeGeneration,daemonGeneration,accountRevision:revision,projectId:project.projectId,threadId:request.threadId,viewId:request.viewId,clientId:randomUUID()});
   if(executionProof&&(await executionProof.bindThread(binding,metadata)!==true||current()!==revision||owned(request.viewId)!==view))throw denied();
   retain(binding,view,project);return binding;
  },
  verifyViewSync:request=>current(false)!==null&&request?.hostId===HOST&&UUID.test(request.threadId??'')&&owned(request.viewId)!==null,
  verifyBindingSync:value=>registered(value)!==null,
  verifyHistorySync:value=>registered(value,true)!==null,
  // Metadata/account reads keep their original daemon, account and held-root
  // checks. Full execution proof is still required by bindings and writes.
  verifyReadSync:()=>current(false)!==null,
  write(encoded){if(current()===null)throw denied();return daemon.writeGateFrame(encoded);},
 });
 async function revalidateProjectForIntent(scope,control){
  const revision=current(false),view=owned(scope?.viewId),project=roots.find(root=>root.projectId===scope?.projectId);
  if(!executionProof||revision===null||!view||!project||scope.hostId!==HOST||scope.runtimeGeneration!==runtimeGeneration||scope.daemonGeneration!==daemonGeneration||scope.accountRevision!==revision||scope.cwd!==project.cwd||!rootCurrent(project)||typeof control?.verifyCurrentSync!=='function')return null;
  // Clearing precedes the async reads. No earlier binding can acquire authority
  // merely because a later user gesture establishes a replacement proof.
  bindings.clear();
  return executionProof.revalidateProject(scope,{signal:control.signal,deadline:control.deadline,expectedRevision:control.expectedRevision,
   verifyCurrentSync:()=>current(false)===revision&&owned(scope.viewId)===view&&rootCurrent(project)&&control.verifyCurrentSync()===true});
 }
 function retireView(viewId){executionProof?.retireView(viewId);for(const[id,entry]of readBindings)if(entry.binding.viewId===viewId)forget(id);}
 async function resolveCreatedBinding(request,receipt){
  const revision=current(),view=owned(request?.viewId),project=roots.find(root=>root.projectId===request?.projectId);
  if(!executionProof||revision===null||!view||request.hostId!==HOST||!UUID.test(request.threadId??'')||!project||!rootCurrent(project)||!capacity(revision))throw denied();
  const binding=Object.freeze({hostId:HOST,runtimeGeneration,daemonGeneration,accountRevision:revision,projectId:project.projectId,threadId:request.threadId,viewId:request.viewId,clientId:randomUUID()});
  if(await executionProof.bindCreatedThread(binding,receipt)!==true||current()!==revision||owned(request.viewId)!==view||!rootCurrent(project))throw denied();
  retain(binding,view,project);return binding;
 }
 function attachNativeAccountRevisionReader(reader){
  // Trusted server assembly only; attachment establishes provenance, never an
  // account revision or authorization. The captured source cannot be rebound.
  if(closed||nativeAccountRevisionReader||profileId===undefined||!isNativeSharedAccountRevisionReader(reader,daemon,runtimeGeneration,profileId))throw denied();
  nativeAccountRevisionReader=reader;return true;
 }
 daemon.signal.addEventListener('abort',close,{once:true});
 return Object.freeze({daemon,sharedThread,attachNativeAccountRevisionReader,executionDomain:executionProof?.executionDomain,executionProof,revalidateProjectForIntent,resolveCreatedBinding,retireView,close});
}
