import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Bridge} from '../bridge.mjs';
const user='ou_owner';
function fixture(){
 const rows=new Map();const store={get:k=>rows.get(k),put:(k,v)=>rows.set(k,v)};let sent=0;const delivered=[];
 const agent={id:'s1',session:{id:'s1'},followup:m=>delivered.push(m)};
 const session={id:'s1',header:{}};agent.session=session;
 const bridge=new Bridge({store,allowedUserId:user,send:async()=>{sent++;return {messageId:'om_card',chatId:'oc_chat'}},submit:async input=>{assert.equal(input.sessionId,'s1');agent.followup({content:[{type:'text',text:input.text}]});return {accepted:true}}});
 return {bridge,session,rows,delivered,sent:()=>sent,agent};
}
const event=(type,data,seq)=>({type,data,seq});
test('only observed root completed turns send final text once, no tool/reasoning body',async()=>{
 const f=fixture();await f.bridge.event(f.session,event('turn/end',{turn:0,reason:{kind:'completed'}},0));assert.equal(f.sent(),0);
 await f.bridge.event(f.session,event('turn/start',{turn:1},1));
 await f.bridge.event(f.session,event('assistant/message',{turn:1,message:{content:[{type:'text',text:'done'},{type:'reasoning',text:'SECRET'}]}},2));
 await f.bridge.event(f.session,event('turn/end',{turn:1,reason:{kind:'completed'}},3));
 await f.bridge.event(f.session,event('turn/end',{turn:1,reason:{kind:'completed'}},3));
 assert.equal(f.sent(),1);assert.equal(f.rows.get('card:om_card').sessionId,'s1');
});
test('reply checks sender/chat/card binding, delivers exactly once through native followup',async()=>{
 const f=fixture();f.rows.set('card:om_card',{sessionId:'s1',chatId:'oc_chat',expiresAt:Date.now()+10000});
 const reply={type:'im.message.receive_v1',chat_type:'p2p',message_id:'om_reply',sender_id:user,sender_type:'user',chat_id:'oc_chat',root_id:'om_card',message_type:'text',content:JSON.stringify({text:'continue'})};
 assert.equal(await f.bridge.reply({...reply,sender_id:'ou_other'}),'ignored');
 assert.equal(await f.bridge.reply({...reply,chat_id:'oc_wrong'}),'ignored');
 assert.equal(await f.bridge.reply(reply),'accepted');assert.equal(await f.bridge.reply(reply),'duplicate');assert.equal(f.delivered.length,1);
 assert.equal(f.delivered[0].content[0].text,'continue');
});
test('unknown submission receipts never automatically resend; disposed targets fail closed',async()=>{
 const f=fixture();f.rows.set('card:om_card',{sessionId:'s1',chatId:'oc_chat',expiresAt:Date.now()+10000});
 f.agent.followup=()=>{throw Error('unknown')};
 const r={type:'im.message.receive_v1',chat_type:'p2p',message_id:'om_reply',sender_id:user,sender_type:'user',chat_id:'oc_chat',root_id:'om_card',message_type:'text',content:'{"text":"again"}'};
 assert.equal(await f.bridge.reply(r),'unknown');assert.equal(await f.bridge.reply(r),'duplicate');
});
test('CLI plain text is accepted; group and conflicting reply targets are rejected',async()=>{
 const f=fixture();f.rows.set('card:om_card',{sessionId:'s1',chatId:'oc_chat',expiresAt:Date.now()+10000});
 f.rows.set('card:om_other',{sessionId:'s2',chatId:'oc_chat',expiresAt:Date.now()+10000});
 const r={type:'im.message.receive_v1',chat_type:'p2p',message_id:'om_reply',sender_id:user,sender_type:'user',chat_id:'oc_chat',root_id:'om_card',message_type:'text',content:'continue'};
 assert.equal(await f.bridge.reply({...r,chat_type:'group'}),'ignored');
 assert.equal(await f.bridge.reply({...r,reply_to:'om_other'}),'ignored');
 assert.equal(await f.bridge.reply(r),'accepted');
});
test('forked root sessions notify and subagent sessions do not',async()=>{
 for(const [header,count] of [[{parentSession:'prior'},1],[{origin:'subagent'},0]]){
  const f=fixture();f.session.header=header;
  await f.bridge.event(f.session,event('turn/start',{turn:1},1));
  await f.bridge.event(f.session,event('assistant/message',{turn:1,message:{content:[{type:'text',text:'done'}]}},2));
  await f.bridge.event(f.session,event('turn/end',{turn:1,reason:{kind:'completed'}},3));assert.equal(f.sent(),count);
 }
});
