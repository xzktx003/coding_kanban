import {constants,openSync,closeSync,fstatSync,lstatSync,readSync,realpathSync} from 'node:fs';
import {isAbsolute,resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createRequire} from 'node:module';
const {copySharedNativePermissionFields,verifySharedNativePermissionReply,createSharedPermissionArtifactContext}=createRequire(import.meta.url)('./shared-permissions-schema.cjs');

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_JSON=2*1024*1024,MAX_FILES=32,MAX_FILE=1024*1024,MAX_TOTAL=4*1024*1024,MAX_BINDINGS=8192;
const denied=()=>Object.assign(new Error('Native execution domain could not be proven'),{code:'SHARED_EXECUTION_DOMAIN_UNPROVEN'});
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const pathOK=x=>typeof x==='string'&&x.length>1&&x.length<=4096&&isAbsolute(x)&&resolve(x)===x&&!/[\x00-\x1f\x7f]/.test(x);
const atom=x=>typeof x==='string'&&x.length>0&&x.length<=4096&&!/[\x00-\x1f\x7f]/.test(x);
const hash=x=>createHash('sha256').update(x).digest('hex');
function canonical(value,depth=0){
 if(depth>64)throw denied();
 if(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return'['+value.map(x=>canonical(x,depth+1)).join(',')+']';
 if(!object(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw denied();
 const keys=Reflect.ownKeys(value);if(keys.some(x=>typeof x!=='string'))throw denied();
 return'{'+keys.sort().map(key=>{const d=Object.getOwnPropertyDescriptor(value,key);if(!Object.hasOwn(d??{},'value'))throw denied();return JSON.stringify(key)+':'+canonical(d.value,depth+1);}).join(',')+'}';
}
function digest(value){const text=canonical(value);if(Buffer.byteLength(text)>MAX_JSON)throw denied();return hash(text);}
const stamp=s=>[s.dev,s.ino,s.uid,s.gid,s.mode,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');
const dirStamp=s=>[s.dev,s.ino,s.uid,s.gid,s.mode].map(String).join(':');
function directory(cwd){
 if(!pathOK(cwd))throw denied();const fd=openSync(cwd,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{const s=fstatSync(fd,{bigint:true});if(!s.isDirectory()||s.uid!==BigInt(process.getuid())||(Number(s.mode)&0o002)!==0||realpathSync.native(cwd)!==cwd||dirStamp(lstatSync(cwd,{bigint:true}))!==dirStamp(s))throw denied();
  const identity=dirStamp(s);return{close:()=>closeSync(fd),current(){try{const p=lstatSync(cwd,{bigint:true});return!p.isSymbolicLink()&&realpathSync.native(cwd)===cwd&&dirStamp(p)===identity&&dirStamp(fstatSync(fd,{bigint:true}))===identity;}catch{return false;}}};
 }catch(error){closeSync(fd);throw error;}
}
function fileSnapshot(file,budget,metadataOnly=false){
 if(!pathOK(file))throw denied();let fd;
 try{
  const p=lstatSync(file,{bigint:true});
  if(metadataOnly){
   // A discovery candidate which the actual daemon did not report is observed
   // only for namespace/metadata changes. Never read unrelated ancestor config.
   if(!p.isFile()||p.isSymbolicLink()||realpathSync.native(file)!==file)throw denied();
   const identity=stamp(p);let closed=false;return{file,contentDigest:null,close(){closed=true;},current(){try{return!closed&&stamp(lstatSync(file,{bigint:true}))===identity&&realpathSync.native(file)===file;}catch{return false;}}};
  }
  if(!p.isFile()||p.isSymbolicLink()||![0n,BigInt(process.getuid())].includes(p.uid)||(Number(p.mode)&0o022)!==0||p.size>BigInt(MAX_FILE)||realpathSync.native(file)!==file)throw denied();
  fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);const s=fstatSync(fd,{bigint:true});if(stamp(s)!==stamp(p))throw denied();
  budget.bytes+=Number(s.size);if(budget.bytes>MAX_TOTAL)throw denied();
  const h=createHash('sha256'),buffer=Buffer.allocUnsafe(65536);let offset=0,count;
  do{count=readSync(fd,buffer,0,Math.min(buffer.length,MAX_FILE+1-offset),offset);if(count){h.update(buffer.subarray(0,count));offset+=count;}}while(count&&offset<=MAX_FILE);
  buffer.fill(0);if(offset!==Number(s.size)||stamp(fstatSync(fd,{bigint:true}))!==stamp(s)||stamp(lstatSync(file,{bigint:true}))!==stamp(s))throw denied();
  const identity=stamp(s),contentDigest=h.digest('hex');let closed=false;
  return{file,contentDigest,close(){if(!closed){closed=true;closeSync(fd);}},current(){try{return!closed&&stamp(lstatSync(file,{bigint:true}))===identity&&stamp(fstatSync(fd,{bigint:true}))===identity&&realpathSync.native(file)===file;}catch{return false;}}};
 }catch(error){if(fd!==undefined)closeSync(fd);if(error?.code!=='ENOENT')throw error;
  // A missing declared/candidate config is an explicit negative identity. Its
  // later creation (including a symlink) revokes the snapshot before a write.
  return{file,contentDigest:null,close(){},current(){try{lstatSync(file);return false;}catch(e){return e?.code==='ENOENT';}}};
 }
}
function layerFile(source){
 if(!object(source)||!atom(source.type))throw denied();
 if(source.type==='sessionFlags')return null; // immutable, pinned daemon argv
 if(['packagedDefaults','system','user','legacyManagedConfigTomlFromFile'].includes(source.type)){if(!pathOK(source.file))throw denied();return source.file;}
 if(source.type==='project'){if(!pathOK(source.dotCodexFolder))throw denied();return join(source.dotCodexFolder,'config.toml');}
 // Managed/MDM remote layers have no file closure in this implementation.
 throw denied();
}

/** Read-only evidence for a project on one already verified native daemon.
 * Hashes the complete native JSON (including unknown fields), both real reads,
 * and all reported file layers. No account or task authority is granted here.
 * This proves a reported project snapshot, not a loaded thread's MCP/policy.
 */
export async function captureSharedExecutionProject({source,cwd,declaredMcp={mode:'preserve-native'}}={}){
 if(!source||source.configurationProtocolVersion!=='0.166.0'||['assertCurrent','readProjectConfig','readRequirements'].some(k=>typeof source[k]!=='function')||
    !object(declaredMcp)||Reflect.ownKeys(declaredMcp).length!==1||declaredMcp.mode!=='preserve-native')throw denied();
 const snapshots=[];let root,closed=false,phase='native-source';
 const close=()=>{if(closed)return;closed=true;for(const item of snapshots)item.close();root?.close();};
 try{
  source.assertCurrent();phase='project-directory';root=directory(cwd);
  phase='native-configuration-read';
  const config=await source.readProjectConfig(cwd),requirements=await source.readRequirements();source.assertCurrent();
  phase='configuration-shape';
  if(!object(config)||!object(config.config)||!object(config.origins)||!Array.isArray(config.layers)||config.layers.length>MAX_FILES||
     !object(requirements)||!Object.hasOwn(requirements,'requirements')||requirements.requirements!==null)throw denied();
  phase='complete-configuration-digest';const configurationDigest=digest(config),requirementsDigest=digest(requirements),mcp=config.config.mcp_servers;
  if(mcp!==undefined&&mcp!==null&&!object(mcp))throw denied();
  const mcpConfigurationDigest=digest(mcp??{}),files=new Set();
  phase='native-file-layers';for(const item of config.layers){if(!object(item)||!object(item.config)||!atom(item.version))throw denied();const file=layerFile(item.name);if(file)files.add(file);}
  // Origins are part of the full digest and every origin must be accounted for
  // by an actual reported layer; a projected/partial layer list is insufficient.
  const layers=new Set(config.layers.map(x=>canonical({name:x.name,version:x.version})));
  phase='native-config-origins';for(const origin of Object.values(config.origins)){if(!object(origin)||!layers.has(canonical({name:origin.name,version:origin.version})))throw denied();}
  // Detect a newly created project config even if it was absent from layers.
  const reportedFiles=new Set(files);for(let p=cwd;;p=dirname(p)){files.add(join(p,'.codex','config.toml'));if(p===dirname(p))break;}
  phase='native-config-file-identity';if(files.size>MAX_FILES)throw denied();const budget={bytes:0};for(const file of files)snapshots.push(fileSnapshot(file,budget,!reportedFiles.has(file)));
  phase='native-configuration-reread';
  const secondConfig=await source.readProjectConfig(cwd),secondRequirements=await source.readRequirements();source.assertCurrent();
  phase='native-configuration-stability';if(digest(secondConfig)!==configurationDigest||digest(secondRequirements)!==requirementsDigest||!root.current()||snapshots.some(x=>!x.current()))throw denied();
  const summary=Object.freeze({cwd,configurationDigest,requirementsDigest,mcpConfigurationDigest,declaredMcpMode:'preserve-native',fileCount:snapshots.length,loadedThreadPolicyProven:false,loadedThreadMcpConfigurationProven:false});
  const current=()=>{try{source.assertCurrent();return!closed&&root.current()&&snapshots.every(x=>x.current());}catch{return false;}};
  const namedProfiles=new Set(object(config.config.permissions)?Object.keys(config.config.permissions):[]);
  return Object.freeze({summary:()=>summary,verifyCurrentSync:current,verifyPermissionSelectionSync(params,{kind='start',artifactContext}={}){try{if(!current()||params?.cwd!==cwd)return false;const fields=copySharedNativePermissionFields(params,{cwd,kind,artifactContext});return(fields.permissions==null||[':read-only',':workspace',':danger-full-access'].includes(fields.permissions)||namedProfiles.has(fields.permissions))&&current();}catch{return false;}},close});
 }catch(cause){close();const failure=denied();failure.phase=phase;
  // The private launcher can retain the first failed phase and a bounded errno
  // without persisting native config bodies, bearer headers or arbitrary errors.
  if(['EACCES','EPERM','ENOENT','ELOOP','ENOTDIR','EMFILE','ENFILE'].includes(cause?.code))failure.causeCode=cause.code;
  throw failure;}
}
const bindingKeys=['hostId','runtimeGeneration','daemonGeneration','accountRevision','projectId','threadId','viewId','clientId'];
const sameBinding=(a,b)=>object(a)&&Reflect.ownKeys(a).length===bindingKeys.length&&bindingKeys.every(k=>a[k]===b[k]);
const minimal=(b,f)=>object(f)&&f.method==='thread/resume'&&object(f.params)&&Object.keys(f.params).length===2&&Object.hasOwn(f.params,'threadId')&&Object.hasOwn(f.params,'excludeTurns')&&f.params.threadId===b.threadId&&f.params.excludeTurns===true;
function nativePolicyCopy(result){
 const fields=['cwd','approvalPolicy','approvalsReviewer','sandbox','activePermissionProfile','runtimeWorkspaceRoots'];
 const text=JSON.stringify(Object.fromEntries(fields.filter(k=>Object.hasOwn(result,k)).map(k=>[k,result[k]])));if(Buffer.byteLength(text)>64*1024)throw denied();
 const value=JSON.parse(text);const freeze=x=>{if(x&&typeof x==='object'){for(const child of Object.values(x))freeze(child);Object.freeze(x);}return x;};return freeze(value);
}
function nativePolicyShape(result){
 const a=result.approvalPolicy,s=result.sandbox;
 const approval=['untrusted','on-request','never'].includes(a)||object(a)&&Object.keys(a).length===1&&object(a.granular)&&
  ['mcp_elicitations','rules','sandbox_approval'].every(k=>typeof a.granular[k]==='boolean')&&Object.keys(a.granular).every(k=>['mcp_elicitations','rules','sandbox_approval','request_permissions','skill_approval'].includes(k)&&typeof a.granular[k]==='boolean');
 if(!approval||!['user','auto_review','guardian_subagent'].includes(result.approvalsReviewer)||!object(s)||!['dangerFullAccess','readOnly','externalSandbox','workspaceWrite'].includes(s.type))return false;
 if(s.type==='externalSandbox'&&s.networkAccess!==undefined&&!['restricted','enabled'].includes(s.networkAccess))return false;
 if(['readOnly','workspaceWrite'].includes(s.type)&&s.networkAccess!==undefined&&typeof s.networkAccess!=='boolean')return false;
 if(s.type==='workspaceWrite'&&(['excludeSlashTmp','excludeTmpdirEnvVar'].some(k=>s[k]!==undefined&&typeof s[k]!=='boolean')||s.writableRoots!==undefined&&(!Array.isArray(s.writableRoots)||s.writableRoots.length>64||!s.writableRoots.every(pathOK))))return false;
 return true;
}

/** Native replies remain execution authority. A minimal resume or branded start
 * response supplies the thread policy. A separately branded directory receipt
 * permits only the original per-thread artifact-root derivation; it grants no
 * task/approval/tool write and never fabricates a settings response.
 */
export async function createPreservedNativeExecutionDomain({source,projects,runtimeGeneration,daemonGeneration,getAccountRevision,codexHome}={}){
 if(!UUID.test(runtimeGeneration??'')||!UUID.test(daemonGeneration??'')||typeof getAccountRevision!=='function'||!Array.isArray(projects)||!projects.length||projects.length>8)throw denied();
 if(codexHome!==undefined&&!pathOK(codexHome))throw denied();
 // Only the trusted provider supplies this home after the same observer has
 // checked initialize.codexHome. No renderer path selects an artifact base.
 const artifactContract=codexHome===undefined?null:await import('./shared-thread-artifacts.mjs');
 let artifactHome;
 const roots=new Map(),bindings=new Map(),usedClientIds=new Set();let closed=false,ready=false,revision=Object.freeze({}),pendingRevalidation=null;
 const closeProofs=()=>{for(const value of roots.values())value.proof?.close();};
 function close(){if(closed)return;closed=true;ready=false;revision=Object.freeze({});bindings.clear();pendingRevalidation?.abort.abort();pendingRevalidation=null;closeProofs();artifactHome?.close();}
 function nativeScopeCurrent(scope){try{source.assertCurrent();return!closed&&(!artifactHome||artifactHome.current())&&(!scope||scope.runtimeGeneration===runtimeGeneration&&scope.daemonGeneration===daemonGeneration&&Number.isSafeInteger(scope.accountRevision)&&scope.accountRevision>=0&&scope.accountRevision===getAccountRevision());}catch{return false;}}
 function scopeCurrent(scope){return ready&&nativeScopeCurrent(scope)&&[...roots.values()].every(x=>x.proof.verifyCurrentSync());}
 try{if(codexHome!==undefined)artifactHome=directory(codexHome);
  for(const project of projects){if(!object(project)||!atom(project.projectId)||roots.has(project.projectId)||[...roots.values()].some(x=>x.cwd===project.cwd))throw denied();roots.set(project.projectId,{cwd:project.cwd,proof:await captureSharedExecutionProject({source,cwd:project.cwd})});}
  if(!nativeScopeCurrent())throw denied();ready=true;
 }catch(error){close();throw error;}
 function entry(binding){const value=bindings.get(binding?.clientId);return value&&value.revision===revision&&sameBinding(binding,value.binding)&&scopeCurrent(binding)?value:null;}
 function createdArtifactRoot(binding,value=entry(binding)){
  try{if(!artifactContract||!artifactHome?.current()||!value?.attestation||value.attestation.policyOrigin!=='native-start-response'||!['workspaceWrite','dangerFullAccess'].includes(value.nativeExecution?.sandbox?.type))return null;
   const path=artifactContract.deriveSharedThreadArtifactRoot(codexHome,binding.threadId);return pathOK(path)&&scopeCurrent(binding)?path:null;
  }catch{return null;}
 }
 function artifactCurrent(binding,value){try{return!!value.artifact&&createdArtifactRoot(binding,value)===value.artifact.path&&artifactContract.verifySharedThreadArtifactDirectorySync(value.artifact.receipt,binding)===true&&scopeCurrent(binding);}catch{return false;}}
 function exactRecord(value,names){
  try{if(!object(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return null;const keys=Reflect.ownKeys(value);if(keys.length!==names.length||keys.some(key=>typeof key!=='string'||!names.includes(key)))return null;
   const entries=[];for(const key of names){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!Object.hasOwn(descriptor??{},'value'))return null;entries.push([key,descriptor.value]);}return Object.freeze(Object.fromEntries(entries));
  }catch{return null;}
 }
 function revalidationScope(raw){const scope=exactRecord(raw,['hostId','runtimeGeneration','daemonGeneration','accountRevision','projectId','cwd','viewId']);
  return scope&&scope.hostId==='kanban-shared-cli'&&scope.runtimeGeneration===runtimeGeneration&&scope.daemonGeneration===daemonGeneration&&Number.isSafeInteger(scope.accountRevision)&&scope.accountRevision>=0&&UUID.test(scope.viewId??'')&&roots.get(scope.projectId)?.cwd===scope.cwd?scope:null;
 }
 async function revalidateProject(rawScope,rawControl){
  const scope=revalidationScope(rawScope),control=exactRecord(rawControl,['signal','deadline','verifyCurrentSync','expectedRevision']);
  if(!scope||!control||!(control.signal instanceof AbortSignal)||!Number.isFinite(control.deadline)||control.deadline<=performance.now()||control.deadline>performance.now()+30000||typeof control.verifyCurrentSync!=='function')return null;
  function ownerCurrent(){try{return!control.signal.aborted&&performance.now()<control.deadline&&nativeScopeCurrent(scope)&&control.verifyCurrentSync(scope)===true&&nativeScopeCurrent(scope)&&!control.signal.aborted&&performance.now()<control.deadline;}catch{return false;}}
  if(pendingRevalidation||control.expectedRevision!==revision||!ownerCurrent()||pendingRevalidation||control.expectedRevision!==revision)return null;
  // The token is an identity fence, not authority. Burn old bindings before any
  // native await; no failed/late attempt can publish them under a new proof.
  revision=Object.freeze({});ready=false;bindings.clear();const operation={revision,abort:new AbortController()};pendingRevalidation=operation;
  const candidates=new Map();let capturing=true,published=false;
  function current(){return pendingRevalidation===operation&&operation.revision===revision&&!operation.abort.signal.aborted&&ownerCurrent()&&pendingRevalidation===operation&&operation.revision===revision&&!operation.abort.signal.aborted;}
  function assertCapture(){source.assertCurrent();if(capturing&&(!current()||source.configurationProtocolVersion!=='0.166.0'))throw denied();}
  function read(method,args){
   return new Promise((resolve,reject)=>{
    let settled=false,timer;const stop=()=>finish(denied());
    function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);control.signal.removeEventListener('abort',stop);operation.abort.signal.removeEventListener('abort',stop);if(error)reject(error);else resolve(value);}
    control.signal.addEventListener('abort',stop,{once:true});operation.abort.signal.addEventListener('abort',stop,{once:true});timer=setTimeout(stop,Math.max(0,control.deadline-performance.now()));
    try{assertCapture();Promise.resolve(source[method](...args)).then(value=>{try{assertCapture();finish(null,value);}catch(error){finish(error);}},error=>finish(error));}catch(error){finish(error);}
   });
  }
  const guardedSource={configurationProtocolVersion:source.configurationProtocolVersion,assertCurrent:assertCapture,readProjectConfig:cwd=>read('readProjectConfig',[cwd]),readRequirements:()=>read('readRequirements',[])};
  try{
   // Every fixed root participates in scopeCurrent; a single-project refresh
   // cannot leave an unrelated stale root hidden behind a new revision.
   for(const[id,root]of roots){if(!current())throw denied();const proof=await captureSharedExecutionProject({source:guardedSource,cwd:root.cwd});candidates.set(id,proof);if(!current())throw denied();}
   if(!current()||[...candidates.values()].some(proof=>!proof.verifyCurrentSync())||!current())throw denied();
   capturing=false;for(const[id,root]of roots){const old=root.proof;root.proof=candidates.get(id);old.close();}
   pendingRevalidation=null;ready=true;published=true;return revision;
  }catch{return null;}
  finally{capturing=false;if(!published){for(const proof of candidates.values())proof.close();closeProofs();if(pendingRevalidation===operation)pendingRevalidation=null;ready=false;}}
 }
 function bindingCandidate(binding){const root=roots.get(binding?.projectId);return root&&sameBinding(binding,binding)&&binding.hostId==='kanban-shared-cli'&&UUID.test(binding.threadId??'')&&UUID.test(binding.clientId??'')&&UUID.test(binding.viewId??'')&&scopeCurrent(binding)&&!usedClientIds.has(binding.clientId)&&usedClientIds.size<MAX_BINDINGS?root:null;}
 const executionDomain=Object.freeze({
  beforeResumeWriteSync(binding,request){const value=entry(binding);if(!value||value.state!=='bound'||!minimal(binding,request))return false;value.state='dispatched';value.requestId=request.id;return true;},
  observeResumeReplySync(binding,request,response){
   const value=entry(binding);if(!value||value.state!=='dispatched'||!minimal(binding,request)||request.id!==value.requestId||response?.id!==value.requestId)return false;
   value.state='replied';if(Object.hasOwn(response,'error'))return true;
   const result=response?.result,thread=result?.thread;
   if(!object(result)||!object(thread)||thread.id!==binding.threadId||thread.cwd!==value.cwd||result.cwd!==value.cwd||!atom(result.model)||!atom(result.modelProvider)||!atom(result.approvalsReviewer)||!nativePolicyShape(result))return false;
   let nativePolicyDigest;try{nativePolicyDigest=digest(result);}catch{return false;}
   value.nativeExecution=nativePolicyCopy(result);value.attestation=Object.freeze({threadId:binding.threadId,cwd:value.cwd,accountRevision:binding.accountRevision,policyOrigin:'native-resume-response',nativePolicyDigest,configurationDigest:roots.get(binding.projectId).proof.summary().configurationDigest,loadedThreadMcpConfigurationProven:false});return true;
  },
 });
 return Object.freeze({
  verifyCurrentSync:scopeCurrent,executionDomain,getRevisionSync:()=>revision,revalidateProject,
  async bindThread(binding,metadata){
   const root=bindingCandidate(binding),bindingRevision=revision;
   if(!root||metadata?.thread?.id!==binding.threadId||metadata.thread.cwd!==root.cwd)return false;
   usedClientIds.add(binding.clientId);const proof=await captureSharedExecutionProject({source,cwd:root.cwd});
   try{if(revision!==bindingRevision||!scopeCurrent(binding)||proof.summary().configurationDigest!==root.proof.summary().configurationDigest||proof.summary().requirementsDigest!==root.proof.summary().requirementsDigest)return false;
    bindings.set(binding.clientId,{binding:Object.freeze({...binding}),revision:bindingRevision,cwd:root.cwd,state:'bound',attestation:null});return true;
   }finally{proof.close();}
  },
  async bindCreatedThread(binding,receipt){
   const root=bindingCandidate(binding),bindingRevision=revision;
   if(!root||typeof source.readThreadMetadata!=='function')return false;
   usedClientIds.add(binding.clientId);
   // Keep the revision across every await, including module loading. A new
   // proof can authorize only a new explicit binding with a new client ID.
   const {consumeSharedThreadCreationReceipt}=await import('./shared-thread-creation.mjs');
   if(revision!==bindingRevision||!scopeCurrent(binding))return false;
   const metadata=await source.readThreadMetadata(binding.threadId);
   if(revision!==bindingRevision||!scopeCurrent(binding)||metadata?.thread?.id!==binding.threadId||metadata.thread.cwd!==root.cwd||!Array.isArray(metadata.thread.turns)||metadata.thread.turns.length)return false;
   const proof=await captureSharedExecutionProject({source,cwd:root.cwd});
   try{
    if(revision!==bindingRevision||!scopeCurrent(binding)||proof.summary().configurationDigest!==root.proof.summary().configurationDigest||proof.summary().requirementsDigest!==root.proof.summary().requirementsDigest)return false;
    const data=consumeSharedThreadCreationReceipt(receipt,binding),execution=data?.execution;
    if(data?.origin!=='native-start-response'||data.threadId!==binding.threadId||data.scope?.cwd!==root.cwd||!object(execution)||execution.cwd!==root.cwd||!atom(execution.model)||!atom(execution.modelProvider)||!nativePolicyShape(execution)||data.replyDigestEncoding!=='json-stringify-utf8'||!/^[a-f0-9]{64}$/.test(data.replySha256??''))return false;
    if(!object(data.permissionRequest)||data.permissionRequest.cwd!==root.cwd||!/^[a-f0-9]{64}$/.test(data.permissionRequestSha256??'')||hash(JSON.stringify(data.permissionRequest))!==data.permissionRequestSha256)return false;
    if(Object.keys(data.permissionRequest).length>1&&(!root.proof.verifyPermissionSelectionSync(data.permissionRequest)||!proof.verifyPermissionSelectionSync(data.permissionRequest)||!verifySharedNativePermissionReply(data.permissionRequest,execution)))return false;
    const attestation=Object.freeze({threadId:binding.threadId,cwd:root.cwd,accountRevision:binding.accountRevision,policyOrigin:'native-start-response',permissionSelectionOrigin:'native-start-request',nativePermissionRequestDigest:data.permissionRequestSha256,nativePolicyDigest:digest(execution),nativeReplyDigest:data.replySha256,nativeReplyDigestEncoding:data.replyDigestEncoding,configurationDigest:root.proof.summary().configurationDigest,loadedThreadMcpConfigurationProven:false});
    bindings.set(binding.clientId,{binding:Object.freeze({...binding}),revision:bindingRevision,cwd:root.cwd,state:'created-replied',attestation,nativeExecution:nativePolicyCopy(execution)});return true;
   }finally{proof.close();}
  },
  getAttestationSync(binding){return entry(binding)?.attestation??null;},
  getCreatedArtifactRootSync:binding=>createdArtifactRoot(binding),
  authorizeCreatedArtifactRootSync(binding,path){return pathOK(path)&&createdArtifactRoot(binding)===path;},
  applyArtifactReceiptSync(binding,receipt){
   try{const value=entry(binding),path=createdArtifactRoot(binding,value);if(!path)return false;
    const data=artifactContract.consumeSharedThreadArtifactReceipt(receipt,binding,{operation:'directory'}),request=data?.request,response=data?.response;
    if(data?.operation!=='directory'||!sameBinding(data.binding,binding)||data.directoryPath!==path||request?.method!=='fs/createDirectory'||request.params?.path!==path||request.params?.recursive!==true||Object.keys(request.params).some(k=>!['path','recursive'].includes(k))||response?.id!==request.id||Object.hasOwn(response,'error')||!object(response.result)||Reflect.ownKeys(response.result).length||!/^[a-f0-9]{64}$/.test(data.replySha256??'')||hash(JSON.stringify(response))!==data.replySha256||!scopeCurrent(binding)||createdArtifactRoot(binding,value)!==path||artifactContract.verifySharedThreadArtifactDirectorySync(receipt,binding)!==true)return false;
    const context=createSharedPermissionArtifactContext({cwd:value.cwd,threadId:binding.threadId,artifactRoot:path});
    value.artifact=Object.freeze({path,receipt,context});
    // This records a directory operation, never a fabricated settings reply or
    // an assertion that the daemon already applied a future turn's policy.
    value.attestation=Object.freeze({...value.attestation,artifactDirectoryOrigin:'native-fs-create-directory-response',nativeArtifactDirectoryReplyDigest:data.replySha256});
    return artifactCurrent(binding,value);
   }catch{return false;}
  },
  retireView(viewId){for(const[id,value]of bindings)if(value.binding.viewId===viewId)bindings.delete(id);},
  verifyBoundPermissionSelectionSync(binding,params){
   try{const value=entry(binding),root=roots.get(binding?.projectId);if(!value?.attestation||!value.nativeExecution||!root||params?.threadId!==binding.threadId)return false;
    const hasArtifact=artifactCurrent(binding,value),artifactContext=hasArtifact?value.artifact.context:undefined;
    const fields=copySharedNativePermissionFields(params,{cwd:root.cwd,kind:'turn',artifactContext}),request={cwd:root.cwd,threadId:binding.threadId,...fields};
    if(!scopeCurrent(binding)||!root.proof.verifyPermissionSelectionSync(request,{kind:'turn',artifactContext}))return false;
    const matches=native=>verifySharedNativePermissionReply(request,native,{artifactContext});
    if(matches(value.nativeExecution))return scopeCurrent(binding)&&(!hasArtifact||artifactCurrent(binding,value));
    if(!hasArtifact)return false;
    // Original I2/I4 append only the successfully materialized visualization
    // root. Every approval/profile/network/tmp flag remains the actual start
    // response. Null turn fields retain the original native inheritance rules.
    const original=value.nativeExecution,append=items=>items.includes(value.artifact.path)?[...items]:[...items,value.artifact.path];
    if(!Array.isArray(original.runtimeWorkspaceRoots))return false;
    const derived={...original,runtimeWorkspaceRoots:append(original.runtimeWorkspaceRoots)};
    if(original.sandbox.type==='workspaceWrite')derived.sandbox={...original.sandbox,writableRoots:append(original.sandbox.writableRoots??[])};
    else if(original.sandbox.type!=='dangerFullAccess')return false;
    return matches(derived)&&scopeCurrent(binding)&&artifactCurrent(binding,value);
   }catch{return false;}
  },
  verifyPermissionSelectionSync(scope,params){const root=roots.get(scope?.projectId);return!!root&&scope.cwd===root.cwd&&params?.cwd===root.cwd&&scopeCurrent(scope)&&root.proof.verifyPermissionSelectionSync(params)&&scopeCurrent(scope);},
  verifyProjectSync(scope){const root=roots.get(scope?.projectId);return!!root&&scope.cwd===root.cwd&&scopeCurrent(scope);},close,
 });
}
