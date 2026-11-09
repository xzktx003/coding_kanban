'use strict';
const {createNativeSharedThreadCreationClient,isSharedThreadCreationFrame}=require('./shared-thread-creation-ipc.cjs');
const {createNativeSharedThreadCreationRouter,readNativeSharedFirstTurnControl}=require('./native-shared-thread-creation-routing.cjs');
const {createNativeSharedThreadSendClient,isSharedThreadSendFrame}=require('./shared-thread-send-ipc.cjs');
const {createNativeSharedThreadSendRouter}=require('./native-shared-thread-send-routing.cjs');
const {plain,copySharedThreadSendFrame}=require('./shared-thread-send-schema.cjs');
const denied=()=>Object.assign(new Error('Shared original submit unavailable'),{code:'SHARED_SEND_INTENT_DENIED'});
const empty=value=>value==null||(Array.isArray(value)&&value.length===0)||(plain(value)&&Reflect.ownKeys(value).length===0);
// The pinned original manager adds generated IDs, trace and empty optional
// defaults before its SDK request. User text and model/effort are never rebuilt.
// Native permission selections and explicit-request-only mode are preserved.
// Unimplemented context, plugin, tier or new fields fail without losing settings.
function canonicalizeOriginalSharedTurn(frame,binding){
 if(!plain(frame)||!plain(frame.params)||frame.method!=='turn/start'||frame.params.threadId!==binding.threadId||Reflect.ownKeys(frame).some(k=>!['id','method','params','jsonrpc','trace'].includes(k)))throw denied();
 const p=frame.params,allowed=['threadId','input','model','effort','collaborationMode','clientUserMessageId','approvalPolicy','approvalsReviewer','permissions','runtimeWorkspaceRoots','sandboxPolicy','multiAgentMode','summary','personality','responsesapiClientMetadata','additionalContext','cyberAccessProgram'];
 const nullable=['parentTurnId','rootTurnId','disabledPluginIds','toolOutput','additionalContext','responsesapiClientMetadata','serviceTier'];
 for(const k of Reflect.ownKeys(p)){
  const d=Object.getOwnPropertyDescriptor(p,k);if(typeof k!=='string'||!d||!Object.hasOwn(d,'value'))throw denied();
  // These original SDK object properties are absent from its actual JSON wire.
  if(d.value===undefined)continue;
  if(allowed.includes(k))continue;
  if(['cwd','environments','cyberAccessProgram','outputSchema'].includes(k)&&p[k]===null)continue;
  if(k==='turnTrigger'&&[undefined,null,'composer'].includes(p[k]))continue;
  if(nullable.includes(k)&&empty(p[k]))continue;
  throw denied();
 }
 try{return copySharedThreadSendFrame({id:frame.id,method:frame.method,params:Object.fromEntries(allowed.filter(k=>Object.hasOwn(p,k)&&p[k]!==undefined&&(k!=='additionalContext'||!empty(p[k]))&&(k!=='cyberAccessProgram'||p[k]!==null)).map(k=>[k,p[k]])),...(frame.jsonrpc===undefined?{}:{jsonrpc:frame.jsonrpc})},binding);}catch{throw denied();}
}
function createNativeSharedThreadSubmission({profileId,generation,getRecord,getOwnedRecord,verifyCurrentSync,sendToView,sendFrame,router}={}){
 if(!router||['lifecycle','findFollower','adoptCreatedBinding','prepareRequest','retire'].some(k=>typeof router[k]!=='function'))throw denied();
 const lives=new WeakMap(),records=new Set();let closed=false;
 const current=()=>{try{return !closed&&verifyCurrentSync()===true}catch{return false}};
 const followerFor=binding=>{
  if(!current())return null;
  for(const record of records){const life=lives.get(record);if(!life||record.viewId!==binding.viewId)continue;
   const sender=record.window?.webContents;const f=router.findFollower(sender,{hostId:binding.hostId,threadId:binding.threadId,viewId:binding.viewId,sequence:life.sequence,epoch:life.epoch});
   if(f&&JSON.stringify(f.binding)===JSON.stringify(binding))return f;
  }return null;
 };
 const creationClient=createNativeSharedThreadCreationClient({profileId,generation,verifyCurrentSync:current,sendFrame});
 const sendClient=createNativeSharedThreadSendClient({profileId,generation,verifyCurrentSync:current,sendFrame});
 const creation=createNativeSharedThreadCreationRouter({profileId,generation,getRecord,getOwnedRecord,verifyRuntimeSync:current,sendToView,
  resolveCreateScope:(_record,target,control)=>creationClient.resolveCreateScope(target,control),
  authorizeCreate:(...args)=>creationClient.authorizeCreate(...args),resolveCreatedBinding:(...args)=>creationClient.resolveCreatedBinding(...args),
  onBound:(binding,_control,token)=>router.adoptCreatedBinding(binding,token)});
 const sender=createNativeSharedThreadSendRouter({profileId,generation,getRecord,getOwnedRecord,verifyRuntimeSync:current,sendToView,
  verifyBindingSync:binding=>!!followerFor(binding),getFirstTurnControlSync:readNativeSharedFirstTurnControl,
  resolveBinding:(record,target)=>{const f=router.findFollower(record.window.webContents,target);if(!f)throw denied();return f.binding;},
  authorizeSend:(...args)=>sendClient.authorizeSend(...args),canonicalizeFrame:canonicalizeOriginalSharedTurn});
 function lifecycle(owner,message){
  // The existing router publishes the sole browser lifecycle ACK. All three
  // routers must install exactly that same epoch before any submit can run.
  if(!router.lifecycle(owner,message))return false;
  if(!creation.lifecycle(owner,message)||!sender.lifecycle(owner,message)){retire(owner);return false;}
  const record=getOwnedRecord(owner);if(!record)return false;
  lives.set(record,{sequence:message.sequence,epoch:message.epoch});records.add(record);return true;
 }
 function prepareRequest(hostId,frame){
  if(hostId==='kanban-shared-cli'&&frame?.method==='thread/start')return creation.prepareRequest(hostId,frame);
  if(hostId==='kanban-shared-cli'&&frame?.method==='turn/start'){
   const first=creation.getFirstTurnContext(hostId,frame);
   // Keep the authorized snapshot immutable. The original SDK assigns params
   // on its transport envelope, even when its metadata helper returns unchanged.
   return (first?sender.prepareFirstTurn(first.binding,frame,first.token):sender.prepareRequest(hostId,frame))
    .then(prepared=>Object.freeze({frame:{...prepared.frame},shared:prepared.shared}));
  }
  return router.prepareRequest(hostId,frame);
 }
 function receive(frame){
  if(isSharedThreadCreationFrame(frame,{side:'native',profileId,generation}))return creationClient.receive(frame);
  if(isSharedThreadSendFrame(frame,{side:'native',profileId,generation}))return sendClient.receive(frame);
  return false;
 }
 function retire(owner){const record=getOwnedRecord(owner);if(record){lives.delete(record);records.delete(record);}creation.retire(owner);sender.retire(owner);return router.retire(owner);}
 function dispose(){if(closed)return;closed=true;creation.dispose();sender.dispose();creationClient.close();sendClient.close();records.clear();}
 return Object.freeze({lifecycle,createIntent:creation.intent,sendIntent:sender.intent,withStart:creation.withStart,withSend:sender.withSend,runPreparedSend:sender.runPreparedSend,prepareRequest,receive,retire,dispose});
}
module.exports={createNativeSharedThreadSubmission,canonicalizeOriginalSharedTurn};
