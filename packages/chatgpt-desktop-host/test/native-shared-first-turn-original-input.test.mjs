import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createNativeSharedThreadCreationRouter,readNativeSharedFirstTurnControl}=require('../src/native-shared-thread-creation-routing.cjs');
const {createNativeSharedThreadSendRouter}=require('../src/native-shared-thread-send-routing.cjs');
const {canonicalizeOriginalSharedTurn}=require('../src/native-shared-thread-submission.cjs');
const directory=process.env.CHATGPT_SHARED_I2_ORIGINAL_DIR;
const pins={'helper-I0.js':'c80ec29b8a655faba31200a973781102d4cd017461c2a7b162b563553c3eaea5','rt-sendMessage.js':'04d0ab608dd0b94567b439f7405c14af40e8e47a2119d8896ebd9935e1df98aa','rG.js':'8507f7540048bfe9a7477a849c735b208816db41efbf31ab9c81cd29050554b9'};
function originalInput(){
 const load=name=>{const value=readFileSync(join(directory,name),'utf8');assert.equal(createHash('sha256').update(value).digest('hex'),pins[name]);return value;};
 const unused=()=>{throw Error('The attachment/audio boundary is not selected');};
 const prepare=new Function('ro','v9',load('helper-I0.js')+';return I0;')({JF:()=>true},unused);
 const sendMessage=new Function('nc','q','n9','nQ','Buffer',`return ({${load('rt-sendMessage.js')}}).sendMessage`)({}, {iwv:'local',V57:'local'},()=>({}),()=>false,Buffer);
 const Prewarm=new Function(load('rG.js')+';return rG;')();
 return{prepare,wire(frame,binding){let text;const prewarm=new Prewarm();sendMessage.call({options:{hostId:'kanban-shared-cli',hostKind:'remote',getConnection:()=>({send:value=>{assert.equal(text,undefined);text=value;}}),transformOutgoingMessage:value=>prewarm.prepare(canonicalizeOriginalSharedTurn(value,binding)),logger:{debug(){},trace(){}}},outgoingMessageSizeTracker:{track:()=>[]},rememberSharedThread(){}},frame);assert.equal(typeof text,'string');return JSON.parse(text);}};
}

test('fixed native I2 input conversion and original SDK serialization preserve a single LF in the staged first message after slow preprocessing',{skip:!directory?'Requires the explicitly supplied pinned original native input and SDK functions':false},async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let now=100;
 const original=originalInput(),profileId=randomUUID(),generation=randomUUID(),sender={isDestroyed:()=>false},viewId=randomUUID();
 const record={senderId:1,viewId,window:{webContents:sender,isDestroyed:()=>false}},cwd='/owned/first-original-input';
 const scope={hostId:'kanban-shared-cli',runtimeGeneration:generation,daemonGeneration:randomUUID(),accountRevision:1,projectId:'owned-project',cwd,viewId,creationNonce:randomUUID()};
 const binding={hostId:scope.hostId,runtimeGeneration:generation,daemonGeneration:scope.daemonGeneration,accountRevision:1,projectId:scope.projectId,threadId:randomUUID(),viewId,clientId:randomUUID()};
 const common={profileId,generation,getRecord:()=>record,getOwnedRecord:value=>value===sender?record:null,verifyRuntimeSync:()=>true,sendToView(){},now:()=>now};
 const creation=createNativeSharedThreadCreationRouter({...common,resolveCreateScope:async()=>scope,authorizeCreate:async()=>true,resolveCreatedBinding:async()=>binding,onBound:async()=>true});
 const authorizations=[];
 const sending=createNativeSharedThreadSendRouter({...common,verifyBindingSync:value=>value.threadId===binding.threadId,resolveBinding:async()=>binding,canonicalizeFrame:canonicalizeOriginalSharedTurn,getFirstTurnControlSync:readNativeSharedFirstTurnControl,authorizeSend:async(_binding,frame,control)=>{authorizations.push({frame,control});return true;}});
 const life={type:'kanban-shared-connect-lifecycle',sequence:1,epoch:randomUUID()},attemptId=randomUUID(),clientThreadId=randomUUID();
 try{
  creation.lifecycle(sender,life);
  assert.equal(await creation.intent(sender,{type:'kanban-shared-create-intent',v:1,action:'create',profileId,generation,viewId,hostId:scope.hostId,projectId:scope.projectId,cwd,clientThreadId,attemptId,sequence:1,epoch:life.epoch}),true);
  const input=[{type:'text',text:'保留原始第一行\nKeep the original second line',text_elements:[]}];
  await creation.withStart(sender,scope.hostId,{cwd,input,model:'owned-selected-model',reasoningEffort:'high',clientUserMessageId:'owned-original-message',__kanbanSharedCreateAttempt:attemptId,__kanbanSharedCreateClient:clientThreadId},async(clean,created)=>{
   await creation.prepareRequest(scope.hostId,{id:'owned-start',method:'thread/start',params:{cwd,model:'owned-selected-model'}});
   await created(binding.threadId);
   now+=34000;t.mock.timers.tick(34000);
   // This is I2's actual no-attachment audio/input helper, then the original
   // SDK outgoing transform/stringify. No text or newline is reconstructed.
   const converted=await original.prepare({getAppServerVersion:()=> '0.166.0'},clean.input,null,'owned-selected-model');
   assert.equal(converted,clean.input);
   const frame=original.wire({id:'owned-first',method:'turn/start',params:{threadId:binding.threadId,input:converted,model:clean.model,effort:clean.reasoningEffort,clientUserMessageId:clean.clientUserMessageId}},binding);
   const capability=creation.getFirstTurnContext(scope.hostId,frame);assert.ok(capability);
   const result=await sending.prepareFirstTurn(capability.binding,frame,capability.token);
   assert.equal(result.frame.params.input[0].text,input[0].text);assert.deepEqual(result.frame.params.input[0].text_elements,[]);
   assert.equal(authorizations.length,1);assert.equal(authorizations[0].control.deadline,now+30000);
  });
  assert.equal(authorizations[0].control.signal.aborted,true,'the original invocation ending destroys its first-stage control');
 }finally{creation.dispose();sending.dispose();}
});
