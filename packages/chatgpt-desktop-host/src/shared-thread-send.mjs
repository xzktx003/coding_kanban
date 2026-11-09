import {performance} from 'node:perf_hooks';

import schema from './shared-thread-send-schema.cjs';
const {UUID,plain,keys,atom,key,copyBinding,copySharedThreadSendFrame}=schema;
export {copySharedThreadSendFrame};
const brands=new WeakSet(),MAX_PENDING=16,MAX_USED=8192;
const denied=()=>Object.assign(new Error('Shared turn send denied'),{code:'SHARED_SEND_DENIED'});
const unknown=()=>Object.assign(new Error('Shared turn delivery unknown'),{code:'SHARED_DAEMON_OUTCOME_UNKNOWN'});
export const isSharedThreadSendAuthority=value=>brands.has(value);

/** Server-only capability bound to the original explicit native submit. It never
 * sends a frame. The same-writer gate must call beforeWriteSync and synchronously
 * perform its original socket write with no await between guard and write.
 */
export function createSharedThreadSendAuthority({verifyBindingSync,getOwnedView,verifyOwnedViewSync,verifyExplicitIntentSync,verifySelectionSync,verifyPermissionsSync,now=()=>performance.now()}={}){
 if([verifyBindingSync,getOwnedView,verifyOwnedViewSync,verifyExplicitIntentSync,now].some(fn=>typeof fn!=='function')||(verifySelectionSync!==undefined&&typeof verifySelectionSync!=='function')||(verifyPermissionsSync!==undefined&&typeof verifyPermissionsSync!=='function'))throw denied();
 const pending=new Map(),nonces=new Set(),ids=new Set(),retired=new WeakSet();let closed=false;
 function selected(frame,binding){
  const p=frame.params;
  try{
   if(['approvalPolicy','approvalsReviewer','permissions','runtimeWorkspaceRoots','sandboxPolicy'].some(k=>Object.hasOwn(p,k)&&p[k]!==null)&&verifyPermissionsSync?.(p,binding)!==true)return false;
   return !['model','effort','collaborationMode'].some(k=>Object.hasOwn(p,k)&&p[k]!==null)||verifySelectionSync?.(p,binding)===true;
  }catch{return false;}
 }
 function valid(v){try{return !closed&&!v.signal.aborted&&now()<v.deadline&&!retired.has(v.record)&&getOwnedView(v.binding.viewId)===v.record&&v.record.viewId===v.binding.viewId&&verifyOwnedViewSync(v.binding.viewId)===true&&verifyBindingSync(v.binding)===true&&selected(v.frame,v.binding);}catch{return false;}}
 function registerSend(rawBinding,rawFrame,control){
  const binding=copyBinding(rawBinding),frame=copySharedThreadSendFrame(rawFrame,binding),id=key(frame.id);
  if(!keys(control,['attemptId','signal','deadline'])||!UUID.test(control.attemptId??'')||!(control.signal instanceof AbortSignal)||!Number.isFinite(control.deadline)||control.deadline<=now()||control.deadline>now()+30000||pending.size>=MAX_PENDING||nonces.size>=MAX_USED||ids.size>=MAX_USED||nonces.has(control.attemptId)||ids.has(id))throw denied();
  const record=getOwnedView(binding.viewId),value={binding,frame,record,signal:control.signal,deadline:control.deadline,state:'registered'};
  if(!record||!valid(value)||verifyExplicitIntentSync(binding,frame,control)!==true||!valid(value))throw denied();
  nonces.add(control.attemptId);ids.add(id);pending.set(id,value);return true;
 }
 function beforeWriteSync(rawFrame){
  const id=key(rawFrame?.id),v=pending.get(id);
  if(!v||v.state!=='registered')throw denied();
  let frame;try{frame=copySharedThreadSendFrame(rawFrame,v.binding);}catch{pending.delete(id);throw denied();}
  if(JSON.stringify(frame)!==JSON.stringify(v.frame)||!valid(v)){pending.delete(id);throw denied();}
  v.state='dispatched';return true;
 }
 function observeReplySync(rawFrame,reply){
  const id=key(rawFrame?.id),v=pending.get(id);if(!v||v.state!=='dispatched')throw unknown();pending.delete(id);
  if(!valid(v)||!keys(reply,['id','result','error','jsonrpc'],['id'])||reply.id!==v.frame.id||(reply.jsonrpc!==undefined&&reply.jsonrpc!=='2.0')||Object.hasOwn(reply,'result')===Object.hasOwn(reply,'error'))throw unknown();
  if(Object.hasOwn(reply,'error')){if(!keys(reply.error,['code','message','data'],['code','message'])||!Number.isInteger(reply.error.code)||typeof reply.error.message!=='string')throw unknown();return Object.freeze({status:'rejected'});}
  const t=reply.result?.turn;
  if(!plain(reply.result)||!plain(t)||!atom(t.id)||!Array.isArray(t.items)||!['inProgress','completed','interrupted','failed'].includes(t.status)||(Object.hasOwn(t,'error')&&t.error!==null&&!plain(t.error)))throw unknown();
  return Object.freeze({status:'started',threadId:v.binding.threadId,turnId:t.id});
 }
 function retireView(viewId){const record=getOwnedView(viewId);if(record&&typeof record==='object')retired.add(record);for(const[id,v]of pending)if(v.binding.viewId===viewId){retired.add(v.record);pending.delete(id);}}
 function close(){closed=true;pending.clear();}
 const authority=Object.freeze({registerSend,beforeWriteSync,observeReplySync,retireView,close});brands.add(authority);return authority;
}
