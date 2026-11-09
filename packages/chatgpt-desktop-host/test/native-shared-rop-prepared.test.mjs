import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {AsyncResource} from 'node:async_hooks';
import {createRequire} from 'node:module';
import {types} from 'node:util';
const require=createRequire(import.meta.url);
const {createDynamicToolsRouter}=require('../src/dynamic-tools-routing.cjs');
const {createNativeSharedThreadSendRouter}=require('../src/native-shared-thread-send-routing.cjs');
const original=process.env.CHATGPT_ORIGINAL_ROP_MODULE;
test('actual original RpcPromise is awaited before its steer and start packets can be branded',{
 skip:!original&&'Requires the explicitly pinned original RPC module',
},async()=>{
 const bytes=await readFile(original);assert.equal(createHash('sha256').update(bytes).digest('hex'),'35629d1aabe19b3ebb2833d126f70f858778eb5252c29778b1aa93dee2167855');
 const bundle={},rop={};new Function('exports',bytes.toString())(bundle);
 function webpack(){assert.fail('Unexpected original RPC dependency');}
 webpack.d=(target,getters,values)=>{for(const[k,get]of Object.entries(getters??{}))Object.defineProperty(target,k,{enumerable:true,get});for(const[k,value]of Object.entries(values??{}))Object.defineProperty(target,k,{enumerable:true,value});};
 bundle.modules[12892](null,rop,webpack);
 const profileId=randomUUID(),generation=randomUUID(),viewId=randomUUID(),sender={isDestroyed:()=>false};
 const record={senderId:1,viewId,window:{webContents:sender,isDestroyed:()=>false}},outside=new AsyncResource('actual-readiness-event');
 const binding={hostId:'kanban-shared-cli',runtimeGeneration:generation,daemonGeneration:randomUUID(),accountRevision:1,projectId:'owned',threadId:randomUUID(),viewId,clientId:randomUUID()},writes=[];
 const send=createNativeSharedThreadSendRouter({profileId,generation,getRecord:()=>record,getOwnedRecord:s=>s===sender?record:null,verifyRuntimeSync:()=>true,verifyBindingSync:()=>true,resolveBinding:()=>binding,authorizeSend:(b,f)=>{writes.push(f);return true;},sendToView:()=>{}});
 const life={type:'kanban-shared-connect-lifecycle',sequence:1,epoch:randomUUID()},attemptId=randomUUID();send.lifecycle(sender,life);
 const frame={id:'same-original-sdk-frame',method:'turn/start',params:{threadId:binding.threadId,input:[{type:'text',text:'exact captured click'}],model:'gpt-6.1-sol',effort:'low'}};
 const remote=new rop.AX({prepare(_input,kind){return {conversationId:binding.threadId,steer:{restoreMessage:{}},...(kind==='start'?{start:{request:frame.params}}:{})};}});
 const observed=remote.prepare({},'steer');assert.equal(types.isPromise(observed),false);assert.equal(typeof observed.then,'function');assert.equal(Object.getOwnPropertyDescriptor(observed,'conversationId'),undefined);const resolved=await observed;assert.equal(resolved.conversationId,binding.threadId);resolved[Symbol.dispose]?.();
 const coordinator={async sendMessage(input,prepare){assert.equal(input.message.context.__kanbanSharedSendAttempt,undefined);const steer=await prepare(input,'steer');assert.equal(Object.hasOwn(steer,'start'),false);const packet=await prepare(input,'start');return outside.runInAsyncScope(()=>send.runPreparedSend(packet.start,()=>send.prepareRequest(binding.hostId,frame)));}};
 const routing=createDynamicToolsRouter({getRecord:()=>record,getOwnedRecord:s=>s===sender?record:null,withSend:send.withSend});
 const manager=routing.bindManagers({open:()=>({status:'ready',manager:{getTurnCoordinator:()=>coordinator}})},sender).open(binding.hostId).manager;
 try{
  assert.equal(await send.intent(sender,{type:'kanban-shared-send-intent',v:1,action:'send',profileId,generation,viewId,hostId:binding.hostId,threadId:binding.threadId,attemptId,sequence:1,epoch:life.epoch}),true);
  const result=await manager.getTurnCoordinator().sendMessage({conversationId:binding.threadId,message:{context:{__kanbanSharedSendAttempt:attemptId}}},remote.prepare);
  assert.deepEqual(result.frame,frame);assert.deepEqual(writes,[frame]);
 }finally{send.dispose();remote[Symbol.dispose]?.();outside.emitDestroy();}
});
