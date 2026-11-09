'use strict';
const {posix}=require('node:path');
const fail=()=>Object.assign(new Error('Shared permission selection is unsupported'),{code:'SHARED_PERMISSION_SELECTION_UNSUPPORTED'});
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
function record(x,names,required=[]){if(!object(x))throw fail();const keys=Reflect.ownKeys(x);if(keys.some(k=>typeof k!=='string'||!names.includes(k))||required.some(k=>!Object.hasOwn(x,k)))throw fail();for(const k of keys)if(!Object.hasOwn(Object.getOwnPropertyDescriptor(x,k)??{},'value'))throw fail();return x;}
function own(x,k){if(!object(x))throw fail();const d=Object.getOwnPropertyDescriptor(x,k);if(d&&!Object.hasOwn(d,'value'))throw fail();return d?.value;}
const validPath=x=>typeof x==='string'&&x.length>1&&x.length<=4096&&posix.isAbsolute(x)&&posix.normalize(x)===x&&!/[\x00-\x1f\x7f]/.test(x);
// This opaque context carries already-authorized metadata only. Its server
// owner must still prove the binding and actual native/filesystem receipt.
const artifactContexts=new WeakMap();
function artifactDate(threadId){
 let timestamp;
 if(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(threadId))timestamp=Number.parseInt(threadId.slice(0,8)+threadId.slice(9,13),16);
 else if(/^[0-9a-f]{8}-[0-9a-f]{3}[048c]-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(threadId))timestamp=1000*Number.parseInt(threadId.slice(0,8),16);
 else throw fail();
 const date=new Date(timestamp);return[date.getUTCFullYear(),String(date.getUTCMonth()+1).padStart(2,'0'),String(date.getUTCDate()).padStart(2,'0')].join('/');
}
function createSharedPermissionArtifactContext(value){
 record(value,['cwd','threadId','artifactRoot'],['cwd','threadId','artifactRoot']);
 const {cwd,threadId,artifactRoot}=value;
 if(!validPath(cwd)||typeof threadId!=='string'||!validPath(artifactRoot)||!artifactRoot.endsWith('/visualizations/'+artifactDate(threadId)+'/'+threadId))throw fail();
 const token=Object.freeze({});artifactContexts.set(token,Object.freeze({cwd,threadId,artifactRoot}));return token;
}
function artifactContextData(token,cwd,threadId){
 if(token===null||token===undefined)return null;
 const value=artifactContexts.get(token);if(!value||value.cwd!==cwd||threadId!==undefined&&threadId!==value.threadId)throw fail();return value;
}
function rootPath(x,cwd,context){if(!validPath(x)||cwd!==undefined&&(!validPath(cwd)||(x!==cwd&&!x.startsWith(cwd+'/')&&x!==context?.artifactRoot)))throw fail();return x;}
function roots(x,cwd,context){if(!Array.isArray(x)||x.length>16)throw fail();const out=[];for(let i=0;i<x.length;i++){const d=Object.getOwnPropertyDescriptor(x,String(i));if(!d||!Object.hasOwn(d,'value'))throw fail();out.push(rootPath(d.value,cwd,context));}return Object.freeze(out);}
function freeze(x){if(x&&typeof x==='object'){for(const v of Object.values(x))freeze(v);Object.freeze(x);}return x;}
const bool=x=>{if(typeof x!=='boolean')throw fail();return x;};
const reviewer=x=>{if(!['user','auto_review','guardian_subagent'].includes(x))throw fail();return x;};
function profileId(x){if(typeof x!=='string'||!([':read-only',':workspace',':danger-full-access'].includes(x)||/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(x)))throw fail();return x;}
function profile(x){if(x===null)return null;record(x,['id','extends'],['id']);return freeze({id:profileId(x.id),...(Object.hasOwn(x,'extends')?{extends:x.extends===null?null:profileId(x.extends)}:{})});}
function approval(x){if(['untrusted','on-request','never'].includes(x))return x;record(x,['granular'],['granular']);record(x.granular,['sandbox_approval','rules','mcp_elicitations','skill_approval','request_permissions'],['sandbox_approval','rules','mcp_elicitations']);return freeze({granular:Object.fromEntries(Object.keys(x.granular).map(k=>[k,bool(x.granular[k])]))});}
function sandbox(x,cwd,context){record(x,['type','networkAccess','writableRoots','excludeSlashTmp','excludeTmpdirEnvVar'],['type']);let out={type:x.type};if(x.type==='dangerFullAccess'){record(x,['type'],['type']);return freeze(out);}if(x.type==='readOnly'){record(x,['type','networkAccess'],['type']);if(Object.hasOwn(x,'networkAccess'))out.networkAccess=bool(x.networkAccess);return freeze(out);}if(x.type==='externalSandbox'){record(x,['type','networkAccess'],['type']);if(Object.hasOwn(x,'networkAccess')){if(!['restricted','enabled'].includes(x.networkAccess))throw fail();out.networkAccess=x.networkAccess;}return freeze(out);}if(x.type!=='workspaceWrite')throw fail();for(const k of ['networkAccess','excludeSlashTmp','excludeTmpdirEnvVar'])if(Object.hasOwn(x,k))out[k]=bool(x[k]);if(Object.hasOwn(x,'writableRoots'))out.writableRoots=roots(x.writableRoots,cwd,context);return freeze(out);}
function copySharedDesktopPermissionConfig(value,{cwd,artifactContext}={}){
 if(!validPath(cwd))throw fail();const context=artifactContextData(artifactContext,cwd);if(value===null||value===undefined)return value;
 record(value,['activePermissionProfile','runtimeWorkspaceRoots','sandboxPolicy','approvalPolicy','approvalsReviewer'],['sandboxPolicy','approvalPolicy','approvalsReviewer']);
 const out={};for(const k of Object.keys(value))out[k]=k==='activePermissionProfile'?profile(value[k]):k==='runtimeWorkspaceRoots'?roots(value[k],cwd,context):k==='sandboxPolicy'?sandbox(value[k],cwd,context):k==='approvalPolicy'?approval(value[k]):reviewer(value[k]);
 if(out.sandboxPolicy.type==='externalSandbox'&&!out.activePermissionProfile)throw fail();return freeze(out);
}
const configKeys=['sandbox_workspace_write','sandbox_workspace_write.writable_roots','sandbox_workspace_write.network_access','sandbox_workspace_write.exclude_slash_tmp','sandbox_workspace_write.exclude_tmpdir_env_var'];
function workspaceConfig(value,cwd,context){record(value,['writable_roots','network_access','exclude_slash_tmp','exclude_tmpdir_env_var']);return freeze(Object.fromEntries(Object.keys(value).map(k=>[k,k==='writable_roots'?roots(value[k],cwd,context):bool(value[k])])));}
function configProjection(value,cwd,context){if(!object(value))throw fail();const out={};for(const k of configKeys){const d=Object.getOwnPropertyDescriptor(value,k);if(!d)continue;if(!Object.hasOwn(d,'value'))throw fail();const v=d.value;if(v===undefined)continue;out[k]=k==='sandbox_workspace_write'?workspaceConfig(v,cwd,context):k.endsWith('writable_roots')?roots(v,cwd,context):bool(v);}if(Object.hasOwn(out,'sandbox_workspace_write')&&Object.keys(out).length>1)throw fail();return Object.keys(out).length?freeze(out):null;}
function copySharedNativePermissionFields(params,{cwd,kind,artifactContext}={}){
 if(!object(params)||!['start','turn'].includes(kind)||!(validPath(cwd)||kind==='turn'&&cwd===undefined))throw fail();
 const contextThreadId=artifactContext==null?undefined:own(params,'threadId');
 if(artifactContext!=null&&(kind!=='turn'||contextThreadId===undefined))throw fail();
 const context=artifactContextData(artifactContext,cwd,contextThreadId),out={};
 if(own(params,kind==='start'?'sandboxPolicy':'sandbox')!==undefined)throw fail();
 for(const k of ['approvalPolicy','approvalsReviewer','permissions','runtimeWorkspaceRoots',kind==='start'?'sandbox':'sandboxPolicy']){
  const value=own(params,k);if(value===undefined)continue;if(value===null){out[k]=null;continue;}
  out[k]=k==='approvalPolicy'?approval(value):k==='approvalsReviewer'?reviewer(value):k==='permissions'?profileId(value):k==='runtimeWorkspaceRoots'?roots(value,cwd,context):k==='sandboxPolicy'?sandbox(value,cwd,context):(()=>{if(!['read-only','workspace-write','danger-full-access'].includes(value))throw fail();return value;})();
 }
 if(out.permissions!=null&&(out.sandbox!=null||out.sandboxPolicy!=null))throw fail();
 const config=own(params,'config');if(config!==undefined&&config!==null){const copied=configProjection(config,cwd,context);if(copied)out.config=copied;}
 if(Buffer.byteLength(JSON.stringify(out))>64*1024)throw fail();return freeze(out);
}
function canonical(x){if(x===null||typeof x!=='object')return JSON.stringify(x);if(Array.isArray(x))return'['+x.map(canonical).join(',')+']';return'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';}
function normalApproval(x){const copied=approval(x);return typeof copied==='string'?copied:{granular:{skill_approval:false,request_permissions:false,...copied.granular}};}
function normalSandbox(x,cwd,context){const copied=sandbox(x,cwd,context);return copied.type==='readOnly'?{networkAccess:false,...copied}:copied.type==='workspaceWrite'?{writableRoots:[],networkAccess:false,excludeSlashTmp:false,excludeTmpdirEnvVar:false,...copied}:copied.type==='externalSandbox'?{networkAccess:'restricted',...copied}:copied;}
function verifySharedNativePermissionReply(params,result,{artifactContext}={}){
 try{if(!object(params)||!object(result)||!validPath(result.cwd)||(params.cwd!==undefined&&params.cwd!==result.cwd))return false;const context=artifactContextData(artifactContext,result.cwd,artifactContext==null?undefined:own(params,'threadId'));if(context){const thread=own(result,'thread'),ids=[own(result,'threadId'),thread==null?undefined:own(thread,'id')];if(ids.some(id=>id!==undefined&&id!==context.threadId))return false;}const requested=copySharedNativePermissionFields(params,{cwd:result.cwd,kind:Object.hasOwn(params,'threadId')||Object.hasOwn(params,'sandboxPolicy')?'turn':'start',artifactContext}),actual=normalSandbox(result.sandbox,result.cwd,context);approval(result.approvalPolicy);reviewer(result.approvalsReviewer);
  if(requested.approvalPolicy!=null&&canonical(normalApproval(requested.approvalPolicy))!==canonical(normalApproval(result.approvalPolicy)))return false;
  if(requested.approvalsReviewer!=null&&requested.approvalsReviewer!==result.approvalsReviewer)return false;
  if(requested.permissions!=null&&profile(result.activePermissionProfile)?.id!==requested.permissions)return false;
  const builtin={':read-only':'readOnly',':workspace':'workspaceWrite',':danger-full-access':'dangerFullAccess'}[requested.permissions];
  if(builtin&&actual.type!==builtin)return false;
  if(builtin==='readOnly'&&actual.networkAccess!==false)return false;
  if(builtin==='workspaceWrite'){const cfg=requested.config?.sandbox_workspace_write??Object.fromEntries(Object.entries(requested.config??{}).map(([k,v])=>[k.slice('sandbox_workspace_write.'.length),v]));for(const [nativeKey,key] of [['networkAccess','network_access'],['excludeSlashTmp','exclude_slash_tmp'],['excludeTmpdirEnvVar','exclude_tmpdir_env_var']])if(actual[nativeKey]!==(cfg[key]??false))return false;}
  if(requested.runtimeWorkspaceRoots!=null&&canonical(requested.runtimeWorkspaceRoots)!==canonical(roots(result.runtimeWorkspaceRoots,result.cwd,context)))return false;
  if(requested.sandbox!=null&&actual.type!=={'read-only':'readOnly','workspace-write':'workspaceWrite','danger-full-access':'dangerFullAccess'}[requested.sandbox])return false;
  if(requested.sandboxPolicy!=null&&canonical(normalSandbox(requested.sandboxPolicy,result.cwd,context))!==canonical(actual))return false;
  if(requested.config&&actual.type==='workspaceWrite'){
   const nested=requested.config.sandbox_workspace_write,flat=Object.fromEntries(Object.entries(requested.config).filter(([k])=>k!=='sandbox_workspace_write').map(([k,v])=>[k.slice('sandbox_workspace_write.'.length),v])),cfg=nested??flat;
   for(const [k,v] of Object.entries(cfg)){const field={network_access:'networkAccess',exclude_slash_tmp:'excludeSlashTmp',exclude_tmpdir_env_var:'excludeTmpdirEnvVar'}[k];if(field&&actual[field]!==v)return false;if(k==='writable_roots'){const expected=[...(requested.runtimeWorkspaceRoots??[result.cwd]),...v];if(canonical([...new Set(expected)].sort())!==canonical([...new Set(actual.writableRoots)].sort()))return false;}}
  }
  return true;
 }catch{return false;}
}
module.exports={createSharedPermissionArtifactContext,copySharedDesktopPermissionConfig,copySharedNativePermissionFields,verifySharedNativePermissionReply};
