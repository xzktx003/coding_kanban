import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const {copySharedThreadSendFrame}=createRequire(import.meta.url)('../src/shared-thread-send-schema.cjs');
const binding={threadId:randomUUID()};
const frame=id=>({id:'actual-native-turn:1',method:'turn/start',params:{threadId:binding.threadId,input:[{type:'text',text:'真实输入 🎯',text_elements:[]}],...id}});
test('official native clientUserMessageId string and null are preserved exactly with original real input',()=>{
 for(const value of ['original-ui-message:'+randomUUID(),null]){
  const original=frame({clientUserMessageId:value}),copied=copySharedThreadSendFrame(original,binding);
  assert.deepEqual(copied,original);assert.equal(copied.params.clientUserMessageId,value);assert.equal(Object.hasOwn(copied.params,'clientUserMessageId'),true);
 }
});
test('absent and undefined clientUserMessageId retain native JSON omission semantics',()=>{
 for(const id of [{},{clientUserMessageId:undefined}]){
  const original=frame(id),copied=copySharedThreadSendFrame(original,binding);
  assert.deepEqual(copied,JSON.parse(JSON.stringify(original)));assert.equal(Object.hasOwn(copied.params,'clientUserMessageId'),false);
 }
});
test('clientUserMessageId is not an escape for arbitrary config or unsafe identifiers',()=>{
 for(const value of [42,{},[],true,'','x'.repeat(257),'has\ncontrol'])assert.throws(()=>copySharedThreadSendFrame(frame({clientUserMessageId:value}),binding),{code:'SHARED_SEND_DENIED'});
 assert.throws(()=>copySharedThreadSendFrame(frame({clientUserMessageId:'real-id',config:{danger:true}}),binding),{code:'SHARED_SEND_DENIED'});
 const max=frame({clientUserMessageId:'x'.repeat(256)});assert.deepEqual(copySharedThreadSendFrame(max,binding),max);
});
