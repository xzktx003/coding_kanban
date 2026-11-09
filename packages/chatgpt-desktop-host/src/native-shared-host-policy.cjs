'use strict';
const {createHash}=require('node:crypto');
const {adaptNativeSharedThreadChunk}=require('./native-shared-thread-policy.cjs');
const BASE='4faa8790de76b9434e943d17fb0e5a9604a358540255d4b7f4561ef03aeb14e7';
const ADAPTED='884acb17715a65a33e0bb8df96f8fda5049e5ccd2d42bac0a82d9051d0de7fc4';
const PATCHES=Object.freeze([
 ['this.appServerManagersService=new Et(this.hostAppServerManagers,this.hostAppServerAccounts),this.daybreakPreferences=',
  'this.appServerManagersService=new Et(this.hostAppServerManagers,this.hostAppServerAccounts),globalThis.__kanbanRegisterSharedSource(this),this.daybreakPreferences='],
 ['getHostConfigForHostId(e){if(e===ar.n)',
  'getHostConfigForHostId(e){if(e==="kanban-shared-cli"){let t=this.appServerConnectionRegistry.getMaybeConnection(e);if(!t)throw Error("Shared host unavailable");return t.hostConfig}if(e===ar.n)'],
 ['function eTw(e){let t=function(e){',
  'function eTw(e){if(e.hostConfig.id==="kanban-shared-cli")return globalThis.__kanbanSelectSharedDesktopTransport(e.hostConfig.id,e.hostConfig,e.desktopAppTools,ex5);let t=function(e){'],
 ['async readCodexHome(e){let t=this.getExecutionHost(e);return eI(t.isLocal?',
  'async readCodexHome(e){let t=this.getExecutionHost(e);return eI(e==="kanban-shared-cli"?await globalThis.__kanbanReadSharedCodexHome(t):t.isLocal?'],
]);
const fail=()=>Object.assign(new Error('Shared native host patch unavailable'),{code:'SHARED_HOST_PATCH_MISMATCH'});
function adaptNativeSharedHostChunk({body}={}){
 const base=adaptNativeSharedThreadChunk({body});if(base.adaptedSha256!==BASE)throw fail();
 let source=base.body.toString('utf8');
 for(const [before,after] of PATCHES){const at=source.indexOf(before);if(at<0||at!==source.lastIndexOf(before))throw fail();source=source.slice(0,at)+after+source.slice(at+before.length);}
 const result=Buffer.from(source),sha=createHash('sha256').update(result).digest('hex');if(sha!==ADAPTED)throw fail();
 return{...base,body:result,sharedThreadSha256:BASE,adaptedSha256:sha};
}
module.exports={adaptNativeSharedHostChunk};
